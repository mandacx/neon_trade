# Earnings dates & results

Pro feature `earnings`. This page covers why the feature exists, how it's built, and how to run and maintain it.

## Idea

Option levels in this app are tied to an expiry. If a company reports earnings before that expiry, the report can push price straight through those levels. So for any level, the most useful extra fact is whether earnings land inside its window.

The feature therefore has to answer three questions everywhere a symbol and an expiry appear together:

1. **When is the next report?** Date and session: before the open (BMO) or after the close (AMC).
2. **Does it fall before this expiry?** Shown as an amber flag across the app.
3. **How did the last report go?** EPS (and sales) against consensus: beat, miss or in-line.

Results should land **the same day** they're published.

## Design

### Two sources, each used for one job

| Need | Source | Cost |
|---|---|---|
| Upcoming dates + EPS estimate | **Alpha Vantage `EARNINGS_CALENDAR`**: one CSV listing every symbol's next report in the coming 3 months | 1 call/day (free tier allows 25) |
| Results (EPS, sales, consensus, beat/miss) | **Alpaca News API**: Benzinga publishes a results headline about 10 minutes after each release | None beyond the existing Alpaca key |

A typical results headline looks like this:

```
IBM Q2 Adj. EPS $2.93 Beats $2.86 Estimate, Sales $17.162B Beat $16.860B Estimate
```

**Why not Alpha Vantage `EARNINGS` (per-symbol history)?** We tried it and dropped it. It costs one call per symbol (about 600) against 25 a day, so a backfill takes weeks. Its `estimatedEPS` is also unreliable: for IBM Q2 it equalled the actual, while Benzinga's consensus was $2.86. About 112 rows from that experiment remain, marked `source='alphavantage'`; the merge rules keep them consistent.

**Why not `public.securities.next/last_earnings_date`?** That table belongs to the sister app (neon_nifty). Those columns were filled once from yfinance in April 2026 and are stale. Never write to them.

### Headline parser — `lib/earningsParse.ts`

- **Pure and dependency-free** (no path aliases), so both the app and Node scripts can import it. Scripts load it directly through Node 24's built-in TypeScript type stripping.
- **Handles:**
  - adjusted, GAAP and unlabelled EPS
  - `$(0.56)` negatives
  - B/M/K amounts
  - `, Inline` (estimate = actual)
  - `Up/Down From … YoY` (no estimate)
  - EPS-only headlines
  - `H1`/`FY` periods
  - `Reported Earlier,` and `CORRECTION:` prefixes (a correction overwrites the figures it corrects)
- **Rejects guidance.** Headlines such as `Sees Q3 Adj EPS $3.95-$4.05 vs $3.99 Est`, `Raises/Lowers/Affirms/Narrows … Guidance` and analyst "Raises … EPS Estimates" look like results but must never be stored as results.
- **Symbol rule:** a headline is accepted only when exactly one tracked symbol is tagged, or when all tagged symbols are share classes of one company (GOOG/GOOGL).
- **Fixtures:** `scripts/test-earnings-parse.mjs` holds real headlines; run `node scripts/test-earnings-parse.mjs`. When validated on a live peak week it parsed 211 results headlines, missed none, and produced no suspicious values.

### Tables

All app tables are `nt_`-prefixed because the database is shared with neon_nifty. They're created by `scripts/bootstrap-earnings.mjs`.

| Table | Key | Holds |
|---|---|---|
| `nt_earnings_calendar` | (symbol, report_date) | Schedule: `eps_estimate`, `time_of_day`, `status` |
| `nt_earnings` | (symbol, reported_date) | Results: EPS/sales actual and estimate, surprise %, outcome, period, `report_time`, `source`, `headline`, `news_id` |
| `nt_api_usage` | (provider, day) | Alpha Vantage calls per **UTC** day, plus `exhausted_at` |
| `nt_job_lease` | name | `locked_until` — one cron run at a time |

Calendar `status` values: `scheduled` → `pending_results` once the date passes → `resolved` once a result is stored. A row becomes `dropped` if it vanishes from a later snapshot (rescheduled or cancelled), and `no_result` if no headline appears within 14 days.

Merge rules:

- **Duplicate headlines:** a results row for the same symbol within ±3 days of an existing one is the same report. This covers a `Reported Earlier` copy published the next day.
- **Within one batch:** repeats are collapsed and the earliest is kept.
- **Calendar → result:** a calendar row resolves when a result exists in [report_date − 3d, report_date + 10d]. Calendar and results are never joined on `fiscal_date_ending`, because Alpha Vantage doesn't keep it consistent.
- **Missing values:** absent values are `NULL`, never `0`. Don't reuse `sanitizeNumeric` from `lib/db.ts` here.

### Sync — `lib/earnings.ts` + `/api/cron/earnings`

The Railway service `earnings-cron` calls the route every 15 minutes. The **route** chooses the work by US/Eastern time, so the schedule never needs editing when daylight saving changes:

| ET window | Step |
|---|---|
| Weekdays 06:30–19:30 | `syncCalendar()` (first run of the UTC day; later runs see it's done and skip the call) + `syncResultsFromNews()` (rolling 30h of news for all tracked symbols, one `symbols=` request, paged) |
| Weekdays 20:00–23:00 | `catchUpPendingFromNews()` — re-query news for symbols whose date passed with no result (last 14 days) |
| Weekends 09:00–12:00 | catch-up again (late Friday headlines) |
| Anything else | returns immediately, no DB access |

Each run follows the same rules:

- **Lease first:** a run takes the single-row lease in `nt_job_lease` and exits if another run holds it. Postgres advisory locks don't work here, because the Neon HTTP driver gives every statement its own session.
- **Budget before calling:** every Alpha Vantage call is reserved first, with an atomic upsert into `nt_api_usage` that refuses once the day's budget (`ALPHA_VANTAGE_DAILY_BUDGET`, default 25) is spent. Alpha Vantage signals throttling with HTTP 200 and an `Information`/`Note` body; that marks the day `exhausted_at`.
- **Calendar safety:** the calendar body is validated (a `symbol` header and at least 1,000 rows) before it's applied, so an error body never wipes the schedule.
- **No leaked keys:** URLs are never logged, because they contain the key.
- **`?force=true`** runs every step at once, for manual runs.

The **tracked universe** is symbols with option levels traded in the last 30 days (about 600). This leaves out the roughly 140 delisted tickers still present in `eod_usmkts_price`.

### Readers and where earnings appear

`lib/earnings.ts` provides:

- `getEarningsSummary(symbols)`: next, last and pending report per symbol
- `getEarningsHistory(symbol)`
- `getEarningsEvents(symbols, {aheadDays, backDays})`
- `earningsBadge(summary, expiry)`: a compact per-row flag, including `beforeExpiry`
- `getEarningsInWindows(pairs)`: a batched "did a report land between A and B?" lookup (a full month of about 9,500 alert windows takes about 0.3s)
- `getEarningsCoverageStart()`

Dates are US/Eastern `YYYY-MM-DD` strings. Day arithmetic works on those strings, never on `new Date('YYYY-MM-DD')` in local time.

| Surface | What it shows |
|---|---|
| Stock page (`components/stock/EarningsPanel.tsx`, `StockAnalysis`, `TVChart`) | Next/last lines in the chart header; ⚠ "Earnings before this expiry" chip; amber dot on expiry pills after the next report; "E" chart markers (coloured by beat/miss) with a tooltip; Earnings History table |
| Watchlists (full table + W Chart, `watchlistShared.tsx`) | Next Earnings / Last Result columns (sortable), Earnings filter (today / this week / 7–30 days / before selected expiry / reported last 7 days), earnings events in the alerts widget |
| Quadrant + scan-alert ladders (`QuadrantChart`) | Amber ring on dots whose report falls before expiry, tooltip lines, Earnings filter (quadrant), Next Earnings column |
| Latest scan alerts | Earnings column relative to each alert's expiry |
| Historical scan alerts | "Earnings in window" — the report that landed between the alert and its expiry, with beat/miss |
| Performance | Each alert tagged `earningsInWindow`; continuation/reversion split **with vs without** earnings. Alerts older than the earnings data (`getEarningsCoverageStart()`) are *unknown* and excluded, so "no data" isn't mistaken for "no report". |
| Home (`/api/home/earnings`) | "Earnings This Week" and "Just Reported" cards; ER flag on Top OI rows. This is a **separate gated route**, because `/api/home/data` is public and CDN-cached for every visitor. |
| Telegram (when re-enabled) | ` · ER Oct 28 before exp` suffix on alert lines, for subscribers who have the feature |

**Gating:** every route returns earnings data only when `hasFeature(ctx.features, FEATURE_EARNINGS)`. The stock details route sends non-entitled viewers `earningsLocked: true`, so the header can show an upgrade link.

## Execution (how it was rolled out)

1. Wrote the parser and its fixtures, then validated it on live peak-week news. Shapes collected: 110 headline formats in one week.
2. `node --env-file=.env.local scripts/bootstrap-earnings.mjs` created the tables.
3. `node --env-file=.env.local scripts/backfill-earnings-news.mjs 200` scanned 200 days of news: 50,703 articles → 1,121 results across 555 of 603 tracked symbols, plus 24 corrections applied. It's re-runnable because inserts never overwrite.
4. The first forced cron run loaded 522 upcoming reports from the Alpha Vantage calendar.
5. Railway service `earnings-cron` was added in `railway/.railway/railway.ts`. It reuses `CRON_SECRET` by **reference** (`${{market-catalog-cron.CRON_SECRET}}`), so there's only one secret. Deployed with `railway config apply` and `railway up --service earnings-cron` from `railway/earnings-cron/`.
6. `ALPHA_VANTAGE_API_KEY` was added to Vercel Production. Locally it lives in `.env.local`.
7. The feature code `earnings` must also be on the Pro plan (`/admin/plans`). The bootstrap seed only covers new environments.

## Operations

```bash
# Force a run (all steps); expect calendar/news/catchUp results in the JSON
curl -H "Authorization: Bearer $CRON_SECRET" "https://us.niftytrendz.com/api/cron/earnings?force=true"

# Re-run the news backfill (idempotent), e.g. after a parser improvement
node --env-file=.env.local scripts/backfill-earnings-news.mjs 120

# Parser fixtures
node scripts/test-earnings-parse.mjs
```

Health checks (SQL):

```sql
SELECT status, COUNT(*) FROM nt_earnings_calendar GROUP BY 1;            -- schedule state
SELECT day, calls, exhausted_at FROM nt_api_usage ORDER BY day DESC LIMIT 7;  -- AV budget
SELECT reported_date, COUNT(*) FROM nt_earnings
  WHERE reported_date > CURRENT_DATE - 7 GROUP BY 1 ORDER BY 1;          -- results landing
SELECT symbol, report_date FROM nt_earnings_calendar
  WHERE status = 'pending_results' ORDER BY report_date;                 -- awaiting a headline
```

Troubleshooting:

- **No new results on a report day:** check the `earnings-cron` logs on Railway, then force a run. If headlines exist but didn't parse, add the headline to the fixtures, fix `lib/earningsParse.ts`, and re-run the backfill for that period.
- **The calendar didn't refresh:** look at `nt_api_usage.exhausted_at`. A local run on the same key shares the daily budget, so use a separate key for local development.
- **A symbol is stuck as `pending_results`:** the catch-up re-queries for 14 days, after which it becomes `no_result`.

## Follow-ups

- **Telegram daily digest** ("your watchlist reports today/tomorrow"): needs once-per-day delivery tracking per user. Build it when Telegram is configured.
- **Scan-alerts ticker badge:** `/api/scan-alerts/recent` is public, so an earnings badge there would need its own gated request.
