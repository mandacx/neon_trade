// Trade Ideas Desk tables (docs/trade-ideas.md). Idempotent: CREATE ... IF NOT EXISTS, safe to re-run.
//
//   node --env-file=.env.local scripts/add-trade-ideas-tables.mjs
//
// nt_trade_ideas           published thesis + plan (plan columns are immutable once published: trigger below)
// nt_idea_updates          append-only timeline (notes, stop moved, partial booked, early close, cancel)
// nt_idea_outcomes         derived, rebuildable result of each idea (lib/ideaScoring.ts); safe to TRUNCATE
// nt_idea_events           append-only event feed (published, triggered, target_hit, stopped, ...), one row per event
// nt_idea_deliveries       per (event, user, channel) delivery log; the unique key gives exactly one alert per event
// nt_idea_prefs            per-user alert preferences and feed read marker
// nt_idea_disclaimer_acks  first-time acknowledgement of the risk disclaimer, with timestamp and version

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set: run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS public.nt_trade_ideas (
    id            BIGSERIAL PRIMARY KEY,
    publisher_id  TEXT NOT NULL,
    symbol        TEXT NOT NULL,
    direction     TEXT NOT NULL CHECK (direction IN ('long', 'short')),
    horizon       TEXT NOT NULL CHECK (horizon IN ('intraday', 'swing', 'positional', 'long_term')),
    status        TEXT NOT NULL DEFAULT 'draft',
    title         TEXT NOT NULL,
    rationale     TEXT NOT NULL DEFAULT '',
    entry_low     NUMERIC(18,6) NOT NULL,
    entry_high    NUMERIC(18,6) NOT NULL,
    targets       JSONB NOT NULL DEFAULT '[]',
    stop          NUMERIC(18,6) NOT NULL,
    valid_until   DATE NOT NULL,
    risk_rating   TEXT NOT NULL DEFAULT 'medium' CHECK (risk_rating IN ('low', 'medium', 'high')),
    option_strategy JSONB,
    ref_price     NUMERIC(18,6),
    published_at  TIMESTAMPTZ,
    published_on  DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS nt_trade_ideas_status_idx ON public.nt_trade_ideas (status, published_at DESC)`;
await sql`CREATE INDEX IF NOT EXISTS nt_trade_ideas_symbol_idx ON public.nt_trade_ideas (symbol, published_at DESC)`;
await sql`CREATE INDEX IF NOT EXISTS nt_trade_ideas_publisher_idx ON public.nt_trade_ideas (publisher_id, created_at DESC)`;

// An idea is immutable once published: the original entry, targets, stop and horizon are what get scored.
// Only status / updated_at (set by tracking and publisher actions) may change after publishing.
await sql`
  CREATE OR REPLACE FUNCTION public.nt_trade_ideas_immutable() RETURNS trigger AS $$
  BEGIN
    IF OLD.published_at IS NOT NULL AND (
         NEW.symbol IS DISTINCT FROM OLD.symbol OR NEW.direction IS DISTINCT FROM OLD.direction
      OR NEW.horizon IS DISTINCT FROM OLD.horizon OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.rationale IS DISTINCT FROM OLD.rationale OR NEW.entry_low IS DISTINCT FROM OLD.entry_low
      OR NEW.entry_high IS DISTINCT FROM OLD.entry_high OR NEW.targets IS DISTINCT FROM OLD.targets
      OR NEW.stop IS DISTINCT FROM OLD.stop OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
      OR NEW.risk_rating IS DISTINCT FROM OLD.risk_rating OR NEW.option_strategy IS DISTINCT FROM OLD.option_strategy
      OR NEW.publisher_id IS DISTINCT FROM OLD.publisher_id OR NEW.published_at IS DISTINCT FROM OLD.published_at
      OR NEW.published_on IS DISTINCT FROM OLD.published_on OR NEW.ref_price IS DISTINCT FROM OLD.ref_price
    ) THEN
      RAISE EXCEPTION 'a published trade idea cannot be edited; append an idea update instead';
    END IF;
    RETURN NEW;
  END $$ LANGUAGE plpgsql
`;
await sql`DROP TRIGGER IF EXISTS nt_trade_ideas_immutable_trg ON public.nt_trade_ideas`;
await sql`
  CREATE TRIGGER nt_trade_ideas_immutable_trg BEFORE UPDATE ON public.nt_trade_ideas
  FOR EACH ROW EXECUTE FUNCTION public.nt_trade_ideas_immutable()
`;
await sql`
  CREATE OR REPLACE FUNCTION public.nt_trade_ideas_no_delete() RETURNS trigger AS $$
  BEGIN
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'a published trade idea cannot be deleted; cancel it instead';
    END IF;
    RETURN OLD;
  END $$ LANGUAGE plpgsql
`;
await sql`DROP TRIGGER IF EXISTS nt_trade_ideas_no_delete_trg ON public.nt_trade_ideas`;
await sql`
  CREATE TRIGGER nt_trade_ideas_no_delete_trg BEFORE DELETE ON public.nt_trade_ideas
  FOR EACH ROW EXECUTE FUNCTION public.nt_trade_ideas_no_delete()
`;

await sql`
  CREATE TABLE IF NOT EXISTS public.nt_idea_updates (
    id           BIGSERIAL PRIMARY KEY,
    idea_id      BIGINT NOT NULL REFERENCES public.nt_trade_ideas(id),
    update_type  TEXT NOT NULL,
    body         TEXT NOT NULL DEFAULT '',
    payload      JSONB NOT NULL DEFAULT '{}',
    created_by   TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_on DATE NOT NULL
  )
`;
await sql`CREATE INDEX IF NOT EXISTS nt_idea_updates_idea_idx ON public.nt_idea_updates (idea_id, created_at)`;
await sql`
  CREATE OR REPLACE FUNCTION public.nt_idea_updates_append_only() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'nt_idea_updates is append-only';
  END $$ LANGUAGE plpgsql
`;
await sql`DROP TRIGGER IF EXISTS nt_idea_updates_append_only_trg ON public.nt_idea_updates`;
await sql`
  CREATE TRIGGER nt_idea_updates_append_only_trg BEFORE UPDATE OR DELETE ON public.nt_idea_updates
  FOR EACH ROW EXECUTE FUNCTION public.nt_idea_updates_append_only()
`;

await sql`
  CREATE TABLE IF NOT EXISTS public.nt_idea_outcomes (
    idea_id           BIGINT PRIMARY KEY REFERENCES public.nt_trade_ideas(id),
    outcome           TEXT NOT NULL,
    entered_on        DATE,
    entry_price       NUMERIC(18,6),
    exit_on           DATE,
    exit_price        NUMERIC(18,6),
    targets_hit       INT NOT NULL DEFAULT 0,
    targets_total     INT NOT NULL DEFAULT 0,
    r_multiple        NUMERIC(12,4),
    pct_return        NUMERIC(12,4),
    mae_pct           NUMERIC(12,4),
    mfe_pct           NUMERIC(12,4),
    days_to_t1        INT,
    days_held         INT,
    events            JSONB NOT NULL DEFAULT '[]',
    evaluated_through DATE,
    basis             TEXT NOT NULL DEFAULT 'daily_bars_stop_first',
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS public.nt_idea_events (
    id          BIGSERIAL PRIMARY KEY,
    idea_id     BIGINT NOT NULL REFERENCES public.nt_trade_ideas(id),
    event_key   TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    horizon     TEXT NOT NULL,
    summary     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (idea_id, event_key)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS nt_idea_events_time_idx ON public.nt_idea_events (created_at DESC)`;

await sql`
  CREATE TABLE IF NOT EXISTS public.nt_idea_deliveries (
    id          BIGSERIAL PRIMARY KEY,
    event_id    BIGINT NOT NULL REFERENCES public.nt_idea_events(id),
    user_id     TEXT NOT NULL,
    channel     TEXT NOT NULL,
    status      TEXT NOT NULL,
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (event_id, user_id, channel)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS public.nt_idea_prefs (
    user_id       TEXT PRIMARY KEY,
    email_alerts  BOOLEAN NOT NULL DEFAULT false,
    feed_seen_at  TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS public.nt_idea_disclaimer_acks (
    user_id   TEXT PRIMARY KEY,
    version   TEXT NOT NULL,
    acked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

// --- Phase 5 (2026-11-08): scheduled publishing, "I took this", Telegram and web push -----------------------------
// Scheduled ideas are drafts with a time: status 'scheduled', plan still editable (published_at stays NULL, so the
// immutability trigger does not apply until the tracker publishes it). A failed scheduled publish is reported in
// schedule_error and the idea goes back to 'draft'.
await sql`ALTER TABLE public.nt_trade_ideas ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ`;
await sql`ALTER TABLE public.nt_trade_ideas ADD COLUMN IF NOT EXISTS schedule_error TEXT`;
await sql`CREATE INDEX IF NOT EXISTS nt_trade_ideas_scheduled_idx ON public.nt_trade_ideas (scheduled_for) WHERE status = 'scheduled'`;

await sql`ALTER TABLE public.nt_idea_prefs ADD COLUMN IF NOT EXISTS telegram_alerts BOOLEAN NOT NULL DEFAULT false`;
await sql`ALTER TABLE public.nt_idea_prefs ADD COLUMN IF NOT EXISTS push_alerts BOOLEAN NOT NULL DEFAULT false`;

// Browser (Web Push) subscriptions: one row per device. Dead endpoints (404/410) are deleted on send.
await sql`
  CREATE TABLE IF NOT EXISTS public.nt_idea_push_subscriptions (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL,
    endpoint    TEXT NOT NULL UNIQUE,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ok_at  TIMESTAMPTZ
  )
`;
await sql`CREATE INDEX IF NOT EXISTS nt_idea_push_user_idx ON public.nt_idea_push_subscriptions (user_id)`;

// The subscriber's own journal entry for an idea they chose to take. Private (every query filters user_id); a record
// only, nothing is sent to a broker. Quantity and price are the subscriber's own, never defaulted from the idea.
await sql`
  CREATE TABLE IF NOT EXISTS public.nt_idea_taken (
    id           BIGSERIAL PRIMARY KEY,
    user_id      TEXT NOT NULL,
    idea_id      BIGINT NOT NULL REFERENCES public.nt_trade_ideas(id),
    qty          NUMERIC(18,4) NOT NULL CHECK (qty > 0),
    entry_price  NUMERIC(18,6) NOT NULL CHECK (entry_price > 0),
    taken_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    note         TEXT,
    exit_price   NUMERIC(18,6),
    closed_at    TIMESTAMPTZ,
    UNIQUE (user_id, idea_id)
  )
`;
await sql`CREATE INDEX IF NOT EXISTS nt_idea_taken_user_idx ON public.nt_idea_taken (user_id, taken_at DESC)`;

console.log('Trade Ideas tables ready.');
