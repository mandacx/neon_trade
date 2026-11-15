// Trade Ideas: optional, editable validity + an "enter by" date (docs/trade-ideas.md, "Dates"). Idempotent, safe to re-run.
//
//   node --env-file=.env.local scripts/add-idea-dates.mjs          # apply
//   node --env-file=.env.local scripts/add-idea-dates.mjs --dry-run
//
// nt_trade_ideas.valid_until   becomes NULLABLE: no value = the idea never expires on its own.
// nt_trade_ideas.entry_by      new, nullable DATE: the last date the idea may ENTER (inclusive). Not entered by then = not triggered.
// Both dates can be changed on a published idea, but only while it is open (live / in trade); the app does it through an
// audited 'dates_changed' row in nt_idea_updates. The immutability trigger keeps protecting every other plan column.
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set: run with --env-file=.env.local'); process.exit(1); }
const dry = process.argv.includes('--dry-run');
const sql = neon(process.env.DATABASE_URL);
const cols = await sql`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='nt_trade_ideas' AND column_name IN ('valid_until','entry_by')`;
console.log('current:', JSON.stringify(cols));
if (dry) { console.log('dry run: nothing changed'); process.exit(0); }

await sql`ALTER TABLE public.nt_trade_ideas ALTER COLUMN valid_until DROP NOT NULL`;
await sql`ALTER TABLE public.nt_trade_ideas ADD COLUMN IF NOT EXISTS entry_by DATE`;

await sql`
  CREATE OR REPLACE FUNCTION public.nt_trade_ideas_immutable() RETURNS trigger AS $$
  BEGIN
    IF OLD.published_at IS NOT NULL AND (
         NEW.symbol IS DISTINCT FROM OLD.symbol OR NEW.direction IS DISTINCT FROM OLD.direction
      OR NEW.horizon IS DISTINCT FROM OLD.horizon OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.rationale IS DISTINCT FROM OLD.rationale OR NEW.entry_low IS DISTINCT FROM OLD.entry_low
      OR NEW.entry_high IS DISTINCT FROM OLD.entry_high OR NEW.targets IS DISTINCT FROM OLD.targets
      OR NEW.stop IS DISTINCT FROM OLD.stop
      OR NEW.risk_rating IS DISTINCT FROM OLD.risk_rating OR NEW.option_strategy IS DISTINCT FROM OLD.option_strategy
      OR NEW.publisher_id IS DISTINCT FROM OLD.publisher_id OR NEW.published_at IS DISTINCT FROM OLD.published_at
      OR NEW.published_on IS DISTINCT FROM OLD.published_on OR NEW.ref_price IS DISTINCT FROM OLD.ref_price
    ) THEN
      RAISE EXCEPTION 'a published trade idea cannot be edited; append an idea update instead';
    END IF;
    -- The two dates may change on a published idea only while it is open.
    IF OLD.published_at IS NOT NULL AND (NEW.valid_until IS DISTINCT FROM OLD.valid_until OR NEW.entry_by IS DISTINCT FROM OLD.entry_by)
       AND OLD.status NOT IN ('live', 'triggered') THEN
      RAISE EXCEPTION 'the dates of an idea that has ended cannot be changed';
    END IF;
    RETURN NEW;
  END $$ LANGUAGE plpgsql
`;
console.log(await sql`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='nt_trade_ideas' AND column_name IN ('valid_until','entry_by')`);
console.log('nt_trade_ideas: valid_until nullable, entry_by added, trigger updated');
