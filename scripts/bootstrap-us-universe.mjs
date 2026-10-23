// DDL for the US scanner universe (read and filled by lib/usUniverse.ts, which also creates these
// on first use, like nt_daily_bars). Run once, or to inspect what would run:
//
//   node --env-file=.env.local scripts/bootstrap-us-universe.mjs [--dry-run]
//
// Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS). DDL only: rows arrive through
// /api/cron/us-universe (listings, index flags, liquidity) and /api/cron/us-universe-meta
// (sector / industry / market cap from the Railway worker). Design: docs/us-scanner.md.
//
// nt_ prefix: this database is shared with neon_nifty.

import { neon } from '@neondatabase/serverless';

const DRY = process.argv.includes('--dry-run');
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const statements = [
  `CREATE TABLE IF NOT EXISTS public.nt_us_universe (
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
  )`,
  `CREATE INDEX IF NOT EXISTS nt_us_universe_scan_idx ON public.nt_us_universe (is_active, is_liquid)`,
  `CREATE TABLE IF NOT EXISTS public.nt_us_universe_jobs (
    step           TEXT PRIMARY KEY,
    run_started_at TIMESTAMPTZ,
    done_at        TIMESTAMPTZ,
    info           JSONB
  )`,
  // Daily bars: which feed a symbol's stored coverage came from. Coverage only counts when it is
  // 'consolidated' (lib/dailyBars.ts), so older single-venue rows are re-pulled and overwritten.
  `ALTER TABLE IF EXISTS public.nt_daily_bars_cover ADD COLUMN IF NOT EXISTS feed TEXT`,
];

for (const s of statements) {
  console.log(`${DRY ? '[dry-run] ' : ''}${s.split('\n')[0]}`);
  if (!DRY) await sql(s);
}
console.log(DRY ? 'Dry run: nothing executed.' : 'Done.');
