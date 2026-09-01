// Bridges eod_usmkts_price / intra_us_scanner_eod / us_opt_chg_rpt on the
// new project (TARGET) to LIVE data on the old project (SOURCE) via
// postgres_fdw, so the app can be cut over to TARGET now and keep reading
// fresh data through these three tables even before the external ingestion
// pipeline is repointed to write into TARGET directly.
//
// This is explicitly a "for now" bridge, not the end state:
//   - It stores SOURCE's database password inside TARGET's catalog
//     (pg_user_mappings) — visible to a superuser/owner on TARGET.
//   - Every query against these 3 tables now round-trips to the OLD
//     project's compute. If that compute is suspended (autoscale-to-zero),
//     the first query after a while pays a cold-start delay.
//   - Once the ingestion pipeline is repointed to write into TARGET
//     directly, drop the foreign tables and either rename the
//     `*_local_snapshot` backups back, or just let the pipeline populate
//     fresh local tables under the real names again.
//
// The existing local copies (populated earlier by clone-market-schema.mjs +
// copy-public-data.mjs) are renamed to `<table>_local_snapshot` rather than
// dropped, so nothing is lost if this needs to be rolled back.
//
// Usage: SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/migrate/setup-fdw-market-tables.mjs

import { neon } from '@neondatabase/serverless';

if (!process.env.SOURCE_DATABASE_URL || !process.env.TARGET_DATABASE_URL) {
  console.error('Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL first.');
  process.exit(1);
}

const TABLES = ['eod_usmkts_price', 'intra_us_scanner_eod', 'us_opt_chg_rpt'];
const SERVER_NAME = 'old_project';

// CREATE SERVER / CREATE USER MAPPING options are SQL string literals, not
// bind-parameter positions — Postgres parses OPTIONS() as literal tokens, so
// these have to be interpolated (safely escaped) rather than passed as $n.
function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseConnectionString(connStr) {
  const url = new URL(connStr);
  return {
    // Neon's pooled ("-pooler") endpoint uses PgBouncer in transaction mode,
    // which doesn't support everything a foreign server connection may need
    // (e.g. multiple statements/prepared state per session) — use the
    // direct endpoint for FDW.
    host: url.hostname.replace(/-pooler(?=\.)/, ''),
    port: url.port || '5432',
    dbname: url.pathname.replace(/^\//, ''),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

const target = neon(process.env.TARGET_DATABASE_URL);
const conn = parseConnectionString(process.env.SOURCE_DATABASE_URL);

async function main() {
  console.log(`Foreign server will point at ${conn.host}:${conn.port}/${conn.dbname} (direct, non-pooled endpoint)`);

  console.log('Renaming existing local copies to *_local_snapshot backups...');
  for (const t of TABLES) {
    await target(`ALTER TABLE IF EXISTS public."${t}" RENAME TO "${t}_local_snapshot"`);
  }

  console.log('Installing postgres_fdw...');
  await target(`CREATE EXTENSION IF NOT EXISTS postgres_fdw`);

  console.log(`Creating foreign server "${SERVER_NAME}"...`);
  await target(`DROP SERVER IF EXISTS ${SERVER_NAME} CASCADE`);
  await target(
    `CREATE SERVER ${SERVER_NAME} FOREIGN DATA WRAPPER postgres_fdw
     OPTIONS (host ${sqlLiteral(conn.host)}, port ${sqlLiteral(conn.port)}, dbname ${sqlLiteral(conn.dbname)}, sslmode 'require')`
  );

  console.log('Creating user mapping (stores SOURCE credentials in TARGET catalog)...');
  await target(
    `CREATE USER MAPPING FOR CURRENT_USER SERVER ${SERVER_NAME}
     OPTIONS (user ${sqlLiteral(conn.user)}, password ${sqlLiteral(conn.password)})`
  );

  console.log(`Importing foreign tables: ${TABLES.join(', ')}...`);
  await target(
    `IMPORT FOREIGN SCHEMA public LIMIT TO (${TABLES.map(t => `"${t}"`).join(', ')}) FROM SERVER ${SERVER_NAME} INTO public`
  );

  console.log('Verifying live pass-through...');
  for (const t of TABLES) {
    const [{ n }] = await target(`SELECT count(*)::bigint as n FROM public."${t}"`);
    console.log(`  public.${t} (foreign): ${n} rows visible right now`);
  }

  console.log('\nDone. public.<table> now reads live from the old project for these 3 tables.');
  console.log('Local backups kept as public.<table>_local_snapshot.');
}

main().catch(err => { console.error(err); process.exit(1); });
