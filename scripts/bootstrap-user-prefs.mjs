// DDL for per-user UI preferences (read by lib/userPrefs.ts). Run once:
//
//   node --env-file=.env.local scripts/bootstrap-user-prefs.mjs
//
// Safe to re-run (IF NOT EXISTS). One row per (user, key); the value is JSON
// validated by lib/userPrefs.ts (only known keys are accepted).
// nt_ prefix: this database is shared with neon_nifty.

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS public.nt_user_prefs (
    user_id    TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
  )
`;

const t = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'nt_user_prefs'`;
console.log('user prefs table ready:', t.map(r => r.table_name).join(', '));
