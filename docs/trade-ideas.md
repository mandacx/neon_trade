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

Three plans, in this order (sort order 30, 40, 50, after Pro Plus at 20), plus a fourth, Premium (sort 60), added 2026-11-10 by `scripts/add-premium-plan.mjs`:

| Plan | Code | Idea access |
|---|---|---|
| **Short term** | `SHORT_TERM` | `ideas_short_term`: intraday + swing ideas |
| **Long term** | `LONG_TERM` | `ideas_long_term`: positional + long-term ideas |
| **Platinum** | `PLATINUM` | both |
| **Premium** | `PREMIUM` (sort 60) | both, with a smaller tool set than Platinum |

There is no billing: Premium is subscribed to by contacting support and assigned by an admin in `/admin/users`, like every plan. The script is insert-only and creates the plan inactive unless `--active` is given (inactive plans are hidden on `/upgrade`, admins can still assign them).

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

| Gate | Short term | Long term | Platinum | Premium |
|---|---|---|---|---|
| `ideas_short_term` | on | off | on | on |
| `ideas_long_term` | off | on | on | on |
| `levels`, `quadrant`, `watchlists`, `earnings`, `us_market_scanner`, `stock_analysis` | on | on | on | only `levels`, `watchlists`, `stock_analysis` on |
| `scan_alerts_latest`, `scan_alerts_history`, `telegram_alerts` | on | off | on | only `telegram_alerts` on |
| `oi_tracker` | off | on | on | off |
| `quarterly_expiry_only` (restriction) | off | **on** (like "Self learners", code `LONG_INVESTORS`) | off | off |
| `option_chain`, `strategy_builder`, options-for-ideas | off | off | off (later) | off |
| `performance`, `crypto_levels` | off | off | off (Pro does not have `performance` live either) | off |

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
| `nt_idea_option_marks` | **derived and rebuildable** price points of an idea's option strategy: `entry`, `target:T1..` (information only), `exit`, `latest`; one row per `(idea_id, event_key)`, legs as JSONB with per-share estimate prices and how each was priced. Created by `scripts/add-idea-option-marks.mjs` (idempotent). See "Option strategy tracking". |
| `nt_idea_events` | append-only event feed (published, triggered, T1.., stopped, expired, updates). `UNIQUE (idea_id, event_key)`: re-running the tracker never duplicates an event. `payload JSONB` (nullable, `{ v: 1, ... }`) holds the event's own facts for the alert builders (added 2026-11-10 by `scripts/add-idea-event-payload.mjs`; NULL on older events). |
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

Mechanical, never self-reported. Fixtures: `node scripts/test-idea-scoring.mjs`. Two entry bases, stored in `nt_idea_outcomes.basis`:

- `daily_bars_stop_first`: ideas published **before 2026-11-10** (`M15_ENTRY_FROM` in `lib/ideaTypes.ts`). Everything below on daily bars.
- `m15_entry_daily_stop_first`: ideas published **on or after 2026-11-10**. See "15-minute entry" below; rules 3 to 7 apply unchanged.

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

`asOf` is yesterday (US/Eastern): a partial bar never decides anything; the provisional live mark below is separate and never stored. Intraday ideas are also scored on daily bars, so
treat them as approximate (stated in the horizon description).

### Live mark (provisional)

On `/ideas/[id]` of an **open** idea (`live` / `triggered`), a "Live mark" card shows the published plan marked at the current
price. It is computed on request by `lib/ideaLiveMath.ts` (pure; fixtures in `scripts/test-idea-scoring.mjs`) and served by
`GET /api/ideas/[id]/live` (`lib/ideaLive.ts`). It is **not** the tracked result: never stored, never fed to `scoreIdea`, never counted
in desk statistics, no alerts, independent of "I took this" (R and % only, no money).

- **Price:** regular session = live price (basis `live`); otherwise the last regular close (basis `last_close`), via `getMarketState()` +
  `buildQuote()`. Pre-market / after-hours moves are shown as a muted extra line and never used in R.
- **Entered** comes only from the stored official outcome (`open` with an entry date). The live price never flips an idea to entered.
- **Formulas** mirror the scorer: entry = worst fill in the zone, risk = |entry - stop|, equal split over targets. Targets booked per the
  official outcome are kept; targets the live price is at or beyond also count (`max`). `R = booked + remaining x favourable(price) / risk`.
  **No clamp at the stop** (a gap fills worse than the stop in the scorer, so clamping would flatter).

| State | Meaning | R shown |
|---|---|---|
| `awaiting_entry` | not entered, price outside the zone (distance to the nearest zone edge shown) | no |
| `in_zone` | not entered, price inside the zone (15-minute basis: the idea enters when a completed 15-minute candle closes inside it, checked every 15 minutes; daily basis: on a completed session that touches it) | no |
| `ran_past_target` | not entered, price at or beyond target 1 | no |
| `in_trade` | entered per the official outcome | yes |
| `beyond_stop` | price beyond the stop (entered or not) | only if entered, unclamped |
| `unavailable` | no price, or an invalid plan | no |

- **Range hint:** if the snapshot's day high/low of a session after the publish day and after `evaluatedThrough` touched the stop or a
  target, the card says the official score (completed bars, stop first) may differ. It never changes R.
- **Polling:** on load, then `lib/pollDelay.ts` (regular 20 s, extended 60 s, closed: sleep to the next boundary, max 15 min); paused while
  the tab is hidden, stops on 401/403/404 or when the idea closes, 60 s back-off on 429, plus a Refresh button.
- **Gating:** the route reads the idea through the gated SQL first (`getIdeaForLive`), 404 for missing and out-of-plan alike. A closed idea
  answers `200 { live: null, reason: 'closed' }`.
- **Points:** `points` is the per-share P&L in price points, blended like R (never before entry); distances to zone / stop / targets also come in points. Closed results convert with `pointsFromR` (R x risk per share).
- **Board chip** (built 2026-11-11): `GET /api/ideas/live` (limiter `ideas_live`) returns the marks of every open idea in the viewer's plan keyed by id; `components/ideas/LiveChip.tsx` shows CMP, day %, and P&L in points / R / % once entered, or the distance to the entry zone. Open tab only; same polling rules.

### 15-minute entry (`lib/ideaScoring.ts`, `lib/ideaIntraday.ts`)

Requested 2026-11-11: do not wait for the daily bar; an idea is entered when the price is in the zone at the end of a 15-minute candle.

- **Entry:** the first **completed regular-session 15-minute bar that starts at or after the publish time and closes inside the entry zone** (`entryLow <= close <= entryHigh`). A wick into the zone that closes outside does not enter. Same rule for shorts. The entry price stays the **worst fill in the zone** (long: zone high, short: zone low) so R is never flattered; the `triggered` event carries `at`, the close time of the entry bar.
- **Never entered:** before entry, a bar that closes at or beyond target 1, or through the stop, without a close in the zone ends the idea as `not_triggered`. Valid-until passing without an entry is `not_triggered`; a publisher cancel before entry is `cancelled`.
- **After entry:** the entry day's stop and targets are judged on the 15-minute bars **after** the entry bar (stop first within a bar; a 15-minute bar opening through the stop fills at its open). The entry day's daily high/low are not used (they include moves before the entry). Later days use complete daily bars as before (a gap fills at the open). Exit events carry `at` when they come from 15-minute bars.
- **Data:** `getCompleted15mBars` reads the 15-minute bars from the facade, keeps only bars whose 15 minutes have elapsed and that fall inside the regular session of a trading day (the calendar gives holidays and early closes). A failed read counts as an error for that idea and is retried; it is never read as "no entry yet". Intraday bars are single-venue (IEX): closes are real-time, highs and lows can miss other venues' prints.
- **Cadence:** `ideas-cron` runs at :02, :17, :32 and :47 (two minutes after each candle closes). Once an entry day is stored, only that day onwards is fetched (unless the outcome is rebuilt with `?force=true`).
- **Live mark:** `entered` still comes only from the stored official outcome, so the card can lag the real entry by up to ~17 minutes; its in-zone text states the 15-minute rule.

## Option strategy tracking (`lib/ideaOptionMath.ts`, `lib/ideaOptions.ts`)

An idea's optional strategy (legs, expiry) is tracked against its **option prices** as an **estimate**, separate from the idea's R, never fed to `scoreIdea` and **never counted in desk statistics**.

- **Opens** when the stock enters (the official `triggered` event). **Target marks** (`target:T1..`) are information only. **Closes** with the idea (stop, last target, valid-until, publisher close) or when the options expire, whichever is first: expiry settles at intrinsic value of the stock's close on the expiry date. The strategy is not split across the target ladder.
- **Fill price = mid** of the live bid/ask. Basis labels shown with every number: `quote_mid` (read within ~20 min of the moment), `quote_mid_late` (read later the same day: quote history of a past moment is not available), `replay_last_trade` (past days: the last option trade at or before the moment from the bars, which are sparse and can be stale; the plan refuses same-day option bars), `last_trade` (no usable bid/ask), `expiry_intrinsic`. A leg with no price leaves that moment unpriced and is retried next run; nothing is invented.
- **Late entry quotes.** A `quote_mid_late` entry read more than 1 hour after the moment (`LATE_APPROX_MS`, `lib/ideaOptionMath.ts`) is flagged `entryApprox`: the card shows a note and no P&L / return (a late quote makes the entry and latest marks identical, so P&L would read 0). On the next tracker run after that day, `repriceLate` (`lib/ideaOptions.ts`) replaces such an entry / target / exit row with the last option trade of the same day (`replay_last_trade`), only when every leg has a trade that day (a prior-day close carried forward is not accepted); otherwise it stays approximate.
- **P&L** = value now minus entry value, `value = sum(sign x qty x 100 x price)`; net credit when the entry value is negative. **Estimated capital** = the larger of the max loss at expiry and the debit paid (a floor when the loss is unlimited); **return** is P&L over that, labelled "return on estimated capital". It is **not** a broker margin requirement (Reg T / SPAN / portfolio margin depend on the account).
- **Tracker:** `trackOptionStrategies` runs at the end of `/api/cron/ideas` (after the alerts, own deadline; a failure there is not a tracker failure). Entry / target / exit rows are written once; `latest` is refreshed during the regular session. Closed ideas missing an exit row are retried for 7 days. Without `nt_idea_option_marks` it reports `unavailable` and does nothing.
- **Reader:** `GET /api/ideas/[id]` returns `optionTrack` (`trackable`, `summary`, `notes`) for ideas with a strategy, read after the plan-gated idea read; `components/ideas/OptionStrategyCard.tsx` shows credit/debit, P&L now or at close, return on estimated capital, estimated capital, max profit/loss, the target marks and the leg prices used. A strategy without an expiry cannot be tracked and says so.
- **Not built:** option P&L in desk statistics, on the board chip, in alerts, or in "I took this"; Greeks/IV history; a model-based replay when there is no trade; a broker-margin estimate.

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
| `/ideas/[id]` | any idea term | frozen plan, **live mark card for open ideas (provisional)**, chart (candles with entry zone, targets and stop drawn, interval buttons and a crosshair OHLC/volume readout; the interval is the stock chart's saved `chart.settings`; link to the full stock page), tracked result, rationale, option strategy, timeline; publishers get the append-only update form |
| `/ideas/mine` | any idea term | **My trades**: your own recorded trades (open ones marked to the latest price, closed ones at your exit), the desk's result beside yours, and followed vs not followed |
| `/ideas/performance` | any idea term | desk stats, coverage banner, equity curve in R, breakdowns, closed-ideas table, metric definitions |
| `/ideas/publish` | `publish_ideas` or admin | composer (live reward:risk readout), preview of what each plan tier gets plus the alert payload, drafts, publish now **or schedule**, own-ideas list, "Run tracker now". Lives under `/ideas`, not `/admin`, because analysts later will not be admins. |

The Header's **Trackers** menu has a "Trade Ideas" entry (also in the mobile menu); `middleware.ts` requires sign-in for `/ideas/*`.
The chart is the charting library on the app's own stored daily bars, not an embeddable streaming widget, because a streaming
widget cannot draw a published plan and would bypass the reader's plan gating.

## API

All under `/api/ideas` (rate limiter `ideas`, 90/min; the live mark has its own `ideas_live`, 60/min so polling cannot starve the rest; both editable at `/admin/settings`). Responses are
`{ success, data | error, details? }`. Signed out: 401. Not entitled: 403 `{ error: 'Upgrade required', feature }`.

| Method and path | Who | Notes |
|---|---|---|
| `GET /api/ideas?tab=open\|closed\|all&horizon=&direction=&symbol=&limit=&offset=` | idea term | list + counts + `locked` counts + `disclaimer` |
| `POST /api/ideas?dry_run=true` | publisher | validates and returns exactly what each tier receives, warnings (no price data, zone far from last close) and the alert payload; saves nothing |
| `POST /api/ideas` | publisher | save a draft (`id` in the body updates it) |
| `GET /api/ideas/[id]` | idea term | idea + timeline + `optionTrack` (estimated option P&L, see "Option strategy tracking"); 404 if missing or outside the plan |
| `DELETE /api/ideas/[id]` | publisher | drafts only |
| `GET /api/ideas/live` | idea term | live marks of all open ideas in the viewer's plan (board chips), keyed by idea id; limiter `ideas_live` |
| `GET /api/ideas/[id]/live` | idea term | provisional live mark of an open idea (limiter `ideas_live`); `data: { live, market, disclaimer }`; closed idea `live: null`; 404 if missing or outside the plan |
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
| `GET/POST /api/email/unsubscribe` | public (signed link) | one-click unsubscribe from Trade Ideas emails; GET only redirects, POST writes (see "Unsubscribe") |
| page `/unsubscribe` | public (signed link) | confirm page for the footer link; the GET never writes |
| `POST /api/ideas/evaluate` | publisher | `{ideaId}` or `{all:true}` re-run the tracker now |
| `GET /api/cron/ideas` | cron secret | publish due scheduled ideas, tracker, then email / Telegram / push delivery; `?force=true` rebuilds every outcome |

## Alerts

Events (`nt_idea_events`): published, triggered, each target, all targets, stopped, expired, not triggered, and every
publisher update. **In-app** (always on): the feed is derived from events filtered to the viewer's terms, so there is no
per-user fan-out and no way to get duplicates. Three opt-in channels, all in `lib/ideaChannels.ts` and all run by
`/api/cron/ideas`:

| Channel | Needs | Content |
|---|---|---|
| **Email** (Resend, `lib/email.ts`) | opted in, `EMAIL_*` set | `lib/ideaEmail.ts`: subject `SYM side: event (R)`, preheader, table-based light HTML (banner with event group, headline and glyph; symbol, LONG/SHORT badge, term / horizon / risk; one "what happened" sentence; levels table with status words; result line; note; "View idea" button plus the raw link; quiet gray disclaimer block; footer with an "Unsubscribe from Trade Ideas emails" link, a manage-alerts link to `/ideas`, the scope sentence, support contact and sender name), and a full plain-text part. Sent as `StocksTrendz Trade Ideas <address>`: the display name is built in code from the address part of `EMAIL_FROM` (`lib/emailFormat.ts` `formatFrom`), so the env display name no longer matters. With `IDEA_UNSUB_SECRET` set it also carries `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers. Published adds the rationale excerpt and the option strategy name. |
| **Telegram** (`lib/telegram.ts`) | opted in, chat linked in /profile, the plan's existing `telegram_alerts` gate, `TELEGRAM_BOT_TOKEN` | `buildTelegram` in `lib/ideaMessages.ts`: HTML parse mode (tags `b`, `i`, `pre`, `a` only, every value escaped): glyph + `SYM . headline`, identity line, title, sentence, monospace levels block, result line, note, link, italic one-line disclaimer, plus an inline "Open idea" button. A 400 (not "chat not found") is retried once as plain text inside the same delivery row. |
| **Web push** (`web-push`, `public/sw.js`) | opted in and a registered browser, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | `buildPush`: title `SYM side: event`, one line of numbers, then `IDEA_DISCLAIMER_MICRO`; tag `idea-<ideaId>-<eventId>` (each event stacks, T2 does not replace T1); icon/badge are `public/idea-alert-icon.svg` / `idea-alert-badge.svg` (SVG support for notification icons is unverified; the notification shows without them); click opens the idea. Urgency (a transport hint, `pushUrgency` in `lib/ideaMessages.ts`): `high` for triggered, target, all targets and stopped; `normal` for the rest. |

**How a message is built.** Facts of the event come from `nt_idea_events.payload` (written by `recordEvent` from the same
scorer result), the plan from the immutable `nt_trade_ideas` row at delivery. A missing payload or plan, or an unknown
`event_type`, gives a summary-only layout (banner/headline, summary, link, disclaimer). Missing numbers drop their clause;
nothing prints `null` or a dash. All text is built in the pure modules `lib/ideaAlertModel.ts`, `lib/ideaEmail.ts`,
`lib/ideaMessages.ts` (fixtures: `scripts/test-idea-alerts.mjs`); `lib/ideaChannels.ts` only fetches, builds and sends.
R shown: per-target R from the plan on target / published alerts, the scorer's realised R (equal-split ladder) on terminal events.

**Unsubscribe (email).** The footer link opens `/unsubscribe?t=<token>` (a public page outside the login gate). The token is a
stateless HMAC (`lib/signedToken.ts`, key `IDEA_UNSUB_SECRET`, at least 32 characters; it carries the user id, no
expiry, and only ever switches email alerts off). The GET of the page and of `/api/email/unsubscribe` never writes (link
scanners prefetch links); the write is a POST: the page's button, or the mail client's one-click POST (RFC 8058). Scope:
`nt_idea_prefs.email_alerts = false` only; Telegram, push and sign-in/account emails are untouched. After a successful
unsubscribe the page offers a 15-minute **Undo** (a separate, purpose-bound token returned only in the POST response, never
mailed); later, re-subscribe by ticking Email in the Alerts menu. Unknown and already-off users get the same answer, and every
invalid token gets the same answer. **Fail closed:** with no (or a short) secret nothing is signed or verified, emails go out
without the link and headers (sign-in fallback sentence in the footer) and the run logs one warning. Rotating the secret
invalidates every link already mailed (they show the "link does not work" state with the manual steps). A forwarded email lets
the forwardee unsubscribe the original recipient (accepted). Limiter `email_unsubscribe` (20/min; per user for a valid link, per
IP otherwise; admin-editable at `/admin/settings`). Custom headers are passed to Resend's `headers` field (documented there as
"Custom headers to add to the email"); `lib/email.ts` resends once without them if the provider answers 400/422, so an alert
is never lost to a header problem. Whether Gmail shows its native Unsubscribe button and whether the header is covered by DKIM
are owner checks (`docs/ideas-alert-checks.md`).

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
"For information only", bullets) in full at the bottom of every Trade Ideas page (there is no strip at the top; removed
2026-11-09), in the acknowledgement screen and the publisher preview, as a one-line banner with "Read more" inside the
Alerts menu, and as a quiet gray footer block in emails (`disclaimerHtmlQuiet`; the amber `disclaimerHtml` is unchanged). Telegram carries the `short` line; push carries `IDEA_DISCLAIMER_MICRO` ("For information only, not advice.", same file). A first-time
reader must acknowledge it once (stored with timestamp and version; bumping the version asks everyone again). Edit the text
in that one file only. **The app has no dark theme** (`app/globals.css`), so the callout uses fixed light colours with
checked contrast; there is nothing theme-dependent to break. The email is light-only by decision (2026-11-10): `color-scheme: light`
hints, a `bgcolor` plus inline background on every cell, and one exported palette (`EMAIL_PALETTE` in `lib/ideaEmail.ts`) whose
contrast is asserted in `scripts/test-idea-alerts.mjs`. A dark palette is specified but not built (docs/CHANGES.md follow-ups).

## Runbook (in this order)

```bash
node --env-file=.env.local scripts/add-trade-ideas-tables.mjs        # tables + triggers (idempotent)
node --env-file=.env.local scripts/add-idea-option-marks.mjs         # option strategy tracking table (idempotent); without it the option P&L card says "not tracked yet"
node --env-file=.env.local scripts/add-idea-event-payload.mjs        # alert payload column (idempotent; --dry-run reports only); run BEFORE deploying the alert formatting
node --env-file=.env.local scripts/add-trade-ideas-plans.mjs --dry-run   # review the plans first
node --env-file=.env.local scripts/add-trade-ideas-plans.mjs          # insert-only; add --active to list them on /upgrade
node scripts/test-idea-scoring.mjs                                    # fixtures (no DB)
node scripts/test-idea-push.mjs                                       # web-push request building (offline)
node scripts/test-idea-alerts.mjs                                     # alert email / Telegram / push builders, every event type (no DB)
node scripts/test-unsubscribe.mjs                                     # sender formatting, List-Unsubscribe headers, signed tokens, request parsing (no DB)
node scripts/render-idea-alert-samples.mjs --screenshots              # offline samples (.html/.txt/.eml/Telegram/push) in .tmp/idea-alert-samples; never sends
```

0. Set `IDEA_UNSUB_SECRET` (at least 32 characters; `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) in Vercel Production and redeploy, and set the `EMAIL_FROM` address to `support@stockstrendz.com`. Then work through `docs/ideas-alert-checks.md` (real mail clients, Telegram and push on real devices) before telling subscribers.
1. Optional: tick/untick gates for the three plans at `/admin/plans`; assign users at `/admin/users`.
2. Give an analyst the `publish_ideas` override in `/admin/users/[id]` (admins can publish without it).
3. Optional channels: Telegram needs `TELEGRAM_BOT_TOKEN` (already used by the scan alerts). Browser push needs a VAPID pair:
   `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` address) in Vercel.
   Until set, those switches in the Alerts menu say so and nothing is sent.
4. Schedule the tracker: `railway/.railway/railway.ts` defines `ideas-cron` (at :02, :17, :32, :47 so each 15-minute candle has closed, `railway/ideas-cron/Dockerfile`)
   but it is **not applied**: from `railway/` run `railway config plan`, then `railway config apply --yes` (see CLAUDE.md
   for the Windows PowerShell note). Until then, "Run tracker now" on `/ideas/publish` and `GET /api/cron/ideas` work.

## Not built (deliberately, from `ideas.md`)

An analyst role and per-analyst leaderboards/calibration/thesis grades; weekly/monthly desk reports and the AI-written
narrative and post-mortems; alert preferences beyond the channel opt-ins (horizon, symbol, quiet hours); Discord/webhook
channels; idea series and model portfolios; comments/Q&A; billing; an audit log beyond the append-only tables (reuse the
admin audit when added); report/abuse and an account-deletion path that stops fan-out (channel delivery already skips users
without the plan feature); a delayed free feed; subscription history; automatic retry of failed alerts; editing the
quantity or price of an "I took this" record (remove and re-add); per-minute scheduled publishing (it follows the tracker's
15-minute tick). A sector breakdown needs a real sector source on ideas.

## Status

See the Trade Ideas entry in `docs/CHANGES.md` for exactly what was and was not verified.
