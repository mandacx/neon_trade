// Copies market-data + nt_* tables from the old shared project (SOURCE) to
// the new dedicated project (TARGET) — a pure-Node replacement for
// migrate.sh's pg_dump/pg_restore approach, since neither psql nor pg_dump
// is available on this machine. Uses @neondatabase/serverless (already a
// project dependency) instead.
//
// Paginates by `ctid` (Postgres's physical row identifier, always present
// even on tables with no primary key — us_opt_chg_rpt has none) rather than
// LIMIT/OFFSET, so large tables don't pay the O(n^2) re-scan cost OFFSET
// pagination has, and it stays correct even if new rows land at the end of
// the table mid-copy (e.g. the EOD ingestion job runs during the copy).
//
// Safe to re-run: each table is truncated (CASCADE) before reload, so a
// partial/failed run just means running the same command again. Run this
// well before cutover for a baseline copy, then once more right before the
// actual cutover to pick up anything written since.
//
// Usage:
//   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/migrate/copy-public-data.mjs market
//   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/migrate/copy-public-data.mjs app
//   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/migrate/copy-public-data.mjs all

import { neon } from '@neondatabase/serverless';

const GROUP = process.argv[2];

// No FK dependencies between these four.
const MARKET_TABLES = ['securities', 'eod_usmkts_price', 'intra_us_scanner_eod', 'us_opt_chg_rpt'];

// Parent-before-child: nt_plans before nt_app_user_profiles (plan_id FK),
// nt_watchlists before nt_watchlist_items (watchlist_id FK).
const APP_TABLES = [
  'nt_plans',
  'nt_app_user_profiles',
  'nt_user_feature_overrides',
  'nt_watchlists',
  'nt_watchlist_items',
  'nt_telegram_link_codes',
  'nt_telegram_alert_subscriptions',
  'nt_telegram_alert_cursors',
  'nt_rate_limit_hits',
];

const GROUPS = { market: MARKET_TABLES, app: APP_TABLES, all: [...MARKET_TABLES, ...APP_TABLES] };

if (!GROUPS[GROUP]) {
  console.error('Usage: node copy-public-data.mjs <market|app|all>');
  process.exit(1);
}
if (!process.env.SOURCE_DATABASE_URL || !process.env.TARGET_DATABASE_URL) {
  console.error('Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL first.');
  process.exit(1);
}

const source = neon(process.env.SOURCE_DATABASE_URL);
const target = neon(process.env.TARGET_DATABASE_URL);

const BATCH_SIZE = Number(process.env.BATCH_SIZE || 1000);

function toParam(value) {
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  return value;
}

async function getColumns(table) {
  const rows = await source(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  if (rows.length === 0) throw new Error(`No columns found for public.${table} — does it exist on SOURCE?`);
  return rows.map(r => r.column_name);
}

async function getSerialColumns(table) {
  const rows = await source(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_default LIKE 'nextval(%'`,
    [table]
  );
  return rows.map(r => r.column_name);
}

async function copyTable(table) {
  const columns = await getColumns(table);
  const colList = columns.map(c => `"${c}"`).join(', ');

  await target(`TRUNCATE TABLE public."${table}" CASCADE`);

  let lastCtid = null;
  let total = 0;
  for (;;) {
    const rows = lastCtid
      ? await source(`SELECT ctid, ${colList} FROM public."${table}" WHERE ctid > $1::tid ORDER BY ctid LIMIT $2`, [lastCtid, BATCH_SIZE])
      : await source(`SELECT ctid, ${colList} FROM public."${table}" ORDER BY ctid LIMIT $1`, [BATCH_SIZE]);

    if (rows.length === 0) break;
    lastCtid = rows[rows.length - 1].ctid;

    const placeholders = rows
      .map((_, i) => `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`)
      .join(', ');
    const values = rows.flatMap(row => columns.map(c => toParam(row[c])));
    await target(`INSERT INTO public."${table}" (${colList}) VALUES ${placeholders}`, values);

    total += rows.length;
    process.stdout.write(`\r  ${table}: ${total} rows copied...`);

    if (rows.length < BATCH_SIZE) break;
  }
  process.stdout.write(`\r  ${table}: ${total} row(s) copied.          \n`);

  // Explicit-value inserts don't advance the table's own SERIAL/BIGSERIAL
  // sequence, so a fresh insert on TARGET right after this would collide
  // with a copied id. Bump it to the current max.
  const serialCols = await getSerialColumns(table);
  for (const col of serialCols) {
    await target(
      `SELECT setval(pg_get_serial_sequence('public.${table}', '${col}'), COALESCE((SELECT max("${col}") FROM public."${table}"), 1))`
    );
  }
}

async function main() {
  const tables = GROUPS[GROUP];
  console.log(`Copying ${tables.length} table(s): ${tables.join(', ')}`);
  for (const table of tables) {
    await copyTable(table);
  }
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
