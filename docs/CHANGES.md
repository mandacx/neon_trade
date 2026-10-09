# Change log and design notes

Running record of what was changed and why, newest first. **Read this before
starting any change, and append to it as part of every change** (see the
"Working rules" section of `CLAUDE.md`). Record only what was verified; mark
anything not tested as *unverified*.

---

## 2026-10-09 — Admin dashboard: activity, behavior, last seen, delete user

Commit `c15599c`. Prompt this area was reconstructed from:
`docs/ADMIN_DASHBOARD_PROMPT.md`.

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
- **"Today"** in the dashboard means the DB server's `CURRENT_DATE`.
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

- None of the new SQL (activity, behavior, last seen, heavy users, delete) has
  been executed against the database.
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
