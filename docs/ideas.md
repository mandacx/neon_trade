# IDEAS.md

This is a **build brief for unbuilt work**, not a description of shipped
behavior.  
Stage 1 of the prompt below is the amendment that brings this feature into
that spec, and no code should be written before that amendment lands.
 

**Decisions already made.** No compliance module: every bottom carries a
clear, well-designed risk disclaimer instead (rule 9). No billing in the MVP:
admins assign plans as they do today 

**Build status.** Phases 1 (ideas core and composer), 2 (subscribers, board, alerts) 3 (automatic tracking) and 4 (desk performance) are built; see `docs/STATUS.md` for what
was and was not verified.  

**Stage 1 status.** The spec amendment this brief asks for is written: `DESIGN.md` §12 (module, IA routes, §9
amendment, §7 pointer), `CONTRACT.md` §2.12 (tables, catalog domains, entitlements) and §3.20 (endpoints, worked
JSON), a pointer in `SOCIAL.md`, and the deviations in `apps/api/README.md`. **Where they differ from the prompt
below, the spec wins.** Differences found while sanity-checking the prompt against the code:

- `first_touch` is a simulation *scenario* (`trade_simulation.py`, constant `FIRST_TOUCH`, private `_first_touch`),
  not a public function, and both it and `plan_outcome.py` operate on trade-replay `points`. "Reuses the engines"
  therefore means extracting the shared touch rule, not importing a function (`CONTRACT.md` §3.20, Deviations).
- `compute_stats` only accepts `TradeStatRow`s and its money keys are formatted as currency. Ideas are adapted with
  R as the outcome measure and only `idea_*` keys are emitted (`CONTRACT.md` §3.20, "How idea outcomes feed...").
- No sector exists anywhere in the schema, so the `sector` breakdown is deferred until there is a real source.
- `require_enabled` treats a key missing from the catalog as **enabled**, and the plan seed grants every feature to
  `standard`/`pro`, so `publish_ideas` ships `default_enabled = false` and is never seeded into a plan.
- Entitlement `limit` semantics (blank = unlimited, disabled = 0) do not fit a delay, so the delay is a limit that is
  read only while `ideas_realtime` is off.
- Publisher UI lives at `/ideas/publish`, not under `/admin`, because analysts later will not be admins.

Verified in the code this session: `stats.py` (`compute_stats`, `compute_curves`), `entitlements.py`
(`require_enabled`), `trade_simulation.py`, `plan_outcome.py`, `performance_report.py`, `report_email.py`,
`email.py`, `evaluation.py`, `admin_audit.py`, `metric_registry.py`, `dimensions.py`, `filters.py` and
`price_history.py` exist; `update_service.run_update_all` and the seed's catalog/plan structure were read.
Not verified: that no web component already exists that could serve as the disclaimer callout, the exact
`GET /api/analytics/stats` response shape, and the touch-rule extraction's effect on the existing replay tests.

A future session can paste the prompt below, as-is, to build it.

---

Build the **Trade Ideas Desk**  . Admins (and later, designated analysts) publish
trade ideas to subscribers. Each idea is a structured call (instrument, direction, entry zone, target
ladder, stop, horizon, rationale, and optionally an option strategy). The platform tracks each idea's
outcome automatically and honestly, and publishes desk-level performance, results, summaries and analysis.

Read `DESIGN.md`, `CONTRACT.md`, `ADMIN.md` and `SOCIAL.md` first. `CLAUDE.md`'s Binding principles and
Gotchas all apply. Work in two stages, and write no application code until Stage 1 is committed.

## Stage 1: amend the spec

- `DESIGN.md`: a new module, "Trade Ideas Desk", placed after the Admin module. Cover: an **idea** is a
  published thesis plus a plan; it is not the publisher's position and not a subscriber's fill (keep the
  three lifecycles of §2 separate). Say what a subscriber is and is not promised: no advice tailored to
  them, no auto-execution, no guaranteed fills, information only (see rule 9). Add the routes to the
  IA block.
- `CONTRACT.md`: new table and endpoint sections at the same depth as existing ones (DDL with indexes,
  endpoint tables, a worked JSON response per list endpoint).
- Decide, and record, how this shares primitives with `SOCIAL.md`: one publication/visibility model,
  one disclosure projection, and one `AlertChannel` interface. Build whichever lands first as the shared
  foundation.
- Deviations go in `apps/api/README.md` → "Deviations from CONTRACT.md".

## Binding rules for this feature

1. **Who may publish is an entitlement, not a role check.** Add a `publish_ideas` feature in the
   existing plans/entitlements system (`app/services/entitlements.py`, `require_enabled`). Admins get it
   first; analysts get it later through the same system.
2. **Who may read is plan-gated.** Subscriber access is entitlements too: a feature key, plus limits such
   as an idea delay for free tiers. Gating is enforced server-side, and a gated field is *absent* from the JSON.
3. **No enums.** New catalog domains go in `app/seed.py` with display metadata: `idea_status`
   (draft, scheduled, live, triggered, target_hit, stopped, expired, closed_by_publisher, cancelled),
   `idea_horizon` (intraday, swing, positional, long_term), `idea_update_type`, `idea_outcome`,
   `subscription_status`, `alert_channel`, `risk_rating`.
4. **An idea is immutable once published.** Edits are append-only `idea_updates` rows (move stop to
   breakeven, book partial at T1, add rationale, close early), each timestamped and alerted. You cannot
   silently rewrite the plan after the fact: the original entry, target and stop are what get scored.
   Same reason the ledger is append-only.
5. **Scoring is mechanical and reuses the engines.** Entry trigger, target/stop touches and outcome come
   from daily bars via the rules in `app/services/plan_outcome.py` and `trade_simulation.py`
   (`first_touch`, stop-first on ambiguous bars, bar-close basis labelled). Never let the publisher
   self-report an outcome. An idea that never entered its zone is `not_triggered`, not a win.
6. **One stats engine.** Desk and publisher performance comes from `stats.py::compute_stats` /
   `compute_curves` over idea-outcome rows, with labels and formats from `metric_registry.py`
   (`meta.definitions`) and breakdowns via `dimensions.py` (horizon, strategy family, symbol, sector,
   publisher). Add idea-specific metrics (hit rate, avg R, expectancy in R, time to target, max adverse
   excursion) to the registry. Do not write a second formula.
7. **Honest numbers.** Every stat block carries `meta.coverage`: ideas counted, ideas excluded and why,
   and the date range. Returns are shown in R-multiples and % per idea, never as a fabricated dollar
   P&L. Cancelled ideas, and ideas closed early, still count. Never publish a number you cannot explain.
8. **Preview before publish.** `POST /api/ideas?dry_run=true` returns exactly what each subscriber tier
   will receive, including the alert payload.
9. **A clear, well-designed risk disclaimer on every surface. There is no compliance module.** Every
   idea page, the ideas board, the performance page, each alert and each email carries the same
   disclaimer. It is server-supplied, so it is edited in one place and never hardcoded per component.
   It must say, in plain language:
   - the publisher is **not a registered investment adviser or research analyst**;
   - ideas are **for information and education only, not trading or investment advice**, and not a
     recommendation to buy or sell;
   - trading and investing involve **risk of loss, including loss of principal**; past performance,
     including the desk's tracked results, does not guarantee future results;
   - **trade or invest only as your own investment adviser advises**, and do your own research.

   Present it as a designed element, not fine print: a calm, readable callout (icon, title such as
   "For information only", short bullet points, theme-aware colours, legible in light and dark mode).
   Show it in full on idea detail and performance pages, as a compact one-line banner with "read more" on
   the board and in alerts, and as a styled footer block in emails. A first-time subscriber acknowledges
   it once, and the acknowledgement is stored with a timestamp. Risk rating stays an ordinary idea
   attribute.
10. Everything else in `CLAUDE.md` still binds: `{data, meta}` envelope, the §1.4 filter grammar via
    `filters.py`, money as `NUMERIC(18,6)` + currency, Idempotency-Key/If-Match, and seed in the same
    commit as each migration.

## Short-term plan (MVP, each phase shippable)

- **Phase 1: Ideas core.** Tables `trade_ideas` (publisher, instrument/strategy_key, direction,
  entry_low/high, targets JSONB ladder, stop, horizon, valid_until, rationale, risk_rating, status,
  optional link to a `market_view` and to the publisher's real `trade`) and `idea_updates`.
  Endpoints: CRUD on drafts, publish with dry-run, list with the §1.4 grammar, detail with update
  timeline. Admin UI: an idea composer that reuses New Trade form components and the strategy
  picker, and shows a live risk/reward (R:R) readout.
- **Phase 2: Subscribers and delivery.** `idea_subscriptions` (state machine: pending, active, paused,
  cancelled, with history), with access gated by plan entitlement. Subscriber pages: `/ideas` (live board:
  open, triggered, closed tabs), `/ideas/[id]` (plan, chart with entry zone/targets/stop drawn, update
  timeline). Alerts on publish, trigger, target/stop and publisher update. Channels: in-app plus email
  (reuse `email.py`), behind one `AlertChannel` interface. Log every delivery append-only, with an
  idempotency key per (event, subscriber).
- **Phase 3: Automatic tracking.** A daily job step (in `update_service.run_update_all`, non-fatal)
  evaluates each live idea against bars and stores the outcome in a derived, rebuildable
  `idea_outcomes` table. Each outcome emits an alert.
- **Phase 4: Performance v1.** `/ideas/performance`: hit rate, average R, expectancy, win/loss streaks,
  equity curve in R, breakdown by horizon and strategy family, closed-ideas results table, all with
  coverage.

## Long-term roadmap

- **Analysis and reporting:** weekly/monthly desk reports through `performance_report.py` /
  `report_email.py` (ideas published, closed, hit rate, best/worst, open book). An AI-written
  narrative summary via `anthropic_client.py`, clearly labelled and generated only from computed numbers.
  An idea "post-mortem" on close, comparing what the plan said with what the market did.
- **Publisher analytics:** per-analyst track records and a desk leaderboard (minimum-sample floor),
  calibration (conviction vs outcome), and thesis grade (A–F via `evaluation.py`) shown separately
  from plan outcome.
- **Subscriber tools:** "I took this" (opens a real trade in the subscriber's own book from the idea,
  using `lifecycle.open_trade` with a preview and their own quantity, never defaulted), followed vs
  not-followed comparison, a personal watchlist and filters, and alert preferences (channel, horizon,
  symbol, quiet hours).
- **More channels:** web push, Telegram/Discord webhooks (HMAC-signed, with backoff).
- **Content:** idea series/model portfolios (a basket with weights and rebalances), watchlist ideas
  (pre-trigger), market notes and commentary attached to ideas, and comments/Q&A moderated by the desk.
- **Monetisation (later, explicitly out of MVP):** paid tiers via billing integration, trials and a
  delayed free feed. Until then, admins assign plans as today.
- **Safety and ops:** audit log for every publish and edit (reuse `admin_audit.py`), rate limits,
  report/abuse, and an account-deletion path that stops fan-out.

## Verification per phase

Run `alembic upgrade head` + `python -m app.seed` locally. Publish an idea and confirm the dry-run
matches what a subscriber on each tier receives. Feed fixture bars and confirm trigger, target and stop
outcomes (including the ambiguous-bar stop-first case and the not-triggered case). Confirm that stats
coverage lists excluded ideas, that the disclaimer renders on every surface listed in rule 9, and that
exactly one alert is delivered per subscription per event. `npx tsc --noEmit` and `next build` must be
clean. Stub `TradierClient.get_quotes` in tests. Update `docs/STATUS.md`, with an honest "not verified" list.

Sanity-check the claims this prompt makes about the codebase before relying on them: that
`compute_stats`/`compute_curves` live in `app/services/stats.py`, `require_enabled` in
`app/services/entitlements.py`, the `first_touch` scenario in `trade_simulation.py`, and that
`plan_outcome.py`, `performance_report.py`, `report_email.py`, `email.py`, `evaluation.py` and
`admin_audit.py` still exist.

**Chart (added after Phase 4).** The idea page's chart is TradingView's Lightweight Charts library at any interval with scroll-back loading, a
cursor readout, publisher/admin-only market price levels per option expiry, an expanded view and a pop-out window. It is the charting
library, not the embeddable TradingView widget, because the widget streams live prices and cannot draw a published plan, which would bypass
the reader's delay and tier. See `docs/STATUS.md` for what was and was not verified.
