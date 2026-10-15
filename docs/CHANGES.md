# Change log and design notes

Running record of what was changed and why, newest first. **Read this before
starting any change, and append to it as part of every change** (see the
"Working rules" section of `CLAUDE.md`). Record only what was verified; mark
anything not tested as *unverified*.

---

## 2026-10-15 — Stock chart: candles fit the window, narrower candles, level lines break at data gaps

Reported: candle height should improve and candle width should be reduced. Plot candles by each day's range
compared with the other days, so they fit the window, rather than letting every price level set the scale.

### Cause (verified in code and in a browser)

- **Level lines set the scale.** The five level lines (`call_high` … `put_low`) were line series on the candles'
  right price scale, so autoscale stretched to include them. On AAPL the candles spanned about $305–345 while
  the scale ran $240–400 to fit Put Low 251 / Call High 361, leaving the candles about a third of the height.
- **Volume shared the candle area.** Candles used the default scale margins and overlapped the 20% volume band.
- **Candle width came from `fitContent()`.** It stretched the initially loaded bars (about two months of daily
  bars) across the full width, so candles were about 25px wide.
- **Lines bridged gaps.** An expiry's level/OI history is often sparse. lightweight-charts 4.2.3 draws a straight
  line across such gaps; whitespace points don't break it (tested in isolation), and the curved style even
  draws loops at the gap edges.

### What changed (`components/charts/TVChart.tsx`)

- **Scale follows the candles.** Level series get `autoscaleInfoProvider` returning null unless a new
  **"Fit levels"** toggle (next to Price/OI) is on.
  - The price scale fits the visible candles' high/low only.
  - Levels outside that range are off-screen; the level chips below the chart still list them with % distance.
- **Candle area.** Right price scale margins are `top 0.06, bottom 0.24`, so candles sit above the volume band.
- **Width cap.** `fitBarsCapped()` replaces `fitContent()` on initial load and on "ALL": at most 8px per bar.
  - A shorter history is drawn right-aligned at that spacing.
  - The empty space on the left triggers the existing load-more, which fills it with older bars.
  - The period buttons (1W, 1M, …) are unchanged.
- **Lines break at gaps.** `breakAtGaps()` makes the point before a gap transparent, because a segment takes its
  starting point's colour. Level and OI lines now use the step style instead of curved, since they are daily values.

### Verified

- Playwright, production build, before and after screenshots of `/stock/AAPL`, `/stock/NVDA` (1440px) and
  `/stock/SPY` (1280px):
  - Candles fill the chart height and are narrow (load-more brought in history back to March).
  - Level lines no longer cross the chart.
  - "Fit levels" widens the scale to include Call High / Put Low.
  - No page errors.
- The transparent-segment technique was checked against lightweight-charts 4.2.3 in an isolated page.
- `tsc` and `npm run build` pass; eslint reports 0 errors on the file.

### Not verified

- The embedded chart on `/watchlists/view` (needs a login) and intraday intervals were not viewed; they use the
  same code.
- Mobile widths were not checked.

---

## 2026-10-15 — Escape closes only the top modal; volume backfill estimate

Requested: fix stacked modals both closing on Escape, and estimate the volume backfill from Sep 1.

### What changed

`components/ui/Modal.tsx` keeps a module-level stack of open modals. Escape now closes only the top one.
- `onClose` is read through a ref and the effect runs once per mount.
- Before this, the effect re-subscribed on every render because callers pass inline functions. With a stack, that re-subscribing would also reorder it.

This applies to every `Modal` user. A single modal behaves as before.

### Verified

- Playwright (Chromium) on a temporary page (deleted afterwards), with modal B opened from inside modal A:
  - Escape closes B and A stays open; a second Escape closes A.
  - After the parent re-renders while both are open, Escape still closes B first.
- `tsc`, eslint and `npm run build` pass.
- Not checked in the OI modal itself (that needs a Pro login).

### Backfill estimate (measured)

- `scripts/backfill-option-volume.mjs` for the 2026-10-12 load (13,366 contracts) took 62.9s, about 4.7 ms per contract. That date is now filled.
- Remaining from 2026-09-01: 29 load dates, about 355k contracts, so roughly **28 minutes** (allow 25–35). Run it as `--from 2026-09-01 --to 2026-10-09`.
- Loads before 10-06 use derived OCC keys, so SPX/NDX weekly contracts there will mostly come back `no_trade`.
- Not verified: Alpaca throttling over a run that long. The script retries a 429 up to 5 times with backoff.

---

## 2026-10-15 — Options OI Tracker (`/oi-tracker`, Pro feature `oi_tracker`)

Requested: a page that tracks stocks by open interest (OI) and by OI change, both up and down. It should cover:
- huge volume and huge positions opened or closed
- views by expiry, by date, by strike and cumulatively
- $ size (OI × 100 × price) in billions / millions / thousands
- trade dates filtered or aggregated

Clicking a stock should open an OI modal sorted by volume, with column filters and search. Users should be able to track contracts (buy to open or sell to open) from the date added and see their P&L. Where legs' quantities are nearly identical (2–3%), the page should suggest a possible strategy.

Decisions made with the user:
- Volume comes from a daily capture plus live data in the modal.
- $ values use the report's `ltp`.
- It is a new Pro feature.
- The user picks BTO/STO, with a hint shown.
- Positions are private per user. The user added: visible to others only if made public, through a future feature like trade social / follow the board. So a `visibility` column is reserved and always set to `private`.

Full design: **`docs/oi-tracker.md`**.

### Data findings (verified live)

- `us_opt_chg_rpt` is a change report: only rows with |oi_chg| ≥ 101, and **no volume column**. Nothing in the app ranked OI change before this.
- **OCC `symbol` is null for every load before 2026-10-06.** Contracts are keyed by the real symbol, or by one derived from underlying, expiry, type and strike (`occSql`). The derived key matches the real one on 94.5% of rows; the mismatches are SPXW/NDXP and adjusted roots such as LEN1, which since 10-06 coexist with the standard contract at the same strike (72 such pairs on 10-15).
- **OI change on load D reflects the session before D.** On the 10-15 load, 1,785 of 1,796 increases of ≥ 1,000 had previous-session volume of at least 95% of the change. For decreases it was 352 of 486 (exercise and assignment close OI without a trade).
- `ltp` does not match the Tradier close or prevclose for the sample checked (WMT 120C: 2.32 against 2.98 / 1.64). Its meaning is **unverified**.
- Alpaca option bars accept 200 symbols per call (~2.7s uncached; limit 200 requests/min) and refuse the current day. Option snapshots cap at 100 symbols.

### What changed

| Area | Files |
|---|---|
| Tables `nt_opt_daily_bars`, `nt_oi_tracked`, lease row `oi_volume` (DDL run on the live DB) | `scripts/bootstrap-oi-tracker.mjs` (new); migrate lists in `scripts/migrate/copy-public-data.mjs`, `scripts/migrate/migrate.sh` |
| Feature code | `lib/features.ts` (`FEATURE_OI_TRACKER`), seed in `scripts/bootstrap-app-tables.mjs` (Pro and Expert) |
| Volume capture, run by the market-catalog cron after the catalog step | `lib/optionVolume.ts` (new), `app/api/cron/market-catalog/route.ts`, `scripts/backfill-option-volume.mjs` (new) |
| Shared lease helper (earnings now uses it; same SQL) | `lib/jobLease.ts` (new), `lib/earnings.ts` |
| Alpaca helpers | `getOptionBarsMulti`, `getOptionSnapshotsMulti`, `getOptionChainSnapshots` in `lib/alpaca.ts` |
| Calendar for any range | `tradingDaysBetween`, `previousTradingDay` in `lib/marketSession.ts` |
| Screen / grouping / stock queries | `lib/oiTracker.ts` (new), `types/oiTracker.ts` (new) |
| Strategy candidates and side hint (pure) | `lib/oiStrategies.ts` (new), `scripts/test-oi-strategies.mjs` (new fixtures) |
| Private tracking + P&L | `lib/oiTracked.ts` (new) |
| API | `app/api/oi-tracker/{meta,screen,strategies,stock/[symbol],tracked,tracked/[id],tracked/[id]/history}`, `lib/oiTrackerApi.ts` (guard, rate limit, param parsing) |
| Page + components | `app/oi-tracker/{layout,page}.tsx`, `components/oi/{DataTable,StockOiModal,TrackedPanel,oiShared}.tsx`, `lib/format.ts` |
| Gating / nav | `middleware.ts` (matcher), `components/layout/Header.tsx` |

**Header change.** On desktop, Earnings and OI Tracker now share one "📊 Trackers" dropdown; the mobile menu lists both separately.
- Measured with Playwright before the change: the home page already overflowed horizontally by 39px at 1280px.
- A separate OI button pushed that to 184px at 1280 and 141px at 1366.
- With the dropdown (and its PRO tags on the items, not the button): 21px at 1280, 0 at 1366 and above.
- Earnings is now one click deeper on desktop.

### Verified

- **Volume capture:**
  - Backfilled loads 10-13, 10-14 and 10-15: 43,647 contract-days, about 1% `no_trade`.
  - With six parallel requests one cron-sized run stored 12,000 of 12,809 contracts in 46s; the next finished the rest in 6s.
  - `GET /api/cron/market-catalog?force=true` on the production build returned the catalog result plus `optionVolume: { done: true }`.
- **`getOiScreen` on the live DB:**
  - 1 load: 0.25–0.8s for every grouping.
  - 20 loads: ~2.2s for contracts, ~2.0–2.3s grouped.
  - 60 loads grouped: 5.7–6.8s.
  - 60 loads per contract took 12.6s, hence the 20-load cap for the market-wide contract view.
  - A combined filter (opened, $1M–1B, monthly, OTM puts, Technology) returned 143 contracts in 0.4s.
- **Strategies:** `node scripts/test-oi-strategies.mjs` passes. It covers every pattern, near-misses at 3.5% against tolerances of 3% and 4%, minimum leg size, per-underlying grouping, one use per leg, `suggestSide` and `expiryKind`. The live 10-15 load gives 964 candidates; the top one is APO with put legs of 10,002 and 10,000.
- **Tracking:** exercised through the lib against the live DB with two test user ids; all test rows were deleted afterwards.
  - Today's entry used the live mid, and a 10-13 entry used the 10-13 bar close (1.64, matching the bar).
  - P&L sign is correct for BTO and STO.
  - An expired AAPL call was valued at intrinsic 0.
  - A two-leg group's history sums its legs (last point equals the two P&L figures).
  - Close and reopen work.
  - Rejected: an unknown contract, a bad side, qty 0, a future date.
  - **Privacy:** user B listing, reading, editing, deleting, group-deleting and fetching history on user A's ids all returned nothing or 404, and A's row was unchanged.
- **Build checks:** `npx tsc --noEmit` passes, and eslint reports 0 errors (`any` warnings only, as elsewhere). `npm run build` passes.
- **Production server, signed out:** `/oi-tracker` redirects to `/login?redirect=%2Foi-tracker`, and all seven API routes (GET, POST, DELETE) return 401. The Trackers dropdown opens and navigates (Chromium).

### Not verified

- **The page, the modal, the column filters, the track form and the My-tracked tab were not seen in a browser.** They need a signed-in account with the feature, and no test credentials were available. The API routes were not called as a signed-in user over HTTP; their lib functions were.
- The live Alpaca chain in the modal (`getOptionChainSnapshots`) was only probed manually (WMT); SPX/NDX chains are unknown.
- The pre-market and early-morning behaviour of the live mid used for today's entry price.
- A full-month backfill (time and rate limits).
- What `ltp` is (see above).
- Pre-existing, not changed: the home page still overflows by 21px at exactly 1280px.

### Follow-ups

- **Rollout step:** tick "Options OI Tracker" for Pro (and Expert) in `/admin/plans`; the seed only covers new databases.
- Optionally backfill volume for older loads (`scripts/backfill-option-volume.mjs --from …`).
- ~~Two stacked modals both close on Escape.~~ Fixed in the next entry.
- A future social feature can expose `visibility = 'public'` positions through its own read path; nothing reads that column today.

---

## 2026-10-14 — Session-aware quotes: live / pre-market / after-hours / closed

Requested: update quotes live or after hours according to the market's opening times, and show the
after-hours change together with the day's closing change until the next market open, on the stock chart and
other places as applicable.

### What the data gives (verified live, after the close)

- IEX snapshot: `dailyBar` is the **regular session only** (SPY close 769.65 while a 16:47 ET print was 768.84);
  `latestTrade` includes extended-hours prints (condition code `T`); `prevDailyBar` is the session before.
- Before this change the stock header used `latestTrade.p` against `prevDailyBar.c`, so after hours the badge
  blended the after-hours move into the day change, while the watchlist routes used `dailyBar.c`. They disagreed.
- IEX only sees part of extended-hours volume: SPY, TSLA, META, QQQ had after-hours prints, AAPL/NVDA/MSFT/PGR did
  not. SIP (consolidated) is refused by this plan (403), so a name with no print simply has no after-hours figure.
- The Alpaca trading calendar works with the existing keys (`/v2/calendar`, `/v2/clock`) and carries holidays,
  early closes (13:00) and the extended window (`session_open` 0400 / `session_close` 2000, or 1700 on early closes).

### What changed

| Area | Files |
|---|---|
| Market state from the calendar (pre / regular / post / closed, next change); weekday fallback if the call fails | `lib/marketSession.ts` (new) |
| Snapshot -> quote: regular price + day change, plus `ext` (after-hours / pre-market move from the regular close) | `lib/quote.ts` (new); `snapshotQuote` removed from `lib/alpaca.ts` |
| Polling cadence from the session (regular 10-30s, pre/post 30-60s, closed: sleep to the next boundary, max 15 min) | `lib/pollDelay.ts` (new) |
| Routes return `ext` + `market: { session, nextChangeAt }` | `app/api/stocks/[symbol]/quote`, `app/api/watchlists/[id]/quotes`, `app/api/market/indices` (now snapshot-based), `app/api/earnings/list`, `app/api/home/earnings` |
| Display | `components/ui/ExtendedMove.tsx` (new): stock header, collapsed bar, watchlists (new "Ext. Hrs" column, only while a row has a print), W Chart (same), header indices strip (AH/Pre pill), home earnings cards, earnings page |
| Stock chart | `components/charts/TVChart.tsx`: "Live" only in the regular session, "At close" otherwise; the extended-hours line under the day change; the last candle follows ticks in the regular session (and the daily candle always), never an intraday bar outside it |
| Polling | `StockAnalysis` (quote), `app/watchlists/page.tsx` (new: it did not refresh before), `app/watchlists/view/page.tsx`, `IndicesStrip` |

Semantics: **price / change / change %** are always the regular session (live while open, the last close after
it); **After hours / Pre-market** is shown separately as the last IEX print versus that regular close, from the
close until the next regular open (overnight, weekends and holidays included), then it disappears.

### Verified

- Session math against the real calendar at fixed instants: 04:00 / 09:29:59 / 09:30 / 16:00 / 20:00 ET
  boundaries, a Saturday, Thanksgiving, the 2026-11-27 early close (post-market until 17:00) and the first
  Monday after DST ends; `etDateOf` across midnight.
- `buildQuote` on the live snapshots: SPY close 769.65, -8.38 (-1.08%), after hours 768.84 -0.81 (-0.11%); META and
  TSLA likewise; AAPL/PGR no after-hours print. The same snapshot treated as in-session gives the live price and
  no `ext`.
- Production build, public routes over HTTP: `/api/stocks/{SPY,TSLA,AAPL}/quote` and `/api/market/indices`
  return `ext` and `market.session = closed`, `nextChangeAt = 08:00Z` (04:00 ET).
- Browser (Playwright, Chromium): `/stock/SPY` and `/stock/TSLA` headers show "AT CLOSE", the day change and
  the "After hours $768.84 -$0.81 (-0.11%) 4:47 PM ET" line; the indices strip shows AH pills; no page errors.
- Polling cadence with a fake clock: closed = one request, none for 10 minutes, the next at the 15-minute cap;
  with the quote response mocked to `regular` the page polls every 10 s and shows "Live"; mocked `post`, every
  ~30 s and no "Live".
- `tsc`, eslint (0 errors) and `npm run build` pass.

### Not verified

- **Pre-market behaviour of the snapshot.** It was not possible to observe the 04:00-09:30 ET window: whether
  Alpaca rolls `dailyBar` to the new day on the first pre-market print is unknown. `buildQuote` handles it
  defensively (if `dailyBar` is dated after the last regular session it uses `prevDailyBar` as the regular
  close and reports no day change for that name), but that branch is untested.
- The watchlist pages, home cards and earnings page after hours were not seen in a browser (they need a login
  or a Pro account); their routes and types are checked, the shared pill is what the screenshots exercised.
- The 10 s regular-session poll was exercised with a mocked session, not during a live session. The calendar
  call has not been seen failing (the weekday fallback is untested).
- Not covered: the home page's top-movers / Top OI (public, CDN-cached route), the quadrant, scan-alert tickers
  and Telegram; the earnings page quotes are a snapshot at load (no refresh); the stock chart's intraday bars
  are whatever Alpaca returns (extended-hours bars appear only if IEX had prints).
- Levels still rebase onto the regular price, not the extended-hours price (deliberate).
- New optional env var `ALPACA_TRADING_URL` (default `https://paper-api.alpaca.markets`) for the calendar host.

---

## 2026-10-14 — Fix: "Object is disposed" client errors on the admin dashboard

Reported: errors showing in the admin dashboard's Errors panel.

### What the log held (live `nt_activity_events`, `event_type` = error_*)

74 events since 2026-10-09: 73 are `Object is disposed` (63 `Uncaught Error:` from `window.onerror`, 10 `Error:`
from `unhandledrejection`), logged on `/`, `/login`, `/admin`, `/quadrant`, `/watchlists/view` and `/stock/*`
(the logged path is the page the user had just navigated *to*). One is `TypeError: Load failed` (a failed
fetch in Safari; not actionable). The tracker stores only the message, so there was no stack.

### Cause (reproduced)

Playwright against a local production build: open `/stock/META`, then client-side navigate to `/`. The page
threw `Error: Object is disposed` from a `lightweight-charts` `requestAnimationFrame` paint (the message comes
from the library's canvas binding, `fancy-canvas` `DevicePixelContentBoxBinding`, once its canvas is disposed).
In `TVChart`, the chart-creation effect's cleanup called `chart.remove()` but left `candleSeriesRef` etc.
pointing at the removed series. React runs cleanups in declaration order, so the price-line effect's cleanup
then called `candleSeriesRef.current.removePriceLine()` on the removed chart, which schedules a repaint on the
disposed canvas. `OptionContractChart` already nulled its refs and was not affected.

### What changed

- `components/charts/TVChart.tsx`: the chart effect's cleanup now nulls `chartRef` and every series ref, and
  empties `priceLineRefs`, before `chart.remove()`.

### Verified

- Before: `/stock/META` -> `/` threw the error (stack in lightweight-charts only, from a rAF callback).
- After (rebuilt production server, Playwright, Chromium): 0 page errors for stock -> stock (symbol switch),
  stock -> `/`, and stock -> `/login`. `npm run build` passes.

### Not verified

- The 10 `Error: Object is disposed` rejections (`unhandledrejection`) may come from a different path; nothing
  here shows they share the cause. Watch whether the count keeps growing after deploy.
- Only Chromium was run (older log entries include Safari user agents, not checked); the fix is browser-independent
  but WebKit was not tested. `/watchlists/view` (embedded chart) was not exercised separately.
- Existing entries stay in the table; the panel counts the last N days, so it clears on its own.

### Also: short stack on error events

So the next error is diagnosable, error events now carry the first 6 stack frames.

- `components/providers/ActivityTracker.tsx`: `shortStack()` (from `e.error` / `e.reason` when they are `Error`s;
  origin stripped, handles Chrome `at fn (url)` and Safari/Firefox `fn@url`; max 1,200 chars) sent as `stack`.
- `app/api/track/route.ts`: accepts `stack`. `lib/activity.ts`: new `stack TEXT` column
  (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` inside `ensureTable()`, so no separate migration), stored clipped to
  1,500 chars, returned on `ErrorRow`. `app/admin/page.tsx`: the Errors panel shows a collapsible "stack" under the message.
- Not shown in the Errors drill-down modal or the user/session history modals (they render plain message text); the
  column is there if you want it added.
- Verified: a local production build with a normal Chrome user agent posted an uncaught error and a rejection;
  both rows stored with their frames, a non-Error rejection (`Promise.reject('text')`) stored `stack` = null, and
  `getActivitySummary()` returns the field. The three test rows were deleted. The `stack` column now exists in the
  live database (the local run used `.env.local`, which points at the same Neon DB; the DDL is additive).
- Not verified: the dashboard panel rendering in a browser (admin session needed). Stack frames from minified
  production chunks are not source-mapped, so they name chunk files and positions, not functions.

---

## 2026-10-14 — Fix: "Delayed" badge missing on watchlists levels

### Cause (verified in code)

`app/api/watchlists/[id]/levels/route.ts` put `levelAccess` / `requiredFeature` only in the top-level
`data` (via `...gate.meta`), while both consumers (`app/watchlists/page.tsx`, `app/watchlists/view/page.tsx`)
use only `data.rows` and `LevelCell` reads `level.levelAccess` / `level.requiredFeature` off each row.
So for a viewer without the live-levels feature, `levelAccess` was `undefined` and the cell rendered "—"
instead of the amber "Delayed" upgrade link.

### What changed

- The route now adds `levelAccess` and `requiredFeature` to every row (the top-level fields are kept).

### Verified / not verified

- `npx tsc --noEmit` and `npm run build` pass.
- *Not verified:* no browser check as a viewer without the levels feature; the route was not called over HTTP.

---

## 2026-10-14 — Earnings page, and LTP / change on the home earnings cards

Requested: add LTP, change $ and % to the home earnings "modals"; a new earnings-only page with filters
and extra detail to analyse results and growth for the next/past 1, 3, 5, 7, 10, 15, 30, 60, 90 days and
custom dates, one ticker per line, row click opens the stock chart in a new tab; plus levels for the
nearest monthly expiry (rebased on LTP, as on the watchlists page) for every stock with price levels.
*Interpretations (unverified with the user):* "modals" = the "Earnings This Week" / "Just Reported" cards on
the home page (there is no modal there); "growth" = price reaction to the report and the move since it.

### What changed

| Area | Files |
|---|---|
| Home cards: each row shows LTP, change $ and change %; "View all" links | `app/api/home/earnings/route.ts` (Alpaca snapshots for the ~20 shown symbols), `app/page.tsx` |
| Earnings page `/earnings` (Pro, `earnings` feature) | `app/earnings/page.tsx`, `app/earnings/layout.tsx`, `middleware.ts` (matcher), `components/layout/Header.tsx` (desktop + mobile link) |
| List API | `app/api/earnings/list/route.ts` |
| Levels API (all tracked symbols at one monthly expiry) | `app/api/earnings/levels/route.ts` |
| Range reader | `getEarningsRange()` in `lib/earnings.ts`, `EarningsRangeRow` in `types/earnings.ts` |
| Price reaction (pure) | `lib/earningsReaction.ts` |
| Alpaca helpers | `snapshotQuote`, `getSnapshotsChunked`, `getDailyBarsMulti` in `lib/alpaca.ts` |

Design and definitions: `docs/earnings.md` ("Earnings page"); the `CLAUDE.md` route list is updated.

### Verified

- `npx tsc --noEmit` and `npm run build` pass; eslint reports 0 errors on the touched files.
- Against the live DB and Alpaca (the real lib functions, no HTTP layer): `getEarningsRange` for upcoming 7d
  (57 rows: 51 upcoming + 6 reported today), reported 7d (15) and a 120-day span (1,031); snapshots, multi-symbol
  daily bars and the reaction maths on real reports (ASML, PGR, STT, MS, FAST: the reaction equals the
  close-to-close move computed by hand from the bars; every past event got a quote and a reaction);
  levels at the next monthly expiry for 633/633 tracked symbols, and rebasing on LTP.
- Heaviest window (90 days each way): 1,098 events, 595 symbols, 37,597 bars in about 11.7 s.
- Production-server smoke test: `/earnings` redirects to `/login?redirect=%2Fearnings`; the three earnings
  API routes return 401 without a session.

### Not verified

- **No browser check** of the page or the home cards (layout, filters, sorting, the new-tab click, the
  `?mode=reported` deep link, 360-1880 px). The routes were not called over HTTP as a signed-in Pro user.
- The Header now has 8 buttons at `xl`; its width was not checked.
- Reaction uses Alpaca IEX daily closes; the DB's `eod_usmkts_price` close was not used because the
  trade_date offset noticed for SPX (see the 2026-10-13 entry) is unresolved. Today's bar is live.
- Upcoming rows show an EPS estimate only (the calendar has no sales estimate).

### Observations / follow-ups

- No caching on the list route; a 60-90 day window takes about 12 s. A short server cache keyed by window would help.
- `/api/watchlists/[id]/levels` did not return per-row `levelAccess`, but `LevelCell` reads it, so viewers
  without live levels saw "—" on watchlists instead of the "Delayed" badge. **Fixed in the next entry.**
- The rebrand left `niftytrendz.com` and `support@neontrade.app` as they were (see the rebrand entry).

---

## 2026-10-14 — Remove "K-line" wording from docs

Requested: drop references to K-line charts from the documentation, since no K-line library is used.

### Verified

- No code imports `klinecharts` / `KLineChart`; `klinecharts` is not in `package.json`. The stock
  chart is `components/charts/TVChart.tsx` on `lightweight-charts`.
- So `CLAUDE.md`'s claim that `klinecharts`/`@klinecharts/pro` are "also present as deps" was stale.

### What changed

- "K-line chart(s)" -> "candlestick chart(s)" in `README.md`, `CLAUDE.md`, `QUICK_START.md`,
  `PROJECT_MASTER_PLAN.md` and the site meta description (`app/layout.tsx`).
- `CLAUDE.md`: removed the `klinecharts`/`@klinecharts/pro` dependency mention.
- `PROJECT_MASTER_PLAN.md`: the planned `KLineChart` component is now `TVChart` (Phase 3 task, component
  sketch, file tree, `charts` stack key); the "shipped as TVChart" note was trimmed.

### Not verified

- `package-lock.json` also has 0 `klinecharts` matches. `tsc`/build not re-run (only docs text and one meta string changed).
- Older entries in this file are history and were not edited.

---

## 2026-10-14 — Rebrand: Neon Trade -> StocksTrendz

Requested: update all branding to StocksTrendz, with a new logo and website as applicable.

### What changed

- **Display name** "Neon Trade" -> "StocksTrendz": page title (`app/layout.tsx`), header logo alt
  (`components/layout/Header.tsx`), login heading, guide page (2 places), Telegram bot replies
  (`app/api/telegram/webhook/route.ts`), a `lib/telegram.ts` comment, the e2e selector
  (`tests/e2e/responsive.spec.ts`), `README.md`, `QUICK_START.md`, `PROJECT_MASTER_PLAN.md`.
- **New logo**: `public/logo.svg` (rising bars + trend arrow icon, "StocksTrendz" wordmark, same
  blue->green gradient) and `public/favicon.svg`. Logo viewBox is now 224x48, so the header image is
  161x34 (was 140x34).
- **npm package name** `neon_trade` -> `stockstrendz` (`package.json`, root entries of `package-lock.json`).

### Deliberately NOT changed

- **Domain `us.niftytrendz.com`** (crons in `railway/*/Dockerfile`, `CLAUDE.md`, `docs/earnings.md`) and
  **`support@neontrade.app`** (`app/upgrade/page.tsx`): live infrastructure / mail; no new domain or
  address was given. Change them together with DNS, Vercel domain and the Railway Dockerfiles.
- **Railway project `neon-trade-crons`** and `railway/package.json` name: renaming through
  `railway config apply` may create a new project rather than rename; do it deliberately.
- **Neon** (the database vendor), `neon_auth`, the sister `neon_nifty` app, `nt_*` table prefix,
  `nn_sid` cookie, and the repo/folder name `neon_trade` (GitHub repo, `cd neon_trade`, tree listings).
- Telegram bot display name/username are set in BotFather, not in code.

### Verified

- `npx tsc --noEmit` passes; no "Neon Trade" text remains outside this file's history.
- New logo rendered to PNG (sharp) and checked visually; the wordmark rendered with a fallback font
  because Inter is not installed locally.

### Not verified

- No browser check of the header at real sizes (360-1880 px) or the favicon in a tab; e2e tests not run.
- The tab title keeps the old tagline "Stock Analysis Platform".

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
