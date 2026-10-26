# US Market Scanner

Pro feature `us_market_scanner` (PRO and EXPERT plans). Page `/scanner` ("🔎 US Market Scanner" in the
Trackers menu), API `GET /api/market/scanner`. Screens about 1,900 liquid US stocks and ETFs with 20
scans in 9 groups, from stored consolidated daily bars plus live snapshots, computed in memory.

Read this before changing anything under `lib/scanner/`, `lib/usUniverse*.ts`, `lib/referenceData/` or
the daily-bar feed rules in `lib/marketdata/provider/primary.ts`. History of decisions: `docs/CHANGES.md`
(2026-10-23 entries).

## Data flow

```
 WEEKLY (Railway, Saturday)                    WEEKLY (Railway, Sunday)
 us-universe-cron ──► /api/cron/us-universe     us-universe-meta-cron (Python, yfinance)
   1 listings   Nasdaq Trader symbol directory    GET  /api/cron/us-universe-meta  -> symbols
   2 indexes    SPY / DIA holdings xlsx,          POST /api/cron/us-universe-meta  <- sector,
                Nasdaq-100 list API                    industry, market cap, name
   3 liquidity  20 sessions of consolidated
                bars for ~11,700 listings
                (paced, resumable)
        │                                               │
        ▼                                               ▼
 ┌──────────────────────── nt_us_universe (latest values only) ───────────────────────┐
 │ symbol, exchange, kind (stock/etf), is_adr, sector (GICS 11), industry, market_cap, │
 │ in_sp500 / in_ndx100 / in_dow30 / in_top1000, avg_dollar_vol_20, is_liquid, active  │
 └─────────────────────────────────────────────────────────────────────────────────────┘
        │ scanner = active AND (liquid OR any index flag)
        ▼
 DAILY (market-catalog cron, 08:30–11:30 CT)      DURING THE SESSION (any scan request)
 warmDailyBars(): tracked ∪ scanner symbols       nt_scanner_today: today's consolidated bars,
   past days -> nt_daily_bars (consolidated)        refreshed in the background (after()),
   + split check on a 5-session overlap             ≤ every 3 min, final at close + 17 min
        │                                               │
        ▼                                               ▼
 GET /api/market/scanner ── runScan(): 1 SQL read of nt_daily_bars (5-min cache)
                                    + snapshots, 2 requests of 1,000 (15-s cache)
                                    + nt_scanner_today
                                    -> latest-session bar -> filters -> scan -> rank
```

## Feeds (verified 2026-10-23)

- **Daily bars are consolidated (SIP)**: real volume and the official OHLC. The single-venue (IEX) volume
  the app used before was ~2% of the real figure (AAPL 2026-10-22: 980,486 vs 47,047,124).
- This plan serves consolidated data **up to 15 minutes ago**. A request whose `end` is later is refused,
  and a date-only `end` means the end of that day. `sipEnd()` caps every daily request at now − 16 min.
- **Snapshots and intraday bars stay single-venue** (real-time consolidated is refused). So the live
  price comes from the snapshot, and today's volume from the 15-minute-delayed consolidated bar.
- Rate limit: 200 requests/min for the account (`X-Ratelimit-Limit`). Bulk jobs use `getDailyBarsPaced`
  (150/min, one shared gate, backoff honouring Retry-After).
- A batched consolidated request for ~2,000 symbols' **today** bar takes 10–25 s, which is why it lives in
  the shared `nt_scanner_today` table and is never fetched inside a scan request.

## Universe

| Piece | Source | Notes |
|---|---|---|
| Listings | Nasdaq Trader `nasdaqlisted.txt` + `otherlisted.txt` | ETF flag, test-issue flag, exchange. Drops `$` preferreds, `.W/.U/.R`, and non-ETF names saying warrant / unit / right / preferred / notes / debenture / coupon %. ADR = name says American Depositary / ADS / ADR. The feed's own asset list was not used: it only answers on the live trading host. |
| S&P 500, Dow 30 | SSGA SPY / DIA daily holdings (xlsx) | Parsed by a small built-in zip/xlsx reader. Plausibility: 480–520 and 29–31 names. |
| Nasdaq-100 | Nasdaq's list API; Invesco QQQ holdings as second source | 101 lines (GOOG + GOOGL). Invesco returned 406 to repeated scripted requests. |
| "≈ Russell 1000" | Top 1000 active non-ADR common stocks by market cap | No reachable public file (iShares serves HTML to scripts). Known gap: foreign issuers whose listing name doesn't say "Depositary" (e.g. TSM) count. The UI labels it an approximation. |
| Liquidity | 20 settled consolidated sessions | Liquid = last close ≥ $5 and average dollar volume ≥ **$50M/day** (`lib/usUniverseRules.ts`). $10M let in ~3,500 names. |
| Sector, industry, cap | yfinance via the Railway worker | Yahoo sectors mapped to the 11 GICS names. `public.securities` seeds the option-levels symbols once; it is never written. |

Every step keeps the previous data when its source fails or looks implausible. No membership history is
kept (decided): bars for scanner symbols are stored daily, so liquidity on past dates can be recomputed.

## Scans

Groups: Streaks, 52-week, Volume, Gaps, Open patterns, Momentum, Volatility, Relative strength, Earnings.
The catalogue (labels, help text, which fields each scan uses) is `SCANS` in `lib/scanner/config.ts`.

Rules that are easy to get wrong:

- **Latest-session bar** (`liveBarFrom`): decided by **date** (the snapshot's bar carries its ET trading
  date) against the last stored session and the calendar's latest session, not by matching closes. The
  close comparison survives as a split check (> 5% off on the same session → flagged). A settled session
  missing from storage (before the morning top-up) is taken from the snapshot's previous bar.
- **Volume scans before today's consolidated bar exists** use the settled sessions only
  (`meta.volumeScanSettledOnly`); single-venue volume would make every ratio tiny.
- **52-week scans** need ≥ 200 stored sessions (IPOs are skipped, not guessed).
- **Ranking**: "smaller is stronger" scans sort ascending (`rankAscending`: 52-week extremes, Open = High,
  golden/death cross age, inside-day ratio, days to earnings, and the "down" side of ROC / SMA / RS);
  ties are broken by dollar volume.
- **Corporate-action flag**: a > 30% one-session move inside the bars the match used (or anywhere in the
  year for 52-week scans). Split *detection* is separate (below).
- **Filters** apply before the scan. Sector, industry and market cap describe companies, so they never
  match ETFs. Every query parameter goes through `normalizeParams` (clamped; unknown values → defaults).

## Splits

`warmDailyBars` re-requests 7 calendar days before each symbol's coverage end. When every overlapping
stored close moved by > 0.5% and all by the same ratio (±1%), the symbol is rebased: bars and coverage
dropped, full history pulled on the next run (`lib/splitCheck.ts`, `WarmResult.rebased`).

## Runbook

```bash
# One-time DDL (also created on first use)
node --env-file=.env.local scripts/bootstrap-us-universe.mjs [--dry-run]
# Grant the feature (insert-only)
node --env-file=.env.local scripts/add-us-market-scanner-feature.mjs [--dry-run]

# Universe now (resumable; repeat until liquidity says done:true). ?force=1 restarts every step.
curl -H "Authorization: Bearer $CRON_SECRET" https://us.niftytrendz.com/api/cron/us-universe
# Metadata now (from railway/us-universe-meta-cron; needs: pip install yfinance)
APP_URL=https://us.niftytrendz.com CRON_SECRET=... python -I railway/us-universe-meta-cron/meta_worker.py
# History for new symbols now (resumable)
curl -H "Authorization: Bearer $CRON_SECRET" https://us.niftytrendz.com/api/cron/daily-bars

# Tests
node scripts/test-us-scanner.mjs
node --env-file=.env.local railway/node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/scanner-dry-run.mts
```

Railway: `us-universe-cron` (Saturday every 10 min 14:00–16:50 UTC; the route skips steps under 6 days
old) and `us-universe-meta-cron` (Sunday 15:00 UTC) in `railway/.railway/railway.ts`. Apply with
`railway config apply` from `railway/` in PowerShell (see CLAUDE.md). Applied and deployed 2026-10-26.
Redeploy an image with `railway up ./us-universe-cron --path-as-root --service us-universe-cron` from `railway/`.

## Tables

| Table | What |
|---|---|
| `nt_us_universe` | One row per listing, latest values (see above). |
| `nt_us_universe_jobs` | Per-step run state (`listings`, `indexes`, `liquidity`): started / done / info. |
| `nt_scanner_today` | Today's (latest session's) consolidated bars for the scanner symbols; one date at a time. |
| `nt_daily_bars`, `nt_daily_bars_cover` | Shared with the stock chart. `cover.feed = 'consolidated'` marks coverage pulled under the current feed rules. |

## Limits and follow-ups

- Pre-market and after-hours behaviour was only fixture-tested (the live runs were during the session).
- Pre-market gappers need a pre-market trade on the single-venue feed; many names have none.
- The Top-1000 approximation only ranks stocks that have a market cap, i.e. scanner stocks.
- Holdings sources are third-party web endpoints that can change or start blocking without notice.
