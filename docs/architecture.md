# Architecture overview (concise, current)

Authoritative detail lives in `CLAUDE.md` (stack, data, services, rules), `docs/CHANGES.md` (change log) and the per-area
docs (`docs/trade-ideas.md`, `docs/earnings.md`, `docs/us-scanner.md`, `docs/oi-tracker.md`, `docs/crypto.md`,
`docs/strategy-builder.md`). This file is the map and the standing rules; it does not repeat those docs.

## Components (high level)

- **Next.js 15 App Router on Vercel**, Neon Postgres via `lib/db.ts`, Railway curl crons for background jobs.
- **Market data** only through the server-only facade `lib/marketdata/index.ts` (vendors named only in `lib/marketdata/provider/*`).
  Quotes are session-aware: `lib/marketSession.ts` (`getMarketState`) + `lib/quote.ts` (`buildQuote`), client polling cadence
  from `lib/pollDelay.ts`.
- **Plan gating** is done in SQL (a gated row is absent from the result), routes answer 401/403/404 consistently.
- **Rate limits**: `lib/rateLimit.ts` + limiters declared in `lib/rateLimitConfig.ts` (admin-editable).
- **Pure modules** (dependency-free, explicit `.ts` import extensions) are fixture-tested by `scripts/test-*.mjs`.

## Trade Ideas Desk (see `docs/trade-ideas.md`)

```
 publish (immutable plan) --> nt_trade_ideas
 tracker (cron / manual)  --> scoreIdea() on COMPLETE daily bars (asOf = yesterday ET) --> nt_idea_outcomes (official)
 reader: GET /api/ideas/[id] (gated read, plan + official outcome)
 reader: GET /api/ideas/[id]/live  and  GET /api/ideas/live      (NEW: provisional live mark, never stored)
            gated read -> facade snapshot -> buildQuote/getMarketState -> lib/ideaLiveMath.ts (pure) -> JSON
```

### Live mark of an open idea (decision record, 2026-11-10)

- **What it is:** a provisional *price mark* of the idea's own published plan at the current price: where price is versus
  the entry zone, stop and targets, and (only once the idea has entered, per the official tracker) the R and % if marked at
  that price. It is computed on request, never persisted, never fed to `scoreIdea`, never counted in desk statistics, never
  sends alerts, and is independent of `nt_idea_taken`.
- **What it is not:** the official result. The official result stays "daily bars through yesterday, stop first". A live
  price crossing a level is shown as a state, not a decision. A "today's range touched ..." hint (from the snapshot's day
  high/low) warns when the official scorer will probably differ; it never changes R.
- **Computation:** `lib/ideaLiveMath.ts` (pure) reuses the scorer's conventions (entry = worst fill in the zone,
  risk = |entry - stop|, equal-split ladder). Targets already booked per the stored outcome are kept; targets the live price
  is at or beyond are counted as reached for the mark. No clamping at the stop (a gap would be worse than the stop, so
  clamping would flatter).
- **Why not re-run `scoreIdea` with a partial "today" bar** (rejected): it contradicts the "a partial bar never decides"
  rule, is empty on the publish day (rule 1), can flip later (stop-first on a half-formed bar) and fires `expired` early.
- **Why not client-only last candle** (rejected): no plan-relative numbers, no R, and would invite the client to hold plan
  logic that must stay gated.
- **Gating:** the live routes call the same gated SQL read as `getIdea`/`listIdeas` first; plan-relative numbers of a gated
  idea never leave the server. The board route takes no ids from the client.
- **Cost control:** idea page = one symbol, one snapshot call (5 s per-instance cache in the provider); board = one batched
  snapshot call for all open symbols; both behind a dedicated limiter `ideas_live`.

### Alert messages: email, Telegram, web push (decision record, 2026-11-10)

```
 recordEvent(ideaId, key, type, horizon, summary, facts)  --> nt_idea_events (summary = in-app feed text, payload = facts JSON)
 deliverAlerts (cron) --> candidates() (eligibility SQL unchanged) + one read of the immutable plans (nt_trade_ideas, by id)
     --> lib/ideaAlertModel.ts (pure: kinds, facts, formatting, escaping)
     --> lib/ideaEmail.ts (subject / preheader / text / HTML)   lib/ideaMessages.ts (Telegram HTML + plain, push payload)
     --> sendEmail / sendTelegramMessage(parse_mode HTML, plain retry) / web-push  --> nt_idea_deliveries (unchanged)
```

- **Data:** `nt_idea_events.payload` (nullable JSONB, `{ v: 1, ... }`) holds only the event's own facts (session date,
  price hit, target label, targets hit so far, scored R, gap flag, new stop, booked price/pct, note). The plan (symbol,
  side, zone, stop, targets, valid until, risk) is read from `nt_trade_ideas` at delivery: it is immutable once published,
  so it cannot drift. `summary` is unchanged and stays the in-app feed text and the fallback.
- **Fallback:** `payload IS NULL` (events recorded before the column) or a missing plan row renders the designer's
  summary-only layout; an unknown `event_type` renders a neutral "Idea update".
- **Builders are pure** (no `server-only`, no `@/` imports, explicit `.ts` extensions) so `scripts/test-idea-alerts.mjs`
  checks every type on every channel. `lib/ideaChannels.ts` only fetches, calls the builders and sends.
- **R shown:** per-target R from the plan (`riskReward`) on target and published alerts; the scorer's realised R (`s.r`,
  equal-split ladder) on terminal events (all targets, stopped, expired), so an alert never disagrees with the Performance page.
- **Telegram:** `parse_mode: 'HTML'` with every dynamic value escaped; on any 400 that is not "chat not found" it resends
  once as plain text without the button, inside the same claimed delivery row.
- **Push:** title `SYM side: event`, one line of numbers, then `IDEA_DISCLAIMER_MICRO`; tag `idea-<ideaId>-<eventId>`
  (per event, so T2 no longer replaces T1). Payload shape `{ title, body, url, tag }` is the service-worker contract.
- Rejected: parsing `summary` (fragile); recomputing facts at delivery from `nt_idea_outcomes` (that row is overwritten,
  so it describes "now", not the event); snapshotting the whole plan into every payload (duplicates immutable data).

## Plans (decision record, 2026-11-10: Premium)

- Plans are **DB rows** (`nt_plans`: code, name, features JSONB, sort_order, is_active), not code. Gates are feature codes
  from `lib/features.ts`; a plan works the moment it holds the right codes. Admins assign plans manually in `/admin/users`;
  `/upgrade` lists only `is_active` plans with a mailto "Contact us" button. No billing, no price field.
- New plans are created by an **insert-only, re-runnable script** (`scripts/add-*-plan(s).mjs`), never by code at runtime.
  Display names live in three hardcoded places that must be updated with the row: `planLabel()` in `lib/features.ts`,
  `PLAN_TAGS` in `components/layout/Header.tsx`, and (Trade Ideas only) the `tiers` preview list in `lib/ideas.ts` plus
  the `TERM_PLANS` copy in `app/ideas/page.tsx`.
- **PREMIUM** (sort 60, name "Premium"): both idea terms + minimal tools. Separate from `PLATINUM`, which is untouched.
  Details: handoff `architect.md` of run 20261110-1100-ideas-premium-plan, `docs/trade-ideas.md` "Plans and gates".

## Do's and Don'ts

Do
- Add a plan by an insert-only script (`ON CONFLICT (code) DO NOTHING`), dry-run first; update `planLabel`, `PLAN_TAGS` and docs together.
- Keep a new plan's features to the codes in `ALL_FEATURES`; never include `publish_ideas` in a subscriber plan.
- Read through the facade on the server; send the client only neutral, vendor-free JSON.
- Keep plan-gating in SQL and call the gated read before touching any market data for an idea.
- Put maths in a pure `.ts` module with explicit `.ts` import extensions and fixtures in `scripts/`.
- Label provisional numbers as provisional, name their basis (live vs last close) and keep the risk disclaimer visible.
- Batch symbols for list views (one `getSnapshotsMulti`), never one request per card/row.
- Use `lib/pollDelay.ts` for any poller; pause when the tab is hidden; stop on 401/403/404; back off on 429.
- Degrade to "price unavailable" instead of inventing or reusing stale numbers silently.
- Record every change in `docs/CHANGES.md` (verified vs not verified).
- Build alert text only in the pure builders (`lib/ideaAlertModel.ts`, `lib/ideaEmail.ts`, `lib/ideaMessages.ts`); truncate
  raw text first, then escape every dynamic value (`escapeHtml`) for email HTML and Telegram HTML.
- Take every disclaimer string from `lib/ideaDisclaimer.ts`; omit a missing number rather than print `null`/`NaN`/a dash.
- Ship schema changes as idempotent, re-runnable scripts that the release step runs before the code that needs them.

Don't
- Don't change gating logic (`lib/ideas.ts` term SQL, `lib/ideasApi.ts`, layouts) to add a plan; feature codes are the contract.
- Don't write to the production DB from development work; plan scripts run at release by the owner.
- Don't import `@/lib/marketdata` (or provider code) from client components; don't name vendors in routes, responses, UI text.
- Don't write live marks to `nt_idea_outcomes`, statuses, events, alerts or desk stats; don't feed partial bars to `scoreIdea`.
- Don't accept idea ids or symbols from the client on a batch route; derive them from the gated SQL read.
- Don't show money P&L or per-user quantities in the idea's live mark (R and % only).
- Don't poll faster than `pollDelayMs` allows or in a hidden tab; don't add timers that outlive the component.
- Don't change the immutability of published plans or the official scoring rules as part of display work.
- Don't change alert eligibility, recipients, plan gating, the 3-day window or the delivery-row dedupe for presentation work.
- Don't rewrite `nt_idea_events.summary` (it is the in-app feed text) or reword the disclaimer; don't hardcode disclaimer text.
- Don't import `server-only`, `@/lib/db` or `@/` aliases into the alert builders; don't add emoji to email subjects or push.
- Don't commit binary assets (push PNG icon/badge) without the owner supplying them.
