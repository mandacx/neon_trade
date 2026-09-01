// Copies Managed Better Auth data from the old shared project (SOURCE) into
// the new dedicated project (TARGET), which must already have Auth enabled
// (i.e. neon_auth schema freshly provisioned there — run diff-auth-schema.mjs
// first and confirm it reports a match).
//
// Never logs secret column values (password hashes, OAuth client secrets,
// jwks key material, session tokens) — only row counts and non-sensitive
// identifiers, since this output may end up in a terminal/log someone else
// can see.
//
// Three independent subcommands, run in this order:
//
//   node copy-auth-data.mjs config
//     Merges trusted_origins/social_providers/email_provider/
//     email_and_password/plugin_configs/webhook_config from SOURCE's single
//     project_config row into TARGET's own row — TARGET's own `id` and
//     `endpoint_id` (tied to ITS OWN project/compute) are preserved, not
//     overwritten. This is what carries your Google OAuth client
//     id/secret over without touching the Neon console.
//
//   node copy-auth-data.mjs identities
//     Full-row copy of user, organization, verification, account, member,
//     invitation (in FK-safe order). Safe to re-run — deletes existing
//     target rows for each table first. Run this well before cutover, and
//     again right before if the source changed since.
//
//     NOTE: `jwks` is deliberately NOT copied — see NEVER_COPY below.
//
//   node copy-auth-data.mjs sessions
//     Full-row copy of the `session` table only. Deliberately separate and
//     meant to be run LAST, as close to the actual cutover moment as
//     possible: any session created on the old project after this point
//     (and before you flip NEON_AUTH_BASE_URL) won't carry over, and that
//     user will just need to log in again — copying right before cutover
//     minimizes how many people that affects. Requires `identities` to have
//     already run (session.userId must exist in target's user table).
//
// Usage: SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node scripts/migrate/copy-auth-data.mjs <config|identities|sessions>

import { neon } from '@neondatabase/serverless';

const subcommand = process.argv[2];
if (!['config', 'identities', 'sessions'].includes(subcommand)) {
  console.error('Usage: node copy-auth-data.mjs <config|identities|sessions>');
  process.exit(1);
}
if (!process.env.SOURCE_DATABASE_URL || !process.env.TARGET_DATABASE_URL) {
  console.error('Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL first.');
  process.exit(1);
}

const source = neon(process.env.SOURCE_DATABASE_URL);
const target = neon(process.env.TARGET_DATABASE_URL);

// The driver auto-decodes json/jsonb columns into JS objects/arrays on
// SELECT; binding those back as INSERT/UPDATE parameters as-is produces
// malformed JSON (the driver's default parameter serialization isn't the
// same as its result decoding), so re-stringify anything object-shaped
// before it goes back out. Dates (timestamptz columns) pass through as-is.
function toParam(value) {
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  return value;
}

async function getColumns(sql, table) {
  const rows = await sql(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'neon_auth' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return rows.map(r => r.column_name);
}

// Generic full-row copy: delete target rows, then re-insert every source row
// with all columns, using the table's own column list (so this doesn't need
// per-table hardcoding). Column values are passed as bound parameters, never
// interpolated, so this is safe regardless of what they contain.
async function copyTable(table) {
  const columns = await getColumns(source, table);
  const colList = columns.map(c => `"${c}"`).join(', ');
  const rows = await source(`SELECT * FROM neon_auth."${table}"`);

  await target(`DELETE FROM neon_auth."${table}"`);

  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows (nothing to copy)`);
    return;
  }

  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  for (const row of rows) {
    const values = columns.map(c => toParam(row[c]));
    await target(`INSERT INTO neon_auth."${table}" (${colList}) VALUES (${placeholders})`, values);
  }
  console.log(`  ${table}: copied ${rows.length} row(s)`);
}

// Tables that must NEVER be copied across projects, even though they live in
// `neon_auth` alongside the identity data.
//
// `jwks` holds the Better Auth signing keypair, and the private half is
// stored encrypted with the auth instance's own secret — which Neon scopes
// per project. Copying these rows leaves the TARGET serving the SOURCE's
// public key (visible at <NEON_AUTH_BASE_URL>/.well-known/jwks.json) while
// being unable to decrypt the matching private key, so every request that
// has to sign a JWT fails. In practice that means `/get-session` returns 200
// + null for a signed-out visitor but 500 for anyone with a real session, and
// the app-side proxy surfaces it as
// "[mintSessionDataCookie] Failed to mint session_data cookie".
//
// Leaving the table alone lets the target's own Auth instance keep (or
// lazily generate) a keypair it can actually sign with. Nothing references
// jwks rows by FK, and the only thing lost is the ability to verify JWTs
// issued by the old project — which is exactly what we want at cutover.
const NEVER_COPY = ['jwks'];

async function cmdIdentities() {
  // Parent tables before tables that reference them via FK.
  const order = ['user', 'organization', 'verification', 'account', 'member', 'invitation']
    .filter(t => !NEVER_COPY.includes(t));
  console.log('Copying identity tables (user, account, etc.) — target rows will be replaced:');
  for (const table of order) {
    await copyTable(table);
  }
  console.log('Done. Sessions are handled separately by the `sessions` subcommand.');
}

async function cmdSessions() {
  console.log('Copying session table — run this as close to actual cutover as possible:');
  await copyTable('session');
  console.log('Done.');
}

async function cmdConfig() {
  const FIELDS = ['trusted_origins', 'social_providers', 'email_provider', 'email_and_password', 'plugin_configs', 'webhook_config'];

  const sourceRows = await source(`SELECT ${FIELDS.map(f => `"${f}"`).join(', ')} FROM neon_auth.project_config LIMIT 1`);
  if (sourceRows.length === 0) {
    console.error('SOURCE has no project_config row — nothing to merge.');
    process.exit(1);
  }
  const targetRows = await target(`SELECT id FROM neon_auth.project_config LIMIT 1`);
  if (targetRows.length === 0) {
    console.error('TARGET has no project_config row — is Managed Better Auth actually enabled on the new project?');
    process.exit(1);
  }

  const setClause = FIELDS.map((f, i) => `"${f}" = $${i + 1}`).join(', ');
  const values = FIELDS.map(f => toParam(sourceRows[0][f]));
  await target(
    `UPDATE neon_auth.project_config SET ${setClause}, updated_at = now() WHERE id = $${FIELDS.length + 1}`,
    [...values, targetRows[0].id]
  );
  console.log(`Merged ${FIELDS.join(', ')} into target's existing project_config row (id/endpoint_id preserved).`);
  console.log('Field values are not printed here since they include OAuth secrets — spot-check in the Neon console if you want to confirm.');
}

const handlers = { config: cmdConfig, identities: cmdIdentities, sessions: cmdSessions };
handlers[subcommand]().catch(err => { console.error(err); process.exit(1); });
