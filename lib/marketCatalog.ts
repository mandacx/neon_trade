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
 * load script upserts that day's rows here right after loading (the SQL is in
 * scripts/bootstrap-market-catalog.mjs, which also creates and backfills the
 * tables). This app only reads them.
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
