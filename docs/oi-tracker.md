# Options OI Tracker

Pro feature `oi_tracker`. Page `/oi-tracker`. It shows where option open interest (OI) is being opened and closed, by contract, stock, expiry, strike and trade date. It also shows the volume behind each change, its dollar size, possible multi-leg strategies, and private position tracking with P&L.

## Data facts (verified 2026-10-15; read before changing anything)

**`public.us_opt_chg_rpt` is a change report, not a full chain.**
- It only holds contracts whose OI moved that day, and every row has |`oi_chg`| ≥ 101.
- Size: about 10–17k rows a day across about 450 underlyings, with loads since 2023-05-08.
- Columns: `symbol_und, symbol (OCC), close (underlying), expiry_dt, opt_type ('call '/'put  ', space-padded char(5)), strike_pr, load_dt, ltp, oi, oi_chg`.
- **There is no volume column.** For full call/put OI per expiry use `eod_usmkts_price.call_oi/put_oi`; the modal's Expiries tab does this.

**The OCC `symbol` is null before the 2026-10-06 load.**
- `occSql()` in `lib/oiTracker.ts` derives the key from underlying + expiry + type + strike when the symbol is missing.
- The derived key equals the real OCC symbol on 94.5% of rows (checked on 2026-10-15). The exceptions are:
  - index weeklies and PM-settled options: `SPXW`, `NDXP`
  - adjusted contracts: `LEN1`, `GME1`, `SOXS2`, `TZA1`
- Since 10-06 those can sit next to the standard contract at the same underlying, expiry, type and strike (72 such pairs on 10-15). So a range that spans 10-06 shows them under two keys.

**OI change on load date D reflects session D−1's trading.**
- The OI published on the morning of D is the result of the previous session.
- Checked live:
  - WMT 261120C120: +104,798 on 10-14, against 107,587 traded on 10-13.
  - SPXW 261127P6500: +60,773 on 10-14, against 60,858 traded on 10-13.
  - On the 10-15 load, 1,785 of 1,796 OI increases of ≥ 1,000 had previous-session volume of at least 95% of the increase.
- For OI decreases it held for 352 of 486. Exercise and assignment also reduce OI without a trade.
- So "Volume" everywhere in this feature means **the volume of the session before the load date**.

**`ltp` semantics are unverified.** WMT 120C on 10-14 had ltp 2.32, while Tradier showed close 2.98 and prevclose 1.64. It may be an intraday snapshot. Dollar columns use it as chosen (`oi_chg × 100 × ltp`), and the UI labels them "from the report's LTP".

**Alpaca options API (same keys as the rest of the app)**
- `/v1beta1/options/bars` accepts 200 symbols per request. An uncached request takes about 2.7s, and the rate limit is 200 requests/min. A range that includes the current trading day is refused.
- `/v1beta1/options/snapshots?symbols=` caps at 100 symbols ("symbol limit is 100").
- `/v1beta1/options/snapshots/{underlying}` returns the chain, paged by 1,000.
- SPXW contracts have bars. Whether Alpaca has a chain snapshot for `SPX` is unverified; the modal degrades to no live data.

## Design

### Tables (`scripts/bootstrap-oi-tracker.mjs`, idempotent)

| Table | Purpose |
|---|---|
| `nt_opt_daily_bars (contract, bar_date)` | Daily option bar for each contract in a load, for the session before that load: `o,h,l,c,v,vw,n`. `no_trade` marks contracts Alpaca had no bar for (~1%), so they aren't asked for again. |
| `nt_oi_tracked` | User positions: `contract, underlying, expiry_dt, opt_type, strike, side BTO/STO, qty, entry_date, entry_price, entry_underlying, strategy_group/label, note, closed_at, exit_price, visibility`. Indexed on `user_id`. |
| `nt_job_lease ('oi_volume')` | Prevents capture runs from overlapping. The lease helper is `lib/jobLease.ts`, shared with earnings. |

### Volume capture (`lib/optionVolume.ts`)

`captureOptionBars({ deadline })` does the following:
1. Takes the latest `opt_chg` load D.
2. Finds the previous trading session S (`previousTradingDay()`, from the Alpaca calendar for that exact range, with a weekday fallback).
3. For every contract in D that has no `nt_opt_daily_bars` row for S, fetches S's daily bar: batches of 1,200 contracts, as six parallel 200-symbol requests.
4. Upserts the bars and stops before the deadline.

It is resumable: the next run continues where this one stopped. It runs at the end of `/api/cron/market-catalog` (Railway, every 30 min, 8:30–11:30 CT weekdays), after the catalog step, with a 50s budget, so no new Railway service is needed. Measured: one run stored 12,000 of 12,809 contracts in 46s, and the next run finished the remaining 809 in 6s.

History: `node --env-file=.env.local scripts/backfill-option-volume.mjs --from YYYY-MM-DD [--to ...]` mirrors the same logic. Alpaca's option history starts in 2024.

### Queries (`lib/oiTracker.ts`)

`getOiScreen(params)` does all filtering, aggregation, sorting and the row limit in one SQL statement (plus a summary statement and a coverage count).
- **Rows:** per contract, or grouped by underlying / underlying + expiry / underlying + strike / load date.
- **Filters:** load-date range, symbols, call/put, expiry range / list / kind (weekly; monthly = 3rd Friday, including quarterly; quarterly = 3rd Friday of Mar/Jun/Sep/Dec), DTE, opened/closed, min |OI chg|, a $ bucket of the change or the total OI ($1B+, $1M–1B, $1K–1M), ITM/OTM, and sector/index via `public.securities`.

Per-contract fields:

| Field | Definition |
|---|---|
| `oiChg` | Sum over the range |
| `oi`, `ltp`, `close` | From the last load in the range |
| `chgValue` | Σ oi_chg·100·ltp |
| `oiValue` | oi·100·ltp |
| `notional` | oi·100·close |
| `newPct` | oiChg / (oi − oiChg) |
| `moneynessPct` | (strike − close)/close |
| `vol` | Captured volume of the sessions behind the changes |
| `volToChg` | ≈1 means the session was mostly this flow; ≫1 means churn |
| `hint` | See the side hint below |

Measured on the live DB (2026-10-15):

| Range | View | Time |
|---|---|---|
| 1 load | any grouping | 0.25–0.8s |
| 20 loads | contracts | ~2.2s |
| 20 loads | grouped | ~2.0–2.3s |
| 60 loads | grouped | 5.7–6.8s |

Range caps follow from these numbers: the contract view across all stocks is capped at the latest **20** loads (`MAX_LOADS_CONTRACT`); grouped views and single-stock views at 60 (`MAX_LOADS`).

### Strategy candidates (`lib/oiStrategies.ts`, pure, fixtures in `scripts/test-oi-strategies.mjs`)

The idea: a multi-leg trade changes each leg's OI by about the same number of contracts.
- Within one underlying and one load date, legs (|OI chg| ≥ `minLeg`, default 500) whose sizes agree within `tolerancePct` (default 3%, adjustable 0.5–5%) are matched.
- Each contract is used once. Matching goes in this order: iron condor / iron butterfly → butterfly (1:2:1, flagged broken-wing when the wings are uneven) → pairs (same expiry first, then closest sizes) → 1×2 ratio spreads.

| Legs | Signs | Label |
|---|---|---|
| Same type and expiry, different strikes | same | Vertical |
| Same type and expiry, different strikes | opposite | Strike roll up/down |
| Call + put, same expiry, same strike | same | Straddle / synthetic stock |
| Call + put, same expiry, put strike below call strike | same | Strangle / risk reversal / collar |
| Call + put, same expiry | opposite | Call ↔ put switch |
| Same type and strike, different expiry | same | Calendar |
| Same type and strike, different expiry | opposite | Expiry roll out/in |
| Same type, different strike and expiry | same | Diagonal |
| Same type, different strike and expiry | opposite | Diagonal roll |
| Call + put, different expiries | — | Not paired |

Confidence = 0.6 × closeness (1 − diff/tolerance) + 0.4 × size (log10 of the smallest leg / 4, capped at 1).

**Limit, stated in every label ("Possible …"):** the sign of an OI change means opened or closed, never bought or sold. So long vs short (debit vs credit) is unknown, and a size match can be coincidence. On 10-15 there were 964 candidates from 4,718 legs at 3%.

### Side hint (`suggestSide`)

The hint comes from the option's open→close move in the session that produced the OI change (the captured bar):
- OI up and premium +3% or more: "BTO?"
- OI up and premium −3% or more: "STO?"
- otherwise: no side
- OI down: closing

It is a hint only. The user always picks BTO/STO when tracking.

### Tracking (`lib/oiTracked.ts`)

**Positions are private to the user who created them.**
- Every statement filters on `user_id` inside the SQL itself, so another user's id behaves exactly like a missing one (404).
- No route lists positions across users.
- `visibility` is reserved for a future social feature (public board / follow) and is always `'private'`. No UI or API can set it. That feature must add its own read path for public rows, behind its own gate.

**Adding a position** (`POST /api/oi-tracker/tracked`, 1–4 legs; legs added together share a `strategy_group`):
- The contract must exist in the report for that underlying. Expiry, type and strike are parsed from the OCC symbol, not taken from the client.
- The entry date can be today or a past date.
- Default entry price: the live mid for today, otherwise that day's bar close, otherwise the report's LTP.
- The entry underlying price is recorded (Alpaca stock data, or the report's close for indices).
- At most 300 open positions per user.

**Performance**
- Current price:
  - live: snapshot mid, else last trade
  - expired: intrinsic value at the expiry-day close of the underlying, else the last bar
  - closed: the exit price
- P&L = (current − entry) × 100 × qty, negated for STO; P&L % likewise.
- The underlying's move since entry is shown alongside.
- History: daily bars since entry plus today's snapshot, carrying the last price on days without a trade, summed across a strategy group.

## API

All routes use `requireFeatureApi(FEATURE_OI_TRACKER)`, via `guardOi()` in `lib/oiTrackerApi.ts`. The heavy ones are also rate-limited at 90 requests/min per user.

| Route | Purpose |
|---|---|
| `GET /api/oi-tracker/meta` | Load dates, upcoming expiries, sector/index options |
| `GET /api/oi-tracker/screen` | `getOiScreen`; query params as in `parseScreenParams` |
| `GET /api/oi-tracker/strategies` | Candidates (`tol`, `minLeg`, plus screen filters; top 500) |
| `GET /api/oi-tracker/stock/[symbol]` | Modal data: contracts (≤2,000), per-expiry / per-strike / per-date aggregates, full OI per expiry, strategies, live Alpaca chain (volume, IV, Δ, bid/ask, top 100 by live volume), quote |
| `GET, POST /api/oi-tracker/tracked` | The user's own positions with performance / add legs |
| `PATCH, DELETE /api/oi-tracker/tracked/[id]` | Edit qty / entry / note, close (`close: {date?, price?}`), reopen; delete (`?group=1` deletes the whole strategy) |
| `GET /api/oi-tracker/tracked/[id]/history` | Daily P&L series |

## UI

**`app/oi-tracker/page.tsx`** has four tabs:
- **OI flow:** contracts, or grouped by stock + expiry, stock + strike, or trade date.
- **By stock**
- **Strategies:** tolerance slider and minimum leg size.
- **My tracked**

Controls: a period card (load date, range 1/5/10/20/60 loads or custom), the filters above, "Rank by" and a row limit. KPI cards show contracts changed, opened, closed, net, call vs put $, and volume (with capture coverage).

**`components/oi/DataTable.tsx`** is a reusable table used by every tab and the modal:
- sorting
- a filter popover on every column: text "contains" (comma = either); numeric min/max, which accepts `1.5m`, `2b`, `750k`; date from/to
- global search, CSV export, "show more" paging

**`components/oi/StockOiModal.tsx`** opens when a stock row is clicked.
- Tabs:
  - **Contracts:** sorted by volume descending by default, with live volume, IV, Δ and bid/ask when available.
  - **Strike ladder:** calls left, puts right, OI-change bars, the strike nearest the close highlighted.
  - **Expiries:** including total OI from the levels table.
  - **Timeline:** opened/closed per day.
  - **Strategies**
  - **Live volume:** top 100 contracts by the latest session's volume, with the change against the previous session.
- A contract row opens the existing `OptionContractModal` (OI history and bars).
- "Track" opens `TrackForm` (`components/oi/oiShared.tsx`).

**Header:** "📊 Trackers" dropdown on desktop (Earnings + Options OI Tracker), separate items in the mobile menu.

## Rollout

1. `node --env-file=.env.local scripts/bootstrap-oi-tracker.mjs`. Done on 2026-10-15; the tables exist in the shared Neon DB.
2. Deploy. The market-catalog cron starts capturing volume for each new load.
3. **Tick "Options OI Tracker" for Pro and Expert in `/admin/plans`.** The seed in `scripts/bootstrap-app-tables.mjs` only applies to new databases. Until this is done, everyone except admins with overrides is sent to `/upgrade`.
4. Optional: backfill volume, e.g. `scripts/backfill-option-volume.mjs --from 2026-09-01`. Measured: 63s for one load date (13,366 contracts, ~4.7 ms per contract). Sep 1 – Oct 9 (29 loads, ~355k contracts) is about 28 minutes.

## Operations

```sql
-- Volume capture coverage per session
SELECT bar_date, COUNT(*), SUM(no_trade::int) AS no_trade, MAX(fetched_at)
FROM nt_opt_daily_bars GROUP BY 1 ORDER BY 1 DESC LIMIT 10;

-- Lease stuck?
SELECT * FROM nt_job_lease WHERE name = 'oi_volume';
```

The cron response includes `optionVolume: { loadDate, session, pendingBefore, stored, noTrade, failed, done }`.

## Follow-ups

- Confirm what `ltp` is (an intraday snapshot?) with the loader's owner. If it isn't the close, consider using the captured bar close for $ values.
- Ranges spanning 2026-10-06 split index weeklies and adjusted contracts into two keys (see above).
- Volume exists only for captured sessions (10-09 through 10-14 so far); older days show "—" until backfilled.
- The page was not checked in a browser as a signed-in Pro user (see CHANGES.md).
