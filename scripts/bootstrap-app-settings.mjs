// DDL for admin-editable app settings (read by lib/appSettings.ts, edited at /admin/settings). Run once:
//
//   node --env-file=.env.local scripts/bootstrap-app-settings.mjs
//
// Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS). Also adds the `blocked` counter to
// nt_rate_limit_hits, which the heavy-users tile uses to count minutes in which requests were
// actually rejected (the limit now differs per user, so hits > a constant no longer tells).
// nt_ prefix: this database is shared with neon_nifty.

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS public.nt_app_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT
  )
`;
await sql`ALTER TABLE public.nt_rate_limit_hits ADD COLUMN IF NOT EXISTS blocked INT NOT NULL DEFAULT 0`;

const t = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('nt_app_settings', 'nt_rate_limit_hits') ORDER BY 1`;
const c = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'nt_rate_limit_hits' AND column_name = 'blocked'`;
console.log('settings tables ready:', t.map(r => r.table_name).join(', '), '| blocked column:', c.length === 1);
