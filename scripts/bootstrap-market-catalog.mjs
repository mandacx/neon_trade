// Creates and backfills the market date catalog (nt_market_dates,
// nt_market_expiries — see lib/marketCatalog.ts for what reads them). Run once:
//
//   node --env-file=.env.local scripts/bootstrap-market-catalog.mjs
//
// Safe to re-run: each source is rebuilt from scratch inside a transaction,
// so it doubles as a repair after a backfill/deletion in the source tables.
// Takes ~15s (it reads every row of eod_usmkts_price and us_opt_chg_rpt).
//
// After this, the daily load script keeps the tables current by running
// scripts/sql/market-catalog-daily.sql for the day it just loaded.

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS public.nt_market_dates (
    source       TEXT NOT NULL,
    trade_date   DATE NOT NULL,
    row_count    INT NOT NULL,
    symbol_count INT NOT NULL,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source, trade_date)
  )
`;
await sql`
  CREATE TABLE IF NOT EXISTS public.nt_market_expiries (
    source           TEXT NOT NULL,
    symbol           TEXT NOT NULL,
    expiry_dt        DATE NOT NULL,
    first_trade_date DATE NOT NULL,
    last_trade_date  DATE NOT NULL,
    refreshed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source, symbol, expiry_dt)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS nt_market_expiries_source_expiry ON public.nt_market_expiries (source, expiry_dt)`;

// Fixed identifiers only — interpolated into SQL text below.
const SOURCES = [
  { source: 'eod', table: 'public.eod_usmkts_price', symbol: 'symbol', date: 'trade_date' },
  { source: 'opt_chg', table: 'public.us_opt_chg_rpt', symbol: 'symbol_und', date: 'load_dt' },
];

for (const { source, table, symbol, date } of SOURCES) {
  const start = Date.now();
  await sql.transaction([
    sql`DELETE FROM public.nt_market_dates WHERE source = ${source}`,
    sql`DELETE FROM public.nt_market_expiries WHERE source = ${source}`,
    sql(
      `INSERT INTO public.nt_market_dates (source, trade_date, row_count, symbol_count)
       SELECT $1, ${date}, COUNT(*), COUNT(DISTINCT ${symbol})
       FROM ${table}
       GROUP BY ${date}`,
      [source]
    ),
    sql(
      `INSERT INTO public.nt_market_expiries (source, symbol, expiry_dt, first_trade_date, last_trade_date)
       SELECT $1, UPPER(${symbol}), expiry_dt, MIN(${date}), MAX(${date})
       FROM ${table}
       WHERE expiry_dt IS NOT NULL AND ${symbol} IS NOT NULL
       GROUP BY UPPER(${symbol}), expiry_dt`,
      [source]
    ),
  ]);
  const [counts] = await sql`
    SELECT
      (SELECT COUNT(*) FROM public.nt_market_dates WHERE source = ${source}) AS dates,
      (SELECT MAX(trade_date)::text FROM public.nt_market_dates WHERE source = ${source}) AS latest,
      (SELECT COUNT(*) FROM public.nt_market_expiries WHERE source = ${source}) AS expiries
  `;
  console.log(
    `${source.padEnd(8)} ${((Date.now() - start) / 1000).toFixed(1)}s  ` +
    `${counts.dates} dates (latest ${counts.latest}), ${counts.expiries} symbol/expiry pairs`
  );
}
