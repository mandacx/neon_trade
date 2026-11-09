# Trade Ideas Desk

Admins (and later, designated analysts) publish **trade ideas** to subscribers: a structured call with an
instrument, direction, entry zone, target ladder, stop, horizon, rationale and, optionally, an option strategy.
The platform scores every idea **mechanically** from daily bars and publishes desk-level performance.

This is the Stocks Trendz adaptation of `docs/ideas.md`. That brief was written for a sibling project (Python/FastAPI,
`DESIGN.md`, `CONTRACT.md`, `app/seed.py`, `stats.py`, ...). None of those exist here, so this document is the spec
for *this* codebase and **wins where the two differ**. Differences, and why:

| `ideas.md` | Here | Why |
|---|---|---|
| `DESIGN.md` / `CONTRACT.md` amendment (Stage 1) | this file | no such spec files in this repo; `CLAUDE.md` + `docs/*.md` are the spec |
| `app/seed.py` catalog domains, "no enums" | `lib/ideaTypes.ts` catalogs (key, label, tone, description) | same intent (display metadata in one place, no hardcoded unions in the UI) |
| `require_enabled` / entitlements | `lib/features.ts` feature codes + `nt_plans.features` + `lib/routeGuards.ts` | this app's existing plan system |
| `stats.py::compute_stats`, `metric_registry.py` | `lib/ideaStats.ts` (one engine, `METRIC_DEFINITIONS`) | no Python engines to reuse |
| `first_touch`, `plan_outcome.py` | `lib/ideaScoring.ts` (pure, fixtures) | same rules, written for daily bars |
| `{data, meta}` envelope, `Idempotency-Key`, `If-Match` | this app's `{ success, data, error }` envelope; idempotency by unique keys in the DB | repo convention |
| `idea_subscriptions` state machine | plan entitlement + `nt_idea_prefs` (email opt-in) | access is the plan; no separate subscription object until billing exists |
| Alembic migrations | `scripts/add-trade-ideas-tables.mjs` (idempotent) | repo convention |
| `AlertChannel` interface shared with `SOCIAL.md` | in-app feed + email, one event table; no `SOCIAL.md` exists | see "Alerts" |

## What an idea is (and is not)

An **idea** is a published thesis plus a plan. It is **not** the publisher's position and **not** a subscriber's fill.
A subscriber is promised nothing more than information: no advice tailored to them, no auto-execution, no guaranteed
fills. Every surface carries the risk disclaimer (below). Subscribers' own trades (the later "I took this" tool) will
be a separate lifecycle that is never defaulted from an idea.

## Plans and gates

Three new plans, in this order (sort order 30, 40, 50, after Pro Plus at 20):

| Plan | Code | Idea access |
|---|---|---|
| **Short term** | `SHORT_TERM` | `ideas_short_term`: intraday + swing ideas |
| **Long term** | `LONG_TERM` | `ideas_long_term`: positional + long-term ideas |
| **Platinum** | `PLATINUM` | both |

**Options are deliberately not part of any plan definition.** Option strategies can already be attached to ideas
(descriptive; the idea is scored on the underlying) and are visible to anyone who can read the idea. The planned
"options for long term" entitlement (Platinum) is a hook, `canSeeOptionStrategy()` in `lib/ideas.ts`: when that feature
code exists, return false for plans without it and the field is dropped from the JSON. No schema change needed.
`option_chain` and `strategy_builder` are not in the new plans either.

New feature codes (`lib/features.ts`, shown in `/admin/plans` as checkboxes like every other gate):

| Code | Meaning |
|---|---|
| `ideas_short_term` | read intraday + swing ideas |
| `ideas_long_term` | read positional + long-term ideas |
| `publish_ideas` | publish and manage ideas. **Not in any plan.** Admins always may; grant it to an analyst with a per-user override in `/admin/users`. Who may publish is an entitlement, not a bare role check. |

**Every other gate is a toggle per plan.** Tick or untick any of these on the new plans at `/admin/plans`:

| What you asked to switch | Feature code(s) |
|---|---|
| Price levels | `levels` |
| Open interest data | `oi_tracker` |
| Option strategy | `strategy_builder` (builder tab) and `option_chain` (chain tab), independent |
| Stock scanners | `us_market_scanner`, `scan_alerts_latest`, `scan_alerts_history` |
| Quadrant analysis | `quadrant` |
| Also | `earnings`, `watchlists`, `telegram_alerts`, `performance`, `crypto_levels`, `stock_analysis`, and the expiry restrictions `standard_expiry_only` / `quarterly_expiry_only` |

**Starting mix** (my choice, not a spec; edit freely in `/admin/plans`, nothing is hardcoded):

| Gate | Short term | Long term | Platinum |
|---|---|---|---|
| `ideas_short_term` | on | off | on |
| `ideas_long_term` | off | on | on |
| `levels`, `quadrant`, `watchlists`, `earnings`, `us_market_scanner`, `stock_analysis` | on | on | on |
| `scan_alerts_latest`, `scan_alerts_history`, `telegram_alerts` | on | off | on |
| `oi_tracker` | off | on | on |
| `quarterly_expiry_only` (restriction) | off | **on** (like "Self learners", code `LONG_INVESTORS`) | off |
| `option_chain`, `strategy_builder`, options-for-ideas | off | off | off (later) |
| `performance`, `crypto_levels` | off | off | off (Pro does not have `performance` live either) |

Plans are created **inactive** (`is_active = false`): admins can assign them from `/admin/users` and see them in
`/admin/plans`, but they are not on the public `/upgrade` page until `is_active` is flipped. There is no billing in
the MVP; admins assign plans as they do today.

Reading is gated **server-side in SQL** (`lib/ideas.ts`): an idea outside the viewer's terms is never selected, so it
is absent from the JSON, and `GET /api/ideas/[id]` answers 404 both for a missing idea and for one outside the plan.
The board shows locked terms only as a count with an upgrade link.

## Data model

Created by `scripts/add-trade-ideas-tables.mjs` (idempotent). All tables are `nt_`-prefixed (the Neon database is shared).

| Table | Purpose |
|---|---|
| `nt_trade_ideas` | the idea: symbol, direction, horizon, status, entry zone, `targets` JSONB ladder, stop, `valid_until`, `risk_rating`, optional `option_strategy` JSONB, `ref_price` (last close at publish), publish stamps. Money columns are `NUMERIC(18,6)`. |
| `nt_idea_updates` | append-only timeline: note, stop moved, partial booked, closed early, cancelled. A DB trigger rejects UPDATE/DELETE. |
| `nt_idea_outcomes` | **derived and rebuildable** result per idea (`lib/ideaScoring.ts`). Safe to TRUNCATE and rebuild (`/api/ideas/evaluate {all:true}` or `/api/cron/ideas?force=true`). |
| `nt_idea_events` | append-only event feed (published, triggered, T1.., stopped, expired, updates). `UNIQUE (idea_id, event_key)`: re-running the tracker never duplicates an event. |
| `nt_idea_deliveries` | email delivery log, `UNIQUE (event_id, user_id, channel)`: exactly one alert per event per subscriber. |
| `nt_idea_prefs` | email opt-in and the feed's read marker. |
| `nt_idea_disclaimer_acks` | first-time acknowledgement: user, disclaimer version, timestamp. |
| `nt_idea_push_subscriptions` | one row per browser/device for web push (endpoint unique; dead endpoints are deleted on send). |
| `nt_idea_taken` | the subscriber's own "I took this" journal entry (`UNIQUE (user_id, idea_id)`), private. |

`nt_trade_ideas` also has `scheduled_for` and `schedule_error`; `nt_idea_prefs` has `telegram_alerts` and `push_alerts`.

**Immutability.** Once `published_at` is set, a trigger rejects any change to the plan columns (symbol, direction,
horizon, title, rationale, entry zone, targets, stop, valid-until, risk, option strategy, publisher, publish stamps),
and rejects deleting the idea. Only `status` and `updated_at` change afterwards (tracker and publisher actions).
Changes are `nt_idea_updates` rows, each timestamped and alerted. The original entry, targets and stop are what get scored.

**Catalogs** (`lib/ideaTypes.ts`, each entry has key, label, tone, description): horizons
(intraday, swing -> short term; positional, long_term -> long term), statuses
(draft, scheduled, live, triggered, target_hit, stopped, expired, closed_by_publisher, cancelled), update types, outcomes, risk
ratings, directions.

## Scoring (`lib/ideaScoring.ts`)

Mechanical, from **daily bars**, never self-reported. Every result is labelled `daily_bars_stop_first`. Fixtures:
`node scripts/test-idea-scoring.mjs`.

1. Only sessions **after** the publish date count (the publish day's bar may pre-date the idea).
2. **Entry:** a bar whose range overlaps the entry zone. Entry price is the **worst fill in the zone** (long: zone high,
   short: zone low), so R is never flattered. Price that runs to target 1 (or through the stop) without touching the zone
   means the idea never entered: `not_triggered`, not a win.
3. **Stop first** when one bar touches both the stop and a target, including on the entry bar. After the entry bar a gap
   through the stop fills at the open (worse than the stop); targets fill at the target price, never better.
4. **Ladder:** the position splits equally across targets; each target booked at its price; the remainder exits at the
   stop, at the close of the valid-until date (marked to market, `expired`), or at the close of the session on which the
   publisher closed it (`closed_by_publisher`).
5. **R** = profit / risk, risk = |entry price - stop|. Also % return per idea, max adverse and favourable excursion,
   sessions to target 1.
6. `open` ideas show an **unrealised** R and are never counted in desk statistics.
7. Stop-moved and partial-booked updates are commentary; they do not change the score. Cancelled before entry = `cancelled`
   (never traded).

`asOf` is yesterday (US/Eastern): a partial bar never decides anything. Intraday ideas are also scored on daily bars, so
treat them as approximate (stated in the horizon description).

## Statistics (`lib/ideaStats.ts`)

One engine. Counted = ideas that **entered and finished** (all targets hit, stopped, expired, closed early). Metrics:
hit rate (win = R > 0, partial wins included), average R, average win/loss R, expectancy (hit rate x avg win + loss rate x
avg loss), profit factor, total R, equity curve in R, streaks, first-target rate, sessions to target 1, average adverse
move. Breakdowns by horizon, direction, symbol, with/without an option strategy. Definitions ship in the API
(`meta.definitions`) and render on the page. **Honest numbers:** every block carries `coverage` (ideas counted, excluded
by reason, date range); returns are R-multiples and %, never a fabricated dollar P&L; a sector breakdown is not offered
because no sector is attached to ideas. Early closes count; ideas cancelled before entry cannot (nothing was traded) and
are listed under coverage.

## Pages and screens

| Route | Who | What |
|---|---|---|
| `/ideas` | any idea term | board: Open / Closed tabs, filters (horizon, direction, symbol), idea cards, locked-term upgrade strips, alert feed with email opt-in |
| `/ideas/[id]` | any idea term | frozen plan, chart (daily candles with entry zone, targets and stop drawn; link to the full stock page), tracked result, rationale, option strategy, timeline; publishers get the append-only update form |
| `/ideas/mine` | any idea term | **My trades**: your own recorded trades (open ones marked to the latest price, closed ones at your exit), the desk's result beside yours, and followed vs not followed |
| `/ideas/performance` | any idea term | desk stats, coverage banner, equity curve in R, breakdowns, closed-ideas table, metric definitions |
| `/ideas/publish` | `publish_ideas` or admin | composer (live reward:risk readout), preview of what each plan tier gets plus the alert payload, drafts, publish now **or schedule**, own-ideas list, "Run tracker now". Lives under `/ideas`, not `/admin`, because analysts later will not be admins. |

The Header's **Trackers** menu has a "Trade Ideas" entry (also in the mobile menu); `middleware.ts` requires sign-in for `/ideas/*`.
The chart is the charting library on the app's own stored daily bars, not an embeddable streaming widget, because a streaming
widget cannot draw a published plan and would bypass the reader's plan gating.

## API

All under `/api/ideas` (rate limiter `ideas`, 90/min, editable at `/admin/settings`). Responses are
`{ success, data | error, details? }`. Signed out: 401. Not entitled: 403 `{ error: 'Upgrade required', feature }`.

| Method and path | Who | Notes |
|---|---|---|
| `GET /api/ideas?tab=open\|closed\|all&horizon=&direction=&symbol=&limit=&offset=` | idea term | list + counts + `locked` counts + `disclaimer` |
| `POST /api/ideas?dry_run=true` | publisher | validates and returns exactly what each tier receives, warnings (no price data, zone far from last close) and the alert payload; saves nothing |
| `POST /api/ideas` | publisher | save a draft (`id` in the body updates it) |
| `GET /api/ideas/[id]` | idea term | idea + timeline; 404 if missing or outside the plan |
| `DELETE /api/ideas/[id]` | publisher | drafts only |
| `POST /api/ideas/[id]/publish` | publisher | revalidates, requires price data, stamps `published_at/on` and `ref_price`, records the `published` event |
| `POST /api/ideas/[id]/schedule` | publisher | `{at: ISO}`, 2 minutes to 90 days ahead; `DELETE` unschedules. See "Scheduled publishing" |
| `GET/POST /api/ideas/[id]/taken` | idea term | GET: my record for this idea. POST `{qty, entryPrice, note?}` records it; `?dry_run=true` returns the preview and saves nothing |
| `GET /api/ideas/taken` | idea term | my trades, marks, followed vs not followed |
| `PATCH/DELETE /api/ideas/taken/[tid]` | idea term | close at my own exit price `{exitPrice}` / remove my record (own rows only) |
| `GET/POST/DELETE /api/ideas/push` | idea term | VAPID public key + device count / register this browser (also turns push on) / remove it |
| `POST /api/ideas/[id]/updates` | publisher | `{type, body?, stop?, price?, pct?}`, append-only |
| `GET /api/ideas/managed` | publisher | own ideas, drafts first (admins: everyone's) |
| `GET /api/ideas/performance?horizon=&direction=&from=&to=` | idea term | stats, breakdowns, closed list, definitions |
| `GET/POST /api/ideas/feed` | idea term | in-app alerts; POST marks read |
| `GET/POST /api/ideas/prefs` | idea term | `{emailAlerts, telegramAlerts, pushAlerts}` opt-ins plus what each channel needs (configured, linked, entitled, devices) |
| `GET/POST /api/ideas/disclaimer` | idea term | text + acknowledgement status; POST stores the timestamped, versioned acknowledgement |
| `POST /api/ideas/evaluate` | publisher | `{ideaId}` or `{all:true}` re-run the tracker now |
| `GET /api/cron/ideas` | cron secret | publish due scheduled ideas, tracker, then email / Telegram / push delivery; `?force=true` rebuilds every outcome |

## Alerts

Events (`nt_idea_events`): published, triggered, each target, all targets, stopped, expired, not triggered, and every
publisher update. **In-app** (always on): the feed is derived from events filtered to the viewer's terms, so there is no
per-user fan-out and no way to get duplicates. Three opt-in channels, all in `lib/ideaChannels.ts` and all run by
`/api/cron/ideas`:

| Channel | Needs | Content |
|---|---|---|
| **Email** (Resend, `lib/email.ts`) | opted in, `EMAIL_*` set | summary, link, the styled disclaimer block |
| **Telegram** (`lib/telegram.ts`) | opted in, chat linked in /profile, the plan's existing `telegram_alerts` gate, `TELEGRAM_BOT_TOKEN` | plain text: summary, link, the one-line disclaimer |
| **Web push** (`web-push`, `public/sw.js`) | opted in and a registered browser, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | title, short summary, "For information only, not advice", click opens the idea |

Each channel finds opted-in subscribers whose *effective* features (plan, minus revoked overrides, plus granted ones, plan
not expired) include the event's term, within the last 3 days and with no delivery yet, **reserves** a
`nt_idea_deliveries` row first (unique per event, user, channel), then sends: exactly one alert per event per channel even
with overlapping runs. A failed send is recorded and **not retried**. A channel that is not configured is skipped, never
marked delivered. Telegram: a blocked bot or deleted chat switches that user's Telegram alerts off (they can switch it back
on). Push: a 404/410 from the push service deletes that device. Alerts stop for anyone whose plan no longer includes the
term. Telegram follows the existing plan gate, so Long term (which has no `telegram_alerts`) gets email and push but not
Telegram unless that gate is ticked for it.

## Scheduled publishing

A draft can be scheduled instead of published now: `POST /api/ideas/[id]/schedule {at}` (2 minutes to 90 days ahead; the
plan is validated now and again at publish time; valid-until must not be before the publish date). While scheduled the idea
is status `scheduled`: private, still editable, `published_at` unset, so the immutability trigger does not apply yet. The
tracker (`publishDueIdeas()`, first step of every `/api/cron/ideas` run) publishes everything due, exactly like the Publish
button (reference price, `published` event, alerts), then the plan freezes. **Granularity is the tracker's cadence (every 30
minutes)**, so the real publish can be up to one tick late. If the publish fails (plan no longer valid, no price data) the
idea returns to `draft` with the reason in `schedule_error`, shown on the publisher page, so it is not retried forever.
A publisher can unschedule at any time before it goes live.

## "I took this" and My trades

On a live or in-trade idea, **I took this** opens a modal where the subscriber types **their own quantity and price** (the
quantity is never pre-filled; the price has a helper button for the zone's worst fill that they must press or overwrite),
sees a **preview** (position value, loss if the original stop is hit, profit if all out at each target, warnings when their
price is outside the zone or beyond the stop), and saves it to `nt_idea_taken`. It is a **personal journal**: nothing is
sent to a broker and the platform never assumes a quantity. Rows are private (every query filters `user_id` in SQL).
The idea page then shows "You recorded this idea". **My trades** (`/ideas/mine`) lists open trades marked to the latest
price, closes them at the user's own exit price, and compares **followed vs not followed**: for ideas the user took, finished
and closed, their own average % next to the desk's average % on the *same* ideas, and the desk's average on finished ideas
they did not take. Open trades and unfinished ideas are listed as "not in the comparison yet". Their % uses their own
entry and exit, so it will differ from the tracked result. One record per user per idea.

## Risk disclaimer (no compliance module)

One server-side copy, `lib/ideaDisclaimer.ts` (versioned). It says: the publisher is not a registered investment adviser
or research analyst; ideas are for information and education only, not advice or a recommendation to buy or sell; trading
involves risk of loss including principal and past performance (including the desk's tracked results) does not guarantee
future results; trade only as your own adviser advises and do your own research. Shown as a designed callout (icon, title
"For information only", bullets) in full on the idea, performance and acknowledgement screens and in the publisher preview,
as a one-line banner with "Read more" on the board and in the alert feed, and as a styled footer in emails. A first-time
reader must acknowledge it once (stored with timestamp and version; bumping the version asks everyone again). Edit the text
in that one file only. **The app has no dark theme** (`app/globals.css`), so the callout uses fixed light colours with
checked contrast; there is nothing theme-dependent to break.

## Runbook (in this order)

```bash
node --env-file=.env.local scripts/add-trade-ideas-tables.mjs        # tables + triggers (idempotent)
node --env-file=.env.local scripts/add-trade-ideas-plans.mjs --dry-run   # review the plans first
node --env-file=.env.local scripts/add-trade-ideas-plans.mjs          # insert-only; add --active to list them on /upgrade
node scripts/test-idea-scoring.mjs                                    # fixtures (no DB)
node scripts/test-idea-push.mjs                                       # web-push request building (offline)
```

1. Optional: tick/untick gates for the three plans at `/admin/plans`; assign users at `/admin/users`.
2. Give an analyst the `publish_ideas` override in `/admin/users/[id]` (admins can publish without it).
3. Optional channels: Telegram needs `TELEGRAM_BOT_TOKEN` (already used by the scan alerts). Browser push needs a VAPID pair:
   `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` address) in Vercel.
   Until set, those switches in the Alerts menu say so and nothing is sent.
4. Schedule the tracker: `railway/.railway/railway.ts` defines `ideas-cron` (every 30 min, `railway/ideas-cron/Dockerfile`)
   but it is **not applied**: from `railway/` run `railway config plan`, then `railway config apply --yes` (see CLAUDE.md
   for the Windows PowerShell note). Until then, "Run tracker now" on `/ideas/publish` and `GET /api/cron/ideas` work.

## Not built (deliberately, from `ideas.md`)

An analyst role and per-analyst leaderboards/calibration/thesis grades; weekly/monthly desk reports and the AI-written
narrative and post-mortems; alert preferences beyond the channel opt-ins (horizon, symbol, quiet hours); Discord/webhook
channels; idea series and model portfolios; comments/Q&A; billing; an audit log beyond the append-only tables (reuse the
admin audit when added); report/abuse and an account-deletion path that stops fan-out (channel delivery already skips users
without the plan feature); a delayed free feed; subscription history; automatic retry of failed alerts; editing the
quantity or price of an "I took this" record (remove and re-add); per-minute scheduled publishing (it follows the tracker's
30-minute tick). A sector breakdown needs a real sector source on ideas.

## Status

See the Trade Ideas entry in `docs/CHANGES.md` for exactly what was and was not verified.
