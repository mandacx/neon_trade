/**
 * The US scanner universe (`nt_us_universe`): every listed US common stock and ETF, with exchange,
 * ETF/ADR flags, sector/industry/market cap, index membership and 20-session liquidity. Server-only.
 * Design and runbook: docs/us-scanner.md.
 *
 *   listings   Nasdaq Trader symbol directory (lib/referenceData/listings.ts), weekly
 *   indexes    S&P 500 / Dow 30 / Nasdaq-100 from issuer holdings (lib/referenceData/indexHoldings.ts), weekly
 *   liquidity  last 20 settled sessions of consolidated daily bars for every active listing, weekly,
 *              paced and resumable (`nt_us_universe_jobs` remembers the run)
 *   top1000    the "≈ Russell 1000" flag: top 1000 non-ADR common stocks by market cap (no public
 *              Russell file is reachable; the UI says it is an approximation)
 *   meta       sector / industry / market cap from yfinance, pushed by the Railway Python worker
 *              through /api/cron/us-universe-meta (no DB credentials on Railway)
 *
 * In the scanner = active AND (liquid OR in any index list). Liquid = last close >= $5 and 20-session
 * average dollar volume >= $50M (about 1,900 names; $10M let in 3,500). No step ever clears data because a fetch failed.
 */
import { sql } from '@/lib/db';
import { getDailyBarsPaced } from '@/lib/marketdata';
import { fetchListings } from '@/lib/referenceData/listings';
import { fetchIndexMembers, type IndexCode } from '@/lib/referenceData/indexHoldings';
import { usTradingDayKey } from '@/lib/utils';
import { liquidityFrom } from '@/lib/usUniverseRules';

/** A weekly step counts as fresh for this long; a run started within it is resumed, not restarted. */
const STEP_FRESH_MS = 6 * 86_400_000;
const META_STALE_DAYS = 7;

export const IN_SCANNER_SQL = `is_active AND (is_liquid OR in_sp500 OR in_ndx100 OR in_dow30 OR in_top1000)`;

/** Yahoo's sector names → the 11 GICS sector names. */
export const GICS_SECTORS = [
  'Communication Services', 'Consumer Discretionary', 'Consumer Staples', 'Energy', 'Financials', 'Health Care',
  'Industrials', 'Information Technology', 'Materials', 'Real Estate', 'Utilities',
] as const;
const YAHOO_TO_GICS: Record<string, string> = {
  'Technology': 'Information Technology', 'Healthcare': 'Health Care', 'Consumer Cyclical': 'Consumer Discretionary',
  'Consumer Defensive': 'Consumer Staples', 'Financial Services': 'Financials', 'Basic Materials': 'Materials',
  'Communication Services': 'Communication Services', 'Industrials': 'Industrials', 'Utilities': 'Utilities',
  'Real Estate': 'Real Estate', 'Energy': 'Energy',
};
export function toGicsSector(s: string | null | undefined): string | null {
  if (!s) return null;
  return YAHOO_TO_GICS[s] ?? ((GICS_SECTORS as readonly string[]).includes(s) ? s : null);
}
const GICS_CASE_SQL = `CASE s.sector ${Object.entries(YAHOO_TO_GICS).map(([y, g]) => `WHEN '${y.replace(/'/g, "''")}' THEN '${g}'`).join(' ')} ELSE NULL END`;

const shiftDate = (date: string, days: number): string => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const todayET = (): string => usTradingDayKey(Math.floor(Date.now() / 1000));

let ready = false;
export async function ensureUniverseTables(): Promise<void> {
  if (ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS public.nt_us_universe (
      symbol            TEXT PRIMARY KEY,
      name              TEXT,
      exchange          TEXT,
      kind              TEXT NOT NULL DEFAULT 'stock',
      is_adr            BOOLEAN NOT NULL DEFAULT false,
      sector            TEXT,
      industry          TEXT,
      market_cap        BIGINT,
      in_sp500          BOOLEAN NOT NULL DEFAULT false,
      in_ndx100         BOOLEAN NOT NULL DEFAULT false,
      in_dow30          BOOLEAN NOT NULL DEFAULT false,
      in_top1000        BOOLEAN NOT NULL DEFAULT false,
      last_close        NUMERIC,
      avg_vol_20        NUMERIC,
      avg_dollar_vol_20 NUMERIC,
      bars_20           INT,
      is_liquid         BOOLEAN NOT NULL DEFAULT false,
      is_active         BOOLEAN NOT NULL DEFAULT true,
      listed_seen_at    TIMESTAMPTZ,
      meta_at           TIMESTAMPTZ,
      meta_error        TEXT,
      liquidity_at      TIMESTAMPTZ,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS nt_us_universe_scan_idx ON public.nt_us_universe (is_active, is_liquid)`;
  await sql`
    CREATE TABLE IF NOT EXISTS public.nt_us_universe_jobs (
      step           TEXT PRIMARY KEY,
      run_started_at TIMESTAMPTZ,
      done_at        TIMESTAMPTZ,
      info           JSONB
    )
  `;
  ready = true;
}

async function jobState(step: string): Promise<{ started: string | null; done: string | null }> {
  const rows = await sql`SELECT run_started_at::text AS s, done_at::text AS d FROM public.nt_us_universe_jobs WHERE step = ${step}`;
  const r = rows[0] as { s: string | null; d: string | null } | undefined;
  return { started: r?.s ?? null, done: r?.d ?? null };
}

async function markJob(step: string, patch: { started?: boolean; done?: boolean; info?: unknown }): Promise<void> {
  await sql`
    INSERT INTO public.nt_us_universe_jobs AS j (step, run_started_at, done_at, info)
    VALUES (${step}, ${patch.started ? new Date().toISOString() : null}::timestamptz, ${patch.done ? new Date().toISOString() : null}::timestamptz, ${patch.info === undefined ? null : JSON.stringify(patch.info)}::jsonb)
    ON CONFLICT (step) DO UPDATE SET
      run_started_at = CASE WHEN ${!!patch.started} THEN EXCLUDED.run_started_at ELSE j.run_started_at END,
      done_at        = CASE WHEN ${!!patch.done} THEN EXCLUDED.done_at WHEN ${!!patch.started} THEN NULL ELSE j.done_at END,
      info           = COALESCE(EXCLUDED.info, j.info)
  `;
}

const isFresh = (done: string | null) => !!done && Date.now() - Date.parse(done) < STEP_FRESH_MS;

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export async function syncListings(opts: { force?: boolean } = {}): Promise<Record<string, unknown>> {
  await ensureUniverseTables();
  if (!opts.force && isFresh((await jobState('listings')).done)) return { skipped: 'fresh' };
  const listings = await fetchListings();
  const started = new Date().toISOString();
  for (let i = 0; i < listings.length; i += 5000) {
    const part = listings.slice(i, i + 5000);
    await sql(
      `INSERT INTO public.nt_us_universe AS u (symbol, name, exchange, kind, is_adr, is_active, listed_seen_at, updated_at)
       SELECT s, n, e, k, a, true, now(), now() FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::bool[]) AS t(s, n, e, k, a)
       ON CONFLICT (symbol) DO UPDATE SET
         name = CASE WHEN u.meta_at IS NULL OR u.name IS NULL THEN EXCLUDED.name ELSE u.name END,
         exchange = EXCLUDED.exchange, kind = EXCLUDED.kind, is_adr = EXCLUDED.is_adr,
         is_active = true, listed_seen_at = now(), updated_at = now()`,
      [part.map(l => l.symbol), part.map(l => l.name), part.map(l => l.exchange), part.map(l => l.kind), part.map(l => l.isAdr)],
    );
  }
  // Gone from the directory = delisted (or now a non-common instrument). Rows are kept, just inactive.
  const gone = await sql`
    UPDATE public.nt_us_universe SET is_active = false, updated_at = now()
    WHERE is_active AND (listed_seen_at IS NULL OR listed_seen_at < ${started}::timestamptz) RETURNING symbol
  `;
  // Metadata we already hold for the option-levels symbols (securities, yfinance-sourced).
  const seeded = await sql(`
    UPDATE public.nt_us_universe u SET
      name = COALESCE(NULLIF(s.name, ''), u.name), sector = ${GICS_CASE_SQL}, industry = s.industry,
      market_cap = NULLIF(s.market_cap, 0), meta_at = COALESCE(s.last_refreshed, now()), updated_at = now()
    FROM public.securities s
    WHERE upper(s.symbol) = u.symbol AND u.meta_at IS NULL AND u.kind = 'stock' AND s.sector IS NOT NULL
    RETURNING u.symbol
  `);
  const info = { listings: listings.length, deactivated: gone.length, seededFromSecurities: seeded.length };
  await markJob('listings', { started: true, done: true, info });
  return info;
}

// ---------------------------------------------------------------------------
// Index flags
// ---------------------------------------------------------------------------

const INDEX_COLUMN: Record<IndexCode, string> = { SP500: 'in_sp500', NDX100: 'in_ndx100', DOW30: 'in_dow30' };

export async function syncIndexFlags(opts: { force?: boolean } = {}): Promise<Record<string, unknown>> {
  await ensureUniverseTables();
  if (!opts.force && isFresh((await jobState('indexes')).done)) return { skipped: 'fresh' };
  const out: Record<string, unknown> = {};
  let allOk = true;
  for (const code of Object.keys(INDEX_COLUMN) as IndexCode[]) {
    try {
      const { tickers, asOf } = await fetchIndexMembers(code);
      const col = INDEX_COLUMN[code];
      await sql(`UPDATE public.nt_us_universe SET ${col} = (symbol = ANY($1::text[])), updated_at = now() WHERE ${col} <> (symbol = ANY($1::text[]))`, [tickers]);
      const known = await sql(`SELECT symbol FROM public.nt_us_universe WHERE symbol = ANY($1::text[])`, [tickers]);
      const knownSet = new Set((known as Array<{ symbol: string }>).map(r => r.symbol));
      out[code] = { members: tickers.length, asOf, notListed: tickers.filter(t => !knownSet.has(t)) };
    } catch (error) {
      allOk = false;
      out[code] = { error: error instanceof Error ? error.message : String(error) }; // previous flags stay
    }
  }
  await markJob('indexes', { started: true, done: allOk, info: out });
  return out;
}

// ---------------------------------------------------------------------------
// Liquidity (weekly, resumable)
// ---------------------------------------------------------------------------

export async function refreshLiquidity(opts: { deadline: number; force?: boolean }): Promise<Record<string, unknown>> {
  await ensureUniverseTables();
  let state = await jobState('liquidity');
  if (!opts.force && isFresh(state.done)) return { skipped: 'fresh' };
  if (!state.started || state.done || opts.force) {
    await markJob('liquidity', { started: true });
    state = await jobState('liquidity');
  }
  const today = todayET();
  const from = shiftDate(today, -45); // ~30 sessions, comfortably more than 20
  const to = shiftDate(today, -1);
  let processed = 0, liquid = 0, failed = 0, requests = 0;
  for (;;) {
    if (Date.now() > opts.deadline) break;
    const batch = (await sql`
      SELECT symbol FROM public.nt_us_universe
      WHERE is_active AND (liquidity_at IS NULL OR liquidity_at < ${state.started}::timestamptz)
      ORDER BY symbol LIMIT 500
    `).map((r: any) => r.symbol as string);
    if (batch.length === 0) {
      const top = await refreshTop1000();
      const info = { ...(await liquiditySummary()), top1000: top };
      await markJob('liquidity', { done: true, info });
      return { processed, liquid, failed, requests, done: true, ...info };
    }
    const res = await getDailyBarsPaced(batch, from, to, { deadline: opts.deadline });
    requests += res.requests;
    const failedSet = new Set(res.failed);
    failed += failedSet.size;
    const tried = batch.filter(s => !failedSet.has(s));
    // Symbols the deadline cut off were never requested: leave them for the next run.
    const requested = res.done ? tried : tried.filter(s => s in res.bars);
    if (requested.length === 0 && !res.done) break;
    const rows = requested.map(s => ({ s, ...liquidityFrom(res.bars[s] ?? []) }));
    await sql(
      `UPDATE public.nt_us_universe u SET last_close = t.c, avg_vol_20 = t.v, avg_dollar_vol_20 = t.dv, bars_20 = t.n, is_liquid = t.l,
         liquidity_at = now(), updated_at = now()
       FROM unnest($1::text[], $2::numeric[], $3::numeric[], $4::numeric[], $5::int[], $6::bool[]) AS t(s, c, v, dv, n, l)
       WHERE u.symbol = t.s`,
      [rows.map(r => r.s), rows.map(r => r.lastClose), rows.map(r => Math.round(r.avgVol)), rows.map(r => Math.round(r.avgDollarVol)), rows.map(r => r.n), rows.map(r => r.liquid)],
    );
    processed += rows.length;
    liquid += rows.filter(r => r.liquid).length;
    if (failedSet.size > 0 && failedSet.size === batch.length) break; // the feed is down: stop, resume next run
  }
  return { processed, liquid, failed, requests, done: false };
}

async function liquiditySummary(): Promise<Record<string, number>> {
  const [r] = await sql(`
    SELECT count(*) FILTER (WHERE is_active)::int AS active,
           count(*) FILTER (WHERE is_active AND is_liquid)::int AS liquid,
           count(*) FILTER (WHERE ${IN_SCANNER_SQL})::int AS in_scanner,
           count(*) FILTER (WHERE ${IN_SCANNER_SQL} AND kind = 'etf')::int AS etfs_in_scanner
    FROM public.nt_us_universe
  `) as Array<Record<string, number>>;
  return r;
}

/** "≈ Russell 1000": the 1000 largest active non-ADR common stocks by market cap. */
export async function refreshTop1000(): Promise<number> {
  await sql`
    WITH ranked AS (
      SELECT symbol, row_number() OVER (ORDER BY market_cap DESC) AS rn
      FROM public.nt_us_universe WHERE is_active AND kind = 'stock' AND NOT is_adr AND market_cap > 0
    )
    UPDATE public.nt_us_universe u SET in_top1000 = COALESCE(r.rn <= 1000, false), updated_at = now()
    FROM public.nt_us_universe u2 LEFT JOIN ranked r ON r.symbol = u2.symbol
    WHERE u.symbol = u2.symbol AND u.in_top1000 IS DISTINCT FROM COALESCE(r.rn <= 1000, false)
  `;
  const [{ n }] = (await sql`SELECT count(*)::int AS n FROM public.nt_us_universe WHERE in_top1000`) as Array<{ n: number }>;
  return n;
}

// ---------------------------------------------------------------------------
// Metadata (sector / industry / market cap) from the Railway worker
// ---------------------------------------------------------------------------

/** Scanner stocks whose metadata is missing or older than a week, most liquid first. */
export async function pendingMetaSymbols(limit: number): Promise<string[]> {
  await ensureUniverseTables();
  const rows = await sql(`
    SELECT symbol FROM public.nt_us_universe
    WHERE ${IN_SCANNER_SQL} AND kind = 'stock' AND (meta_at IS NULL OR meta_at < now() - interval '${META_STALE_DAYS} days')
    ORDER BY meta_at NULLS FIRST, avg_dollar_vol_20 DESC NULLS LAST LIMIT $1
  `, [Math.max(1, Math.min(limit, 500))]);
  return (rows as Array<{ symbol: string }>).map(r => r.symbol);
}

export interface MetaInput { name?: string | null; sector?: string | null; industry?: string | null; marketCap?: number | null; error?: string | null }

export async function applyMeta(results: Record<string, MetaInput>): Promise<{ updated: number; errors: number }> {
  await ensureUniverseTables();
  const entries = Object.entries(results).filter(([s]) => /^[A-Z]{1,6}(\.[A-Z])?$/.test(s)).slice(0, 1000);
  const ok = entries.filter(([, m]) => !m.error);
  const bad = entries.filter(([, m]) => !!m.error);
  if (ok.length > 0) {
    await sql(
      `UPDATE public.nt_us_universe u SET
         name = COALESCE(NULLIF(t.n, ''), u.name), sector = COALESCE(t.sec, u.sector), industry = COALESCE(NULLIF(t.ind, ''), u.industry),
         market_cap = COALESCE(t.cap, u.market_cap), meta_at = now(), meta_error = NULL, updated_at = now()
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::bigint[]) AS t(s, n, sec, ind, cap)
       WHERE u.symbol = t.s`,
      [ok.map(([s]) => s), ok.map(([, m]) => m.name ?? null), ok.map(([, m]) => toGicsSector(m.sector)), ok.map(([, m]) => m.industry ?? null),
        ok.map(([, m]) => (Number.isFinite(Number(m.marketCap)) && Number(m.marketCap) > 0 ? Math.round(Number(m.marketCap)) : null))],
    );
  }
  if (bad.length > 0) {
    // Unknown to the metadata source: don't ask again for a week.
    await sql(
      `UPDATE public.nt_us_universe u SET meta_at = now(), meta_error = t.e, updated_at = now()
       FROM unnest($1::text[], $2::text[]) AS t(s, e) WHERE u.symbol = t.s`,
      [bad.map(([s]) => s), bad.map(([, m]) => String(m.error).slice(0, 200))],
    );
  }
  return { updated: ok.length, errors: bad.length };
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export interface UniverseRow {
  symbol: string;
  name: string | null;
  exchange: string | null;
  kind: 'stock' | 'etf';
  isAdr: boolean;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  inSp500: boolean;
  inNdx100: boolean;
  inDow30: boolean;
  inTop1000: boolean;
  isLiquid: boolean;
}

/** Every symbol in the scanner, with its metadata. Throws if the table is missing (caller reports it). */
export async function getScannerUniverse(): Promise<UniverseRow[]> {
  const rows = await sql(`
    SELECT symbol, name, exchange, kind, is_adr, sector, industry, market_cap::float8 AS market_cap,
           in_sp500, in_ndx100, in_dow30, in_top1000, is_liquid
    FROM public.nt_us_universe WHERE ${IN_SCANNER_SQL} ORDER BY symbol
  `);
  return (rows as any[]).map(r => ({
    symbol: r.symbol, name: r.name, exchange: r.exchange, kind: r.kind === 'etf' ? 'etf' : 'stock', isAdr: !!r.is_adr,
    sector: r.sector, industry: r.industry, marketCap: r.market_cap != null ? Number(r.market_cap) : null,
    inSp500: !!r.in_sp500, inNdx100: !!r.in_ndx100, inDow30: !!r.in_dow30, inTop1000: !!r.in_top1000, isLiquid: !!r.is_liquid,
  }));
}

/** Scanner symbols only; [] when the table does not exist yet (so callers such as the bar warm-up degrade). */
export async function getScannerSymbols(): Promise<string[]> {
  try {
    const rows = await sql(`SELECT symbol FROM public.nt_us_universe WHERE ${IN_SCANNER_SQL}`);
    return (rows as Array<{ symbol: string }>).map(r => r.symbol);
  } catch {
    return [];
  }
}
