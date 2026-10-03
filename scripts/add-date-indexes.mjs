// Date-column indexes for the market tables. Run once:
//
//   node --env-file=.env.local scripts/add-date-indexes.mjs
//
// Safe to re-run (IF NOT EXISTS). CONCURRENTLY builds without blocking the
// nightly loader's writes, at the cost of being slower to build.
//
// Why: every existing index on eod_usmkts_price / intra_us_scanner_eod leads
// with symbol, so "latest trade date" style queries (MAX(trade_date),
// WHERE trade_date = X, the expiry_dt >= today filter) were full scans of
// ~5M rows — 2-4s each, and the home + quadrant pages run several per load.

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
];

for (const stmt of statements) {
  const start = Date.now();
  await sql.query(stmt);
  console.log(`${((Date.now() - start) / 1000).toFixed(1)}s  ${stmt}`);
}
