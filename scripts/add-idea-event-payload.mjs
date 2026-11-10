// Adds nt_idea_events.payload (JSONB, nullable): the facts of each Trade Ideas event for the alert emails, Telegram
// messages and pushes (lib/ideaAlertModel.ts, docs/trade-ideas.md "Alerts"). Idempotent and additive: ADD COLUMN IF
// NOT EXISTS is a metadata-only change in Postgres (no table rewrite). No default, no backfill, no index. Events
// recorded before this column keep payload NULL and render with the summary-only layout.
//
//   node --env-file=.env.local scripts/add-idea-event-payload.mjs              # apply
//   node --env-file=.env.local scripts/add-idea-event-payload.mjs --dry-run    # only report whether the column exists
//
// Release order: run this BEFORE deploying the code that writes it (the code also falls back to the old insert if the
// column is missing, so a deploy that lands first does not break publishing).
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set: run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const dry = process.argv.includes('--dry-run');

const exists = async () => {
  const rows = await sql`SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'nt_idea_events' AND column_name = 'payload'`;
  return rows.length ? rows[0].data_type : null;
};

const before = await exists();
console.log(`before: nt_idea_events.payload ${before ? `exists (${before})` : 'does not exist'}`);
if (dry) {
  console.log('dry run: nothing changed.');
  process.exit(0);
}
await sql`ALTER TABLE public.nt_idea_events ADD COLUMN IF NOT EXISTS payload JSONB`;
const after = await exists();
console.log(`after:  nt_idea_events.payload ${after ? `exists (${after})` : 'does not exist'}`);
console.log('Done.');
