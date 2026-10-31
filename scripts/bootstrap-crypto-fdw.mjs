// Links the crypto levels database into the main database through postgres_fdw (docs/crypto.md).
//
//   node --env-file=.env.local scripts/bootstrap-crypto-fdw.mjs
//
// Needs three env vars:
//   DATABASE_URL            the main database (owner role: creates the server, mapping, schema)
//   CRYPTO_DATABASE_URL     the crypto database, admin role: only used to create / update the
//                           read-only role and its grants
//   CRYPTO_RO_DATABASE_URL  the read-only role on the crypto database (user, password, direct host);
//                           its password is what the FDW user mapping stores
//
// Steps, all idempotent (safe to re-run, e.g. after rotating the read-only password):
//   1. crypto DB: role nt_crypto_ro (LOGIN, read-only by default), SELECT on the two source tables only.
//   2. main DB: server crypto_src, a user mapping for the current role, schema `crypto` with the two
//      tables imported as foreign tables (re-imported each run, so source column changes come through).
//   3. main DB: the local copies the app reads (lib/crypto.ts), then one full sync from the foreign tables.

import { neon } from '@neondatabase/serverless';

for (const k of ['DATABASE_URL', 'CRYPTO_DATABASE_URL', 'CRYPTO_RO_DATABASE_URL']) {
  if (!process.env[k]) {
    console.error(`${k} is not set — run with --env-file=.env.local`);
    process.exit(1);
  }
}
const main = neon(process.env.DATABASE_URL);
const admin = neon(process.env.CRYPTO_DATABASE_URL);
const ro = new URL(process.env.CRYPTO_RO_DATABASE_URL);
const RO_USER = decodeURIComponent(ro.username);
const RO_PASS = decodeURIComponent(ro.password);
const RO_DB = ro.pathname.slice(1) || 'neondb';
// postgres_fdw keeps its own connection, so use the direct host, not the pooler.
const RO_HOST = ro.hostname.replace('-pooler', '');
const TABLES = ['deribit_levels', 'deribit_option_chain'];

const lit = s => `'${String(s).replace(/'/g, "''")}'`;
const ident = s => `"${String(s).replace(/"/g, '""')}"`;

// 1. Read-only role on the crypto DB.
const exists = (await admin`SELECT 1 FROM pg_roles WHERE rolname = ${RO_USER}`).length > 0;
await admin(`${exists ? 'ALTER' : 'CREATE'} ROLE ${ident(RO_USER)} WITH LOGIN PASSWORD ${lit(RO_PASS)}`);
await admin(`ALTER ROLE ${ident(RO_USER)} SET default_transaction_read_only = on`);
await admin(`GRANT CONNECT ON DATABASE ${ident(RO_DB)} TO ${ident(RO_USER)}`);
await admin(`GRANT USAGE ON SCHEMA public TO ${ident(RO_USER)}`);
await admin(`GRANT SELECT ON ${TABLES.map(t => `public.${ident(t)}`).join(', ')} TO ${ident(RO_USER)}`);
console.log(`crypto DB: role ${RO_USER} ${exists ? 'updated' : 'created'}, SELECT on ${TABLES.join(', ')}`);

// 2. FDW in the main DB.
await main`CREATE EXTENSION IF NOT EXISTS postgres_fdw`;
const opts = `host ${lit(RO_HOST)}, port '5432', dbname ${lit(RO_DB)}, sslmode 'require'`;
if ((await main`SELECT 1 FROM pg_foreign_server WHERE srvname = 'crypto_src'`).length) {
  await main(`ALTER SERVER crypto_src OPTIONS (SET host ${lit(RO_HOST)}, SET dbname ${lit(RO_DB)})`);
} else {
  await main(`CREATE SERVER crypto_src FOREIGN DATA WRAPPER postgres_fdw OPTIONS (${opts}, fetch_size '5000')`);
}
await main(`DROP USER MAPPING IF EXISTS FOR CURRENT_USER SERVER crypto_src`);
await main(`CREATE USER MAPPING FOR CURRENT_USER SERVER crypto_src OPTIONS (user ${lit(RO_USER)}, password ${lit(RO_PASS)})`);
await main`CREATE SCHEMA IF NOT EXISTS crypto`;
for (const t of TABLES) await main(`DROP FOREIGN TABLE IF EXISTS crypto.${ident(t)}`);
await main(`IMPORT FOREIGN SCHEMA public LIMIT TO (${TABLES.map(ident).join(', ')}) FROM SERVER crypto_src INTO crypto`);
const [{ n }] = await main`SELECT count(*)::int AS n FROM crypto.deribit_levels`;
console.log(`main DB: server crypto_src, schema crypto (${TABLES.join(', ')}); ${n} level rows readable`);

// 3. Local copies + first sync (same statements as lib/crypto.ts syncCryptoTables, kept in step).
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
await main`
  CREATE TABLE IF NOT EXISTS public.nt_crypto_sync (
    id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    synced_at   TIMESTAMPTZ NOT NULL,
    last_snapshot TIMESTAMPTZ,
    levels_rows INT NOT NULL DEFAULT 0,
    chain_rows  INT NOT NULL DEFAULT 0
  )
`;
const t0 = Date.now();
const [lv] = await main`
  WITH up AS (
    INSERT INTO public.nt_crypto_levels
    SELECT currency, settlement_ccy, expiry_dt, trade_date, cmp, strike_size,
           pe_oi_diff_tgt_low, pe_oi_intersection, pe_oi_diff_tgt_high, comb_oi_intersection,
           ce_oi_diff_tgt_low, ce_oi_intersection, ce_oi_diff_tgt_high, call_oi, put_oi, snapshot_ts
    FROM crypto.deribit_levels
    ON CONFLICT (currency, settlement_ccy, expiry_dt, trade_date) DO UPDATE SET
      cmp = EXCLUDED.cmp, strike_size = EXCLUDED.strike_size,
      put_low = EXCLUDED.put_low, put_int = EXCLUDED.put_int, put_high = EXCLUDED.put_high,
      comb_int = EXCLUDED.comb_int, call_low = EXCLUDED.call_low, call_int = EXCLUDED.call_int,
      call_high = EXCLUDED.call_high, call_oi = EXCLUDED.call_oi, put_oi = EXCLUDED.put_oi,
      snapshot_ts = EXCLUDED.snapshot_ts
    RETURNING 1
  ) SELECT count(*)::int AS n FROM up
`;
const [ch] = await main`
  WITH up AS (
    INSERT INTO public.nt_crypto_option_chain
    SELECT currency, settlement_ccy, expiry_dt, trade_date, strike_pr, ce_oi, pe_oi, ce_close, pe_close,
           underlying_price, snapshot_ts
    FROM crypto.deribit_option_chain
    ON CONFLICT (currency, settlement_ccy, expiry_dt, trade_date, strike_pr) DO UPDATE SET
      ce_oi = EXCLUDED.ce_oi, pe_oi = EXCLUDED.pe_oi, ce_close = EXCLUDED.ce_close, pe_close = EXCLUDED.pe_close,
      underlying_price = EXCLUDED.underlying_price, snapshot_ts = EXCLUDED.snapshot_ts
    RETURNING 1
  ) SELECT count(*)::int AS n FROM up
`;
await main`
  INSERT INTO public.nt_crypto_sync (id, synced_at, last_snapshot, levels_rows, chain_rows)
  SELECT 1, now(), max(snapshot_ts), ${lv.n}, ${ch.n} FROM public.nt_crypto_levels
  ON CONFLICT (id) DO UPDATE SET synced_at = EXCLUDED.synced_at, last_snapshot = EXCLUDED.last_snapshot,
    levels_rows = EXCLUDED.levels_rows, chain_rows = EXCLUDED.chain_rows
`;
console.log(`local copies: ${lv.n} level rows, ${ch.n} chain rows synced in ${Date.now() - t0} ms`);
