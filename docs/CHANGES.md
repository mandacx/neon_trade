# Change log and design notes

Running record of what was changed and why, newest first. **Read this before
starting any change, and append to it as part of every change** (see the
"Working rules" section of `CLAUDE.md`). Record only what was verified; mark
anything not tested as *unverified*.

---

## 2026-10-13 — Index charts (SPX) via Tradier fallback

Reported: the SPX stock chart showed nothing.

### Cause (verified live)

Alpaca's stock-bars API has no indices: `SPX`/`SPXW` return HTTP 200 with `{"bars":{}}`,
`^GSPC`/`I:SPX` return 400 "invalid symbol"; `SPY` works. `getHistoricalBars` returned `[]`, so
`/api/stocks/SPX/ohlc` succeeded with no data. The DB does hold SPX levels (`eod_usmkts_price`).
Tradier serves SPX: quote, daily/weekly/monthly history and 1/5/15-minute timesales.

### What changed

- `lib/tradier.ts`: new `getBarsForChart(symbol, interval, from, to)` returning Alpaca-shaped bars.
  Daily/weekly/monthly from `/markets/history` (stamped at US/Eastern midnight like Alpaca);
  1/5/15min from `/markets/timesales` (`session_filter=open`); 30min/1hour aggregated from 15min,
  bucketed on ET clock boundaries (hourly bars at 09:00, 10:00 … like Alpaca). Tradier limits how
  far back intraday goes, per interval; the oldest allowed start is read from its 400 message
  ("start: must be on or after YYYY-MM-DD") and the request is retried once from there.
- `app/api/stocks/[symbol]/ohlc/route.ts`: if Alpaca returns no bars (or errors), try Tradier; the
  response now includes `source: 'alpaca' | 'tradier'`. If neither has bars and Alpaca errored, the
  original error is returned as before.

### Verified (dev server, real calls)

- `/api/stocks/SPX/ohlc`: daily (9 bars), weekly, 15min (clamped from July to the earliest allowed
  start, 2026-08-17; 1,138 bars), 30min and 1hour all return `source: tradier`. SPY still returns
  `source: alpaca`. Timestamps match Alpaca's convention (daily 04:00Z; 15min from 09:30 ET).
- A 5min request for March (older than Tradier keeps) returns an empty set, not an error.
- `npx tsc --noEmit` passes; eslint 0 errors.

### Not verified / limits

- **No browser check** that the SPX page now draws candles with the level overlays.
- Index bars have volume 0 (no volume pane). Intraday history is limited to Tradier's window
  (observed ~57 days for 15min; 1min/5min limits not pinned down).
- `^GSPC` still errors (Tradier has no such symbol; the route returns the Alpaca 400).
- Today's bar is live/in progress. A DB-vs-Tradier date offset for SPX (DB `trade_date` 10-13
  carried the 10-12 close, 7807.24) was noticed and **not investigated**; it could shift levels
  by a day against candles.
- Other indices (NDX, RUT, VIX) were not tested.

---

## 2026-10-13 — More earnings date filters (watchlists + quadrant)

Requested: more date filters wherever the earnings date filter is used.

### What changed

- New pure module `lib/earningsFilter.ts` (shared by client and server): one filter list + matcher.
  Options: today, tomorrow, this week, **next week**, next 7/14/30/**60/90** days, **this month**,
  **custom From/To range**, before / **after** selected expiry, reported today-or-yesterday /
  7 / **14 / 30** days, **date confirmed / estimated**, **no upcoming date**. (Bold = new.)
- Watchlists (`app/watchlists/page.tsx`, `app/watchlists/view/page.tsx`): use the shared list;
  From/To inputs appear for "Custom date range"; expiry-based options only show with a selected expiry.
  `earningsMatches` in `components/watchlists/watchlistShared.tsx` now delegates to the shared matcher.
- Quadrant (`app/quadrant/page.tsx`, `app/api/quadrant/data/route.ts`): same list plus the existing
  "Exclude reports before expiry"; `earningsFrom` / `earningsTo` query params (YYYY-MM-DD validated);
  unknown `earnings` values are ignored instead of emptying the list.
- **Behavior change:** quadrant `earnings=week` used to mean "within 7 days"; it now means the
  calendar week (Mon–Fri, like watchlists). Use `earnings=7` for the old meaning. Old bookmarked URLs
  with `week` get the new meaning.

### Verified

- `npx tsc --noEmit` passes; eslint on touched files: 0 errors.
- 26 matcher cases run with fixed dates (today = Tue 2026-10-13, plus a Saturday): week/next-week
  boundaries, 60-day edge, month, open-ended range, after-expiry, reported windows, confirmed/estimated, none.

### Not verified

- No browser check of the dropdowns / date inputs; the quadrant route was not called over HTTP.
- Quadrant rows only know the *last reported* date (no pending-result date), so its "Reported …"
  filters can miss a report whose result hasn't been stored yet.
- Not covered: home "Earnings This Week" card and the alerts widget have no filter (none existed).

---

## 2026-10-13 — Mark unconfirmed earnings dates as estimates (`~Nov 4`)

Reported: META showed Nov 4 (user says Oct 21), MSFT also looked wrong.

### Investigation (verified)

- Fetched the live Alpha Vantage `EARNINGS_CALENDAR` CSV and compared it with `nt_earnings_calendar`:
  stored rows equal the feed (parse/store is correct). META = 2026-11-04 with a blank
  `timeOfTheDay`; MSFT = 2026-10-28 `post-market`. The 10-09 snapshot had MSFT on 11-04
  (now `dropped`); the 10-13 sync moved it to 10-28.
- Pattern in our stored snapshots: confirmed dates carry `pre-/post-market`; dates with a
  blank time moved later (GOOGL 11-04 -> 10-28, AAPL 10-29 -> 11-02, MSFT 11-04 -> 10-28).
  So a blank time looks like a projected date. *Inferred from a few symbols, not documented by
  Alpha Vantage.*
- Cadence: calendar is fetched once per UTC day, weekdays only, by the first `earnings-cron`
  run inside 06:30-19:30 ET (stored `last_seen_at` 10:32 UTC = 06:32 ET). Not on weekends.
- META's true date (user: Oct 21) could not be confirmed from any source I could reach.

### What changed

| Area | Files |
|---|---|
| `estimated` flag (`!time_of_day`) on `UpcomingEarnings`, `EarningsBadge.nextEstimated`, `EarningsEvent.estimated` | `types/earnings.ts`, `lib/earnings.ts` |
| `~` prefix / "estimated, not yet confirmed" tooltips: stock panel, watchlist cell (full + compact `E~`), badge cell (`ER~`), home + alerts widget lists, quadrant tooltip | `components/watchlists/watchlistShared.tsx` (new `fmtNextDate`), `components/stock/EarningsPanel.tsx`, `components/ui/EarningsBadgeCell.tsx`, `components/watchlists/AlertsWidget.tsx`, `app/page.tsx`, `components/charts/QuadrantChart.tsx` |

### Verified / not verified

- `npx tsc --noEmit` passes.
- *Not verified:* no browser check of the new labels; Telegram line and TVChart earnings markers
  do not show the estimate marker; the "blank time = estimate" rule is a heuristic.

### Follow-ups

- A confirmed-date source (company IR / Benzinga "to announce" headlines) or an admin override
  would fix wrong dates, not just label them.

---

## 2026-10-12 — User / session history on the dashboard, clickable user rows

Requested: on the admin dashboard, selecting a user name or a session should show
the history of that user or session; on the Users page, selecting an email (direct
click or row select) should open the manage page. *Interpretation (unverified with
the user):* "selected" = clicked; the dashboard shows history in a modal, with a link
on to the full user page (previously the name linked straight to the user page).

### What changed

| Area | Files |
|---|---|
| History queries (user: summary, last 300 events, last 20 auth logins; session: summary, first referrer/device, last 300 events) | `lib/adminHistory.ts` (new) |
| Admin-only API `GET /api/admin/history?user=<id>` or `?session=<id>` (403 non-admin, 400 bad params, 404 unknown) | `app/api/admin/history/route.ts` (new) |
| History modal (stats, logins, newest-first timeline, "Open user page →", a user's events link to their session) | `components/admin/HistoryModal.tsx` (new) |
| Dashboard: user cells open history instead of navigating; anonymous rows open their session; new Session column in "Active sessions today" | `app/admin/page.tsx` |
| Drill modal: cell shape `{text, user?, session?, iso?}` replaces `href`; Sessions drill has a clickable session id; Esc closes only the top modal | `lib/adminDrill.ts`, `components/admin/DrillModal.tsx` |
| `ActiveSessionRow.sessionId` is now the full tracker id (was truncated to 8 chars) so it can be looked up; the UI still shows 8 chars | `lib/activity.ts` |
| Users page: whole row opens the manage page (not when text is being selected); email and "Manage →" links still work | `app/admin/users/page.tsx` |

### Design

- A session is a tracker session (`nt_activity_events.session_id`, the `nn_sid`
  cookie), not an auth session. Anonymous sessions have history but no user page.
- The full session id is sent to admin-only endpoints only. It is a tracking id,
  not an auth credential.
- Events older than the 90-day activity retention are not available.

### Verified

- `npx tsc --noEmit` passes; eslint on changed files: 0 errors (warnings only).
- The SQL of `getUserHistory` / `getSessionHistory` was run read-only against the live
  Neon DB (a real user and a real session): email lookup, summary, logins
  (`neon_auth.session` `createdAt`/`ipAddress`), first referrer/user agent all return rows.

### Not verified

- **No browser check** of the modals, row click, or Esc behavior, and the API was not
  called over HTTP as an admin (the 403 guard mirrors the other admin routes).
- The TypeScript wrappers were type-checked but not executed (only their SQL was).
- `npm run build` was not re-run for this change.

### Follow-ups

- Opening a session from a user's history replaces the modal (no back button).
- Errors panel rows have no session id, so anonymous errors are not clickable.

---

## 2026-10-10 — Period drill-downs, Central Time reporting, user links, heavy-users fix

Requested: extended drill-down (period filters / date selection) for every
dashboard tile and section title, timestamps in a US Central zone everywhere,
and links from sessions / user names to the user page. The user's screenshot
(a different app's dashboard: Funnel & retention, Most viewed stocks, Sections
used, Traffic sources, Devices, Top pages, titles underlined) was treated as a
reference list of sections, "but not limited to" those (*interpretation,
unverified with the user*). The request first said IST, then corrected to CST;
implemented as **America/Chicago** (CST in winter, CDT in summer) because fixed
CST (UTC-6) would be an hour off during DST. Confirm if fixed UTC-6 was meant.

### What was added / changed

| Area | Files |
|---|---|
| Central Time helpers (parse, format, DST-aware day start) | `lib/time.ts` |
| Period drill-down queries for 13 metrics (users, signups, telegram, logins, sessions, pages, errors, heavy, funnel, stocks, sections, referrers, devices) | `lib/adminDrill.ts`, `app/api/admin/drill/route.ts` |
| Drill-down modal: presets (Today, Yesterday, 7/30/90 days, This month) + custom From/To, per-day bar chart, table | `components/admin/DrillModal.tsx` |
| Dashboard: every tile and section title opens the modal; inline panels get "View over time"; Top pages (7d) section; funnel stat boxes; user cells link to `/admin/users/[id]` | `app/admin/page.tsx`, `lib/activity.ts` (adds user ids to sessions/errors, `topPages`) |
| "Today" and day buckets now Central Time instead of DB `CURRENT_DATE` (UTC) | `lib/activity.ts`, `lib/admin.ts` |
| Central Time display + user links elsewhere | `app/admin/users/page.tsx`, `components/admin/UserBehaviorPanel.tsx`, `components/admin/UserDetailEditor.tsx`, `app/upgrade/page.tsx`, `app/profile/page.tsx` |
| **Bug fix** | `lib/apiUsage.ts` |

### Design

- A period is an inclusive range of **Central calendar days**; the API
  (`GET /api/admin/drill?metric=&from=&to=`, admin-only, max 366 days) converts
  it to `[start of from, start of to+1)` using the DST-aware `ctDayStartISO`.
  Per-day buckets use `(ts AT TIME ZONE 'America/Chicago')::date`.
- Result shape: `{ columns, rows, series, note, truncated }`; row cap 500 (the
  chart still covers the full period). Cells can be plain, a link, or an instant
  that the client formats with `formatCT`.
- `heavy` ignores the period: rate-limit counters only retain about a day.
- Sessions and user names link to the user page when a user id exists;
  **anonymous sessions have no user page** and stay plain text.
- DB timestamps are `timestamptz`; `lib/time.ts` parses Postgres `::text`
  timestamps ("...+00") safely for all browsers.

### Bug found and fixed

`getHeavyApiUsers` (commit c15599c) failed with `operator does not exist:
integer > text` (untyped CASE parameters) and its catch returned `[]`, so the
**Heavy API users tile was always empty**. Fixed with `::int` / `::text`
casts. After the fix it returns real rows (2 users in the last 24h, one with 2
throttled minutes).

### Verified

- `npx tsc --noEmit` passes; `npm run build` succeeds; eslint 0 errors.
- Against the live Neon DB (read-only): all 13 drill metrics execute and return
  sensible rows/series; `getActivitySummary`, `getBehaviorStats`,
  `getUserBehavior`, `listUsers({sort:'last_seen'})`, `getDashboardStats`,
  `getTodaysLogins` and `getHeavyApiUsers` execute with the Central Time
  boundaries. This closes the earlier "new SQL not executed" gap.
- `lib/time.ts`: 19:51 UTC renders as 2:51 PM CDT, a December instant renders
  as CST, and day starts are correct including both DST transition days
  (2026-03-08, 2026-11-01).
- Timezone facts: DB `TimeZone` is GMT; `neon_auth.user/session` and
  `nt_activity_events` timestamps are `timestamptz`.
- The user deleted several users; an orphan scan afterwards found no leftover
  rows in any user-keyed table (one unrelated `neon_auth.verification` row with
  a token identifier remains).

### Not verified

- **No browser check** of the dashboard, modal, date inputs or layouts (360–1880
  px), and the modal's behavior with real clicks. Only compile, build and queries.
- `/api/admin/drill` was not called through HTTP as an admin (auth path
  untested); the 403 guard mirrors the other admin routes.
- Page-view history only exists from when tracking was deployed, so most
  periods before that are empty.

### Deliberately NOT converted to Central Time

- **Scan-alert load times** (`load_dt_tm`, `timestamp without time zone`, e.g.
  "2026-10-09 14:45:34"): the source zone is unknown (could be Central or
  Eastern), so converting would guess. Shown as stored (scan-alerts pages, the
  watchlist alerts widget, quadrant tooltip).
- **Chart axes** (`TVChart`, `OptionContractChart`) stay in America/New_York
  (exchange time); **trade/expiry dates** (`YYYY-MM-DD`) are not instants.

### Follow-ups

- `pruneRateLimitHits` appears not to run: `nt_rate_limit_hits` still holds
  user rows from 2026-08-13 (verified by query). Harmless to the 24h view but
  the table keeps growing.
- Decide zone for scan-alert times and whether chart axes should follow.
- Anonymous session drill-down (a per-session timeline page) is not built.

---

## 2026-10-09 — Admin dashboard: activity, behavior, last seen, delete user

Commit `c15599c`. Prompt this area was reconstructed from:
`docs/ADMIN_DASHBOARD_PROMPT.md`.

Follow-up: `docs/ADMIN_DASHBOARD_PROMPT.md` was first committed unchanged; it was
then updated to describe the behavior section, referrer rule, last-seen sort,
per-user behavior panel and delete user.

### What was added

| Area | Files |
|---|---|
| Dashboard second row of tiles (active sessions, page views, errors, heavy API users) and "User behavior" section (DAU/WAU/MAU, traffic chart, funnel, top stocks/sections/referrers/devices) | `app/admin/page.tsx`, `app/api/admin/dashboard/route.ts` |
| Activity tracking | `lib/activity.ts`, `app/api/track/route.ts`, `components/providers/ActivityTracker.tsx` (mounted in `app/layout.tsx`) |
| Heavy API users (from rate-limit counters) | `lib/apiUsage.ts` |
| Per-user behavior panel on the user page | `components/admin/UserBehaviorPanel.tsx`, `app/admin/users/[id]/page.tsx` |
| Last-seen column + sort on the Users list | `lib/admin.ts` (`listUsers`), `app/api/admin/users/route.ts`, `app/admin/users/page.tsx` |
| Delete user | `lib/admin.ts` (`deleteUser`), `DELETE` in `app/api/admin/users/[id]/route.ts`, `components/admin/UserDetailEditor.tsx` |

### Design

- **Activity table** `public.nt_activity_events` is created lazily
  (`CREATE TABLE IF NOT EXISTS`, `ensureTable()` in `lib/activity.ts`). It is not
  in `scripts/bootstrap-app-tables.mjs` or the migrate scripts (*gap, see below*).
- **Event model:** `pageview` rows come in pairs — an *arrival* row
  (`duration_ms IS NULL`, counted as a view) and an *exit* row (`duration_ms`
  set, used for time on page). `error_client` rows come from `window.onerror` /
  `unhandledrejection`. Duration is clamped to 30 min.
- **Tracking endpoint** `POST /api/track` is public (not in the middleware
  matcher) and always answers 204. It ignores headless/bot user agents, sets an
  httpOnly `nn_sid` cookie (1 year) for anonymous visitors, and attaches earlier
  anonymous events to the user once signed in and the same cookie pings again.
- **Referrer** is sent only on the first ping of a visit (`document.referrer`
  does not change on client-side navigation).
- **Heavy API users** reads `public.nt_rate_limit_hits`, buckets named
  `<limit name>:user:<id>`. Counters are pruned after a day, so the view is 24h.
  Throttled = window hits above the limit of that bucket
  (`LEVEL_RANGE_RATE` / `LEVEL_POINT_RATE` in `lib/levelAccess.ts`).
- **"Today"** originally meant the DB server's `CURRENT_DATE` (UTC).
  *Superseded 2026-10-10: it is now the Central Time day.*
- **Retention:** events older than 90 days are pruned opportunistically on about
  1 in 200 tracking writes (no cron).
- **Delete user** (`deleteUser`): one `sql.transaction` that deletes, for the
  user id, rows in `nt_watchlists` (items cascade), `nt_telegram_alert_subscriptions`,
  `nt_telegram_alert_cursors`, `nt_telegram_link_codes`, `nt_user_feature_overrides`,
  `nt_app_user_profiles`, `nt_activity_events`, matching `nt_rate_limit_hits`
  buckets, `neon_auth.verification` rows for the email, then `neon_auth."user"`.
  The API refuses self-delete, deleting another admin, and a mismatched
  confirmation email.

### Verified in this work

- `npx tsc --noEmit` passes; eslint on changed files has 0 errors (only
  `no-explicit-any` warnings, same style as existing `lib/admin.ts`).
- Live read-only query of the Neon database: `neon_auth.session`, `account`,
  `member` and `invitation` have `ON DELETE CASCADE` foreign keys to
  `neon_auth."user"`; the six `public` tables with a `user_id` column and no FK
  are the ones listed above.
- Existing code already writes to `neon_auth."user"` directly (`setUserRole`).

### Not verified

- *(Superseded 2026-10-10: the activity, behavior, last-seen and heavy-users SQL
  has since been executed; the heavy-users query was broken and is fixed. The
  delete SQL was exercised by the user deleting real users.)* Originally: none of
  the new SQL had been executed against the database.
- The pages have not been opened in a browser (no layout check at 360–1880 px).
- No real user delete was performed (irreversible on the shared database).
- `/api/track` has not been called end to end, including cookie behavior behind
  Vercel and the post-login claim of anonymous events.

### Known limits and follow-ups

- Server-side errors are not recorded; the Errors tile shows client errors only.
- `nt_activity_events` is absent from the bootstrap/migrate scripts.
- `login_history` (prompt section 3) was not built; "Logins today" still reads
  `neon_auth.session`.
- `getUserApiUsage` reuses the top-1000 heavy-users query, so it only covers the
  1000 heaviest users.
- Sorting the Users list by last seen computes last activity for every user.
  May need an index or cached column at larger scale.
- After a delete, Neon Auth's ~5 minute session cookie cache may keep the user
  signed in briefly.
- Funnel compares 7-day visitor/signup counts with all-time total/paid users, so
  it is not a strict conversion rate.
- Not built from the prompt: payments tab, admin alerts (SMS/Telegram), terms
  page, per-IP limits on public endpoints.
