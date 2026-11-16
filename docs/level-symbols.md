# Level symbols: requests and admin list

Which stocks get option levels is decided by `public.us_symbols`, which the **external loader reads** to know what to compute.
This feature lets signed-in users ask for a stock to be added and lets admins approve, add and remove symbols.

## Tables

- `public.us_symbols` (created outside this repo; granted to `nt_us_stocks_rw` with SELECT/INSERT/UPDATE, no DELETE, 2026-11-15).
  Columns (read from the live DB 2026-11-16): `symbol` text PK, `strike_size` numeric null, `company_name` text null,
  `active` boolean not null default true, `deleted_at` timestamptz null, `updated_at` timestamptz not null default now().
- `public.nt_level_requests` (new; `scripts/create-level-requests.mjs`): `id, symbol, requested_by, requested_at, note, status
  (pending|approved|rejected), decided_by, decided_at, decision_note`. A partial unique index allows one pending request per symbol.

## Rules

- **Any signed-in user** may request (`POST /api/level-requests`, limiter `level_request`, 10/min, editable at `/admin/settings`; at most 20 open per user).
  Rejected when the symbol is already `active` in `us_symbols` or already has a pending request. Ticker format only is checked at request time (`lib/levelRequestRules.ts`); the admin vets it.
- **Approve** (admin) upserts the symbol into `us_symbols` (`active = true`, `deleted_at = NULL`, `strike_size` = the admin's value, **default 5**) and closes the request.
  If the write fails the request is put back to pending. Approving does not make levels appear: the loader computes them on its next run.
- **Remove** is a soft delete: `active = false, deleted_at = now(), updated_at = now()`. Rows are never deleted (the loader role cannot delete either). Old levels stay visible. **Restore** reverses it.
- Admin can also add a symbol directly, edit a strike size, and see recent decisions. The admin nav shows a badge with the pending count (no email).
- `hasLevels` (search, scanner) still comes from real level data (`nt_market_expiries` / the scanner's level set), not from `us_symbols`, so an approved symbol shows "Levels" only once data exists.

## Where users ask

Scanner rows without levels show **Request levels**; the stock page shows "No option levels for X" with the same button (not in `embedded` mode).
The search dropdown has no button (its rows are buttons; nesting is invalid HTML).

## Files

`lib/levelRequestRules.ts` (pure, fixtures `scripts/test-level-requests.mjs`), `lib/levelRequests.ts`, `app/api/level-requests/route.ts`,
`app/api/admin/level-symbols/route.ts`, `.../[symbol]/route.ts`, `app/api/admin/level-requests/[id]/route.ts`,
`app/admin/level-symbols/page.tsx`, `components/admin/LevelSymbolsAdmin.tsx`, `components/ui/RequestLevelsButton.tsx`.

## Not built / follow-ups

- No requester notification (decision: badge only). Users cannot yet see their request status in the UI (`GET /api/level-requests` exists).
- Strike size is not auto-derived from the option chain (decision: default 5).
