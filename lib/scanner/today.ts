/**
 * Today's (latest session's) consolidated daily bars for the whole scanner universe, shared by every
 * server instance through `nt_scanner_today`. Server-only.
 *
 * Why a table: the consolidated feed serves today's bar only 15 minutes late, and a batched request for
 * ~2,000 symbols takes 10-25 s (measured 2026-10-23), far too slow for a scan request. So one instance
 * refreshes the table in the background (`after()` in the route, under a lease) at most every
 * REFRESH_MS during the session, and once more after the close settles; scans read whatever is there.
 * Until a refresh lands, the scanner uses the live snapshot's own bar (single-venue volume) and says so.
 */
import { sql } from '@/lib/db';
import { getDailyBarsChunk } from '@/lib/marketdata';
import { acquireLease, releaseLease } from '@/lib/jobLease';
import type { DayBar } from './indicators.ts';
import { etDate } from './liveBar.ts';

const CHUNK = 500;
const PARALLEL = 4;

let ready = false;
async function ensureTable(): Promise<void> {
  if (ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS public.nt_scanner_today (
      symbol     TEXT PRIMARY KEY,
      bar_date   DATE NOT NULL,
      o NUMERIC NOT NULL, h NUMERIC NOT NULL, l NUMERIC NOT NULL, c NUMERIC NOT NULL, v BIGINT NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  ready = true;
}

export interface TodayBars { date: string; fetchedAt: string | null; bars: Map<string, DayBar> }

export async function readTodayBars(date: string): Promise<TodayBars> {
  await ensureTable();
  const rows = await sql`
    SELECT symbol, o::float8 AS o, h::float8 AS h, l::float8 AS l, c::float8 AS c, v::float8 AS v, (extract(epoch FROM fetched_at) * 1000)::float8 AS f
    FROM public.nt_scanner_today WHERE bar_date = ${date}::date
  `;
  const bars = new Map<string, DayBar>();
  let newest = 0;
  for (const r of rows as any[]) {
    bars.set(r.symbol, { date, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
    if (r.f > newest) newest = r.f; // one refresh writes every row, so the newest is the last refresh
  }
  return { date, fetchedAt: newest > 0 ? new Date(newest).toISOString() : null, bars };
}

/**
 * Fetch and store the latest session's consolidated bars for `symbols`. Only one instance runs it at a
 * time (lease); returns null when another holds it.
 */
export async function refreshTodayBars(symbols: string[], date: string): Promise<{ stored: number; failed: number; ms: number } | null> {
  await ensureTable();
  if (!(await acquireLease('scanner-today', 90))) return null;
  const t0 = Date.now();
  let stored = 0, failed = 0;
  try {
    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK));
    for (let i = 0; i < chunks.length; i += PARALLEL) {
      const parts = await Promise.all(chunks.slice(i, i + PARALLEL).map(async chunk => {
        try {
          return await getDailyBarsChunk(chunk, date, date);
        } catch (error) {
          failed += chunk.length;
          console.error('[scanner/today] chunk failed:', error instanceof Error ? error.message : error);
          return {};
        }
      }));
      const rows: Array<[string, DayBar]> = [];
      for (const part of parts) {
        for (const [sym, list] of Object.entries(part)) {
          const b = list.find(x => etDate(x.t) === date);
          if (b && b.o > 0 && b.c > 0) rows.push([sym, { date, o: b.o, h: b.h, l: b.l, c: b.c, v: Number(b.v) || 0 }]);
        }
      }
      if (rows.length > 0) {
        await sql(
          `INSERT INTO public.nt_scanner_today (symbol, bar_date, o, h, l, c, v, fetched_at)
           SELECT s, $2::date, o, h, l, c, v, now() FROM unnest($1::text[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::bigint[]) AS t(s, o, h, l, c, v)
           ON CONFLICT (symbol) DO UPDATE SET bar_date = EXCLUDED.bar_date, o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l, c = EXCLUDED.c, v = EXCLUDED.v, fetched_at = now()`,
          [rows.map(r => r[0]), date, rows.map(r => r[1].o), rows.map(r => r[1].h), rows.map(r => r[1].l), rows.map(r => r[1].c), rows.map(r => Math.round(r[1].v))],
        );
        stored += rows.length;
      }
    }
    await sql`DELETE FROM public.nt_scanner_today WHERE bar_date <> ${date}::date`;
  } finally {
    await releaseLease('scanner-today');
  }
  return { stored, failed, ms: Date.now() - t0 };
}
