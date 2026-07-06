# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- **Tradier** — `TRADIER_API_KEY`, `TRADIER_API_URL`. Used only for symbol search/lookup (`lib/tradier.ts` → `searchSymbols`, used in `app/api/stocks/search/route.ts`). Missing key logs a warning, not a hard failure.
- **Alpaca Markets** — `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `ALPACA_BASE_URL`. Used for all OHLC/candlestick/bar data (`lib/alpaca.ts`, plus an inline fetch client duplicated in `app/api/home/data/route.ts`). Uses the IEX feed (`feed: 'iex'`) for free-tier compatibility and requests split-adjusted prices (`adjustment: 'split'`).

Note the split from what `README.md`/`QUICK_START.md` describe: those docs predate the current code and describe Tradier as the OHLC source — in the actual code, **Alpaca provides OHLC/bars, Tradier only provides symbol search**. Trust the code in `lib/` over the older docs when they disagree.

**Deployment**: hosted on Vercel, connected to the same Neon Postgres instance and Tradier API in production as in local dev — set `DATABASE_URL`, `TRADIER_API_KEY`, `TRADIER_API_URL`, `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `ALPACA_BASE_URL` as Vercel project environment variables. API routes that read these are Node runtime by default (no `export const runtime = 'edge'` present), so Vercel serverless functions handle them.

## Architecture

**Stack**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS. Chart libraries: `lightweight-charts` (TVChart candlesticks), `recharts` (quadrant scatter plot), `klinecharts`/`@klinecharts/pro` (also present as deps).

### Data model — the "levels" concept

The whole app centers on one Neon table, `public.eod_usmkts_price` (end-of-day US market prices + derived options levels), and a `public.securities` table for metadata (name, sector, industry, market_cap_tier, indices as JSON).

For every `(symbol, trade_date, expiry_dt)` row there are 5 price "levels" (`put_low`, `put_int`, `comb_int`/`put_call_int`, `call_int`, `call_high`) representing put/call open-interest-derived support/resistance. `lib/calculations.ts` computes, for each level:

```
value = (CLOSE - LEVEL_PRICE) / CLOSE
```

The level with `value` closest to 0 is the `closestLevel` — i.e., the price is nearest that level. This single calculation (`calculateLevels` + `findClosestLevel`) is reused across the stock detail page, quadrant page, and home dashboard sector breakdown — it's the one piece of business logic worth understanding before touching any of those.

Column naming is inconsistent between the DB (`snake_case`) and the `StockData` TypeScript type (`types/stock.ts`, mixed `SCREAMING_CASE`/`camelCase`/`snake_case` fields like `PUT_INT`, `call_low`, `put_HIGH`) — `lib/db.ts` does the aliasing in SQL (`COALESCE(put_int, 0) as "PUT_INT"`) and also sanitizes all numeric fields (NaN/null → 0) via `sanitizeStockData`. Any new query against `eod_usmkts_price` should follow this same COALESCE + alias + sanitize pattern rather than reading raw columns.

### Route structure

- `app/page.tsx` — home dashboard (top OI stocks/ETFs, sector breakdown, top movers, market indices), backed by `app/api/home/data/route.ts` which fans out to Neon (`securities`, `eod_usmkts_price`) and Alpaca (index quotes, mover bars) in parallel.
- `app/stock/[symbol]/page.tsx` — single-stock K-line chart with level overlays; expiry-date dropdown changes which levels are shown. Backed by `app/api/stocks/[symbol]/*` routes (details, `ohlc` from Alpaca, `levels` with historical range support, `expiry-dates`, `oi`).
- `app/quadrant/page.tsx` — scatter/ladder visualization of all stocks positioned by proximity to their closest level, with sector/industry/market-cap/index filters. Backed by `app/api/quadrant/data/route.ts`, which also derives available filter options from the securities present for the selected date (so filter dropdowns never offer an empty result set).
- `app/diagnostics/page.tsx` + `app/api/{health,test-alpaca,test-db,test-tradier,debug/[symbol]}` — connectivity/debug endpoints for each external dependency, useful for verifying env vars are wired correctly after a deploy.

### Frontend/data conventions

- All calculation happens server-side in API routes; chart components (`components/charts/*`) are `'use client'` and just render pre-computed data.
- API routes return `{ success: boolean, data?, error?, message? }` (see `types/api.ts` `ApiResponse<T>`), and query failures are generally caught and degrade to empty arrays/`null` rather than throwing, so the frontend can render partial dashboards when one data source (e.g. Alpaca) is down.
- Symbols are always upper-cased before querying (`symbol.toUpperCase()`) since the DB stores them uppercase.
