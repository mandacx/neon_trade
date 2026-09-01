// Recreates the market-data tables' DDL (columns, types, primary keys,
// indexes) on the new project (TARGET), introspected live from the old
// project (SOURCE) via pg_catalog — a pure-Node stand-in for
// `pg_dump --schema-only`, since neither pg_dump nor psql is available on
// this machine. There's no CREATE TABLE script for these tables anywhere in
// the repo (they predate/live outside this codebase), so this is the only
// source of truth for their shape.
//
// nt_* tables are NOT handled here — scripts/bootstrap-app-tables.mjs is
// their authoritative DDL source; run that instead.
//
// Usage: SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/migrate/clone-market-schema.mjs

import { neon } from '@neondatabase/serverless';

const TABLES = ['securities', 'eod_usmkts_price', 'intra_us_scanner_eod', 'us_opt_chg_rpt'];

if (!process.env.SOURCE_DATABASE_URL || !process.env.TARGET_DATABASE_URL) {
  console.error('Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL first.');
  process.exit(1);
}

const source = neon(process.env.SOURCE_DATABASE_URL);
const target = neon(process.env.TARGET_DATABASE_URL);

async function getColumnDefs(table) {
  const rows = await source(
    `SELECT
       a.attname AS name,
       format_type(a.atttypid, a.atttypmod) AS type,
       a.attnotnull AS not_null,
       pg_get_expr(d.adbin, d.adrelid) AS default_expr
     FROM pg_attribute a
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
    ['public.' + table]
  );

  return rows.map(r => {
    // A nextval() default means this is a serial column — recreate as
    // SERIAL/BIGSERIAL so Postgres provisions a fresh sequence scoped to
    // TARGET, rather than copying a `nextval('old_seq'::regclass)` default
    // that references a sequence which doesn't exist on TARGET.
    if (r.default_expr && r.default_expr.startsWith('nextval(')) {
      const serialType = r.type === 'bigint' ? 'BIGSERIAL' : r.type === 'smallint' ? 'SMALLSERIAL' : 'SERIAL';
      return `"${r.name}" ${serialType}`;
    }
    let def = `"${r.name}" ${r.type}`;
    if (r.not_null) def += ' NOT NULL';
    if (r.default_expr) def += ` DEFAULT ${r.default_expr}`;
    return def;
  });
}

async function getPrimaryKey(table) {
  const rows = await source(
    `SELECT a.attname
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary
     ORDER BY array_position(i.indkey, a.attnum)`,
    ['public.' + table]
  );
  return rows.map(r => r.attname);
}

async function getSecondaryIndexes(table) {
  const rows = await source(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 AND indexname NOT LIKE '%_pkey'`,
    [table]
  );
  return rows.map(r => r.indexdef);
}

async function cloneTable(table) {
  const [columnDefs, pk] = await Promise.all([getColumnDefs(table), getPrimaryKey(table)]);
  if (columnDefs.length === 0) throw new Error(`public.${table} not found on SOURCE`);

  const parts = [...columnDefs];
  if (pk.length > 0) parts.push(`PRIMARY KEY (${pk.map(c => `"${c}"`).join(', ')})`);

  const ddl = `CREATE TABLE IF NOT EXISTS public."${table}" (\n  ${parts.join(',\n  ')}\n)`;
  await target(ddl);
  console.log(`  ${table}: table created (or already existed)`);

  const indexDefs = await getSecondaryIndexes(table);
  for (const indexDef of indexDefs) {
    const idempotent = indexDef.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ');
    await target(idempotent);
  }
  if (indexDefs.length > 0) console.log(`  ${table}: ${indexDefs.length} secondary index(es) created (or already existed)`);
}

async function main() {
  console.log(`Cloning schema for: ${TABLES.join(', ')}`);
  for (const table of TABLES) {
    await cloneTable(table);
  }
  console.log('Done. Now run: node scripts/migrate/copy-public-data.mjs market');
}

main().catch(err => { console.error(err); process.exit(1); });
