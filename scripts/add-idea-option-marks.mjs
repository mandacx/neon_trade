// Trade Ideas Desk: option strategy tracking table (docs/trade-ideas.md, "Option strategy tracking"). Idempotent, safe to re-run.
//
//   node --env-file=.env.local scripts/add-idea-option-marks.mjs
//
// nt_idea_option_marks   the idea's option legs priced at one moment: 'entry' (when the stock enters), 'target:T1'.. (information
//                        only), 'exit' (when the idea ends, or the options expire) and 'latest' (the current mark while open).
//                        Prices are per-share ESTIMATES (mid of bid/ask, else last trade); P&L is derived from them at read time
//                        (lib/ideaOptionMath.ts), so this table is derived and rebuildable: safe to TRUNCATE; the tracker re-prices
//                        entry / target / exit from stored quotes where it can (replay) and the latest mark on its next run.
//                        Separate from nt_idea_outcomes: never counted in desk statistics.

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set: run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS public.nt_idea_option_marks (
    id           BIGSERIAL PRIMARY KEY,
    idea_id      BIGINT NOT NULL REFERENCES public.nt_trade_ideas(id),
    event_key    TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('entry', 'target', 'mark', 'exit')),
    at           TIMESTAMPTZ NOT NULL,
    captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    underlying   NUMERIC(18,6),
    legs         JSONB NOT NULL,
    basis        TEXT NOT NULL,
    note         TEXT,
    UNIQUE (idea_id, event_key)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS nt_idea_option_marks_idea_idx ON public.nt_idea_option_marks (idea_id)`;
console.log('nt_idea_option_marks ready');
