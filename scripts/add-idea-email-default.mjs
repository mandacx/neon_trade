// Trade Ideas: email alerts are ON by default for users whose plan includes an ideas term (decision 2026-11-13).
// nt_idea_prefs.email_alerts becomes nullable: NULL (or no row) = "never chose" = on; false = the user switched it off
// (Alerts menu or the unsubscribe link). Telegram and push stay opt-in. Idempotent, safe to re-run.
//
//   node --env-file=.env.local scripts/add-idea-email-default.mjs
import { neon } from '@neondatabase/serverless';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set: run with --env-file=.env.local'); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);
await sql`ALTER TABLE public.nt_idea_prefs ALTER COLUMN email_alerts DROP NOT NULL`;
await sql`ALTER TABLE public.nt_idea_prefs ALTER COLUMN email_alerts SET DEFAULT NULL`;
console.log(await sql`SELECT user_id, email_alerts FROM public.nt_idea_prefs`);
console.log('nt_idea_prefs.email_alerts is now nullable (NULL = default on)');
