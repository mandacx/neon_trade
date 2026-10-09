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
- **Tradier** — `TRADIER_API_KEY`, `TRADIER_API_URL`. Used only for stock search, as the *remote* half (`lib/tradier.ts` → `searchCompanies` for names, `searchSymbols` for tickers). Missing key logs a warning, not a hard failure.
  - **Search is local-first** (`lib/symbolSearch.ts`, `app/api/stocks/search?scope=local|remote`). An in-memory index of our ~750 symbols + `securities` names answers ticker *and* company-name queries in ~2ms. Tradier's matches are a second request appended by `components/ui/useSymbolSearch.ts`, so its slow responses (often near the 2s client timeout) never delay the dropdown.
  - Remote symbols are normalized: `BRK/B` → `BRK.B`, and anything the stock page wouldn't accept is dropped.
- **Alpaca Markets** — `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `ALPACA_BASE_URL`. Used for all OHLC/candlestick/bar data (`lib/alpaca.ts`, plus an inline fetch client duplicated in `app/api/home/data/route.ts`). Uses the IEX feed (`feed: 'iex'`) for free-tier compatibility and requests split-adjusted prices (`adjustment: 'split'`).

Note the split from what `README.md`/`QUICK_START.md` describe: those docs predate the current code and describe Tradier as the OHLC source — in the actual code, **Alpaca provides OHLC/bars, Tradier only provides symbol search**. Trust the code in `lib/` over the older docs when they disagree.

**Deployment**: hosted on Vercel, connected to the same Neon Postgres instance and Tradier API in production as in local dev — set `DATABASE_URL`, `TRADIER_API_KEY`, `TRADIER_API_URL`, `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `ALPACA_BASE_URL` as Vercel project environment variables. API routes that read these are Node runtime by default (no `export const runtime = 'edge'` present), so Vercel serverless functions handle them.

**Crons (Railway)**: the `neon-trade-crons` Railway project runs three services, each a tiny curl container that calls a protected route on `https://us.niftytrendz.com` with `Authorization: Bearer $CRON_SECRET` (`lib/cronAuth.ts`; the secret is set in Vercel Production and on `market-catalog-cron`/`telegram-alerts-cron`; `earnings-cron` references it as `${{market-catalog-cron.CRON_SECRET}}`):
- `telegram-alerts-cron` → `/api/cron/telegram-alerts`. **Currently disabled** (no schedule) until Telegram is configured (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` in Vercel); to re-enable, restore `cronSchedule: "*/15 12-21 * * 1-5"` in `railway/.railway/railway.ts` and `railway config apply` (route enforces NYSE hours).
- `market-catalog-cron` → `/api/cron/market-catalog`, every 30 min 13:00–17:30 UTC weekdays (route enforces 8:30–11:30 CT).
- `earnings-cron` → `/api/cron/earnings`, every 15 min; the route picks calendar / news / catch-up by US/Eastern time (see `docs/earnings.md`).

Service settings (schedules, restart policy, Dockerfile builds) are infrastructure-as-code in `railway/.railway/railway.ts`; the Railway SDK it imports is a devDependency of `railway/package.json`, deliberately separate from the app (and `railway/` is excluded in `tsconfig.json`). From `railway/`: `railway config plan` to diff against the live project, `railway config apply` to push changes, `railway up --service <name>` from a service's folder to redeploy its container. **On Windows** the CLI is an npm shim the SDK can't exec, so set `_` to the real binary first (PowerShell: `$env:_ = "$env:APPDATA\npm\node_modules\@railway\cli\bin\railway.exe"; & $env:_ config plan`); in Git Bash this fails regardless, use PowerShell.

## Architecture

**Stack**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS. Chart libraries: `lightweight-charts` (TVChart candlesticks), `recharts` (quadrant scatter plot), `klinecharts`/`@klinecharts/pro` (also present as deps).

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

### Route structure

- `app/page.tsx` — home dashboard (top OI stocks/ETFs, sector breakdown, top movers — the market indices moved out of this page into the shared Header's `IndicesStrip`), backed by `app/api/home/data/route.ts` which fans out to Neon (`securities`, `eod_usmkts_price`) and Alpaca (index quotes, mover bars) in parallel.
- `app/stock/[symbol]/page.tsx` — thin wrapper around `components/stock/StockAnalysis.tsx`, which holds the whole stock page (single-stock K-line chart with level overlays; the selected expiry changes which levels are shown). See "Stock chart layout" below. Backed by `app/api/stocks/[symbol]/*` routes (details, `ohlc` from Alpaca, `levels` with historical range support, `expiry-dates`, `oi`).
- `app/watchlists/page.tsx` — full watchlists management (create/rename/delete lists, quotes table with level/direction/proximity filters, alerts widget). `app/watchlists/view/page.tsx` ("Watchlist W Chart" in the nav) is a split view of the same data: embedded stock chart on the left, compact watchlist table on the right. Both read/write the same watchlists via `app/api/watchlists/*`, so lists created on one show up on the other; shared types/cells/helpers live in `components/watchlists/watchlistShared.tsx`. Both sit under `app/watchlists/layout.tsx`, which gates on the Watchlists feature.
- `app/quadrant/page.tsx` — scatter/ladder visualization of all stocks positioned by proximity to their closest level, with sector/industry/market-cap/index filters. Backed by `app/api/quadrant/data/route.ts`, which also derives available filter options from the securities present for the selected date (so filter dropdowns never offer an empty result set).
- `app/diagnostics/page.tsx` + `app/api/{health,test-alpaca,test-db,test-tradier,debug/[symbol]}` — connectivity/debug endpoints for each external dependency, useful for verifying env vars are wired correctly after a deploy.

### Stock chart layout

`StockAnalysis` (`{ symbol, embedded? }`) renders, top to bottom: the symbol/quote block on the left with the Analysis box and expiry selector stacked on the right (passed to `TVChart` as `headerBelow` / `topAside`), then the chart, then level chips (which show each level's % distance), then — only when not `embedded` — the Price Levels History and Option Chain tables. There is no side panel any more.

- **Chart overlays** (inside `components/charts/TVChart.tsx`): the interval selector (`headerExtra`) is a collapsible overlay at the chart's top-left; Price/OI toggles, period buttons and the enlarge/collapse buttons (`toolbarEnd`) are an overlay at the top-right, inset past the price scale. The hover OHLC readout sits below the interval overlay.
- **Expiry selector**: dates are grouped by month under tinted month labels, scrolled with ◀ ▶ buttons (`HScrollRow`, no native scrollbar). Historical mode lists years on one row with one year open at a time. Date pills are colour-coded by type via `expiryKind()`: weekly (white), monthly = 3rd Friday (sky), quarterly = 3rd Friday of Mar/Jun/Sep/Dec (violet); a key is shown in the card header. The selected date is always solid blue.
- **Collapse**: one icon button collapses the whole block to a slim bar (quote, section jumps, expiry selector).
- **`embedded` mode** drops the site Header, alerts ticker, jump buttons and both history tables (and their fetches). Callers must pass `key={symbol}` so a symbol change remounts with fresh per-symbol state (selected expiry etc.). `/watchlists/view` uses it with a fixed chart height; its watchlist panel is absolutely positioned inside its grid cell so the chart column alone sets the row height and the table scrolls inside.
- **Market indices**: `components/layout/IndicesStrip.tsx`, rendered by `components/layout/Header.tsx` so it appears on every page, polls `/api/market/indices` (30s in US market hours, 5min otherwise) and caches the last response at module level between navigations.

### Frontend/data conventions

- All calculation happens server-side in API routes; chart components (`components/charts/*`) are `'use client'` and just render pre-computed data.
- API routes return `{ success: boolean, data?, error?, message? }` (see `types/api.ts` `ApiResponse<T>`), and query failures are generally caught and degrade to empty arrays/`null` rather than throwing, so the frontend can render partial dashboards when one data source (e.g. Alpaca) is down.
- Symbols are always upper-cased before querying (`symbol.toUpperCase()`) since the DB stores them uppercase.

## Known follow-ups

- **[#4](https://github.com/mandacx/neon_trade/issues/4) — per-request latency from `getCurrentUserContext()`.** Partly addressed: `auth.listAccounts()` moved out to `getHasPassword()` (only `/profile` calls it); `getSessionUser()` / `getCurrentUserContext()` are React `cache()`-wrapped, which dedupes within one server render (never across requests, so plan changes and sign-outs still apply on the next request); and the two stock routes run `checkRateLimit()` in parallel with `getUserContextFor(user)`. The signed-in context is a single statement (profile+plan, overrides, role and the FREE plan's features for the expired case). Still open: anonymous requests re-read the FREE plan row from `nt_plans` every call.
