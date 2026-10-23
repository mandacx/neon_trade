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
 * SPLITS ARE NOT HANDLED YET. The stored bars are split-adjusted, so after a split the stored days before it
 * are stale (unadjusted). `invalidateDailyBars()` drops a symbol's bars so they are re-pulled adjusted;
 * detecting a split and calling it is a planned follow-up (docs/CHANGES.md).
 */
import { sql } from '@/lib/db';
import { getDailyBarsChunk, getHistoricalBars } from '@/lib/marketdata';
import { easternMidnightIso, getFallbackBars } from '@/lib/marketdata';
import { usTradingDayKey } from '@/lib/utils';

export interface DailyBar { date: string; open: number; high: number; low: number; close: number; volume: number }
type Vendor = 'primary' | 'fallback';

/** How long today's live bar is reused. */
const LIVE_TTL_MS = 15_000;

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
    const cover = (await sql`SELECT from_date::text AS f, to_date::text AS t FROM public.nt_daily_bars_cover WHERE symbol = ${symbol}`)[0] as { f: string; t: string } | undefined;
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
      INSERT INTO public.nt_daily_bars_cover (symbol, from_date, to_date, checked_at) VALUES (${symbol}, ${newFrom}::date, ${newTo}::date, now())
      ON CONFLICT (symbol) DO UPDATE SET from_date = EXCLUDED.from_date, to_date = EXCLUDED.to_date, checked_at = now()
    `;
    return used;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const liveCache = new Map<string, { at: number; bar: DailyBar | null }>();

/** Today's (partial) bar, or null before the open, on a non-trading day, or on failure. */
async function liveBar(symbol: string, today: string): Promise<DailyBar | null> {
  const hit = liveCache.get(symbol);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.bar;
  try {
    const { bars } = await fetchRange(symbol, today, today);
    const bar = bars.find(b => b.date === today) ?? null;
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

/** Symbols with option levels on a recent load: the set the app shows (same definition as the symbol search). */
async function trackedSymbols(): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT upper(symbol) AS symbol FROM public.nt_market_expiries
    WHERE source = 'eod' AND last_trade_date >= CURRENT_DATE - 30 AND symbol IS NOT NULL ORDER BY 1
  `;
  return (rows as any[]).map(r => r.symbol as string).filter(s => /^[A-Z0-9.\-]{1,10}$/.test(s));
}

export interface WarmResult {
  symbols: number;
  /** Symbols that needed bars (no stored history, or days missing since their coverage ends). */
  planned: number;
  /** Symbols whose missing days were stored (or confirmed empty) this run. */
  filled: number;
  barsStored: number;
  /** Symbols the primary source returned nothing for and that we have never stored (indices, odd tickers): left to the lazy fallback path. */
  noBars: number;
  failedChunks: number;
  requests: number;
  /** False when the deadline or a failed request cut the run short (the next run resumes). */
  done: boolean;
}

type ChunkBars = Awaited<ReturnType<typeof getDailyBarsChunk>>;

/**
 * Bring every tracked symbol's stored bars up to yesterday (US/Eastern), and back to `days` calendar days
 * before today. Run daily this is one or two requests (a day for ~750 symbols fits one page); the first run
 * is the history backfill (~20 requests for a year of ~750 symbols) and resumes where it stopped if `deadline`
 * (epoch ms) cuts it short. A failed chunk is skipped and retried next run; coverage is only extended for
 * symbols whose chunk succeeded.
 */
export async function warmDailyBars(opts: { symbols?: string[]; days?: number; deadline?: number } = {}): Promise<WarmResult> {
  await ensureTables();
  const today = todayET();
  const to = shiftDate(today, -1);
  const from = shiftDate(today, -(opts.days ?? 380));
  const symbols = opts.symbols?.map(s => s.toUpperCase()) ?? await trackedSymbols();
  const result: WarmResult = { symbols: symbols.length, planned: 0, filled: 0, barsStored: 0, noBars: 0, failedChunks: 0, requests: 0, done: true };
  if (symbols.length === 0) return result;

  const covers = new Map<string, { f: string; t: string }>();
  const coverRows = await sql`SELECT symbol, from_date::text AS f, to_date::text AS t FROM public.nt_daily_bars_cover WHERE symbol = ANY(${symbols}::text[])`;
  for (const r of coverRows as any[]) covers.set(r.symbol, { f: r.f, t: r.t });

  // Symbols with the same missing range share requests.
  const groups = new Map<string, { a: string; b: string; symbols: string[] }>();
  for (const sym of symbols) {
    for (const [a, b] of missingSegments(covers.get(sym), from, to)) {
      const g = groups.get(`${a}|${b}`) ?? { a, b, symbols: [] };
      g.symbols.push(sym);
      groups.set(`${a}|${b}`, g);
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
      const chunk = g.symbols.slice(i, i + CHUNK);
      let bySymbol: ChunkBars;
      try {
        result.requests++;
        bySymbol = await getDailyBarsChunk(chunk, g.a, shiftDate(g.b, 1));
      } catch (error) {
        result.failedChunks++;
        result.done = false;
        console.error('[dailyBars] warm chunk failed:', error instanceof Error ? error.message : error);
        continue;
      }
      const rows: Array<{ symbol: string; bar: DailyBar }> = [];
      const known: string[] = [];
      for (const sym of chunk) {
        let any = false;
        for (const b of bySymbol[sym] ?? []) {
          const date = usTradingDayKey(Math.floor(new Date(b.t).getTime() / 1000));
          if (date < g.a || date > g.b) continue;
          if (![b.o, b.h, b.l, b.c].every(Number.isFinite) || !(b.c > 0)) continue;
          rows.push({ symbol: sym, bar: { date, open: b.o, high: b.h, low: b.l, close: b.c, volume: Number(b.v) || 0 } });
          any = true;
        }
        // A symbol with stored history that simply had no new bars (weekend, holiday) is still covered up to the end of the range.
        if (any || covers.has(sym)) known.push(sym);
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
        await sql(
          `INSERT INTO public.nt_daily_bars_cover (symbol, from_date, to_date, checked_at)
           SELECT s, $2::date, $3::date, now() FROM unnest($1::text[]) AS s
           ON CONFLICT (symbol) DO UPDATE SET from_date = LEAST(public.nt_daily_bars_cover.from_date, EXCLUDED.from_date),
             to_date = GREATEST(public.nt_daily_bars_cover.to_date, EXCLUDED.to_date), checked_at = now()`,
          [known, g.a, g.b],
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
