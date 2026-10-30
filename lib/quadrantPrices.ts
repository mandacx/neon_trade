/**
 * Reference prices for the quadrant: the price each stock's levels are measured
 * against. Shared by every viewer and kept in Postgres (`nt_price_cache`), not
 * in memory, because on Vercel each serverless instance has its own heap.
 *
 *   latest load date  `getLatestPrices`
 *     regular session   last trade, refreshed at most every LIVE_TTL_MS (5 min)
 *                       no matter how many users are looking
 *     any other time    the last regular close, captured once after the close
 *                       (`final`) and served unchanged until the next regular
 *                       session opens (overnight, weekends, holidays included)
 *   past load dates   `getDayClosePrices`: the close of that date's own session
 *                       (immutable, stored once per date). Note the EOD table's
 *                       `close` for load date D is the close of session D-1.
 *
 * A failed market-data call never overwrites a good row; the old row is served.
 *
 * A stored row only vouches for the symbols it was captured for, and callers ask for different
 * symbol sets (the quadrant route passes the stocks of the selected expiry: 631 for the nearest
 * monthly, 6 for some weeklies). So a row is reused only for symbols it covers; missing symbols are
 * priced and merged into it. Symbols the vendor has no price for are stored as 0 ("attempted"), so
 * they are not asked for again on every request; 0 is never returned to callers.
 */
import { sql } from '@/lib/db';
import { getSnapshotsChunked, getDailyBarsMulti, getFallbackBars, INDEX_QUOTE_SYMBOLS } from '@/lib/marketdata';
import { getSnapshotsWithIndices } from '@/lib/snapshots';
import { getMarketState, type MarketSession } from '@/lib/marketSession';
import { buildQuote } from '@/lib/quote';

export const LIVE_TTL_MS = 5 * 60_000;
/** After the close, wait this long before treating a capture as the final close. */
const SETTLE_MS = 5 * 60_000;
/** Until then a not-yet-final capture is reused this long, so requests don't each refetch. */
const UNSETTLED_TTL_MS = 60_000;
/** Up to this many symbols without a price are taken as "the vendor has none", not as a failed fetch. */
const FEW_MISSING = 10;

export type PriceSource = 'live' | 'last-close' | 'day-close';

export interface ReferencePrices {
  prices: Record<string, number>;
  source: PriceSource;
  /** When the prices were read from the market-data vendor (ISO). */
  asOf: string | null;
  session: MarketSession | null;
  nextChangeAt: string | null;
}

interface CacheRow { sessionDate: string; takenAt: number; final: boolean; prices: Record<string, number> }

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS public.nt_price_cache (
      key          TEXT PRIMARY KEY,
      session_date TEXT NOT NULL,
      taken_at     TIMESTAMPTZ NOT NULL,
      final        BOOLEAN NOT NULL DEFAULT false,
      payload      JSONB NOT NULL
    )
  `;
  tableReady = true;
}

async function readRow(key: string): Promise<CacheRow | null> {
  await ensureTable();
  const rows = await sql`SELECT session_date, taken_at, final, payload FROM public.nt_price_cache WHERE key = ${key}`;
  if (rows.length === 0) return null;
  const r = rows[0] as { session_date: string; taken_at: string | Date; final: boolean; payload: Record<string, number> };
  return { sessionDate: r.session_date, takenAt: new Date(r.taken_at).getTime(), final: r.final, prices: r.payload };
}

async function writeRow(key: string, row: { sessionDate: string; takenAt: number; final: boolean; prices: Record<string, number> }): Promise<void> {
  await ensureTable();
  await sql`
    INSERT INTO public.nt_price_cache (key, session_date, taken_at, final, payload)
    VALUES (${key}, ${row.sessionDate}, ${new Date(row.takenAt).toISOString()}, ${row.final}, ${JSON.stringify(row.prices)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET session_date = EXCLUDED.session_date, taken_at = EXCLUDED.taken_at,
      final = EXCLUDED.final, payload = EXCLUDED.payload
  `;
}

/** Drop the 0 placeholders ("attempted, no price") before handing prices to callers. */
const priced = (prices: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(prices).filter(([, p]) => p > 0));

const hasAll = (prices: Record<string, number>, symbols: string[]) => symbols.every(s => s in prices);
const countPriced = (prices: Record<string, number>) => Object.values(prices).filter(p => p > 0).length;

const inflight = new Map<string, Promise<ReferencePrices>>();
// One load per key at a time. Keyed by the symbols as well: concurrent requests for different
// symbol sets must not share a result that covers only one of them.
const once = (key: string, symbols: string[], fn: () => Promise<ReferencePrices>) => {
  const k = `${key}|${symbols.length}|${symbols.slice(0, 3).join(',')}|${symbols[symbols.length - 1] ?? ''}`;
  const p = inflight.get(k) ?? fn().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
};

const LATEST_KEY = 'quadrant:latest';

/** Prices for the latest load date's stocks: live in the regular session, the last regular close otherwise. */
export function getLatestPrices(symbols: string[]): Promise<ReferencePrices> {
  return once(LATEST_KEY, symbols, () => loadLatest(symbols));
}

async function loadLatest(symbols: string[]): Promise<ReferencePrices> {
  const now = Date.now();
  const state = await getMarketState(new Date(now));
  const row = await readRow(LATEST_KEY).catch(err => { console.error('[quadrantPrices] read failed:', err); return null; });
  const live = state.session === 'regular';
  const asResult = (r: CacheRow): ReferencePrices => ({
    prices: priced(r.prices), source: live ? 'live' : 'last-close', asOf: new Date(r.takenAt).toISOString(),
    session: state.session, nextChangeAt: state.nextChangeAt,
  });
  const sameSession = !!row && row.sessionDate === state.lastSessionDate;

  if (row && sameSession) {
    if (live ? now - row.takenAt < LIVE_TTL_MS : row.final || now - row.takenAt < UNSETTLED_TTL_MS) {
      if (hasAll(row.prices, symbols)) return asResult(row);
      // Captured for other symbols (e.g. another expiry): price only the missing ones and add them,
      // keeping the capture's time and `final` flag so its refresh schedule is unchanged.
      const missing = symbols.filter(s => !(s in row.prices));
      const extra = await priceSymbols(missing, state);
      // Nothing priced among many missing symbols means the vendor failed: serve what we have and store
      // nothing. A handful of symbols with no price (indices) is normal: remember the attempt.
      if (countPriced(extra) === 0 && missing.length > FEW_MISSING) return asResult(row);
      const merged: CacheRow = { ...row, prices: { ...row.prices, ...extra } };
      await writeRow(LATEST_KEY, merged).catch(err => console.error('[quadrantPrices] write failed:', err));
      return asResult(merged);
    }
  }

  // Refresh. Include the symbols the previous capture covered, so one request for a small set can't
  // shrink the cache that a request for the full set relies on.
  const wanted = Array.from(new Set([...symbols, ...(row && sameSession ? Object.keys(row.prices) : [])]));
  const prices = await priceSymbols(wanted, state);
  if (countPriced(prices) === 0) {
    // Vendor failed: serve the previous capture (if it is from the same session) rather than nothing.
    if (row && sameSession) return asResult(row);
    return { prices: {}, source: live ? 'live' : 'last-close', asOf: null, session: state.session, nextChangeAt: state.nextChangeAt };
  }
  const fresh: CacheRow = {
    sessionDate: state.lastSessionDate,
    takenAt: now,
    final: !live && now >= Date.parse(state.lastCloseAt) + SETTLE_MS,
    prices,
  };
  await writeRow(LATEST_KEY, fresh).catch(err => console.error('[quadrantPrices] write failed:', err));
  return asResult(fresh);
}

/** Current prices for `symbols` (0 where the vendor has none, so the attempt is remembered). */
async function priceSymbols(symbols: string[], state: Awaited<ReturnType<typeof getMarketState>>): Promise<Record<string, number>> {
  const out: Record<string, number> = Object.fromEntries(symbols.map(s => [s, 0]));
  if (symbols.length === 0) return out;
  const snaps = await getSnapshotsWithIndices(symbols, getSnapshotsChunked);
  for (const [sym, snap] of Object.entries(snaps)) {
    const p = buildQuote(snap, state).price;
    if (p) out[sym] = p;
  }
  return out;
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Close of `date`'s own session for these symbols (stored once; a closed session never changes). */
export function getDayClosePrices(date: string, symbols: string[]): Promise<ReferencePrices> {
  return once(`quadrant:close:${date}`, symbols, () => loadDayClose(date, symbols));
}

async function loadDayClose(date: string, symbols: string[]): Promise<ReferencePrices> {
  const key = `quadrant:close:${date}`;
  const base = { source: 'day-close' as const, session: null, nextChangeAt: null };
  const row = await readRow(key).catch(() => null);
  if (row && hasAll(row.prices, symbols)) return { ...base, prices: priced(row.prices), asOf: new Date(row.takenAt).toISOString() };

  // Nothing stored yet, or stored for other symbols: fetch the closes for the ones we don't have.
  const missing = row ? symbols.filter(s => !(s in row.prices)) : symbols;
  const closes = await dayCloses(date, missing);
  const takenAt = Date.now();
  // Store only a reasonably complete capture, so a partly failed fetch is retried next time.
  const complete = countPriced(closes) >= missing.length * 0.8 || (row !== null && missing.length <= FEW_MISSING);
  const merged = { ...(row?.prices ?? {}), ...closes };
  if (complete) {
    await writeRow(key, { sessionDate: date, takenAt: row?.takenAt ?? takenAt, final: true, prices: merged }).catch(err => console.error('[quadrantPrices] write failed:', err));
  }
  return { ...base, prices: priced(complete ? merged : { ...(row?.prices ?? {}), ...closes }), asOf: new Date(row?.takenAt ?? takenAt).toISOString() };
}

/** The close of `date`'s own session for each symbol (0 where there is no bar). */
async function dayCloses(date: string, symbols: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = Object.fromEntries(symbols.map(s => [s, 0]));
  if (symbols.length === 0) return out;
  const bars = await getDailyBarsMulti(symbols, date, nextDay(date));
  for (const [sym, list] of Object.entries(bars)) {
    const bar = list.find(b => b.date === date);
    if (bar?.close) out[sym] = bar.close;
  }
  // The primary feed has no bars for SPX / NDX: read their close from the fallback source.
  await Promise.all(symbols.filter(s => INDEX_QUOTE_SYMBOLS.has(s) && !out[s]).map(async s => {
    try {
      const rows = await getFallbackBars(s, 'daily', date, date);
      const close = rows.length ? rows[rows.length - 1].c : 0;
      if (close) out[s] = close;
    } catch (err) {
      console.error(`[quadrantPrices] index close failed for ${s}:`, err instanceof Error ? err.message : err);
    }
  }));
  return out;
}
