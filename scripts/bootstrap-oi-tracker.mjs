// DDL for the OI tracker tables (read by lib/oiTracker.ts and
// lib/optionVolume.ts). Run once:
//
//   node --env-file=.env.local scripts/bootstrap-oi-tracker.mjs
//
// Safe to re-run (IF NOT EXISTS). DDL only — volume arrives through
// /api/cron/market-catalog (captureOptionBars) and the one-time
// scripts/backfill-option-volume.mjs; tracked positions are written by users.
// Design: docs/oi-tracker.md.
//
// nt_ prefix: this database is shared with neon_nifty.

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

// Daily bars (Alpaca options) for the contracts in us_opt_chg_rpt, so the
// change report (which has no volume) can be joined to the volume that
// produced it. `no_trade` marks a contract Alpaca had no bar for that day,
// so the capture job doesn't ask again.
await sql`
  CREATE TABLE IF NOT EXISTS public.nt_opt_daily_bars (
    contract   TEXT NOT NULL,
    bar_date   DATE NOT NULL,
    o          NUMERIC,
    h          NUMERIC,
    l          NUMERIC,
    c          NUMERIC,
    v          BIGINT NOT NULL DEFAULT 0,
    vw         NUMERIC,
    n          INT,
    no_trade   BOOLEAN NOT NULL DEFAULT false,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (contract, bar_date)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS nt_opt_daily_bars_date ON public.nt_opt_daily_bars (bar_date)`;

// User-tracked option positions. Private to their owner: every query filters
// on user_id. `visibility` is reserved for a future social feature and is
// always 'private' today (no UI or API sets it).
await sql`
  CREATE TABLE IF NOT EXISTS public.nt_oi_tracked (
    id               BIGSERIAL PRIMARY KEY,
    user_id          TEXT NOT NULL,
    contract         TEXT NOT NULL,
    underlying       TEXT NOT NULL,
    expiry_dt        DATE NOT NULL,
    opt_type         TEXT NOT NULL CHECK (opt_type IN ('call', 'put')),
    strike           NUMERIC NOT NULL,
    side             TEXT NOT NULL CHECK (side IN ('BTO', 'STO')),
    qty              INT NOT NULL CHECK (qty > 0),
    entry_date       DATE NOT NULL,
    entry_price      NUMERIC NOT NULL CHECK (entry_price >= 0),
    entry_underlying NUMERIC,
    strategy_group   TEXT,
    strategy_label   TEXT,
    note             TEXT,
    closed_at        DATE,
    exit_price       NUMERIC,
    visibility       TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS nt_oi_tracked_user ON public.nt_oi_tracked (user_id)`;

// Lease row for the capture job (table created by scripts/bootstrap-earnings.mjs).
await sql`
  CREATE TABLE IF NOT EXISTS public.nt_job_lease (
    name         TEXT PRIMARY KEY,
    locked_until TIMESTAMPTZ NOT NULL DEFAULT 'epoch'
  )
`;
await sql`INSERT INTO public.nt_job_lease (name) VALUES ('oi_volume') ON CONFLICT (name) DO NOTHING`;

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN ('nt_opt_daily_bars','nt_oi_tracked','nt_job_lease')
  ORDER BY 1
`;
console.log('oi tracker tables ready:', tables.map(t => t.table_name).join(', '));
