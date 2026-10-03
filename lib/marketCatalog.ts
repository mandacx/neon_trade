/**
 * Market date catalog: small summary tables of which trade dates and which
 * (symbol, expiry) pairs exist in the big market tables, so pages never
 * DISTINCT/MAX across millions of rows to answer "what's the latest date" or
 * "which expiries are listed".
 *
 *   nt_market_dates     one row per (source, trade_date) + row/symbol counts
 *   nt_market_expiries  one row per (source, symbol, expiry_dt) + the first
 *                       and last trade date that expiry was seen on — this is
 *                       what tracks expiries being added/rolled day to day
 *
 * Sources: 'eod' = eod_usmkts_price (trade_date), 'opt_chg' = us_opt_chg_rpt
 * (load_dt). Both are loaded once per trading day, and the external daily
 * load script upserts that day's rows here right after loading
 * (scripts/sql/market-catalog-daily.sql; scripts/bootstrap-market-catalog.mjs
 * creates and backfills the tables). As a safety net for a load that ran
 * without that upsert, app/api/cron/market-catalog calls catchUpMarketCatalog()
 * every 30 min through the morning load window.
 *
 * intra_us_scanner_eod is deliberately NOT catalogued: scan alerts land every
 * 15 min intraday, so a daily snapshot would hide today's alerts all day.
 *
 * Readers fall back to the live table whenever the catalog has nothing for a
 * question (not bootstrapped yet, table missing), so the catalog is purely an
 * accelerator — if the loader ever skips the upsert, the pages show the last
 * catalogued day rather than breaking.
 *
 * `nt_` prefix: this database is shared with neon_nifty (see
 * scripts/bootstrap-app-tables.mjs).
 */
import { sql } from '@/lib/db';

export type CatalogSource = 'eod' | 'opt_chg';

// Identifiers are interpolated into SQL text below, so they must only ever
// come from this fixed map — never from request input.
const SOURCES: Record<CatalogSource, { table: string; symbol: string; date: string }> = {
  eod: { table: 'public.eod_usmkts_price', symbol: 'symbol', date: 'trade_date' },
  opt_chg: { table: 'public.us_opt_chg_rpt', symbol: 'symbol_und', date: 'load_dt' },
};

export interface CatalogCatchUpResult {
  source: CatalogSource;
  /** Latest catalogued date before this run. */
  catalogLatest: string | null;
  /** current: catalog already had today, source untouched. no-new-data: nothing loaded yet. caught-up: missing days added. */
  status: 'current' | 'no-new-data' | 'caught-up';
  addedDates: string[];
}

/**
 * Safety net for the loader's daily upsert. Per source: if the catalog
 * already has `today`, the source table isn't touched at all. Otherwise one
 * index probe asks whether the source has anything newer than the catalog,
 * and only then are those days aggregated and upserted (same statements as
 * scripts/sql/market-catalog-daily.sql, over `> latest` instead of `= day`).
 * Relies on the date indexes from scripts/add-date-indexes.mjs to stay cheap.
 */
export async function catchUpMarketCatalog(today: string): Promise<CatalogCatchUpResult[]> {
  const results: CatalogCatchUpResult[] = [];
  for (const source of Object.keys(SOURCES) as CatalogSource[]) {
    const { table, symbol, date } = SOURCES[source];

    const [{ latest }] = (await sql`
      SELECT MAX(trade_date)::text AS latest FROM public.nt_market_dates WHERE source = ${source}
    `) as Array<{ latest: string | null }>;

    if (latest && latest >= today) {
      results.push({ source, catalogLatest: latest, status: 'current', addedDates: [] });
      continue;
    }

    // A source the bootstrap never covered is caught up from the beginning.
    const since = latest ?? '0001-01-01';
    const [{ newest }] = (await sql(
      `SELECT MAX(${date})::text AS newest FROM ${table} WHERE ${date} > $1::date`,
      [since]
    )) as Array<{ newest: string | null }>;
    if (!newest) {
      results.push({ source, catalogLatest: latest, status: 'no-new-data', addedDates: [] });
      continue;
    }

    const [dateRows] = await sql.transaction([
      sql(
        `INSERT INTO public.nt_market_dates (source, trade_date, row_count, symbol_count)
         SELECT $1, ${date}, COUNT(*), COUNT(DISTINCT ${symbol})
         FROM ${table}
         WHERE ${date} > $2::date
         GROUP BY ${date}
         ON CONFLICT (source, trade_date) DO UPDATE SET
           row_count    = EXCLUDED.row_count,
           symbol_count = EXCLUDED.symbol_count,
           refreshed_at = now()
         RETURNING trade_date::text AS d`,
        [source, since]
      ),
      sql(
        `INSERT INTO public.nt_market_expiries AS e (source, symbol, expiry_dt, first_trade_date, last_trade_date)
         SELECT $1, UPPER(${symbol}), expiry_dt, MIN(${date}), MAX(${date})
         FROM ${table}
         WHERE ${date} > $2::date AND expiry_dt IS NOT NULL AND ${symbol} IS NOT NULL
         GROUP BY UPPER(${symbol}), expiry_dt
         ON CONFLICT (source, symbol, expiry_dt) DO UPDATE SET
           first_trade_date = LEAST(e.first_trade_date, EXCLUDED.first_trade_date),
           last_trade_date  = GREATEST(e.last_trade_date, EXCLUDED.last_trade_date),
           refreshed_at     = now()`,
        [source, since]
      ),
    ]);
    results.push({
      source,
      catalogLatest: latest,
      status: 'caught-up',
      addedDates: (dateRows as Array<{ d: string }>).map(r => r.d).sort(),
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Readers. Each takes the live query as `fallback`, used when the catalog
// returns nothing or errors (e.g. before the bootstrap script has run).
// ---------------------------------------------------------------------------

async function withFallback<T>(catalog: () => Promise<T[]>, fallback: () => Promise<T[]>): Promise<T[]> {
  try {
    const rows = await catalog();
    if (rows.length > 0) return rows;
  } catch (err) {
    console.warn('[marketCatalog] catalog read failed, using live query:', err instanceof Error ? err.message : err);
  }
  return fallback();
}

/** Most recent `limit` trade dates for a source, newest first. */
export function catalogTradeDates(source: CatalogSource, limit: number, fallback: () => Promise<string[]>): Promise<string[]> {
  return withFallback(async () => {
    const rows = await sql`
      SELECT trade_date::text AS d FROM public.nt_market_dates
      WHERE source = ${source}
      ORDER BY trade_date DESC
      LIMIT ${limit}
    `;
    return rows.map((r: any) => r.d as string);
  }, fallback);
}

/**
 * Distinct expiries for a source. `symbols` narrows to those symbols;
 * `when` picks unexpired (ascending) or already-expired (descending) relative
 * to today; `limit` caps the list.
 */
export function catalogExpiries(
  source: CatalogSource,
  opts: { symbols?: string[]; when?: 'upcoming' | 'expired' | 'all'; limit?: number },
  fallback: () => Promise<string[]>
): Promise<string[]> {
  const symbols = opts.symbols?.map(s => s.toUpperCase()) ?? null;
  const when = opts.when ?? 'all';
  const limit = opts.limit ?? 1000;
  // Direction is spliced into the text (this driver version can't nest sql``
  // fragments); everything else stays a bound parameter. ISO date text sorts
  // the same as the date.
  return withFallback(async () => {
    const rows = await sql(
      `SELECT DISTINCT expiry_dt::text AS d FROM public.nt_market_expiries
       WHERE source = $1
         AND ($2::text[] IS NULL OR symbol = ANY($2::text[]))
         AND ($3 <> 'upcoming' OR expiry_dt >= CURRENT_DATE)
         AND ($3 <> 'expired' OR expiry_dt < CURRENT_DATE)
       ORDER BY d ${when === 'expired' ? 'DESC' : 'ASC'}
       LIMIT $4`,
      [source, symbols, when, limit]
    );
    return rows.map((r: any) => r.d as string);
  }, fallback);
}

/** Last date a (symbol, expiry) pair was seen in a source, or null. */
export async function catalogLastSeen(
  source: CatalogSource,
  symbol: string,
  expiry: string,
  fallback: () => Promise<string | null>
): Promise<string | null> {
  const [d] = await withFallback(async () => {
    const rows = await sql`
      SELECT last_trade_date::text AS d FROM public.nt_market_expiries
      WHERE source = ${source} AND symbol = ${symbol.toUpperCase()} AND expiry_dt = ${expiry}::date
    `;
    return rows.map((r: any) => r.d as string);
  }, async () => {
    const live = await fallback();
    return live ? [live] : [];
  });
  return d ?? null;
}
