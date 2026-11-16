// Level-symbol requests (docs/level-symbols.md). Idempotent (CREATE IF NOT EXISTS).
//
//   node --env-file=.env.local scripts/create-level-requests.mjs --dry-run
//   node --env-file=.env.local scripts/create-level-requests.mjs
//
// nt_level_requests: signed-in users ask for a symbol to get option levels; an admin approves (which upserts the
// symbol into public.us_symbols, read by the external loader) or rejects. public.us_symbols itself is not altered here.
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set: run with --env-file=.env.local'); process.exit(1); }
const dry = process.argv.includes('--dry-run');
const sql = neon(process.env.DATABASE_URL);

const exists = await sql`SELECT to_regclass('public.nt_level_requests') AS t`;
console.log('nt_level_requests exists:', exists[0].t !== null);
if (dry) { console.log('dry run: nothing changed'); process.exit(0); }

await sql`
  CREATE TABLE IF NOT EXISTS public.nt_level_requests (
    id            BIGSERIAL PRIMARY KEY,
    symbol        TEXT NOT NULL,
    requested_by  TEXT NOT NULL,
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    note          TEXT,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    decided_by    TEXT,
    decided_at    TIMESTAMPTZ,
    decision_note TEXT
  )
`;
// One open request per symbol; a user sees their own history.
await sql`CREATE UNIQUE INDEX IF NOT EXISTS nt_level_requests_one_pending ON public.nt_level_requests (symbol) WHERE status = 'pending'`;
await sql`CREATE INDEX IF NOT EXISTS nt_level_requests_user ON public.nt_level_requests (requested_by, requested_at DESC)`;
console.log(await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='nt_level_requests' ORDER BY ordinal_position`);
