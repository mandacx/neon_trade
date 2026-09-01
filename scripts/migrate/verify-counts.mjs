// Row-count sanity check after migrate.sh's `data` step: compares SOURCE vs
// TARGET for each table so a truncated dump or a failed pg_restore job shows
// up immediately instead of silently shipping partial data.
//
// Usage: SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/migrate/verify-counts.mjs table1 table2 ...
// (invoked by migrate.sh's `verify`/`all` subcommands, which pass the table list)

import { neon } from '@neondatabase/serverless';

const tables = process.argv.slice(2);
if (tables.length === 0) {
  console.error('Usage: node verify-counts.mjs <table1> <table2> ...');
  process.exit(1);
}
if (!process.env.SOURCE_DATABASE_URL || !process.env.TARGET_DATABASE_URL) {
  console.error('Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL first.');
  process.exit(1);
}

const source = neon(process.env.SOURCE_DATABASE_URL);
const target = neon(process.env.TARGET_DATABASE_URL);

async function countRows(sql, table) {
  const rows = await sql(`SELECT count(*)::bigint as n FROM public.${table}`);
  return BigInt(rows[0].n);
}

async function main() {
  let mismatches = 0;
  const widest = Math.max(...tables.map(t => t.length));

  for (const table of tables) {
    const [sourceCount, targetCount] = await Promise.all([
      countRows(source, table),
      countRows(target, table),
    ]);
    const ok = sourceCount === targetCount;
    if (!ok) mismatches++;
    console.log(
      `${ok ? '  OK ' : 'FAIL '}${table.padEnd(widest)}  source=${sourceCount}  target=${targetCount}`
    );
  }

  if (mismatches > 0) {
    console.error(`\n${mismatches} table(s) mismatched — re-run './migrate.sh data' or investigate before cutover.`);
    process.exit(1);
  }
  console.log('\nAll row counts match.');
}

main().catch(err => { console.error(err); process.exit(1); });
