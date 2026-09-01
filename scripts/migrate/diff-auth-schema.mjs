// Compares the `neon_auth` schema's table/column shape between the old
// (SOURCE) and new (TARGET) Neon projects, using @neondatabase/serverless
// directly instead of psql/pg_dump (neither is available in this
// environment, and may not be on the machine actually running the cutover
// either). Run before ever touching data — a mismatch here means the new
// project's Managed Better Auth provisioned a different schema version than
// the one that built the old project's data.
//
// Usage: SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/migrate/diff-auth-schema.mjs

import { neon } from '@neondatabase/serverless';

if (!process.env.SOURCE_DATABASE_URL || !process.env.TARGET_DATABASE_URL) {
  console.error('Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL first.');
  process.exit(1);
}

const source = neon(process.env.SOURCE_DATABASE_URL);
const target = neon(process.env.TARGET_DATABASE_URL);

async function listTables(sql) {
  const rows = await sql(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'neon_auth' ORDER BY table_name`
  );
  return rows.map(r => r.table_name);
}

async function listColumns(sql, table) {
  const rows = await sql(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'neon_auth' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return rows;
}

async function countRows(sql, table) {
  const rows = await sql(`SELECT count(*)::bigint as n FROM neon_auth."${table}"`);
  return BigInt(rows[0].n);
}

function colKey(c) {
  return `${c.column_name} ${c.data_type} nullable=${c.is_nullable}`;
}

async function main() {
  const [sourceTables, targetTables] = await Promise.all([listTables(source), listTables(target)]);

  console.log('SOURCE neon_auth tables:', sourceTables.join(', ') || '(none)');
  console.log('TARGET neon_auth tables:', targetTables.join(', ') || '(none)');

  const sourceSet = new Set(sourceTables);
  const targetSet = new Set(targetTables);
  const onlyInSource = sourceTables.filter(t => !targetSet.has(t));
  const onlyInTarget = targetTables.filter(t => !sourceSet.has(t));

  if (onlyInSource.length) console.log('\n⚠ Tables only in SOURCE (missing on target):', onlyInSource.join(', '));
  if (onlyInTarget.length) console.log('\n⚠ Tables only in TARGET (extra, freshly provisioned):', onlyInTarget.join(', '));

  let anyColumnMismatch = false;
  console.log('\nPer-table column comparison (SOURCE ∩ TARGET):');
  for (const table of sourceTables.filter(t => targetSet.has(t))) {
    const [sourceCols, targetCols] = await Promise.all([listColumns(source, table), listColumns(target, table)]);
    const sourceKeys = sourceCols.map(colKey);
    const targetKeys = targetCols.map(colKey);
    const same = sourceKeys.length === targetKeys.length && sourceKeys.every((k, i) => k === targetKeys[i]);
    if (same) {
      const [sourceCount, targetCount] = await Promise.all([countRows(source, table), countRows(target, table)]);
      console.log(`  OK      ${table}  (source rows=${sourceCount}, target rows=${targetCount})`);
    } else {
      anyColumnMismatch = true;
      console.log(`  DIFFERS ${table}`);
      console.log('    source:', sourceKeys.join(' | '));
      console.log('    target:', targetKeys.join(' | '));
    }
  }

  if (onlyInSource.length || anyColumnMismatch) {
    console.log('\nSchema mismatch detected — do not run a data copy until this is understood.');
    process.exit(1);
  }
  console.log('\nSchema shapes match for all shared tables.');
}

main().catch(err => { console.error(err); process.exit(1); });
