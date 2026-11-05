// Schema of the crypto levels tables (docs/crypto.md). Idempotent (CREATE IF NOT EXISTS).
//
//   node --env-file=.env.local scripts/create-crypto-tables.mjs
//
// The tables are filled by the source pushing rows directly (role nt_us_stocks_rw); the app only
// reads them. This replaces scripts/bootstrap-crypto-fdw.mjs, removed 2026-11-05 with the FDW link.

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run with --env-file=.env.local');
  process.exit(1);
}
const main = neon(process.env.DATABASE_URL);

await main`
  CREATE TABLE IF NOT EXISTS public.nt_crypto_levels (
    currency       TEXT NOT NULL,
    settlement_ccy TEXT NOT NULL,
    expiry_dt      DATE NOT NULL,
    trade_date     DATE NOT NULL,
    cmp            NUMERIC,
    strike_size    NUMERIC,
    put_low        NUMERIC,
    put_int        NUMERIC,
    put_high       NUMERIC,
    comb_int       NUMERIC,
    call_low       NUMERIC,
    call_int       NUMERIC,
    call_high      NUMERIC,
    call_oi        NUMERIC,
    put_oi         NUMERIC,
    snapshot_ts    TIMESTAMPTZ,
    PRIMARY KEY (currency, settlement_ccy, expiry_dt, trade_date)
  )
`;
await main`
  CREATE TABLE IF NOT EXISTS public.nt_crypto_option_chain (
    currency         TEXT NOT NULL,
    settlement_ccy   TEXT NOT NULL,
    expiry_dt        DATE NOT NULL,
    trade_date       DATE NOT NULL,
    strike_pr        NUMERIC NOT NULL,
    ce_oi            NUMERIC,
    pe_oi            NUMERIC,
    ce_close         NUMERIC,
    pe_close         NUMERIC,
    underlying_price NUMERIC,
    snapshot_ts      TIMESTAMPTZ,
    PRIMARY KEY (currency, settlement_ccy, expiry_dt, trade_date, strike_pr)
  )
`;
console.log('nt_crypto_levels and nt_crypto_option_chain exist');
