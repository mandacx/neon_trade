# Stock page tabs and the Option Strategy Builder

Design and runbook for the stock page tabs and the optionstrat-style
Strategy Builder in the **Option Chain** tab (Pro feature `strategy_builder`; `option_chain` alone gives the plain chain without the builder).
The maths is a TypeScript port of the `options-alert-lab` payoff lab
(`backend/app/payoff.py`, `backend/app/engine/strategies.py`).

## Tabs

`components/stock/StockAnalysis.tsx` renders four tabs under the quote, Analysis box and expiry selector (passed to `TVChart` as `afterHeader`). The tab bar is `components/ui/Tabs.tsx` (solid boxes, one light colour per tab via `tone`, a darker fill of that colour for the selected one).

| Tab (`?tab=`) | Component | Data |
|---|---|---|
| Chart & Price Levels (`levels`, default) | the chart, then `components/stock/tabs/PriceLevelsTab.tsx` | `/levels?range=true` (fetch stays in `StockAnalysis`; it reuses the chart's levels when they cover the range) |
| Open Interest (`oi`) | `components/stock/tabs/OpenInterestTab.tsx`; sub-views OI changes / Live volume (`/api/oi-tracker/live/[symbol]`, feature `oi_tracker`, fetched when opened, 30 s shared cache) | `/opt-chain?loads=N` (last N trading days, 1D default) for the strike ladder (selected expiry) and the contract table beside it; `expiry=all` only when the table is switched to all expiries; `OiTrendModal` reads `/levels?range=true` only when its button is clicked |
| Option Chain (`chain`) | `components/stock/tabs/OptionChainTab.tsx`: chain on the left third (mirrored, selectable columns `stockChain`, sides scroll together), builder on the right with a hover explainer (`StrategyInfo`) | `/api/stocks/[symbol]/chain` (live chain) |
| Earnings (`earnings`) | `EarningsHistoryTable` | `/earnings` (already fetched for the chart markers) |

- **Lazy loading.** A tab mounts, and fetches, the first time it is opened, then stays mounted (`hidden`).
  - Opening a stock no longer requests `/opt-chain`.
  - The Price Levels fetch is gated on the tab having been visited, and it is the default tab.
- **The open tab is kept in `?tab=`.** It is written with `history.replaceState` and read once on mount. The page doesn't use `useSearchParams`, so the embedded chart (`/watchlists/view`) needs no Suspense boundary.
- **The chart lives in the first tab.** The other tabs keep the header (quote, expiry selector, which they depend on) and hide the chart (`chartHidden`). It is hidden, not unmounted: a remount re-fits the view and fires a load-more (an extra `ohlc` and a rate-limited `levels` call) on every switch back.
- **`embedded` mode** renders no tabs.
- **Contract chart.** Clicking a strike in the OI tab or the chain opens `OptionContractModal`. Its chart (`OptionContractChart`) shows candles and the underlying line, plus two histogram bands: OI change per session (green for opened, red for closed) and volume.

## Live chain API

`GET /api/stocks/[symbol]/chain?expiry=YYYY-MM-DD`

- **Gate:** `strategy_builder` or `option_chain`. It returns 401 when signed out and 403 with neither. `enabledStrategies` is only filled for `strategy_builder` (empty for chain-only users).
  - Weekly expiries are refused for `standard_expiry_only` plans (`WEEKLY_EXPIRY_ERROR`).
  - Past expiries get a 400.
- **Rate limit:** limiter `option_chain`, 30 requests a minute per user by default, editable at `/admin/settings`.
- **Data:**
  - The chain comes from `getOptionChainSnapshots(symbol, {expiry, expiry})`, grouped by OCC root (`lib/occ.ts`); the root with the most contracts wins.
  - If an index chain is empty, the route retries under the index's weekly root (`SPX→SPXW`, `NDX→NDXP`, `RUT→RUTW`, `VIX→VIXW`). Verified 2026-10-28: SPX returns nothing for the 10-30 weekly and SPXW returns 974 contracts.
  - Spot is the session-aware regular price (`lib/quote.ts`), falling back to the fallback feed's quote for indices.
  - Results are cached in memory for 15 s per symbol and expiry.
- **Response:** `{ data: { symbol, root, expiry, spot, asOf, rows: [{ strike, call?, put? }] }, enabledStrategies }`.
  - Each side is `{ bid, ask, mid, last, iv, delta, gamma, theta, vega, vol }`.
  - `mid` is (bid+ask)/2 when the quote is sane, otherwise `last`.
  - No vendor names appear.
- **Refreshing:** the client loads each expiry once and re-requests only when the user clicks **Refresh quotes**. There is no timer. A refresh keeps the legs, re-prices them at the new mids, and shows the old price struck through.

## Payoff engine (`lib/payoff/`, pure, runs in the browser)

| File | What |
|---|---|
| `bs.ts` | Black-76 on the forward (`black76`), bisection IV (`impliedVol`), and model greeks (used only when the chain has none) |
| `carry.ts` | `fitCarry`: regress C−P on K over strikes within ±15% of spot to get `disc` (−slope) and `basis` (F/S). It needs at least 4 strikes and falls back to (1, 1) outside the bands disc 0.85–1.05 and basis 0.8–1.3. `legCarry` rescales to any τ. |
| `chain.ts` | `buildCtx` (strike lists, mids, carry, ATM IV, T to 16:00 ET of the expiry), `priceLeg` / `repriceLegs`, `resolveTemplate` |
| `evaluate.ts` | `valueAt` (each leg priced at its own remaining τ, so calendars and diagonals work), `analyze`, `curve`, `heatmap`, `probProfit` |
| `strategies.ts` | the 45 templates |
| `glossary.ts` | the hover text used by `<Term>` |

**Calibration.** Each option leg stores `ivPx`, the vol that reproduces its own mid through the carry-aware model. The position therefore marks at exactly its entry cost: there is no phantom P&L at entry, which the fixtures test.

**Metrics** (`analyze`) are taken at the nearest leg's expiry:
- **Max profit / max loss** are taken over a price grid from 0 to 3×spot that includes every strike.
- **Unbounded** is judged from the slope between 5× and 10× spot.
- **Breakevens** are zero crossings, kept only within ¼× to 2× spot. Far out, a calendar's long leg drifts with the fitted carry and can cross zero at meaningless prices; this was seen live.
- **POP** integrates a risk-neutral lognormal at the ATM IV over the profitable slabs.
- **Est. capital** is max(|max loss|, debit), shown as "≥" when the loss is unbounded.
- **Greeks** are the chain's greeks Σ qty·100, plus 100 delta per stock lot.

**Scenarios:**
- A date slider runs from today to the nearest expiry.
- The IV shift adds vol points to every leg.
- The price range is Auto (fits every strike and breakeven) or ±5% to ±50%.
- The P&L table (price × date) can show $, %, % of max risk or position value.

**Not modelled:** commissions, early exercise, dividends beyond what the quotes imply through the carry fit, and spot-vol skew (the lab's `SPOT_VOL_BETA` is used only by its forecast feature, not the editor).

## Templates (`lib/payoff/strategies.ts`)

There are 45 templates in four views:

| View | Count |
|---|---|
| Bullish | 9 |
| Bearish | 6 |
| Neutral | 17 |
| Volatile | 13 |

Leg recipes are the lab's. Strike rules:
- `atm` is the listed strike nearest spot.
- `steps` moves by n *listed* strikes.
- `call_high` / `put_low` anchor on this app's Call High / Put Low levels for the selected expiry. They fall back to spot ±10% when the expiry has no level.
  - **Near the money when worthless:** when the anchored option's mid is below `minAnchorPremium` (the larger of $0.05 and 0.1% of spot), the anchor walks toward the money until an option has that premium. It never crosses spot.
  - Wing legs (`steps`) keep their spacing from the moved anchor.
  - The result carries `notes`, shown in the explainer and under the position.
  - Near expiry, the levels can sit where every option is ~$0.
- `far` legs use the next listed expiry after the selected one. That chain is fetched only when such a strategy is picked or a leg is moved to it.

Users reach a template either **by view** (cards priced from the chain, with a sparkline) or from **All strategies** (searchable, grouped by structure).

## Admin: enable or disable strategies

- `/admin/settings` has a "Strategy builder: available strategies" card (`components/admin/StrategySettingsEditor.tsx`).
- It saves through `PUT /api/admin/settings/strategies` into `nt_app_settings` under the key `strategy_templates` = `{ disabled: id[] }`.
- `lib/strategySettings.ts` validates the ids and caches the setting for 30 s per instance.
- Users receive the enabled ids with each chain response. A disabled template disappears from both the cards and the list; building legs by hand is always allowed.

## Gating and plans

Two feature codes, both ticked per plan at `/admin/plans` (plans live in the DB; no plan has either until then):

| Feature | Label in `ALL_FEATURES` | Option Chain tab shows |
|---|---|---|
| `strategy_builder` | "Option Strategy Builder (includes the live chain)" | chain on the left third, builder on the right; bid/ask clicks add legs |
| `option_chain` | "Live Option Chain" | the plain chain at full width (centred, capped at its column width), bid/ask as plain numbers, the chart cell, Refresh quotes, and a one-line link to the builder upgrade |
| neither | | a teaser with Sign in / Upgrade; nothing is fetched |

Both use the same `/chain` route, rate limiter (`option_chain`) and cache.

## Tests

`node scripts/test-payoff.mjs` covers:
- Black-Scholes reference values and put-call parity under carry
- IV round trip
- carry fit and refusal
- DST-aware expiry close
- every template resolving
- no phantom P&L at entry
- bull call spread, iron condor, covered call and calendar metrics
- IV shift
- the heatmap
- quote-refresh bookkeeping

## Follow-ups

- "Track this strategy": save built legs to the private `nt_oi_tracked` positions (`TrackForm`, `lib/oiTracked.ts`).
- Spot-vol skew in scenarios (the lab's `spot_vol_mult`).
- Chain open interest per strike: the snapshots carry none, so it would need the OI report joined in.
