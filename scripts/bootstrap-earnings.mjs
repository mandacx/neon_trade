// DDL for the earnings tables (read by lib/earnings.ts). Run once:
//
//   node --env-file=.env.local scripts/bootstrap-earnings.mjs
//
// Safe to re-run (IF NOT EXISTS). DDL only — data arrives through
// /api/cron/earnings (Alpha Vantage calendar for dates, Alpaca News headlines
// for results) and the one-time scripts/backfill-earnings-news.mjs.
// Design: docs/earnings.md.
//
// nt_ prefix: this database is shared with neon_nifty. public.securities
// (owned by that app) has next/last_earnings_date columns, but they're a
// stale one-off yfinance load — don't write there; these tables are ours.

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

// Reported quarters, one row per (symbol, reported_date), from Alpaca News
// (Benzinga results headlines). `source` also allows 'alphavantage' for the
// few rows from the retired per-symbol AV history backfill.
await sql`
  CREATE TABLE IF NOT EXISTS public.nt_earnings (
    symbol             TEXT NOT NULL,
    reported_date      DATE NOT NULL,
    report_time        TEXT,
    period             TEXT,
    fiscal_date_ending DATE,
    eps_actual         NUMERIC,
    eps_estimate       NUMERIC,
    eps_surprise_pct   NUMERIC,
    eps_outcome        TEXT,
    eps_adjusted       BOOLEAN,
    sales_actual       NUMERIC,
    sales_estimate     NUMERIC,
    sales_outcome      TEXT,
    source             TEXT NOT NULL,
    headline           TEXT,
    news_id            BIGINT,
    fetched_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (symbol, reported_date)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS nt_earnings_reported_date ON public.nt_earnings (reported_date)`;

// Upcoming schedule from the Alpha Vantage calendar.
await sql`
  CREATE TABLE IF NOT EXISTS public.nt_earnings_calendar (
    symbol             TEXT NOT NULL,
    report_date        DATE NOT NULL,
    fiscal_date_ending DATE,
    eps_estimate       NUMERIC,
    time_of_day        TEXT,
    status             TEXT NOT NULL DEFAULT 'scheduled',
    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (symbol, report_date)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS nt_earnings_calendar_date ON public.nt_earnings_calendar (report_date)`;

// Daily external-API budget (Alpha Vantage free tier: 25/day), keyed on the UTC day.
await sql`
  CREATE TABLE IF NOT EXISTS public.nt_api_usage (
    provider     TEXT NOT NULL,
    day          DATE NOT NULL,
    calls        INT NOT NULL DEFAULT 0,
    exhausted_at TIMESTAMPTZ,
    PRIMARY KEY (provider, day)
  )
`;

// Single-row leases: the Neon HTTP driver gives every statement its own
// session, so pg advisory locks can't guard a multi-statement job.
await sql`
  CREATE TABLE IF NOT EXISTS public.nt_job_lease (
    name         TEXT PRIMARY KEY,
    locked_until TIMESTAMPTZ NOT NULL DEFAULT 'epoch'
  )
`;
await sql`INSERT INTO public.nt_job_lease (name) VALUES ('earnings') ON CONFLICT (name) DO NOTHING`;

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN ('nt_earnings','nt_earnings_calendar','nt_api_usage','nt_job_lease')
  ORDER BY 1
`;
console.log('earnings tables ready:', tables.map(t => t.table_name).join(', '));
