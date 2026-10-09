# Prompt: build an admin dashboard (Next.js + Postgres + managed auth)

Reusable prompt reconstructed from the admin area of this project (`app/admin`,
`app/api/admin`, `components/admin`, `lib/admin.ts`, `lib/activity.ts`,
`lib/apiUsage.ts`, `lib/rateLimit.ts`, `lib/adminAlert.ts`). Replace the
`<placeholders>`; delete sections you don't need.

---

Build an **admin area** for my Next.js (App Router, TypeScript, Tailwind) app. Auth is
a managed Better-Auth-style service whose tables live in the same Postgres database
(`<auth schema>.user`, `.session`, `.account`; `user.role = 'admin'` marks admins).
App tables are in `public`. Use the existing `sql` tagged-template Postgres client.
Read the repo's CLAUDE.md/docs first and match existing code style. Verify against the
real schema before writing queries; do not guess column names.

## 1. Access control (server-enforced)
- `/admin/*` is wrapped by one **server layout** that loads the current user context:
  not logged in -> redirect `/login`; logged in but not admin -> redirect `/`.
  Layout has a small tab nav: Dashboard · Plans · Users · Payments.
- Admin is read from the auth `user.role` column directly, never from client state.
- **Every `/api/admin/*` route re-checks** `loggedIn && isAdmin` and returns 403 JSON.
  Never rely on the layout alone.

## 2. Dashboard (`/admin`) — stat tiles with click-to-drill-down
One API (`GET /api/admin/dashboard`) returns everything the tiles and their drill-downs
need in a single response (`Promise.all`, every list capped, so it stays cheap).
Two rows of 4 `StatTile`s (2 columns on phones); clicking a tile opens a `DrillPanel`
below it (click again to close; one panel open at a time):
- Total users -> all users (email, short id, created)
- Signups (7 days) -> list with name + time
- Telegram (or other channel) linked -> list
- Logins today -> from the auth `session.createdAt` (a new session row = a login): email, IP, time
- Active sessions today -> distinct tracker session ids today, grouped with who (email or
  "Anonymous"), pageviews, last seen
- Page views today -> top pages today: path, views, avg time on page
- Errors today -> client/server error events with path + message
- **Heavy API users (24h)** -> top 20 users by gated-API calls: requests, peak/min,
  throttled minutes; rows flagged red when throttled or >= 3000 calls/day
Below the tiles: **plan distribution** bars (click a bar -> users on that plan with
group + expiry). "FREE" means no active grant, so list users with no entitlement row.

## 3. Activity tracking (feeds the tiles)
- `activity_events(session_id, user_id, event_type, path, referrer, duration_ms, message,
  status_code, user_agent, created_at)`, lazily created (`CREATE TABLE IF NOT EXISTS`).
  Event types: `pageview`, `error_client`, `error_server`. 90-day prune in a daily cron.
- Public `POST /api/track` (outside auth middleware) fed by a client `ActivityTracker`
  (arrival ping + exit beacon with duration; skip the arrival ping when counting views).
  Anonymous visitors get an httpOnly `nn_sid` cookie (1 year). On login, claim that
  session's earlier anonymous events for the user. Clamp duration to 30 min.
- **Ignore headless-browser user agents** so test runs don't inflate stats (stats hygiene,
  not security).
- Mirror each fresh login into `login_history(user_id, session_id, ip, created_at)`
  (180-day retention) so history survives session revocation.

## 4. Users (`/admin/users`, `/admin/users/[id]`)
- List: search by email/name, 25 per page, total count, plan badges (active grants),
  verified/banned/role, last seen, channel-linked flag. **Re-fetch on window focus** (client
  router cache can restore a stale list after editing a user).
- Detail page: account info, **admin role toggle**, **plan per entitlement group** (plan +
  optional expiry, blank = never), **per-feature overrides** (grant or deny a feature on top
  of the plan; removable), login history, and an **activity timeline** (recent events).
- Writes go through `PUT/POST /api/admin/users/[id]`, `/role`, `/overrides`; validate input
  (plan belongs to the group, feature codes exist in the registry, no self-demotion).

## 5. Plans / feature gating (`/admin/plans`)
- A **plan x feature grid**: one card per plan with a checkbox per feature, saved per plan
  (`PUT /api/admin/plans/[id]` accepting `{features, isPublished, isActive}`; validate
  feature codes against the registry).
- Two switches per plan: **Plan enabled** (`is_active`) and **Published on plans page**
  (`is_published`). Checkout rejects a plan unless it is active AND published; holders of an
  unpublished plan still see it. This enables a "rollout" plan: ship new feature keys ticked
  only there, then tick them for other plans to release.
- Feature access is enforced server-side (`requireFeatureApi` / `requireFeaturePage`); the UI
  only hides things.

## 6. Payments (`/admin/payments`)
Server-rendered, filters in the URL (shareable): tabs **Transactions** (status filter,
search, pagination, totals), **Webhook events** (delivery log), **Grants** (entitlement
ledger), **Emails** (email log). Keep the payment vendor masked behind your payments layer.

## 7. Abuse protection and alerts
- **Rate limits** in the shared route guards: 120 req/min per signed-in user across all gated
  APIs (bucket `api:user:<id>`), 240/min per IP on public data endpoints. Postgres-backed
  fixed-window counter (`rate_limit_hits(bucket, window_start, hits)`, one upsert per request),
  429 with `Retry-After` + `X-RateLimit-*`; fails open if the counter errors; prune after 8 days.
- The "Heavy API users" tile reads those same counters (no extra writes).
- **Admin alert** on the first blocked request of a window for a signed-in user: SMS via an
  email-to-text gateway (SMTP) and a Telegram message to admins who linked the bot; once per
  user per cooldown (default 60 min), de-duplicated by claiming a unique key in `email_log`.
  Never throws; supports a dry-run env flag.
- Terms of use page forbidding scraping, linked from the footer and the sign-up form.

## 8. UI conventions
- Tailwind, compact admin look: white cards, `border-gray-200`, 11-12px text, small uppercase
  labels, blue accents. Tables inside `max-h-96 overflow-y-auto`.
- Fully responsive: test at 360, 390, 768, 1024, 1366 and 1880 px; no horizontal page scroll;
  check alignment, not just widths.
- Loading and error states for every fetch; no secrets or vendor names in responses.

## 9. Deliverables and verification
- Types for every API payload; shared `lib/admin.ts` (plans/users queries), `lib/activity.ts`
  (events), `lib/apiUsage.ts`, `lib/rateLimit.ts`, `lib/adminAlert.ts`.
- Idempotent migration scripts / lazy DDL; no destructive changes.
- Verify and report separately what was tested (type check, build, live queries, browser at
  the sizes above, a 130-call burst for the limiter, a real alert send) and what was not.
- Don't commit or push until I say so.
