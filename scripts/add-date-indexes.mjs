// Date-column indexes for the market tables. Run once:
//
//   node --env-file=.env.local scripts/add-date-indexes.mjs
//
// Safe to re-run (IF NOT EXISTS). CONCURRENTLY builds without blocking the
// nightly loader's writes, at the cost of being slower to build.
//
// Why: every existing index on eod_usmkts_price / intra_us_scanner_eod /
// us_opt_chg_rpt leads with symbol, so "latest trade date" style queries
// (MAX(trade_date), WHERE trade_date = X, the expiry_dt >= today filter) were
// full scans of 5-9M rows — 2-4s each, and the home + quadrant pages run
// several per load.

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const statements = [
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_eod_usmkts_price_trade_date ON public.eod_usmkts_price (trade_date)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_eod_usmkts_price_expiry_dt ON public.eod_usmkts_price (expiry_dt)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_intra_us_scanner_eod_trade_date ON public.intra_us_scanner_eod (trade_date)',
  // Lets the loader's daily catalog upsert (scripts/sql/market-catalog-daily.sql)
  // read just the day it loaded instead of all ~8.6M option-chain rows.
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_us_opt_chg_rpt_load_dt ON public.us_opt_chg_rpt (load_dt)',
];

for (const stmt of statements) {
  const start = Date.now();
  await sql(stmt);
  console.log(`${((Date.now() - start) / 1000).toFixed(1)}s  ${stmt}`);
}
