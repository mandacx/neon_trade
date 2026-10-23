/**
 * Daily stock bars kept in Postgres (`nt_daily_bars`), so a stock page does not ask the market-data feed for the same
 * past days on every open, scroll-back chunk and levels request. Server-only.
 *
 *  - Days before today (US/Eastern) are final: fetched once, on demand, and stored.
 *    `nt_daily_bars_cover` records, per symbol, the date range already pulled (so weekends, holidays
 *    and days a symbol did not trade are not asked for again). Later requests fetch only the missing
 *    edge: older days when the user scrolls back, newer days since the last visit.
 *  - Today is never stored: it is the one live market-data call (a partial bar until the close), kept
 *    for LIVE_TTL_MS so the chart and levels requests of one page load share it.
 *  - A failed fetch stores nothing and records no coverage, so it is retried on the next request
 *    (what is already stored is still served). Primary source first, the fallback when it has no bars (indices such as SPX).
 *
 * `warmDailyBars()` fills the same tables for every tracked symbol in bulk (about 100 symbols a request), so a
 * first visit to a stock already finds its history: the one-time history plus the daily top-up, both run by the
 * market-catalog cron (and by /api/cron/daily-bars for a manual run).
 *
 * FEED: past days are consolidated (SIP) bars: real volume and the official OHLC (lib/marketdata). Coverage
 * rows record the feed (`feed = 'consolidated'`); coverage from before the switch (single-venue bars, feed
 * NULL) does not count, so those days are re-pulled and overwritten, while the old rows keep being served
 * until then.
 *
 * SPLITS: bars are split-adjusted as of the day they are pulled. The warm-up's daily top-up re-requests a
 * few stored sessions and compares closes (lib/splitCheck.ts); when they all moved by one ratio the symbol
 * had a split or reverse split, so its stored history is dropped (`invalidateDailyBars`) and re-pulled.
 */
import { sql } from '@/lib/db';
import { getDailyBarsChunk, getHistoricalBars, getSnapshotsMulti } from '@/lib/marketdata';
import { easternMidnightIso, getFallbackBars } from '@/lib/marketdata';
import { usTradingDayKey } from '@/lib/utils';
import { detectRebase } from '@/lib/splitCheck';
import { getScannerSymbols } from '@/lib/usUniverse';

export interface DailyBar { date: string; open: number; high: number; low: number; close: number; volume: number }
type Vendor = 'primary' | 'fallback';

/** How long today's live bar is reused. */
const LIVE_TTL_MS = 15_000;
/** Coverage written under the consolidated-feed rules; anything else is re-pulled. */
const COVER_FEED = 'consolidated';
/** Calendar days of already-stored history the daily top-up re-requests for the split check (~5 sessions). */
const SPLIT_OVERLAP_DAYS = 7;

const shiftDate = (date: string, days: number): string => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const todayET = (): string => usTradingDayKey(Math.floor(Date.now() / 1000));

let tableReady = false;
async function ensureTables(): Promise<void> {
  if (tableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS public.nt_daily_bars (
      symbol   TEXT NOT NULL,
      bar_date DATE NOT NULL,
      o NUMERIC NOT NULL, h NUMERIC NOT NULL, l NUMERIC NOT NULL, c NUMERIC NOT NULL, v BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (symbol, bar_date)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS public.nt_daily_bars_cover (
      symbol    TEXT PRIMARY KEY,
      from_date DATE NOT NULL,
      to_date   DATE NOT NULL,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE public.nt_daily_bars_cover ADD COLUMN IF NOT EXISTS feed TEXT`;
  tableReady = true;
}

/** Bars for [from, to] from the vendor. Throws when a vendor call fails, so nothing is recorded as covered. */
async function fetchRange(symbol: string, from: string, to: string): Promise<{ bars: DailyBar[]; source: Vendor }> {
  // `end` as a bare date is midnight, which would cut off the last day's bar.
  let raw = await getHistoricalBars(symbol, '1Day', from, shiftDate(to, 1));
  let source: Vendor = 'primary';
  if (raw.length === 0) {
    raw = await getFallbackBars(symbol, 'daily', from, to);
    source = 'fallback';
  }
  const bars: DailyBar[] = [];
  for (const b of raw) {
    const date = usTradingDayKey(Math.floor(new Date(b.t).getTime() / 1000));
    if (date < from || date > to) continue;
    if (![b.o, b.h, b.l, b.c].every(Number.isFinite) || !(b.c > 0)) continue;
    bars.push({ date, open: b.o, high: b.h, low: b.l, close: b.c, volume: Number(b.v) || 0 });
  }
  return { bars, source };
}

async function storeBars(symbol: string, bars: DailyBar[]): Promise<void> {
  if (bars.length === 0) return;
  await sql(
    `INSERT INTO public.nt_daily_bars (symbol, bar_date, o, h, l, c, v)
     SELECT $1, d, o, h, l, c, v FROM unnest($2::date[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::bigint[]) AS t(d, o, h, l, c, v)
     ON CONFLICT (symbol, bar_date) DO UPDATE SET o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l, c = EXCLUDED.c, v = EXCLUDED.v`,
    [symbol, bars.map(b => b.date), bars.map(b => b.open), bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close), bars.map(b => Math.round(b.volume))],
  );
}

/** The date ranges still to pull for a symbol whose stored coverage is `cover`, to have [from, to] covered. Always adjacent to the coverage, so it stays one contiguous range. */
function missingSegments(cover: { f: string; t: string } | undefined, from: string, to: string): Array<[string, string]> {
  if (!cover) return from <= to ? [[from, to]] : [];
  const out: Array<[string, string]> = [];
  if (from < cover.f) out.push([from, shiftDate(cover.f, -1)]);
  if (to > cover.t) out.push([shiftDate(cover.t, 1), to]);
  return out;
}

const inflight = new Map<string, Promise<Vendor | null>>();

/** Make sure the final days [from, to] (to < today) are stored, fetching only the missing edges. Resolves to the vendor used, or null when nothing was fetched. */
function ensureStored(symbol: string, from: string, to: string): Promise<Vendor | null> {
  const key = `${symbol}|${from}|${to}`;
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    await ensureTables();
    const row = (await sql`SELECT from_date::text AS f, to_date::text AS t, feed FROM public.nt_daily_bars_cover WHERE symbol = ${symbol}`)[0] as { f: string; t: string; feed: string | null } | undefined;
    // Coverage from the old single-venue feed does not count: the range is pulled again and overwritten.
    const cover = row && row.feed === COVER_FEED ? row : undefined;
    const segments = missingSegments(cover, from, to);
    if (segments.length === 0) return null;
    let used: Vendor = 'primary';
    for (const [a, b] of segments) {
      const { bars, source } = await fetchRange(symbol, a, b);
      used = source;
      await storeBars(symbol, bars);
    }
    const newFrom = cover && cover.f < from ? cover.f : from;
    const newTo = cover && cover.t > to ? cover.t : to;
    await sql`
      INSERT INTO public.nt_daily_bars_cover (symbol, from_date, to_date, checked_at, feed) VALUES (${symbol}, ${newFrom}::date, ${newTo}::date, now(), ${COVER_FEED})
      ON CONFLICT (symbol) DO UPDATE SET from_date = EXCLUDED.from_date, to_date = EXCLUDED.to_date, checked_at = now(), feed = EXCLUDED.feed
    `;
    return used;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const liveCache = new Map<string, { at: number; bar: DailyBar | null }>();

/**
 * Today's (partial) bar, or null before the open, on a non-trading day, or on failure.
 * Daily bars are consolidated but served 15 minutes late, so the delayed bar gives open, range and
 * volume, and the real-time snapshot's regular-session price is the close (also widening high/low).
 * In the first ~15 minutes after the open there is no delayed bar yet and the snapshot's own bar is
 * used (its volume is single-venue, so it is low until the delayed bar appears).
 */
async function liveBar(symbol: string, today: string): Promise<DailyBar | null> {
  const hit = liveCache.get(symbol);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.bar;
  try {
    const [{ bars }, snaps] = await Promise.all([
      fetchRange(symbol, today, today),
      getSnapshotsMulti([symbol]),
    ]);
    const delayed = bars.find(b => b.date === today) ?? null;
    const d = snaps[symbol]?.dailyBar;
    const rt = d && usTradingDayKey(Math.floor(Date.parse(d.t) / 1000)) === today && d.c > 0
      ? { date: today, open: d.o, high: d.h, low: d.l, close: d.c, volume: Number(d.v) || 0 }
      : null;
    const bar: DailyBar | null = delayed && rt
      ? { ...delayed, high: Math.max(delayed.high, rt.close), low: Math.min(delayed.low, rt.close), close: rt.close }
      : delayed ?? rt;
    liveCache.set(symbol, { at: Date.now(), bar });
    return bar;
  } catch (error) {
    console.error('[dailyBars] live bar failed:', error instanceof Error ? error.message : error);
    return hit?.bar ?? null;
  }
}

/**
 * Daily bars for [from, to] (inclusive, 'YYYY-MM-DD'), ascending. Past days come from the table (filled
 * on demand); today, when in range, is fetched live. Failures degrade to whatever is stored.
 */
export async function getDailyBars(symbolIn: string, from: string, to: string): Promise<{ bars: DailyBar[]; source: Vendor; error?: unknown }> {
  const symbol = symbolIn.toUpperCase();
  let error: unknown;
  const today = todayET();
  const pastTo = to < today ? to : shiftDate(today, -1);
  let source: Vendor = 'primary';

  const bars: DailyBar[] = [];
  if (from <= pastTo) {
    try {
      source = (await ensureStored(symbol, from, pastTo)) ?? source;
    } catch (err) {
      error = err;
      console.error('[dailyBars] fill failed:', err instanceof Error ? err.message : err);
    }
    try {
      await ensureTables();
      const rows = await sql`
        SELECT bar_date::text AS d, o::float8 AS o, h::float8 AS h, l::float8 AS l, c::float8 AS c, v::float8 AS v
        FROM public.nt_daily_bars WHERE symbol = ${symbol} AND bar_date BETWEEN ${from}::date AND ${pastTo}::date ORDER BY bar_date
      `;
      for (const r of rows as any[]) bars.push({ date: r.d, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v });
    } catch (error) {
      console.error('[dailyBars] read failed:', error instanceof Error ? error.message : error);
    }
  }

  if (from <= today && to >= today) {
    const live = await liveBar(symbol, today);
    if (live) bars.push(live);
  }
  // `error` is set when filling failed: with no bars to show, callers can report it instead of an empty chart.
  return { bars, source, error };
}

/** The same bars as neutral `Bar`s (`t` at US/Eastern midnight, as the feed stamps daily bars). */
export function toBars(bars: DailyBar[]) {
  return bars.map(b => ({ t: easternMidnightIso(b.date), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
}

/** Forget a symbol's stored bars so they are pulled again (e.g. after a split rewrote history). */
export async function invalidateDailyBars(symbolIn: string): Promise<void> {
  const symbol = symbolIn.toUpperCase();
  await ensureTables();
  await sql`DELETE FROM public.nt_daily_bars WHERE symbol = ${symbol}`;
  await sql`DELETE FROM public.nt_daily_bars_cover WHERE symbol = ${symbol}`;
  liveCache.delete(symbol);
}

/** Symbols with option levels on a recent load (same definition as the symbol search), plus the scanner universe. */
async function warmSymbols(): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT upper(symbol) AS symbol FROM public.nt_market_expiries
    WHERE source = 'eod' AND last_trade_date >= CURRENT_DATE - 30 AND symbol IS NOT NULL ORDER BY 1
  `;
  const tracked = (rows as any[]).map(r => r.symbol as string);
  const all = new Set([...tracked, ...(await getScannerSymbols())]);
  return [...all].filter(s => /^[A-Z0-9.\-]{1,10}$/.test(s)).sort();
}

export interface WarmResult {
  symbols: number;
  /** Symbols that needed bars (no current coverage, or days missing since their coverage ends). */
  planned: number;
  /** Symbols whose missing days were stored (or confirmed empty) this run. */
  filled: number;
  barsStored: number;
  /** Symbols the primary source returned nothing for and that we have never stored (indices, odd tickers): left to the lazy fallback path. */
  noBars: number;
  /** Symbols whose stored history no longer matched (split / reverse split): dropped, re-pulled next run. */
  rebased: Array<{ symbol: string; ratio: number }>;
  failedChunks: number;
  requests: number;
  /** False when the deadline or a failed request cut the run short (the next run resumes). */
  done: boolean;
}

type ChunkBars = Awaited<ReturnType<typeof getDailyBarsChunk>>;

/**
 * Bring every tracked and scanner symbol's stored bars up to yesterday (US/Eastern), and back to `days`
 * calendar days before today. Run daily this is a few requests (symbols with the same missing range share
 * them, ~100 a request); the first run for new symbols is their history backfill and resumes where it
 * stopped if `deadline` (epoch ms) cuts it short. A failed chunk is skipped and retried next run; coverage
 * is only extended for symbols whose chunk succeeded.
 *
 * The top-up range starts SPLIT_OVERLAP_DAYS before each symbol's coverage ends, so a few stored sessions
 * come back too; if they all moved by one ratio (lib/splitCheck.ts) the symbol is rebased: its bars and
 * coverage are dropped and the next run pulls its full history again.
 */
export async function warmDailyBars(opts: { symbols?: string[]; days?: number; deadline?: number } = {}): Promise<WarmResult> {
  await ensureTables();
  const today = todayET();
  const to = shiftDate(today, -1);
  const from = shiftDate(today, -(opts.days ?? 380));
  const symbols = opts.symbols?.map(s => s.toUpperCase()) ?? await warmSymbols();
  const result: WarmResult = { symbols: symbols.length, planned: 0, filled: 0, barsStored: 0, noBars: 0, rebased: [], failedChunks: 0, requests: 0, done: true };
  if (symbols.length === 0) return result;

  const covers = new Map<string, { f: string; t: string }>();
  const coverRows = await sql`SELECT symbol, from_date::text AS f, to_date::text AS t, feed FROM public.nt_daily_bars_cover WHERE symbol = ANY(${symbols}::text[])`;
  for (const r of coverRows as any[]) if (r.feed === COVER_FEED) covers.set(r.symbol, { f: r.f, t: r.t });

  // Symbols with the same missing range share requests. Top-ups (`overlap`) also re-read a few stored days.
  const groups = new Map<string, { a: string; b: string; overlap: boolean; symbols: string[] }>();
  const add = (a: string, b: string, overlap: boolean, sym: string) => {
    const key = `${a}|${b}|${overlap}`;
    const g = groups.get(key) ?? { a, b, overlap, symbols: [] };
    g.symbols.push(sym);
    groups.set(key, g);
  };
  for (const sym of symbols) {
    const cover = covers.get(sym);
    for (const [a, b] of missingSegments(cover, from, to)) {
      if (cover && a > cover.t) add(shiftDate(cover.t, -SPLIT_OVERLAP_DAYS), b, true, sym);
      else add(a, b, false, sym);
    }
  }
  const planned = new Set<string>();
  const filled = new Set<string>();
  const never = new Set<string>();
  groups.forEach(g => g.symbols.forEach(s => planned.add(s)));
  result.planned = planned.size;

  const CHUNK = 100;
  outer: for (const g of groups.values()) {
    for (let i = 0; i < g.symbols.length; i += CHUNK) {
      if (opts.deadline && Date.now() > opts.deadline) { result.done = false; break outer; }
      let chunk = g.symbols.slice(i, i + CHUNK);
      let bySymbol: ChunkBars;
      try {
        result.requests++;
        bySymbol = await getDailyBarsChunk(chunk, g.a, g.b);
      } catch (error) {
        result.failedChunks++;
        result.done = false;
        console.error('[dailyBars] warm chunk failed:', error instanceof Error ? error.message : error);
        continue;
      }
      const parsed = new Map<string, DailyBar[]>();
      for (const sym of chunk) {
        const list: DailyBar[] = [];
        for (const b of bySymbol[sym] ?? []) {
          const date = usTradingDayKey(Math.floor(new Date(b.t).getTime() / 1000));
          if (date < g.a || date > g.b) continue;
          if (![b.o, b.h, b.l, b.c].every(Number.isFinite) || !(b.c > 0)) continue;
          list.push({ date, open: b.o, high: b.h, low: b.l, close: b.c, volume: Number(b.v) || 0 });
        }
        parsed.set(sym, list);
      }

      if (g.overlap) {
        const cut = new Map(chunk.map(s => [s, covers.get(s)!.t]));
        const stored = await sql`
          SELECT symbol, bar_date::text AS d, c::float8 AS c FROM public.nt_daily_bars
          WHERE symbol = ANY(${chunk}::text[]) AND bar_date BETWEEN ${g.a}::date AND ${g.b}::date
        `;
        const storedBy = new Map<string, Array<{ date: string; close: number }>>();
        for (const r of stored as any[]) {
          if (r.d > cut.get(r.symbol)!) continue; // only days we held before this run
          const list = storedBy.get(r.symbol) ?? [];
          list.push({ date: r.d, close: r.c });
          storedBy.set(r.symbol, list);
        }
        const rebased: string[] = [];
        for (const sym of chunk) {
          const fresh = (parsed.get(sym) ?? []).filter(b => b.date <= cut.get(sym)!).map(b => ({ date: b.date, close: b.close }));
          const hit = detectRebase(storedBy.get(sym) ?? [], fresh);
          if (hit) {
            rebased.push(sym);
            result.rebased.push({ symbol: sym, ratio: Number(hit.ratio.toFixed(4)) });
          }
        }
        for (const sym of rebased) {
          console.log('[dailyBars] split/rebase detected, re-pulling history:', sym);
          await invalidateDailyBars(sym);
          parsed.delete(sym);
        }
        if (rebased.length > 0) {
          chunk = chunk.filter(s => !rebased.includes(s));
          result.done = false; // their full history is pulled next run
        }
      }

      const rows: Array<{ symbol: string; bar: DailyBar }> = [];
      const known: string[] = [];
      for (const sym of chunk) {
        const list = parsed.get(sym) ?? [];
        for (const bar of list) rows.push({ symbol: sym, bar });
        // A symbol with stored history that simply had no new bars (weekend, holiday) is still covered up to the end of the range.
        if (list.length > 0 || covers.has(sym)) known.push(sym);
        else never.add(sym);
      }
      for (let k = 0; k < rows.length; k += 10_000) {
        const part = rows.slice(k, k + 10_000);
        await sql(
          `INSERT INTO public.nt_daily_bars (symbol, bar_date, o, h, l, c, v)
           SELECT * FROM unnest($1::text[], $2::date[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::bigint[])
           ON CONFLICT (symbol, bar_date) DO UPDATE SET o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l, c = EXCLUDED.c, v = EXCLUDED.v`,
          [part.map(r => r.symbol), part.map(r => r.bar.date), part.map(r => r.bar.open), part.map(r => r.bar.high), part.map(r => r.bar.low), part.map(r => r.bar.close), part.map(r => Math.round(r.bar.volume))],
        );
      }
      result.barsStored += rows.length;
      if (known.length > 0) {
        // A re-pull after the feed switch replaces the old coverage outright; otherwise coverage only grows.
        await sql(
          `INSERT INTO public.nt_daily_bars_cover AS c (symbol, from_date, to_date, checked_at, feed)
           SELECT s, $2::date, $3::date, now(), $4 FROM unnest($1::text[]) AS s
           ON CONFLICT (symbol) DO UPDATE SET
             from_date = CASE WHEN c.feed IS DISTINCT FROM EXCLUDED.feed THEN EXCLUDED.from_date ELSE LEAST(c.from_date, EXCLUDED.from_date) END,
             to_date = CASE WHEN c.feed IS DISTINCT FROM EXCLUDED.feed THEN EXCLUDED.to_date ELSE GREATEST(c.to_date, EXCLUDED.to_date) END,
             checked_at = now(), feed = EXCLUDED.feed`,
          [known, g.a, g.b, COVER_FEED],
        );
        known.forEach(sym => filled.add(sym));
      }
    }
  }
  result.filled = filled.size;
  // Symbols the primary source has nothing for are left to the lazy path; they are not unfinished work.
  result.noBars = [...never].filter(sym => !filled.has(sym)).length;
  return result;
}
