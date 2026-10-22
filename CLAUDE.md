# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working rules (read first, every conversation)

1. **Read before changing.** At the start of every conversation, read `docs/CHANGES.md` (the running change log and design notes) and any doc relevant to the area you're about to touch (e.g. `docs/earnings.md`, `docs/ADMIN_DASHBOARD_PROMPT.md`). Do this before proposing or making any change.
2. **No assumptions, no guessing.** Verify against the real thing: read the code, query the live schema, fetch the docs, run the check. If something wasn't verified, say "unverified" rather than stating it as fact.
3. **Verify completely, then recommend.** Confirm current behavior first, then suggest the best steps or a design/code update, and implement.
4. **Record every change.** Append to `docs/CHANGES.md` in the same change: what changed (files), the design/why, what was verified, what was not, and follow-ups. If a change alters behavior described elsewhere in this file or a doc, update that too.

## Commands

```bash
npm install       # install deps (legacy-peer-deps=true is set in .npmrc — needed for React 19 peer conflicts)
npm run dev        # dev server at http://localhost:3000
npm run build       # next build — TypeScript typecheck + lint run as part of this
npm start          # serve the production build
npm run lint       # eslint (next lint)
npx tsc --noEmit    # typecheck only, no build output
```

There is no test suite/framework configured in this repo.

`npm run build` will fail at the "Collecting page data" step unless `DATABASE_URL` is set (several API routes call `lib/db.ts` at module load, which throws immediately if the env var is missing). Copy `.env.example` to `.env.local` and fill in real credentials before building.

## Environment & external services

Three services this app depends on, all configured via env vars (see `.env.example`):

- **Neon (Postgres)** — `DATABASE_URL`. Primary data store. Accessed through `lib/db.ts` via `@neondatabase/serverless`'s `neon()` tagged-template client (HTTP-based, no connection pooling to manage). `lib/db.ts` throws at import time if `DATABASE_URL` is unset, so any route importing it will fail hard without it.
- **Tradier** — `TRADIER_API_KEY`, `TRADIER_API_URL`. Used for stock search, as the *remote* half (`lib/tradier.ts` → `searchCompanies` for names, `searchSymbols` for tickers). Missing key logs a warning, not a hard failure.
  - **Search is local-first** (`lib/symbolSearch.ts`, `app/api/stocks/search?scope=local|remote`). An in-memory index of our ~750 symbols + `securities` names answers ticker *and* company-name queries in ~2ms. Tradier's matches are a second request appended by `components/ui/useSymbolSearch.ts`, so its slow responses (often near the 2s client timeout) never delay the dropdown.
  - Remote symbols are normalized: `BRK/B` → `BRK.B`, and anything the stock page wouldn't accept is dropped.
- **Alpaca Markets** — `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `ALPACA_BASE_URL`. Used for all OHLC/candlestick/bar data (`lib/alpaca.ts`, plus an inline fetch client duplicated in `app/api/home/data/route.ts`). Uses the IEX feed (`feed: 'iex'`) for free-tier compatibility and requests split-adjusted prices (`adjustment: 'split'`).
  - **Quotes are session-aware.** `lib/marketSession.ts` reads the Alpaca trading calendar (`/v2/calendar` on `ALPACA_TRADING_URL`, default the paper host; read-only, same keys; holidays, early closes and the 04:00–20:00 ET extended window come from it) and `lib/quote.ts` turns a snapshot into: regular-session price and day change (live while open, the last regular close otherwise) plus `ext`, the pre-market / after-hours move from that close, which stays until the next regular open. Every quote route (`/api/stocks/[symbol]/quote`, watchlist quotes, `/api/market/indices`, earnings list, home earnings) goes through it and returns `market: { session, nextChangeAt }`; client pollers use `lib/pollDelay.ts` (regular 10–30s, pre/post 30–60s, closed: sleep to the next boundary, max 15 min). The IEX snapshot's `dailyBar` is the regular session only, `latestTrade` includes extended-hours prints, and SIP is not available on this plan, so `ext` only exists for names with an IEX extended-hours print. Details and caveats in `docs/CHANGES.md` (2026-10-14 "session-aware quotes" entry).

**Daily bars are stored** (`lib/dailyBars.ts`, `nt_daily_bars` + `nt_daily_bars_cover`): past days are pulled from Alpaca once and kept, only today's bar is fetched live (15 s cache); `/ohlc?interval=daily` and the levels route's per-date reference close read from it. `warmDailyBars()` pre-fills every tracked symbol (history + daily top-up) from `/api/cron/market-catalog`, and `/api/cron/daily-bars` runs it on demand. Intraday intervals still call Alpaca directly. Splits are not handled yet (see `docs/CHANGES.md`, 2026-10-22).

Tradier is also the **OHLC fallback for symbols Alpaca has no bars for** (indices such as SPX): `getBarsForChart` in `lib/tradier.ts`, called from `app/api/stocks/[symbol]/ohlc/route.ts` only when Alpaca returns nothing. Index bars have no volume.

Note the split from what `README.md`/`QUICK_START.md` describe: those docs predate the current code and describe Tradier as the OHLC source — in the actual code, **Alpaca provides OHLC/bars, Tradier provides symbol search plus the index OHLC fallback above**. Trust the code in `lib/` over the older docs when they disagree.

**Deployment**: hosted on Vercel, connected to the same Neon Postgres instance and Tradier API in production as in local dev — set `DATABASE_URL`, `TRADIER_API_KEY`, `TRADIER_API_URL`, `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `ALPACA_BASE_URL` as Vercel project environment variables. API routes that read these are Node runtime by default (no `export const runtime = 'edge'` present), so Vercel serverless functions handle them.

**Crons (Railway)**: the `neon-trade-crons` Railway project runs three services, each a tiny curl container that calls a protected route on `https://us.niftytrendz.com` with `Authorization: Bearer $CRON_SECRET` (`lib/cronAuth.ts`; the secret is set in Vercel Production and on `market-catalog-cron`/`telegram-alerts-cron`; `earnings-cron` references it as `${{market-catalog-cron.CRON_SECRET}}`):
- `telegram-alerts-cron` → `/api/cron/telegram-alerts`. **Currently disabled** (no schedule) until Telegram is configured (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` in Vercel); to re-enable, restore `cronSchedule: "*/15 12-21 * * 1-5"` in `railway/.railway/railway.ts` and `railway config apply` (route enforces NYSE hours).
- `market-catalog-cron` → `/api/cron/market-catalog`, every 30 min 13:00–17:30 UTC weekdays (route enforces 8:30–11:30 CT). The same run then captures option volume for the latest options load into `nt_opt_daily_bars` (`lib/optionVolume.ts`, resumable; see `docs/oi-tracker.md`).
- `earnings-cron` → `/api/cron/earnings`, every 15 min; the route picks calendar / news / catch-up by US/Eastern time (see `docs/earnings.md`).

Service settings (schedules, restart policy, Dockerfile builds) are infrastructure-as-code in `railway/.railway/railway.ts`; the Railway SDK it imports is a devDependency of `railway/package.json`, deliberately separate from the app (and `railway/` is excluded in `tsconfig.json`). From `railway/`: `railway config plan` to diff against the live project, `railway config apply` to push changes, `railway up --service <name>` from a service's folder to redeploy its container. **On Windows** the CLI is an npm shim the SDK can't exec, so set `_` to the real binary first (PowerShell: `$env:_ = "$env:APPDATA\npm\node_modules\@railway\cli\bin\railway.exe"; & $env:_ config plan`); in Git Bash this fails regardless, use PowerShell.

**Rate limits** (`lib/rateLimit.ts`, `lib/rateLimitConfig.ts`). Postgres counters in `nt_rate_limit_hits` (`hits`, plus `blocked` = rejected requests). Limits are admin-editable at `/admin/settings` (stored in `nt_app_settings`, key `rate_limits`, cached 30 s per instance), with a *standard* and an *entitled* (live levels) tier; the defaults live in `LIMITERS` in `lib/rateLimitConfig.ts` (add a limiter there). The levels routes record the hit in parallel with the user lookup (`recordHit`) and judge it with `applyTieredLimit` once the tier is known. The dashboard's "Heavy API users" tile counts minutes with a rejection (`blocked > 0`), not hits above a constant.

## Architecture

**Stack**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS. Chart libraries: `lightweight-charts` (TVChart candlesticks), `recharts` (quadrant scatter plot).

### Data model — the "levels" concept

The whole app centers on one Neon table, `public.eod_usmkts_price` (end-of-day US market prices + derived options levels), and a `public.securities` table for metadata (name, sector, industry, market_cap_tier, indices as JSON).

For every `(symbol, trade_date, expiry_dt)` row there are 5 price "levels" (`put_low`, `put_int`, `comb_int`/`put_call_int`, `call_int`, `call_high`) representing put/call open-interest-derived support/resistance. `lib/calculations.ts` computes, for each level:

```
value = (CLOSE - LEVEL_PRICE) / CLOSE
```

The level with `value` closest to 0 is the `closestLevel` — i.e., the price is nearest that level. This single calculation (`calculateLevels` + `findClosestLevel`) is reused across the stock detail page, quadrant page, and home dashboard sector breakdown — it's the one piece of business logic worth understanding before touching any of those.

**Date/expiry lookups go through the catalog, not the big tables.** `eod_usmkts_price` (~5M rows) and `us_opt_chg_rpt` (~8.6M rows) are too large to `DISTINCT`/`MAX` per request. `nt_market_dates` (one row per source + trade date) and `nt_market_expiries` (one row per source + symbol + expiry, with first/last seen dates) summarize them; read them via `lib/marketCatalog.ts`, which falls back to the live table if the catalog is empty. The external daily load script maintains them with `scripts/sql/market-catalog-daily.sql`; `scripts/bootstrap-market-catalog.mjs` creates/rebuilds them. As a safety net, `/api/cron/market-catalog` (Railway, every 30 min 8:30–11:30 CT on weekdays) catches up any day the loader didn't record — it skips the source tables entirely once today's date is catalogued. `intra_us_scanner_eod` is intentionally not catalogued (it updates every 15 min intraday) — its date queries rely on the indexes in `scripts/add-date-indexes.mjs`.

Column naming is inconsistent between the DB (`snake_case`) and the `StockData` TypeScript type (`types/stock.ts`, mixed `SCREAMING_CASE`/`camelCase`/`snake_case` fields like `PUT_INT`, `call_low`, `put_HIGH`) — `lib/db.ts` does the aliasing in SQL (`COALESCE(put_int, 0) as "PUT_INT"`) and also sanitizes all numeric fields (NaN/null → 0) via `sanitizeStockData`. Any new query against `eod_usmkts_price` should follow this same COALESCE + alias + sanitize pattern rather than reading raw columns.

**Earnings** (Pro feature `earnings`). Full design and runbook: **`docs/earnings.md`** — read it before touching any of this. The short version:
- **Dates:** Alpha Vantage `EARNINGS_CALENDAR`, one CSV for every symbol, 1 call/day → `nt_earnings_calendar`.
- **Results:** Benzinga results headlines from the Alpaca News API (e.g. `IBM Q2 Adj. EPS $2.93 Beats $2.86 Estimate, Sales …`), parsed by `lib/earningsParse.ts` → `nt_earnings`, the same day.
  - The parser is dependency-free so scripts can import it.
  - Fixtures live in `scripts/test-earnings-parse.mjs`; run them after any parser change.
  - Guidance headlines ("Sees/Raises … EPS") must never parse as results.
- **Not used:** Alpha Vantage per-symbol `EARNINGS` (too many calls on the free tier, and unreliable estimates), and `public.securities.next/last_earnings_date` (a stale one-off load in the sister app's table).
- **Cron:** `/api/cron/earnings` runs every 15 min (Railway `earnings-cron`) and picks the step by US/Eastern time:
  - weekdays 06:30–19:30: calendar + news;
  - weekday evenings and weekend mornings: catch-up for dates that passed without a result.
  - A single-row lease (`nt_job_lease`) prevents overlapping runs; pg advisory locks don't work over the Neon HTTP driver.
  - Alpha Vantage calls are reserved against `nt_api_usage` before they're made.
- **Readers** in `lib/earnings.ts` feed the stock page, watchlists, quadrant, scan alerts, performance (with/without-earnings split), home (separate gated `/api/home/earnings`, because `/api/home/data` is public and CDN-cached) and Telegram.
- **Gating:** every route returns earnings only when the viewer has the feature.
- **Dates** are US/Eastern `YYYY-MM-DD` strings; never parse them with `new Date('YYYY-MM-DD')` in local time.

**Options OI tracker** (Pro feature `oi_tracker`). Full design: **`docs/oi-tracker.md`**; read it before touching any of this. Key facts:
- `us_opt_chg_rpt` is a *change report*: only contracts whose OI moved (|oi_chg| ≥ 101), and no volume column. Its OCC `symbol` is null before the 2026-10-06 load, so key contracts with `occSql()` (`lib/oiTracker.ts`). OI change on load date D reflects session D−1, so volume is that session's bar, captured into `nt_opt_daily_bars`.
- Queries live in `lib/oiTracker.ts` (all filtering, aggregation and limits in SQL; the market-wide contract view is capped at 20 loads). Strategy candidates and the side hint are in `lib/oiStrategies.ts` (pure; fixtures in `scripts/test-oi-strategies.mjs`).
- Tracked positions are in `lib/oiTracked.ts` and `nt_oi_tracked`. **They are private: every query filters on `user_id`.** `visibility` is reserved for a future social feature and is always `private`.

**Column selection (every user-facing table).** Each table has a "⚙ Columns" menu (`components/ui/ColumnsMenu.tsx`) driven by `useColumnPrefs(tableId, columns)` (`components/ui/useColumnPrefs.ts`):
- Users can also reorder (drag headers or the menu) and resize columns; `useColumnPrefs` saves `{ hidden, order, widths }` together and `components/ui/ColRow.tsx` applies them: put `data-col="<id>"` on every registry `<th>`/`<td>` and render header/body rows as `<ColRow layout={cols.layout}>`. The menu's "Reset columns" clears all three.
- Signed in, the *hidden* column ids are saved per user in `nt_user_prefs` under `cols.<tableId>` via `/api/prefs/[key]` (`lib/userPrefs.ts` validates the key against `TABLE_IDS` in `lib/tableColumns.ts`); signed out (the public stock page) they go to localStorage.
- To add the menu to a table: give it a registry of `ColumnMeta`, add its id to `TABLE_IDS`, wrap its `<th>`/`<td>` in `cols.isShown(id)` and render `<ColumnsMenu />` (the OI `DataTable` does this itself when given a `tableId`).
- Admin pages are deliberately excluded.

### Route structure

- `app/page.tsx` — home dashboard (top OI stocks/ETFs, sector breakdown, top movers — the market indices moved out of this page into the shared Header's `IndicesStrip`), backed by `app/api/home/data/route.ts` which fans out to Neon (`securities`, `eod_usmkts_price`) and Alpaca (index quotes, mover bars) in parallel.
- `app/stock/[symbol]/page.tsx` — thin wrapper around `components/stock/StockAnalysis.tsx`, which holds the whole stock page (single-stock candlestick chart with level overlays; the selected expiry changes which levels are shown). See "Stock chart layout" below. Backed by `app/api/stocks/[symbol]/*` routes (details, `ohlc` from Alpaca, `levels` with historical range support, `expiry-dates`, `oi`).
- `app/watchlists/page.tsx` — full watchlists management (create/rename/delete lists, quotes table with level/direction/proximity filters, alerts widget). `app/watchlists/view/page.tsx` ("Watchlist W Chart" in the nav) is a split view of the same data: embedded stock chart on the left, compact watchlist table on the right. Both read/write the same watchlists via `app/api/watchlists/*`, so lists created on one show up on the other; shared types/cells/helpers live in `components/watchlists/watchlistShared.tsx`. Both sit under `app/watchlists/layout.tsx`, which gates on the Watchlists feature.
- `app/quadrant/page.tsx` — scatter/ladder visualization of all stocks positioned by proximity to their closest level. **Price used:** the EOD row's `close` for load date D is session D−1's close, so levels are measured against `refPrice` from `lib/quadrantPrices.ts` instead: live (5-minute shared cache in `nt_price_cache`) during the regular session, the stored last close after it, and that date's own close for past dates (see `docs/CHANGES.md`, 2026-10-16 and 2026-10-18 quadrant entries; the shared cache only vouches for the symbols it was captured for, so `lib/quadrantPrices.ts` merges missing symbols into it), with sector/industry/market-cap/index filters. Backed by `app/api/quadrant/data/route.ts`, which also derives available filter options from the securities present for the selected date (so filter dropdowns never offer an empty result set).
- `app/earnings/page.tsx` — Pro earnings tracker: upcoming / reported / custom windows, EPS and sales vs consensus, LTP, price reaction, and levels at a chosen monthly expiry for every stock with price levels. Backed by `app/api/earnings/{list,levels}/route.ts`; design and definitions in `docs/earnings.md` ("Earnings page"). Rows open the stock page in a new tab. Its columns (incl. Market cap) are selectable per user like every other table (see "Column selection" below).
- `app/oi-tracker/page.tsx` — Pro options OI tracker: OI flow (per contract, or grouped by stock + expiry, stock + strike, or trade date), By stock, Strategies, and My tracked (private positions with P&L). Clicking a row opens `components/oi/StockOiModal.tsx` (contracts sorted by volume, strike ladder, expiries, timeline, strategies, live volume). Backed by `app/api/oi-tracker/*`. Tables use the reusable `components/oi/DataTable.tsx` (sort, per-column filters, search, CSV). In the desktop Header it sits with Earnings under a "Trackers" dropdown.
- `app/diagnostics/page.tsx` + `app/api/{health,test-alpaca,test-db,test-tradier,debug/[symbol]}` — connectivity/debug endpoints for each external dependency, useful for verifying env vars are wired correctly after a deploy.

### Stock chart layout

`StockAnalysis` (`{ symbol, embedded? }`) renders, top to bottom: the symbol/quote block on the left with the Analysis box and expiry selector stacked on the right (passed to `TVChart` as `headerBelow` / `topAside`), then the chart, then level chips (which show each level's % distance), then — only when not `embedded` — the Price Levels History and Option Chain tables. There is no side panel any more.

- **Chart overlays** (inside `components/charts/TVChart.tsx`): the interval selector (`headerExtra`) is a collapsible overlay at the chart's top-left; Price/OI toggles, period buttons and the enlarge/collapse buttons (`toolbarEnd`) are an overlay at the top-right, inset past the price scale. The hover OHLC readout sits below the interval overlay.
- **Expiry selector**: dates are grouped by month under tinted month labels, scrolled with ◀ ▶ buttons (`HScrollRow`, no native scrollbar). Historical mode lists years on one row with one year open at a time. Date pills are colour-coded by type via `expiryKind()`: weekly (white), monthly = 3rd Friday (sky), quarterly = 3rd Friday of Mar/Jun/Sep/Dec (violet); a key is shown in the card header. The selected date is always solid blue.
- **Price scale and candles** (`TVChart.tsx`): the price scale follows the visible candles only; the five level lines don't widen it unless the **Fit levels** toggle is on (`autoscaleInfoProvider`). Candle spacing is 12px (`MAX_BAR_SPACING`) and the right 20% of the plot is left empty (`FREE_RIGHT_FRACTION`, applied as `rightOffset` by `fitBarsCapped`, and by bar position for the 1W/1M/3M/… buttons: a *time* range would snap to the last bar and remove the margin). The daily window is 85 calendar days (~60 bars) first, then chunks of the same size as the chart scrolls back (`INTERVAL_CONFIG` in `StockAnalysis.tsx`); a typical screen needs one or two chunks.
- **Load-more rules** (easy to break): (1) fit the view only when the data is *replaced*, never when older bars are merely added (`fittedRangeRef`); re-fitting after each chunk squeezed the bars and re-triggered load-more in a loop of 15–30 chunks. (2) The load-more triggers ignore the margins we add (`from < -2`, `to > last + rightOffset + 2`). (3) `/levels?range=true` is rate limited (10 a minute, 30 for users with live levels; editable at `/admin/settings`, see "Rate limits"). `levelsCoverageRef` records which symbol, expiry and date range the page already holds levels for, and the mount effect, the refetch effect, scroll-back chunks and the Price Levels History panel skip requests inside it; `skipLevelsRefetchRef` skips the one refetch right after a load-more merge and **must clear the loading overlay when it does** (a cancelled run never does). Opening a stock costs 2 calls and interval switches 0; check the count after touching any of this.
- **Level and OI lines** are curved, only have points for days with data, and run straight on to the next available point. **Missing data is stored as zeros, not null** (`eod_usmkts_price`): a level of 0 and a day with call OI and put OI both 0 mean "no data" (verified: those rows have every level at 0), so the levels route sends `oi: null` for such a day and the chart skips it. Never plot those zeros.
- **Saved chart settings** (`lib/chartPrefs.ts`, `components/charts/useChartPrefs.ts`, pref `chart.settings`): interval, expiry, period, Price/OI/Fit levels/Alt toggles, height, timeframe overlay. `StockAnalysis` gates its first load on them (`prefsApplied`) so requests use the saved interval/expiry; `TVChart` reads them once at mount and reports changes via `onSettingsChange`. The **Alt** toggle hides Call Low / Put High; ↺ resets everything.
- **Collapse**: one icon button collapses the whole block to a slim bar (quote, section jumps, expiry selector).
- **`embedded` mode** drops the site Header, alerts ticker, jump buttons and both history tables (and their fetches). Callers must pass `key={symbol}` so a symbol change remounts with fresh per-symbol state (selected expiry etc.). `/watchlists/view` uses it with a fixed chart height; its watchlist panel is absolutely positioned inside its grid cell so the chart column alone sets the row height and the table scrolls inside.
- **Market indices**: `components/layout/IndicesStrip.tsx`, rendered by `components/layout/Header.tsx` so it appears on every page, polls `/api/market/indices` (30s in US market hours, 5min otherwise) and caches the last response at module level between navigations.

### Frontend/data conventions

- All calculation happens server-side in API routes; chart components (`components/charts/*`) are `'use client'` and just render pre-computed data.
- API routes return `{ success: boolean, data?, error?, message? }` (see `types/api.ts` `ApiResponse<T>`), and query failures are generally caught and degrade to empty arrays/`null` rather than throwing, so the frontend can render partial dashboards when one data source (e.g. Alpaca) is down.
- **Report time zone:** instants shown in admin/account pages and the admin dashboard's "today" / day buckets use **Central Time** (`America/Chicago`, CST/CDT) via `lib/time.ts` (`formatCT`, `ctDayStartISO`, ...). Not converted: trade/expiry dates (`YYYY-MM-DD`), chart axes (America/New_York, exchange time) and scan-alert `load_dt_tm` (zone-less, source zone unconfirmed). See `docs/CHANGES.md`.
- Symbols are always upper-cased before querying (`symbol.toUpperCase()`) since the DB stores them uppercase.

## Known follow-ups

- **[#4](https://github.com/mandacx/neon_trade/issues/4) — per-request latency from `getCurrentUserContext()`.** Partly addressed: `auth.listAccounts()` moved out to `getHasPassword()` (only `/profile` calls it); `getSessionUser()` / `getCurrentUserContext()` are React `cache()`-wrapped, which dedupes within one server render (never across requests, so plan changes and sign-outs still apply on the next request); and the two stock routes run `checkRateLimit()` in parallel with `getUserContextFor(user)`. The signed-in context is a single statement (profile+plan, overrides, role and the FREE plan's features for the expired case). Still open: anonymous requests re-read the FREE plan row from `nt_plans` every call.
