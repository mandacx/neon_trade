# Change log and design notes

Running record of what was changed and why, newest first. **Read this before
starting any change, and append to it as part of every change** (see the
"Working rules" section of `CLAUDE.md`). Record only what was verified; mark
anything not tested as *unverified*.

---

## 2026-10-29 — Option Chain tab: plain chain without the Strategy Builder (new feature `option_chain`)

Requested: when the Strategy Builder is off, the Option Chain tab should still show a simple option chain. The user chose a separate admin-tickable feature for the chain over opening it to all signed-in users or the public (each load costs 1–5 market-data calls).

**What changed**
- **`lib/features.ts`:** new `FEATURE_OPTION_CHAIN = 'option_chain'` ("Live Option Chain"). The builder's label is now "Option Strategy Builder (includes the live chain)". `strategy_builder` still includes the chain, so nothing changes for plans that have it.
- **`app/api/stocks/[symbol]/chain/route.ts`:** allows either feature (401 signed out, 403 with neither, `feature: 'option_chain'` in the 403). `enabledStrategies` is read and sent only with `strategy_builder`; chain-only users get `[]`. Same limiter and cache.
- **`components/stock/tabs/OptionChainTab.tsx`:** new `builder` prop.
  - Without it: the title is "Option chain", the chain card is full width, there's no picker or position, and a line under the header links to `/upgrade?feature=strategy_builder`.
  - `entitled` now means either feature.
- **`components/stock/StockAnalysis.tsx`:** passes `entitled` (either feature) and `builder`. The tab's "Pro" badge hides with either feature.
- **`components/stock/strategy/ChainTable.tsx`:**
  - `onAdd` is optional; without it bid/ask are plain coloured numbers and the hint reads "Click the chart icon…".
  - The table is capped at its own column width and centred (`maxWidth = 2 × side width + strike + gutter`), so a full-width card has no empty bands. In the builder's left third the cap never binds; below `lg`, where the chain card is full width, the table is now centred there too.
- **Docs:** `docs/strategy-builder.md` ("Gating and plans" table, route gate), `CLAUDE.md` (tabs line).

**Verified**
- `npx tsc --noEmit` is clean; eslint on the touched files has 0 errors (the 25 warnings in `StockAnalysis.tsx` are older).
- **Plain chain UI** (temporary dev page rendering the real `OptionChainTab` with `builder={false}`, deleted afterwards; Playwright served `/chain` from the saved AAPL 2026-11-20 fixture; 1440 and 390 px):
  - title "Option chain", no picker, no position, one builder upgrade link;
  - no clickable bid/ask;
  - the chart cell opened 340 call;
  - one chain request on open, one more on Refresh quotes;
  - table centred at 1440 px, 0 px overflow at both widths, no page errors.
- **Route:** 401 signed out; 403 signed in as the owner's account, which (checked read-only) currently has neither feature: no `strategy_builder`/`option_chain` overrides and no plan with `strategy_builder`. The tab correctly shows the teaser there.

**Not verified**
- The route's 200 path for a chain-only user (needs `option_chain` on a plan or a user override; no DB write was made).
- The builder path after this change, in a browser (no account currently has `strategy_builder`). The builder branch's markup is unchanged apart from the `builder` condition around it.

**Follow-up:** tick `option_chain` (and/or `strategy_builder`) for plans at `/admin/plans`.

---

## 2026-10-28 — Strategy Builder: level anchors fall back near the money; live volume ranks only the latest session

Requested: fix the two issues found in the signed-in verification:
- level-anchored strategies fall back to strikes near the money;
- live volume ranks only the latest session.

**What changed**
- **`lib/payoff/chain.ts`:**
  - `resolveTemplate`: a `call_high` / `put_low` anchor whose option mid is below the new `minAnchorPremium(spot)` (the larger of $0.05 and 0.1% of spot) walks toward the money until an option has that premium. It stops at the last strike before spot.
  - Anchors are computed once per expiry + right + anchor, so a condor's wings keep their 1-strike spacing from the moved short strike.
  - `ResolveResult` gains `notes` ("Put Low (176.38) is too far out for 2026-10-30: its puts have no premium, so the strike moved nearer the money to 335.").
  - Templates using level anchors: Short Strangle, Iron Condor, Covered Strangle, Long Strangle.
- **UI:** `OptionChainTab` shows the notes under the position (cleared on manual chain picks and expiry moves); `StrategyInfo` shows them in the hover explainer.
- **`lib/oiLive.ts`:** new `topBySessionVolume(all, n)`.
  - It ranks only contracts whose bar date is the newest one among traded contracts.
  - It returns `session` and `stale`, the count of traded contracts left out.
  - Used by `/api/oi-tracker/live/[symbol]` (top 200) and `/api/oi-tracker/stock/[symbol]` (top 100, popup).
  - `LiveVolumeTable` shows "Top N by volume in the YYYY-MM-DD session … (n last traded earlier, not ranked)".
- **Fixtures (`scripts/test-payoff.mjs`):**
  - New test: on a 2-day chain with 85 / 115 levels (options ~$0), the condor shorts move inside, with ≥ $0.10 premium, 1-strike wings, two notes, a credit and POP > 0.
  - The old condor test assumed an 85 short put worth $0.036 (now correctly moved), so it uses priced levels 90 / 110 ($0.25 / $0.42) and asserts no notes.
- **Docs:** `docs/strategy-builder.md` (strike rules), `docs/oi-tracker.md` (live volume), and the `lib/payoff/strategies.ts` header.

**Verified**
- `node scripts/test-payoff.mjs`: 23 passed. `npx tsc --noEmit` is clean.
- **Live, signed in (dev :3003):**
  - **AAPL 2026-10-30 Iron Condor card:** now Credit $37, POP 63.6%, Max L −$214 (was $0 / 0% / −$500).
    - Explainer and position both show the two notes: Put Low 176.38 → 335, Call High 363.67 → 350.
  - **`/api/oi-tracker/live`** (AAPL, SPY, KO): `session` 2026-10-28; every top row's bar date is 2026-10-28; `stale` 1,507 / 1,932 / 486. The 10-23 `AAPL261030P00170000` row is gone.
  - **The tracker popup route** (`/api/oi-tracker/stock/AAPL`): top 100, all 2026-10-28.
  - **OI tab toolbar:** "Top 200 by volume in the 2026-10-28 session, of 3,192 live contracts (1,507 last traded earlier, not ranked)". No page errors.

**Not verified**
- The other level-anchored templates (Short / Long / Covered Strangle) on a near expiry were only covered by the shared code path and the "every template resolves" fixture.
- During market hours, before most contracts trade, the "latest session" is today and the ranking holds only today's prints. That is intended, not observed.

## 2026-10-28 — Signed-in Pro verification of the stock page tabs, chain and live volume (no code change)

Requested: test what was left unverified:
- the Option Chain tab against the real chain route as a Pro user;
- live volume returning data;
- the OI tracker popup's Live volume tab after the shared-table refactor;
- `npm run test:e2e`.

**How:** Google refuses sign-in in a browser launched by automation. So the user's installed Chrome was started normally (separate scratch profile, `--remote-debugging-port`), and the user signed in themselves. Playwright attached over CDP only to save the localhost session (`storageState`). The tests ran headless with that session against `next dev` on :3003. The account is Pro Plus with both features.

**Results**
- **`npm run test:e2e`:** 470 passed (7.6 min, chromium, `PLAYWRIGHT_BASE_URL=http://localhost:3003`).
- **`/api/stocks/[symbol]/chain`** (signed in):
  - AAPL 2026-11-20: 200, 94 strikes, 0.7 s.
  - SPY 10-30 weekly: 249 strikes, 0.4 s.
  - SPX 10-30: root `SPXW` via the weekly-root retry, 487 strikes, 2.5 s, spot 7743.98 from the fallback quote.
  - `enabledStrategies` 45; no vendor names in the bodies; a past expiry gets 400.
- **Option Chain tab** (`/stock/AAPL?tab=chain`):
  - On open, one `/chain` request (sent twice in dev, StrictMode).
  - 25 strike rows.
  - Hovering Iron Condor showed the A–D recipe; picking it built the position and metrics.
  - **35 s idle: no requests.**
  - **Refresh quotes: exactly one `/chain` request**, and the quote time updated.
  - Calendar Spread fetched the next expiry's chain (`2026-11-04`) once, with legs on 10-30 and 11-04.
  - The chain's chart cell opened `AAPL 2026-10-30 327.5 Call`.
  - No page errors.
- **`/api/oi-tracker/live/[symbol]`:**
  - AAPL: 200, top 200 of 3,192, 3.0 s; repeat 0.3 s with the same `asOf` (**30 s cache works**).
  - SPY: 200 of 6,000 (page cap), 5.0 s.
  - SPX: 200.
  - No vendor names.
- **OI tab > Live volume:** one request on opening, a table of 200 ("of 3,192 live contracts"), Refresh makes one request, and a row opens `AAPL 2026-10-30 350 Call`.
- **OI tracker popup > Live volume tab** (META, via `/oi-tracker`): the shared `LiveVolumeTable` renders 100 rows ("of 6,000 live contracts").

**Found, not changed**
- **Iron Condor on a 2-day expiry** (AAPL 10-30): the card shows Debit $0, POP 0%, Max P $0, Max L −$500. Its short strikes anchor on this app's Put Low / Call High for the expiry, which are far enough out that every leg's mid is ~0. The maths is consistent, but the suggestion is useless that close to expiry. Possible fix: fall back to listed-strike steps from ATM when the level-anchored legs carry no premium.
- **Live volume ranks stale sessions:** rows whose last bar is an older session (e.g. `Oct 30 170 P` with session 2026-10-23, 18,505) rank among today's volume. This is the same in the OI tracker popup (pre-existing; `toLive` takes the snapshot's `dailyBar` whatever its date). Possible fix: rank only bars from the latest session, or show the session prominently.

## 2026-10-28 — Option Chain tab: chain left third with mirrored selectable columns, builder right, strategy explainer; OI tab: sub-views, live volume, trend 7D

Requested:
- **Option Chain tab:**
  - the chain on the left third, the strategy builder on the right;
  - a chart column on the call and put sides;
  - LTP and mid columns;
  - columns selectable, mirrored on both sides and scrolling sideways together;
  - an optionstrat-style explainer when hovering a strategy.
- **Open Interest tab:**
  - more trend windows, with 7D as the default;
  - the trend button looking like an option inside the tab rather than a tab, placed at the right end;
  - "Open Int" shortened to "OI" to save space, and the title renamed "Open interest change by contracts";
  - the OI tracker's live volume as a separate view.
- Mid-task questions: confirm the duplicate requests are dev-only, and the cost of the live-volume call.

**What changed**
- **`components/stock/strategy/ChainTable.tsx`** (rewritten):
  - **Layout:** calls | fixed strike column | puts, built from fixed-width div cells.
  - **Columns:** LTP, Bid, Mid, Ask, Chart, IV, Δ, Vol, Γ, Θ, Vega. Γ, Θ and Vega are off by default. They are chosen and reordered with a Columns menu saved as `stockChain` (new id in `TABLE_IDS`).
    - Columns run from the strike outwards, and the calls side mirrors them.
    - Bid sells and ask buys, as before. The chart cell opens the contract chart.
  - **Sideways scroll:** when the columns don't fit, both sides scroll together, mirrored, so the strike stays centred. This works by wheel or trackpad on either side, or by a "More columns" slider under the table.
    - The headers are separate overflow-hidden rows kept in sync.
    - Header and body both use `scrollbar-gutter: stable`, so the columns line up beside the vertical scrollbar.
    - The Calls / Puts labels sit in a static row; they scrolled and clipped at first.
- **`components/stock/tabs/OptionChainTab.tsx`:**
  - The header (spot, ATM IV, quote time, Refresh quotes, errors) spans the full width.
  - Below it is a `lg` grid of `1fr | 2fr`: the chain card on the left (sticky) and the picker and position cards on the right.
- **`components/stock/strategy/StrategyInfo.tsx`** (new) and **`StrategyPicker.tsx`**: hovering or focusing a card or list entry shows an explainer under the picker; with nothing hovered it shows the picked strategy. The explainer has:
  - the name, the view, and Limited/Unlimited profit and loss badges (from `analyze` on the live chain);
  - the description;
  - "Buy a call at strike A…" lines, with letters A, B, C… from the lowest resolved strike (far legs say "later expiry");
  - the strike values;
  - an expiry payoff SVG with green/red fill, lettered strikes and spot, framed by the strike spread.
  - Cards are 1 / 2 / 3 columns at sm / xl. List descriptions are clamped to one line.
- **Live volume:**
  - **`lib/oiLive.ts`** (new): `LiveOption` and `toLive`, moved out of `app/api/oi-tracker/stock/[symbol]/route.ts`.
  - **New `GET /api/oi-tracker/live/[symbol]`:**
    - Same gate and limiter as the OI tracker (`guardOi(true)`, feature `oi_tracker`).
    - Returns the top 200 contracts by live session volume across unexpired expiries. Weekly expiries are dropped for monthly/quarterly-only plans.
    - **30 s shared cache per symbol.**
  - **`components/oi/LiveVolumeTable.tsx`** (new) is now used by both the OI tracker's stock modal (its private columns, `LiveOption` and the unused `parseOcc` copy were removed) and the stock page.
- **`components/stock/tabs/OpenInterestTab.tsx`:**
  - **Sub-views:** an underlined sub-nav "OI changes | Live volume", deliberately unlike the coloured page tabs.
    - Live volume loads when first opened, then only on Refresh. Without `oi_tracker` it shows a sign-in/upgrade note and makes no request.
    - Its rows open the contract chart (OCC root passed for index roots).
  - **Trend button:** now a small outline button with a line icon at the right end of the window row.
  - **Column labels:** OI, Chg OI, ABS Chg OI, Chg OI $, ABS Chg OI $ (ids unchanged, so saved column choices still apply). Cell padding is tighter.
  - **Title:** "Open interest change by contracts".
- **`components/stock/tabs/OiTrendModal.tsx`:** windows 7D · 14D · 1M · 3M · 6M · 1Y · All, default 7D.

**Live volume cost** (measured 2026-10-28 after the close, via the facade): each load reads the chain in pages of ≤1,000 contracts, at most 6 pages.

| Symbol | Pages | Time | Downloaded | Note |
|---|---|---|---|---|
| KO | 2 | 0.25 s | 0.5 MB | |
| AAPL | 4 | 1.6 s | 1.7 MB | |
| NVDA | 5 | 0.8 s | 2.2 MB | |
| TSLA | 6 | 1.4 s | 2.7 MB | |
| SPY | 6 | 1.3 s | 3.2 MB | hit the 6-page cap at 6,000 contracts, so its furthest expiries are cut |

- The browser gets only the top 200 rows.
- The OI tracker's stock modal makes the same upstream calls on every open, with no cache.
- The account limit is 200 market-data requests/min.

**Verified**
- **Production build:** an isolated copy of the working tree was built in the scratchpad (sharing `node_modules`). Building in place failed with `PageNotFoundError` while another `next` process from this folder was running on port 3000 and sharing `.next`.
  - `npm run build` succeeds there, and the vendor grep of `.next/static` prints nothing.
  - **Duplicate requests are dev-only.** On `next start` (port 3002), opening `/stock/SPY?tab=oi` sent **one** `opt-chain?loads=1` request and the trend popup **one** `levels` request. Dev sends each twice (React StrictMode).
- **Option Chain tab** (temporary dev page rendering the real `OptionChainTab`, deleted afterwards; Playwright served `/chain` from a real AAPL chain read through the facade for 2026-11-20 and 2026-12-18; 1440 and 390 px):
  - chain card on the left third (411 of 1,248 px);
  - headers mirrored `Vol|Δ|IV|Chart|LTP|Ask|Mid|Bid | Bid|Mid|Ask|LTP|Chart|IV|Δ|Vol`;
  - scrolling the puts side 60 px moved the calls side 60 px from the strike;
  - hovering Bull Call Spread showed the explainer ("Buy a call at strike A / Sell a call at strike B"), and Long Call Butterfly showed A/B/C with Limited profit and Limited loss;
  - the chart cell opened 310 call;
  - picking a strategy built the position and payoff;
  - clicking an ask made a custom position;
  - a calendar fetched the 12-18 chain once;
  - 0 px overflow, no page errors.
- **Open Interest tab** (dev, signed out, SPY): the title and the "OI" header are in place; the trend button is right of the window picker at 1440 px (wraps under it on a phone); the trend popup opens on 7D (`from=2026-10-21`); Live volume shows the upgrade note with no request; 0 px overflow.
- **Live-volume route:** answers 401 signed out.
- `npx tsc --noEmit` is clean.

**Not verified**
- **Signed in with `oi_tracker`:** the live-volume route's 200 path and its cache in a browser.
- **The tracker modal's live tab** after the `LiveVolumeTable` refactor: only type-checked.
- **The Option Chain tab against the real `/chain` route as a Pro user:** still only rendered via the temporary page.
- `npm run test:e2e` was not re-run.

---

## 2026-10-28 — Open Interest tab: trend in a modal, strike ladder beside the contract table, trading-day windows, all-expiries mode, more filters

Requested:
- the OI trend becomes a button that opens a modal and calls the API only when clicked;
- OI change by strike and OI changes by contract sit side by side, with most of the width going to the contracts, and share one window picker;
- add 1D/2D/3D/5D windows, with 1D the default;
- more filters on the contract table;
- the contract table can include or exclude the expiry filter (the strike ladder may keep its own scope).

**What changed**
- **`app/api/stocks/[symbol]/opt-chain/route.ts`** (back-compatible; the contract modal's calls are unchanged):
  - **`loads=N`** (1–260) means the last N loads, i.e. trading days, up to `to` (default today). They come from `nt_market_dates` (source `opt_chg`) via the new `catalogTradeDatesUpTo` in `lib/marketCatalog.ts`. The fallback is a per-symbol `DISTINCT load_dt` (uses the `us_opt_chg_rpt_key` index prefix).
  - **`expiry=all`** returns every expiry of the symbol in the window, each row carrying `expiry`. Weekly expiries are dropped for monthly/quarterly-only plans (`filterByExpiry`). Rows are capped at 5,000, keeping the largest |OI change| (`truncated: true`).
    - Measured 2026-10-28: busy names report ~200–1,500 changed contracts per load across 20–49 expiries (SPY ~900, SPX ~1,100). SPY over 5 loads: index scan, 4,301 rows, 3 ms.
  - Expiry and dates are validated (400 otherwise).
  - Single-expiry rows now also carry `expiry`.
- **`components/stock/tabs/OpenInterestTab.tsx`** (rewritten):
  - **Top row:** an "Open interest trend" button, then the window picker 1D · 2D · 3D · 5D · 10D · 30D · 90D · All (default 1D; trading days, so 10D/30D/90D now count sessions, not calendar days), then the reported range.
  - **Side by side** from `lg` up (`1fr | 2fr`): the strike ladder and the contract table, both on the shared window.
  - **Expiry scope:** the ladder always uses the selected expiry, since summing the same strike across expiries means nothing. The contract table has an **Expiry YYYY-MM-DD | All expiries** switch. "All expiries" makes one more request (`expiry=all`), only when switched on, and shows a note when the result is capped.
  - **Filters:** search (strike, type, expiry), type, change (OI added / cut), moneyness (ITM / OTM against the row's underlying close), trade date, expiry (all-expiries mode), strike min–max, min |ΔOI|, min |$ ΔOI|, and Clear filters (n). Expiry is sortable too.
  - The default sort is now |ΔOI| descending (it was trade date).
  - A row opens the contract chart for **that row's expiry**.
- **`components/stock/tabs/OiTrendModal.tsx`** (new): the call/put OI trend and PCR in a modal, with 1M / 3M / 6M / 1Y windows (default 3M).
  - It reads `/levels?range=true` when opened and on each window change, so it gets the same rate limit and delayed-plan clamp as the chart.
  - It shows the route's message on errors such as 429.
- **`components/stock/StockAnalysis.tsx`:** the `oiTrend` memo and `oiHistory` prop are gone. `selectedOptContract` carries `expiry`, and the contract modal uses it.

**Verified** (dev server, Playwright, `/stock/SPY?tab=oi`, signed out, 1440 and 390 px; screenshots checked)
- **Opening the tab:** only `opt-chain?expiry=2026-11-20&loads=1` → 69 rows (2026-10-28 only).
- **3D:** `loads=3` → 223 rows (10-26 to 10-28).
- **All expiries:** one `expiry=all&loads=3` request → 587 rows.
- **Filters:** Type = put with min |ΔOI| 1000 → 48 of 587.
- **Row click:** a 2026-12-18 row opened `SPY 2026-12-18 810 Call` and requested that expiry's history.
- **Trend button:** one `levels?range=true` request, and only on click.
- **Route by curl:**
  - `loads=2&to=2026-10-20` → 10-19 and 10-20.
  - `expiry=all` signed out → only monthly/quarterly expiries (11 for SPY on 1 load).
  - 90 loads → capped, `truncated: true`.
  - `expiry=bad` → 400.
- **Layout:** 0 px overflow at both widths after fixing the window picker (it overflowed by 15 px on a phone before getting `min-w-0`). No page errors.
- `npx tsc --noEmit` is clean. Lint shows only `any` warnings, matching the existing route style.

**Not verified / notes**
- **Signed-in plans:** I didn't test signed in. That covers weekly expiries in all-expiries mode, and the trend modal's full 1Y window. Signed out, the 3M window showed only 2026-10-12 to 10-22, which looks like the levels route's delayed-plan clamp working as designed.
- **Duplicate requests in dev:** every newly mounted fetch effect (the tab, both modals) sends its request twice, back to back. This fits React StrictMode in dev. Unverified in a production build.
- **Mixed roots:** `expiry=all` still mixes SPX/SPXW roots, as the single-expiry query already did (see the trade-date entry below).
- `npm run build` and `npm run test:e2e` were not re-run.

---

## 2026-10-28 — Stock page tabs: solid coloured boxes

Requested: the tab names as solid boxes, each a different light colour, with a darker one for the selected tab.

- **`components/ui/Tabs.tsx`:**
  - Each tab is a rounded, bordered box with a light fill. `TabDef` gains `tone` (gray / green / orange / blue / amber / violet; gray by default).
  - The selected tab is the same hue's 600 fill with white text.
  - Class strings are literal so Tailwind keeps them.
  - The underline and the thin dividers are gone; the gap between boxes separates the tabs.
- **`StockAnalysis.tsx`:** Chart & Price Levels is green, Open Interest orange, Option Chain blue, Earnings amber. These are the colours of the old jump buttons.
- **Verified:**
  - `npx tsc --noEmit` is clean.
  - Playwright screenshots of the tab bar at 1366 and 390 px show the idle and selected states (chart tab, then Earnings selected).
  - 0 px overflow, no page errors.
  - The stock page is the only user of `Tabs`.

---

## 2026-10-28 — Stock page: tabs sit under the quote and expiry selector

Requested: put the tabs below the stock info and the expiry selector, and fetch a tab's data only when that tab is opened.

**What changed**
- `components/charts/TVChart.tsx`: two new props.
  - `afterHeader` renders between the header (quote, Analysis, expiry selector) and the chart. It is not shown while the chart is enlarged.
  - `chartHidden` hides the chart row and the level chips but keeps the header. The chart stays mounted. The row swaps `flex` for `hidden`, because the `hidden` attribute loses to Tailwind's `flex`.
- `components/stock/StockAnalysis.tsx`:
  - The tab bar (`tabBar`) is passed as `afterHeader`. The quote, Analysis and expiry selector stay above the tabs in every tab; only the chart belongs to the first tab.
  - The slim bar is back to being only the collapsed state. The tab bar renders under it when collapsed, and its expand button shows in every tab.
- **Lazy loading is unchanged and was re-measured** (below).
  - Price levels table: reuses the chart's levels when they cover the range.
  - Earnings history: still loads with the page for viewers who have the feature, because the chart's earnings markers use it. The "Next / Last earnings" header lines come from the details call.

**Verified** (Playwright, dev server, `/stock/AAPL`, signed out, 1366 and 390 px; screenshots checked)
- Order: quote and expiry selector, then the tab bar, then the chart (or the tab's content).
- **Page open** makes only the chart's requests: quote, expiry-dates, details, and then ohlc, scan-alerts and `levels?range` twice (the initial window plus one scroll-back chunk, as before).
- **Clicking each tab:**
  - Open Interest → `opt-chain` (on first open only);
  - Option Chain and Earnings → none (signed out: both locked);
  - back to the chart tab, and to Open Interest again → none.
- 0 px horizontal overflow; no page errors. `npx tsc --noEmit` is clean.

**Not verified**
- Signed in with the Pro features (Option Chain's `/chain` fetch on first open, earnings history).
- The `opt-chain` request still appears twice on the first OI open in dev, back to back with identical parameters (see the entry below). Unverified in a production build.
- `npm run build` and `npm run test:e2e` were not re-run.

---

## 2026-10-28 — Stock page: the chart moves into the first tab; tab dividers, no icons

Requested: the chart belongs in the first tab, tabs get a divider between them, and tab labels need no icons.

**What changed**
- `components/stock/StockAnalysis.tsx`:
  - The tab bar now sits at the top of the page, under the alerts ticker. Tabs: **Chart & Price Levels** · Open Interest · Option Chain · Earnings (no emoji).
  - The chart block (quote, Analysis, expiry selector, chart) shows only in the first tab. The other tabs show the slim bar the collapse button already used: quote plus expiry selector, which those tabs depend on.
  - The chart is *hidden* in the other tabs, not unmounted. Unmounting it was tried first: each switch back re-fitted the view and fired a load-more, costing an extra `ohlc` call and a rate-limited `/levels?range=true` call. TVChart's ResizeObserver ignores a zero width, so `display:none` leaves its size and visible range alone. Collapsing still unmounts the chart, as before.
  - The jump buttons are gone (under the quote and in the slim bar). The tab bar now sits directly above, so they duplicated it. `openTab` lost its scroll argument and `tabsRef`.
- `components/ui/Tabs.tsx`: a thin vertical divider between tabs.
- `components/charts/TVChart.tsx`: the `topAside` wrapper gets `basis-80`. The jump buttons used to make the quote column wide enough that on phones the Analysis box and expiry selector wrapped under it. Without them, the panel squeezed in beside the quote and the expiry card overflowed the page by 85 px at 390 px.

**Verified** (Playwright on the dev server, `/stock/AAPL`, signed out, at 1366 and 390 px)
- 4 tabs without icons, 3 dividers.
- Switching to Open Interest and back to the chart tab made no `ohlc`, `levels` or `scan-alerts` request; with the unmount version it made 2–3.
- 0 px horizontal overflow at both widths; no page errors. Screenshots checked for both layouts.
- `npx tsc --noEmit` is clean. Lint on the two files shows only warnings that were already there.

**Not verified / noticed**
- **Opening the OI tab sends `/opt-chain` twice in dev**, back to back with identical parameters. This is most likely React StrictMode's double effect (on by default for the App Router in dev; `next.config.ts` doesn't set it). Unverified in a production build.
- **The chart's top-right toolbar on a phone** sits partly past the chart's left edge. Not touched; unknown whether it predates this change.
- `npm run build` and `npm run test:e2e` were not re-run for this change.

---

## 2026-10-28 — Stock page tabs; Open Interest tab; live Option Chain + Strategy Builder (optionstrat-style)

Requested:
- the stock page's scroll-down sections become tabs, with a separate Open Interest tab to track OI;
- the Option Chain tab gets an optionstrat-like payoff builder, where users pick a market view (bullish / bearish / neutral) or any strategy from a list, reusing the parallel repo's options lab;
- TradingView charts, not Recharts;
- clicking a strike opens a TradingView chart of that contract's OHLCV and OI change;
- quotes refresh only on demand;
- admins can enable and disable strategies;
- hover titles explain every greek and acronym.

Full design: **`docs/strategy-builder.md`**.

### What changed

**Tabs** (`components/stock/StockAnalysis.tsx`, now 1,530 lines, down from 1,864)
- Price Levels · Open Interest · Option Chain · Earnings, using the new `components/ui/Tabs.tsx`. The open tab is kept in `?tab=` via `history.replaceState`.
- Tabs are lazy: each mounts and fetches on first open, then stays mounted. **Opening a stock no longer requests `/opt-chain`.**
- The per-section collapse toggles are gone. The jump buttons switch tab, and there is a new 🧮 Option Chain button.
- The Earnings tab shows an upgrade teaser when locked; it used to be hidden.

**Tab components** (`components/stock/tabs/`)
- `PriceLevelsTab.tsx` (presentational; the fetch stays in `StockAnalysis`).
- `OpenInterestTab.tsx`: owns the OI-change report's state and fetch, moved unchanged from `StockAnalysis`. It adds:
  - an **OI trend** chart (`components/charts/OiTrendChart.tsx`, lightweight-charts): call vs put OI per day plus PCR, built from the levels history the chart already loaded, so it costs no request;
  - an **OI change by strike** ladder.
- `OptionChainTab.tsx` and `shared.tsx`.

**Contract chart** (`components/charts/OptionContractChart.tsx`)
- Adds an OI-change histogram band and a volume band under the candles, for every caller (OI tab, chain, OI tracker).
- The modal legend notes the bands, and the chart is 460 px tall.

**Live chain route** (`app/api/stocks/[symbol]/chain/route.ts`, new)
- Feature `strategy_builder`, limiter `option_chain` (30/min, added to `LIMITERS`), weekly-expiry gate, 15 s cache.
- Retries index weeklies under SPXW / NDXP / RUTW / VIXW.
- `lib/marketdata/index.ts` exports `getFallbackQuote`, used for index spot.

**Payoff engine** (`lib/payoff/{bs,carry,chain,evaluate,strategies,glossary}.ts`, new, pure)
- A port of the lab's Python: Black-76 with put-call-parity-fitted carry, per-leg calibration (`ivPx`), payoff and metrics, POP, heatmap and the 45 templates.
- It is generalised so each leg has its own time to expiry (calendars and diagonals).
- It runs in the browser, so edits make no requests.

**Builder UI** (`components/stock/strategy/`)
- `StrategyPicker` (view cards with sparklines, or the searchable list), `LegEditor`, `StrikeRuler` (draggable), `StrategyBuilder` (scenario controls), `MetricsPanel`, `PayoffTable` (P&L heatmap), `ChainTable` (bid = sell, ask = buy, C📈 / 📈P opens the contract chart).
- `PayoffChart` uses lightweight-charts `createChartEx` with a custom numeric `IHorzScaleBehavior`, so the x-axis is price.
- **The custom scale was the risk, and it works in the installed 4.2.3** (rendered and screenshotted, below).

**Admin**
- `components/admin/StrategySettingsEditor.tsx` on `/admin/settings`.
- `PUT /api/admin/settings/strategies`.
- `lib/strategySettings.ts`, using `nt_app_settings` key `strategy_templates`.

**Feature and other changes**
- `FEATURE_STRATEGY_BUILDER = 'strategy_builder'` in `lib/features.ts` and `ALL_FEATURES`.
- `components/ui/Term.tsx` gives hover explanations from `lib/payoff/glossary.ts`.
- `lib/occ.ts` holds `parseOcc`, moved from `lib/oiTracked.ts`, which re-exports it. `StockOiModal`'s private looser copy was left as is (a different regex, so swapping it would change behaviour).
- `EarningsHistoryTable` takes `className`.

### Design notes
- **Math in the browser rather than server POSTs** (the lab debounces a POST per edit). One chain request per expiry is the only API and rate-limit cost, and leg edits, sliders and template switches are instant.
- **Level anchors use this app's own levels.** Strangles and condors anchor on Call High / Put Low of the selected expiry instead of the lab's spot ±10% default, which remains the fallback.
- **Chain OI per strike is not shown.** The snapshots have no OI; the Open Interest tab has it from the report.

### Verified
- `npx tsc --noEmit` clean.
- eslint: 0 errors on the touched files. The only warnings are pre-existing `any`s, plus the existing exhaustive-deps warning on the price-history effect.
- `npm run test:e2e`: 188 passed (responsive suite; it has no stock-page tab tests of its own). `npm run build` succeeds, and `grep -rlE '[Aa]lpaca|ALPACA|[Tt]radier|TRADIER|APCA-' .next/static` prints nothing.
- Fixtures: `node scripts/test-payoff.mjs` 22 passed (new); `test-oi-strategies`, `test-earnings-parse` and `test-us-scanner` all pass.
- **Live chain through the facade, using the same grouping as the route (scratch script, market hours):**
  - AAPL 2026-11-20: 188 contracts, spot 345.02, fitted carry disc 1.0035 / basis 0.9984 (inside the bands), ATM IV 27.4%.
  - **45/45 templates resolve**, including calendars against 2026-12-18.
  - Bull call spread 345/347.5: max P/L = width − debit.
  - Iron condor breakevens sit outside the short strikes.
  - No vendor strings in the chain JSON.
  - SPY weekly 10-30 and 11-06 also resolve 45/45.
- **SPX:**
  - The primary feed has no SPX spot; the fallback quote returned 7743.98, which is the route's fallback path.
  - SPX lists no 10-30 weekly under `SPX`; SPXW does, which led to the weekly-root retry.
- **Dev server, anonymous:**
  - `/chain` returns 401 and the admin strategies API returns 403.
  - On the `/stock/AAPL` walkthrough in Playwright, page open made no `/opt-chain` request; opening the OI tab made exactly one.
  - `?tab=oi` deep link works.
  - At 390 px width there is no horizontal overflow.
  - The Option Chain tab shows the sign-in teaser.
  - No page errors.
- **Builder rendering:** checked on a temporary dev-only page (deleted afterwards) fed a synthetic chain. The payoff chart, date slider, IV shift, crosshair readout, P&L table, calendar and Auto range all rendered with no console errors.
- **Bugs found and fixed during verification:**
  1. The OI trend chart crashed the page: OI arrives as numeric strings from Postgres, and lightweight-charts asserts on that. It is now coerced with `Number()`.
  2. A calendar reported a meaningless breakeven at 3× spot (carry drift far out); breakevens are now limited to ¼×–2× spot.
  3. The default ±10% range hid condor wings, so Auto is now the default.

### Not verified
- **The Option Chain tab against the real route as a signed-in Pro user.** No session was available here: the 200 path of `/chain`, the 429 limiter, Refresh quotes, far-chain loading and leg-expiry moves in the real page are untested.
- **The admin strategies card** (needs an admin session).
- **The contract modal's new bands in a browser** (type-checked only).
- **POP and greeks** were not cross-checked against the options-alert-lab backend on the same chain (it wasn't running). The formulas are ported line for line and fixture-tested.

### Follow-ups
- **Tick `strategy_builder` for Pro / Pro Plus in `/admin/plans` after deploy.** No plan has it yet, so everyone sees the teaser. This needs a DB write; ask first.
- **To-do (user):** "Track this strategy", saving built legs to the private OI-tracker positions (`nt_oi_tracked`).
- The orphan `/api/stocks/[symbol]/oi` route (no expiry filter, no gating) is still unused.
- Spot-vol skew in scenarios.

---

## 2026-10-28 — OI-change dates shown as the trading day behind them (trade date), everywhere they were load dates

Requested: the OI tracker already shows the session behind an OI change (the report loaded on D reflects D-1; `docs/oi-tracker.md`), but the option contract chart's OI markers and the stock page's Option Chain list still used the load date (user screenshot: the 2026-10-28 7725 Call marker sat on Oct 28's bar while its change happened on Oct 27).

- **Shared helper:** `sessionsForLoads()` in `lib/marketSession.ts` (moved out of `lib/oiTracker.ts`, which now aliases it): load date → previous trading day from the exchange calendar (weekend/holiday aware), one calendar call for the span.
- **Stock page + contract chart:** `/api/stocks/[symbol]/opt-chain` rows gain `tradeDate` (both the range and the latest-snapshot branches; falls back to the load date if the calendar is unavailable). The Option Chain table's "Trade Date" column (it was headed that already but showed the load date) shows `tradeDate` with the load date in the tooltip; `OptionContractModal` keys its OI history by `tradeDate`, so `OptionContractChart` puts the OI marker and the tooltip's OI line on the session's bar.
- **OI tracker:** per-date grouping rows (`OiGroupRow.tradeDate`, `MAX(last_session)` in `GROUP_AGGS`) — the column is now "Trade date" (it was "Load date" under a segment labelled "Trade date"); the stock modal's Timeline chart uses it; strategy candidates carry `tradeDate` (optional field, fixtures unchanged) and the cards show it.
- **Deliberately unchanged:** the load-date pickers/ranges (they really are load dates), the `eod_usmkts_price` levels data and the "Total OI as of" line (same one-day lag in that table, but changing how levels are plotted is a separate decision), tracked positions, scan alerts.
- **Verified:** `tsc` clean; `scripts/test-oi-strategies.mjs` passes. Live opt-chain route: 10-28→10-27, Monday loads → Friday (10-19→10-16, 10-12→10-09), 56 loads back to 2025-12 map correctly on the "All" range (~1.9 s), default branch returns `tradeDate`.
- **Not verified:** the browser rendering of any of this; the OI tracker routes (per-date grouping SQL, Timeline, strategies) were not exercised live (they need a signed-in Pro user), only type-checked.
- **Noticed, not changed:** `opt-chain` filters by `symbol_und`, so SPX and SPXW rows for the same expiry/strike/type are merged in the Option Chain table and in a contract's OI history (duplicate dates, e.g. 10-26 and 10-23 for SPX 2026-11-20 8000C); the chart's per-day map keeps one of them. Would need the OCC root in that query.

---

## 2026-10-28 — Option contract chart: today's bars from the fallback feed (history stays on the primary feed)

Requested: the contract chart showed the current trading day as a single bar, because the primary feed refuses any range that includes today and its only current-day data is one daily snapshot bar.

- **Change:** `app/api/stocks/[symbol]/option-bars/route.ts`. History is still the primary feed, capped at yesterday. For `daily` and every intraday interval, today's bars now come from `getFallbackBars(occSymbol, interval, today, today)` (the existing facade function, same `/markets/timesales` and `/markets/history` calls it already makes for index bars; 30m/1h are aggregated from 15m). It runs in parallel with the history request. If it returns nothing or errors, the old primary-feed snapshot bar is used as before (daily shape only). Weekly/monthly are unchanged (history only). No client change; no vendor names in the response.
- **Verified live (2026-10-28, market open):**
  - The fallback feed serves option OCC symbols (AAPL261104C00355000): 1/5/15-minute bars, and daily history that includes the in-progress day.
  - Seam: for the completed session 10-27 its daily bar equals the primary feed's exactly (O/H/L/C/V), and its 5-minute buckets start at the same times, so history and today line up.
  - Through the real route (dev server, anonymous, monthly expiry 2026-11-20, strikes 345/350): `5min` returned 60 and 57 bars for today (was 1), `daily` one bar for today whose volume equals the sum of the 5-minute bars; 30m/1h on another contract aggregate correctly. `npx tsc --noEmit` clean. No `tradier`/`alpaca` in the response body.
- **Not verified:** the browser rendering of the modal; expired contracts or non-trading days (the date filter keeps only today's bars, so they should add nothing); index options (SPX/SPXW) on the fallback feed; behaviour under the fallback feed's rate limits with many users opening contracts (each open of the modal adds one call, 10 s timeout). Alpaca pre-market option prints are not shown for today (fallback uses regular-session bars), so today's chart can start at 09:30 while earlier days may include an odd pre-market bar.
- **Follow-up:** the stale-snapshot guard remains only as a fallback; if the fallback feed proves reliable it could be removed.
- **SPX / SPXW check (same day):** both work on the fallback feed (OCC `SPX261120C08000000`, `SPXW261029C07900000`; chain root_symbol `SPX` / `SPXW`). But index options trade outside 09:30–16:00 and the primary feed's bars include those prints, so the regular-session default was wrong for them: Tradier's daily history for SPX/SPXW differed from Alpaca's on open/high/close for the completed day 10-27 (volume matched). Fix: `getBarsForChart` (`lib/marketdata/provider/fallback.ts`) takes `sessions: 'open' | 'all'` (default `'open'`, so index-bar callers are unchanged). The option route uses `'all'` for every intraday interval, and for **daily** only when the root is an index (`INDEX_OPTION_ROOTS` in the route), building the day from 15-min bars (`aggregateBars(…, 1440)`). Equity-option daily keeps the regular-session daily history, because Alpaca's daily bar excludes the occasional pre-market print (AAPL 10-27: Alpaca open 3.11 vs all-session 2.74).
  - Verified vs Alpaca for 10-27: all-session 5-min bars identical for AAPL (63/63) and SPXW (41/41), SPX 38/40 (two bars differ); all-session daily aggregate identical to Alpaca for SPXW (O/H/L/C/V); SPX identical on O/H/L/V, close 17.50 vs 17.76 (likely a late print Tradier doesn't return). Through the route: SPX 2026-11-20 8000C returns 5-min/1-hour/daily bars for today (daily V 3683 = sum of 5-min V), AAPL daily unchanged; `tsc` clean.
  - **SPXW contracts had no bars in the modal (pre-existing; confirmed in the browser by the user: SPX 2026-10-30 7500 Put showed only the SPX price line).** `OptionContractModal` sent only the underlying (`SPX`), expiry, strike and type, and the route built `SPX261030P07500000`, while the report holds `SPXW261030P07500000` (checked in `us_opt_chg_rpt`). **Fix:** `OptionContractModal` takes an optional `occRoot`, sent as `&root=` when it differs from the underlying; `StockOiModal` derives it from the row's `contract` key; the route validates `root` (`^[A-Za-z0-9]{1,6}$`, else 400), builds the OCC symbol from it and uses it for the index-session rule. The same fix covers NDXP and adjusted roots (LEN1...). The stock page's option-chain modal passes no root (unchanged behaviour).
  - **Verified:** `tsc` clean; route with `root=SPXW` on a monthly (2026-11-20 8000C) returns `SPXW261120C08000000` with today's daily and 37 five-minute bars, a different contract from the root-less `SPX261120C08000000` (volume 241 vs 3749); a malformed root returns 400. **Not verified:** the modal in a browser after the fix, and weekly SPXW through the route as a signed-in user (the user is checking that).

---

## 2026-10-28 — US scanner: the % quoted in "Why it matched" gets its own column

Requested (after a first misreading as today's Chg %): for scans like consecutive winners/losers, "Why it matched" quotes the % move across the streak ("5 closes higher in a row, +8.40%"); show that value as a column beside the scan's value column.

- **Change:** `Match.windowChg` (`lib/scanner/scans.ts`) carries the signed % the detail text quotes when it is not the metric; `ScanRow.windowChg` (`lib/scanner/run.ts`, rounded to 2 dp, `null` otherwise); `ScanInfo.changeLabel` (`lib/scanner/config.ts`) names the column, and `app/scanner/page.tsx` renders it (coloured, with arrow like Chg %) right after the scan's value column, which itself moved from last to directly after "Why it matched". The column only exists for the scans below.
  - Consecutive gainers/losers: **Streak chg %**, close of the latest bar vs the close before the streak (the same number as in the text).
  - Price × volume: **Price chg %** over the window.
  - Relative strength vs SPY: **Stock chg %** (the stock's own ROC; the metric stays the excess over SPY).
  - Earnings reaction: **Day chg %** (the metric stays the gap).
  - Not added where the metric already is the signed move (Rate of change, Price vs MA, Open = High/Low) or the text quotes only the metric (gaps, 52-week, breakout, volume, ATR, inside day, cross, upcoming earnings).
- **Saved layouts:** column order is only the default; users who already reordered columns keep their saved order (new columns are appended per the `useColumnPrefs` contract in CLAUDE.md, unverified here), "Reset columns" applies the new default. Sorting, ⚙ Columns and CSV work through the same column list.
- **Verified:** `npx tsc --noEmit` clean, eslint 0 errors on the touched files, `node scripts/test-us-scanner.mjs` 23 passed (they don't assert the new field). **Not verified:** rendered in a browser, or a live scan response.

---

## 2026-10-27 — Header: Performance hidden by plan/user, plan tag on the avatar

Requested: drop Performance from the menu per plan/user feature, hide it when signed out, and show the plan (Free / Pro / Expert) on the profile icon.

- **Change** (`components/layout/Header.tsx` only): the Performance button (desktop and mobile menu) renders only when `authCtx.loggedIn && hasFeature(features, 'performance')`. `authCtx.features` is the plan's list with per-user overrides applied (`lib/appUsers.ts`), so the admin Plans editor and per-user overrides control it with no new code. It is no longer shown with a PRO badge to users who lack it.
- **Avatar:** a small pill under the initial shows the plan from `authCtx.planCode` (`FREE` gray, `PRO` amber, `EXPERT` purple; unknown codes fall back to a capitalised code in the Free style). Also in the avatar tooltip/aria-label and next to "Profile" in the mobile menu. An expired plan already resolves to `FREE` in the context. EXPERT is labelled "Pro Plus" everywhere (`planLabel()` in `lib/features.ts`, used by the header avatar and `/profile`, matching `nt_plans.name` already used on /upgrade and admin).
- **Avatar size:** enlarged from 32 px to 40 px (`w-10 h-10`, initial `text-sm`) so the "Pro Plus" pill (8 px text) fits within the circle's width. The header row is 56 px tall, so it still fits.
- **Not changed:** the route is still protected independently (`middleware.ts` login check, `app/performance/layout.tsx` feature guard), so a typed URL is still refused. Links elsewhere (e.g. the Guide page text link to /performance) are untouched.
- **Verified:** `npx tsc --noEmit` clean; code paths read.
- **Not verified:** visual check in a browser (pill placement/clipping on the 32 px avatar, mobile menu); behavior per plan with real accounts.

---

## 2026-10-27 — Stock chart: drag up/down without touching the price axis first

Reported: dragging the candles vertically did nothing until the right price axis had been resized once.

- **Cause** (read in `lightweight-charts` 4.2.3, `PriceScale.startScroll`): it returns immediately while the scale is auto-fitting; dragging the axis turns auto-fit off, which is why it worked afterwards.
- **Change** (`components/charts/TVChart.tsx`, chart-creation effect): a capture-phase `mousedown` on the plot area (not the axes) turns the right scale's auto-fit off before the library's own handler runs, so the same drag pans in both directions. If the drag stays horizontal (< 3 px vertical), auto-fit is turned back on at release, so scrolling through time still fits the visible candles. If the scale is already manual, nothing changes (the library pans as before). Fit levels toggle, ↺ and the axis double-click still restore auto-fit.
- **Verified:** library source read; `npx tsc --noEmit` clean.
- **Not verified:** behaviour in a browser (not run); touch (unchanged, mouse events only).

---

## 2026-10-26 — US scanner Railway services live

The scanner code is on main (725ef74, 80406fc; Vercel deploy succeeded). `railway config apply --yes` from `railway/` created `us-universe-cron` and `us-universe-meta-cron` with `CRON_SECRET` referenced from `market-catalog-cron`. Images were deployed with `railway up`.

- **Deploy gotcha.** `railway up --service X`, run from inside `railway/X/`, uploads the whole linked `railway/` directory. The build then fails with "couldn't locate the dockerfile at path Dockerfile". Use `railway up ./X --path-as-root --service X` from `railway/`. CLAUDE.md is updated to match.
- **Verified:**
  - Both deployments report SUCCESS. The `us-universe-cron` build log shows the alpine + curl image.
  - `railway config plan` reports "already up to date".
- **Not verified:**
  - First scheduled runs: Saturday 2026-10-31 14:00 UTC for the universe, Sunday 2026-11-01 15:00 UTC for the metadata. Check `nt_us_universe.liquidity_at` / `meta_at` afterwards.
  - The meta image's build log could not be streamed, though its deployment reports SUCCESS.
- The 2026-10-23 open items "Push" and "railway config apply" are done. The signed-in browser check of `/scanner` is still open.

---

## 2026-10-23 — US Market Scanner: compact controls so results are visible without scrolling

Reported (screenshot): the scan chips (9 rows) and the 3-row filter grid pushed the results below the fold.

- `app/scanner/page.tsx` controls redesigned:
  - **Scan picker**: one button ("Volatility: Range breakout") opening a grouped menu (5 / 3 / 2 columns by width; closes on choice, outside click or Esc; each item has its help as a tooltip).
  - **One toolbar row** (tablet and up): picker, the scan's own settings (N, direction, period, SMA, combination, volume ×, gap, tolerance, ATR), Universe, Type, "Filters (n)", Presets. Long labels truncate with a tooltip; field widths capped so the row doesn't wrap at 1440 px.
  - **Help line** with Refresh / Copy link / Reset as icon buttons on the right.
  - **Active filters as removable chips** + "Clear all" (only filters that differ from the defaults).
  - **Filters panel** (sector, industry, price, change today, dollar / share volume, market cap tier and minimum, near 52W high, result limit, exchanges, exclude ADRs): collapsible inline panel from the tablet width up (open/closed remembered per browser in `localStorage`, guarded); on a phone a bottom sheet that also holds the scan settings, universe, type and presets, with Copy link / Reset / Show results buttons.
  - **Phone toolbar**: scan button, "Settings (n)", Refresh, plus a one-line summary of the scan settings.
  - Corporate-action note and results header made one compact line each. Universe label shortened to "Top 1000 by cap (≈ Russell 1000)".
- **Verified** (Playwright, page component on a temporary ungated route, deleted afterwards, API mocked with a real engine response): first result row now at 498 px on 1280/1440 (was ~860 in the reported screenshot), 560 px at 768, 628 px on a 375×812 phone (above the fold); no horizontal page scroll except the known pre-existing header overflow at 1280; scan menu and phone sheet rendered and checked visually. `tsc`, eslint, 23 fixture tests and `npm run build` pass; bundle still has 0 vendor strings.
- **Not verified:** signed in on the real route; a real phone (only Chromium emulated widths).

---

## 2026-10-23 — US Market Scanner: docs, final checks, open items

Step 8. **`docs/us-scanner.md`** (new): data flow, feeds and plan limits, universe sources and rules, scan rules that are easy to get wrong, splits, runbook, tables, limits. The prompt's `docs/DESIGN.md` / `docs/DATA_FLOW.md` don't exist in this repo, so it follows the `docs/earnings.md` / `docs/oi-tracker.md` pattern. **`CLAUDE.md`**: feed rules (daily = consolidated, capped at now − 16 min; snapshots/intraday single-venue; 200 req/min), stored-bars paragraph (consolidated coverage, split check, scanner symbols), new crons, the scanner route, test commands. Removed the unused `fetchUsAssets` from the provider (it only works on the live trading host).

### Final checks (all on 2026-10-23)
- `node scripts/test-us-scanner.mjs` 23 passed; `test-earnings-parse.mjs` 31 passed; `test-oi-strategies.mjs` passed; `scanner-dry-run.mts` 10 symbols identical.
- `npx tsc --noEmit` clean; `npm run lint` 0 errors (265 warnings, the repo's existing `no-explicit-any` style); `npm run build` passes.
- Masking: 0 vendor strings in `.next/static`; 0 vendor mentions in `app/`, `lib/`, `components/`, `types/` outside `lib/marketdata/provider/` (stored DB values `alpaca_news` / `alphavantage` excepted; they are mapped before reaching clients).
- Gate: `/api/market/scanner` signed out → 401 "Login required"; `/scanner` signed out → 307 to `/login?redirect=%2Fscanner`.

### Open items (need the user)
- **Push** (main auto-deploys to Vercel). Nothing has been pushed.
- **`railway config apply`** for `us-universe-cron` and `us-universe-meta-cron` (plan: 2 to add, 0 to change, 0 to destroy), after the push, so the services never call routes that 404.
- Signed-in check of `/scanner` as a Pro user in a browser (gate, live API, auto-refresh, Copy link) and outside market hours (pre-market gappers, after-hours pill).
- The universe, history and metadata were filled from this machine against the shared DB, so production will already have them when deployed. The weekly Railway jobs keep them current.

---

## 2026-10-23 — Earnings ingestion widened to the US scanner universe

Step 7. Requested: use the existing earnings calendar table and include the scanner's tickers.

- `lib/earnings.ts`: `getEarningsIngestSymbols()` = tracked ∪ scanner universe (~2,300), used only where data is **ingested**: the Alpha Vantage calendar filter (`syncCalendar`), the news results sync and the news catch-up. Readers are unchanged: the earnings page, home and stock pages still pass `getTrackedSymbols()`, so they show the same stocks as before (checked by reading every caller: `app/api/earnings/list`, `app/api/home/earnings`, `app/api/earnings/levels`).
- News queries carry the symbol list in the URL; it is now sent in chunks of 1,000 (verified live: the endpoint accepted the full 1,907-symbol list, a 12 KB URL; chunks keep it well inside common limits). No extra Alpha Vantage calls: the calendar is one CSV of every symbol.
- `/api/cron/earnings?force=true` now also re-syncs the calendar when it already ran today (`forceCalendar`), costing one more Alpha Vantage call; the scheduled runs are unchanged.

### Verified
- Forced run from the local dev server against live sources: calendar synced, 1,206 rows in the 3-month horizon (717 before; 5 future dates that vanished from the newer snapshot marked dropped as designed); news 2,319 articles → 38 results; catch-up 6 pending, 0 new. Scheduled dates now cover 1,195 symbols, 1,166 of them in the scanner. Alpha Vantage usage today: 2 calls of 25. `tsc` clean.

### Not verified
- The earnings page and home cards were not opened after the change (readers unchanged by code reading only).

---

## 2026-10-23 — US Market Scanner page (`/scanner`)

Step 6. `app/scanner/page.tsx` (client), gated by `app/scanner/layout.tsx`; nav: Trackers dropdown + mobile menu.

- **Layout** (OI tracker shell, `bg-gray-50`, white rounded-xl cards, blue-600 primary): presets + Refresh / Copy link / Reset filters bar (sticky from the tablet width up; on a phone it would cover the screen, so there it scrolls sideways and is not sticky) → scan chips by group (sideways-scrolling rows on a phone) → one-line help for the selected scan → filter grid (2 / 3 / 6 columns) with the prompt's labels, scan-specific fields only when the scan uses them (N select, direction, period, SMA, combination, volume surge, min gap, tolerance, ATR min/max) → Exchange checkboxes and Exclude ADRs → results card.
- **Results**: "{label} - {matched} matches of {scanned} scanned - showing {returned}", status pill Live (green dot) / Pre-market / After hours / As of close {date}, "(today's volume is partial)", and a note when volume scans had to use settled sessions. Table = `components/oi/DataTable` (sort, per-column filters, search, CSV of the current rows, Columns menu with saved choice: new table id `usScanner` in `TABLE_IDS`). Columns: # Symbol (pinned; opens the chart in a new tab; badges Levels / ETF / Check corporate action with the reason as tooltip), Why it matched (truncated, tooltip), Price, Chg $, Chg % (▲/▼ and sign, not colour alone), Open, High, Low, 52W High, 52W Low, Volume (compact), Avg $ vol, Mkt Cap ($B/$T), Sector, scan metric. Numbers en-US with `Number()` coercion.
- **States**: empty "No stocks match these filters right now.", error "Could not run the scan. Try again in a moment." (a failed background refresh keeps the old rows), `LoadingSpinner` on first load. Footer disclaimer as specified.
- **URL state**: params restored once on mount through `normalizeParams` (the server validates again), written with `replaceState` on every change; requests debounced 300 ms. **Auto-refresh** every 30 s only while the tab is visible and the API says the regular session is open.
- **`DataTable` changes (all tables)**: `aria-sort` on sortable headers, 40 px tap targets for header sort buttons on phones, focus rings, `aria-label` on the search box, opt-in `stickyFirst`. The rank was merged into the Symbol column so that one column can stay pinned.

### Verified
- `npm run build` passes (`/scanner` 10 kB; `/api/market/scanner`); `tsc` clean; client bundle still has 0 vendor strings.
- Screenshots (Playwright, Chromium) at 375, 768, 1280 and 1920 of the page component mounted on a temporary ungated route (deleted afterwards) with `/api/market/scanner` mocked by a **real** engine response (range breakout, 100 rows; one row's flag and one row's ETF kind set by hand to show the badges): no horizontal page scroll at 375 / 768 / 1920, the table scrolls inside its box with the symbol pinned, 14 headers with `aria-sort`, every scanner input labelled.

### Not verified / found
- The real `/scanner` route signed in as a Pro user (the gate, the live API call, auto-refresh, Copy link) was not exercised: the e2e suite has no login.
- **Pre-existing, not from this change:** signed out at 1280 px the shared Header's desktop nav overflows (document 1301 px; same on `/` and `/guide`), and the header search box has no label.

---

## 2026-10-23 — US Market Scanner: engine, API, feature code

Steps 4–5 of the build (page in the next entry).

- **Engine (`lib/scanner/`)**, pure modules unless noted: `config.ts` (catalogue of 20 scans in 9 groups, params, presets, `normalizeParams` clamps every query value, `toQuery` round-trips), `indicators.ts` (streak, volume ratio, 30% jump, SMA, ROC, ATR%, SMA50×200 cross, inside day, range breakout, percentile), `scans.ts` (one function per scan + corporate-action flag), `liveBar.ts` (latest-session bar, pre-market price, refresh timing), `today.ts` (server: shared `nt_scanner_today`), `run.ts` (server: the runner).
- **One scan** = one SQL query for the whole universe (per symbol: last 60 OHLCV, 120 highs/lows, 260 closes, 52-week extremes with dates, newest >30% jump) cached 5 min + snapshots in 2 requests of 1,000 symbols (verified the endpoint takes 1,000) cached 15 s + the shared today table. `lib/ttlCache.ts` `getOrSet` de-duplicates concurrent misses.
- **Latest-session bar (`liveBarFrom`)**: a date comparison against the last stored session (snapshot bars carry their ET date; DST-safe via Intl), not the NSE design's close-matching. The close comparison is kept as a split check (> 5% off on the same session → row flagged). A settled session missing from storage (before the morning top-up) is taken from the snapshot's previous bar.
- **Today's consolidated volume**: a batched request for ~1,900 symbols takes 10–25 s (measured), so `nt_scanner_today` holds today's 15-min-delayed consolidated bars for everyone, refreshed in the background (`after()`) at most every 3 min in session plus once after close + 17 min, by one instance (lease `scanner-today`), at most one attempt per instance per 3 min. Measured: 1,906 symbols in 14.4 s. Until it lands, volume scans use the settled sessions (`meta.volumeScanSettledOnly`; before this rule a volume scan on single-venue volume matched 0, after the refresh 8).
- **API**: `GET /api/market/scanner` (`dynamic`, `maxDuration 30`), `requireFeatureApi(us_market_scanner)` + limiter `us_scanner` (120/min, admin-editable); earnings scans also need `earnings`. Response `{ success, data: { params, rows, meta, filters } }`, no vendor names.
- **Rate-limit settings fix** (`lib/rateLimitConfig.ts`): loading saved limits now fills limiters added since the save with their defaults (and drops removed ones) instead of rejecting the whole saved set and silently reverting every admin-edited value. Admin save is still strict.
- **Feature**: `FEATURE_US_MARKET_SCANNER = 'us_market_scanner'` in `ALL_FEATURES` (drives `/upgrade`, admin plan editor, `/profile`), seed lists in `scripts/bootstrap-app-tables.mjs`, `scripts/add-us-market-scanner-feature.mjs` (insert-only, `--dry-run`) **run against the live DB: added to PRO and EXPERT** (re-run: none added). `middleware.ts` matcher `/scanner/:path*`, `app/scanner/layout.tsx` guard, Header Trackers dropdown + mobile menu entry "🔎 US Market Scanner".
- **tsconfig**: `allowImportingTsExtensions` so the pure scanner modules can import each other as `./x.ts` and run under Node's type stripping in the fixture tests (Next resolves them as before).

### Verified
- `scripts/test-us-scanner.mjs`: 23 tests (adds streak across Thanksgiving, gap filled/open, 52-week today vs 3 sessions ago and the 200-session rule, volume ratio short baseline, jump flag, indicators, RS + ranking, `normalizeParams` clamping + URL round trip, ET dates across the 11-01 DST change, `liveBarFrom` for DST / Thanksgiving / the 11-27 13:00 half day / a missing settled session / split suspicion / stale snapshot, pre-market, refresh timing). Existing `test-earnings-parse.mjs` and `test-oi-strategies.mjs` still pass.
- `scripts/scanner-dry-run.mts` (new): 10 symbols (AAPL, MSFT, NVDA, BRK.B, JPM, XOM, TSM, SPY, QQQ, SOXL): engine history vs an independent raw consolidated fetch: 260/260 bars, 0 mismatches, identical streak / volume ratio / SMA200 / 3M ROC / ATR.
- Live engine runs (via tsx, during the regular session 2026-10-23): 12 scans, cold 3.0 s, warm 160–460 ms; results printed and plausible (e.g. AXP "Reports today (2026-10-23, pre-market)", CBOE golden cross, gap/inside-day/RS rows with corporate-action flags where a >30% move exists). `tsc` clean.

### Not verified
- The HTTP route with a signed-in Pro session (auth, 429, `after()` on Vercel); only the runner was called directly.
- Pre-market and after-hours behaviour live (the run was during the regular session); half-day and holiday paths are fixture-tested only.

---

## 2026-10-23 — US universe (`nt_us_universe`), consolidated daily bars, split detection

Steps 2–3 of the US Market Scanner build. Decisions taken with the user during the build are marked **(decided)**.

### Daily bars switched to the consolidated feed (SIP) — affects the stock chart too
- **Found (verified live):** stored/daily bars were IEX-only. AAPL 2026-10-22: IEX volume 980,486 vs consolidated 47,047,124 (~2%); IEX close 348.34 vs official 348.22. Every volume number in the app (chart volume, liquidity) was ~50x low.
- **Verified plan rules:** consolidated (SIP) daily bars are served up to now − 15 min; any later `end` is refused ("subscription does not permit querying recent SIP data"); a date-only `end` means the end of that day (so `end=today` is refused); real-time SIP snapshots are refused. Rate limit header: `X-Ratelimit-Limit: 200`.
- **(decided) SIP history for everyone:** `lib/marketdata/provider/primary.ts` uses `feed=sip` for daily/weekly/monthly bars (`getHistoricalBars` with a daily timeframe, `getDailyBarsChunk`, `getDailyBarsMulti`, `getDailyBarsRevalidated`), with `end` turned into an explicit instant capped at now − 16 min (`sipEnd`). Intraday bars and snapshots stay IEX (real time).
- **Today's bar** (`lib/dailyBars.ts` `liveBar`): the 15-min-delayed consolidated bar gives open/range/volume, the real-time snapshot's regular-session price is the close (widening high/low). In the first ~15 min after the open there is no delayed bar and the snapshot's own (single-venue volume) bar is used.
- **Earnings reactions** (`app/api/earnings/list`): today's close in the closes series is replaced by the live price (the delayed bar would be 15 min stale).
- **Re-pull without a gap:** `nt_daily_bars_cover.feed` (new column). Coverage only counts when `feed = 'consolidated'`, so old rows are re-fetched and overwritten (upsert) while still being served until then.

### Universe
- **Listings (decided: Nasdaq Trader directory, not the vendor asset list):** the vendor's asset list answers only on the live trading host (paper host 401 with these live-account keys); the app keeps to the paper host. `lib/referenceData/listings.ts` parses nasdaqlisted.txt + otherlisted.txt (ETF flag, test-issue flag, exchange). Drops test issues, `$` preferreds, `.W/.U/.R` suffixes and non-ETF names with warrant/unit/right/preferred/notes/debenture/coupon %. ADR = name says American Depositary / ADS / ADR. 11,675 listings kept (5,904 stocks, 5,771 ETFs).
- **Index flags (decided):** S&P 500 = SPY holdings xlsx, Dow 30 = DIA holdings xlsx (SSGA; parsed by a small built-in zip/xlsx reader, no dependency), Nasdaq-100 = Nasdaq's list API (101 incl. GOOG/GOOGL) with Invesco QQQ JSON as second source (it returned 406 to repeated scripted requests). Plausibility ranges; a failed index keeps its old flags. **Russell 1000: no reachable file** (iShares serves HTML to scripts, Vanguard 404), so `in_top1000` = top 1000 active non-ADR common stocks by market cap, labelled as an approximation. Known gap: foreign issuers whose listing name doesn't say "Depositary" (e.g. TSM) count as US.
- **Liquidity (decided: $50M/day):** 20 settled consolidated sessions for every active listing, weekly, via `getDailyBarsPaced` (paced, resumable through `nt_us_universe_jobs`). $10M/day let in 3,512 names; $50M → 1,904 liquid (1,421 stocks, 483 ETFs). Scanner = active AND (liquid OR S&P 500 / Nasdaq-100 / Dow 30 / Top-1000) = **1,907** today. **(decided) latest only**: no membership history is kept (bars for scanner symbols are stored daily anyway).
- **Metadata (decided: weekly Railway Python worker):** `railway/us-universe-meta-cron/meta_worker.py` (yfinance) pulls symbols from and posts results to `/api/cron/us-universe-meta` (cron secret), so Railway holds no DB credentials. Yahoo sectors → GICS 11 names. Existing `securities` metadata seeds 596 rows (never writes `securities`).
- **Files:** `lib/usUniverse.ts`, `lib/usUniverseRules.ts` (pure), `lib/referenceData/{listings,indexHoldings}.ts`, `app/api/cron/us-universe/route.ts` (listings → indexes → liquidity; steps skip while < 6 days old; `?force=1`), `app/api/cron/us-universe-meta/route.ts`, `scripts/bootstrap-us-universe.mjs` (DDL, `--dry-run`; run once), Railway: `railway/us-universe-cron/Dockerfile` (Sat every 10 min 14–16 UTC), `railway/us-universe-meta-cron/{Dockerfile,meta_worker.py}` (Sun 15:00 UTC) in `railway/.railway/railway.ts`.

### Split detection (`lib/splitCheck.ts`, `warmDailyBars`)
- The daily top-up re-requests 7 calendar days before each symbol's coverage end. If every overlapping stored close moved by > 0.5% and all by the same ratio (±1%), the symbol is rebased: bars and coverage dropped (`invalidateDailyBars`), full history re-pulled next run; reported in `WarmResult.rebased`. One revised print or noise is not a split. Closes the 2026-10-22 follow-up.
- `warmDailyBars` now warms tracked ∪ scanner symbols.

### Verified
- Live runs from a local dev server against the shared Neon DB and live sources: `bootstrap-us-universe.mjs` (dry run, then run); `/api/cron/us-universe` 7 calls (~50 s each): 11,675 listings, 503/101/30 index members all matched, liquidity for 11,675 symbols with 0 failed requests; meta worker run locally: 861 stocks in 107 s, 0 errors, Top-1000 reached 1,000; `/api/cron/daily-bars` 4 calls: 1,947 symbols, ~504k consolidated bars stored, 0 failed chunks, 0 rebased; AAPL stored bars now consolidated (10-22: 348.22, 47.0M).
- `scripts/test-us-scanner.mjs` (8 tests: listings classify/parse, holdings parse, split check 2:1 / 1:10 / noise, liquidity rules, `sipEnd` EDT/EST). `tsc` clean. `railway config plan`: 2 to add, 0 to change.

### Not verified / not done
- **Railway not applied** (`railway config apply` waits until this code is deployed, else the services would call routes that 404 in production). Docker images not built.
- `liveBar` merge, the earnings today-close override and the chart's change in past-candle values were not viewed in a browser; split detection has not seen a real split yet (fixtures only).
- Holdings sources are third-party web endpoints that can change or block without notice (Invesco already did); the cron reports per-index errors and keeps old flags.

---

## 2026-10-23 — Vendor masking: market-data facade (`lib/marketdata`), no vendor names reach the browser

Step 1 of the US Market Scanner build (plan agreed 2026-10-23: full repo masking, env var names kept since they are server-only).

- **Facade:** `lib/marketdata/index.ts` (server-only) re-exports everything callers need under neutral names and types (`lib/marketdata/types.ts`: `Bar`, `Snapshot`, `OptionSnapshot`, `CalendarRow`, `NewsArticle`, `UsAsset`). `lib/alpaca.ts` → `lib/marketdata/provider/primary.ts`, `lib/tradier.ts` → `lib/marketdata/provider/fallback.ts` (git mv; `AlpacaBar`/`AlpacaSnapshot`/`AlpacaOptionSnapshot` → `Bar`/`Snapshot`/`OptionSnapshot`, `getBarsForChart` exported as `getFallbackBars`). Client-safe `lib/marketdata/intervals.ts` (`ChartInterval`, `isIntradayInterval`).
- **Moved into the provider:** the trading-calendar fetch (`fetchCalendar`, used by `lib/marketSession.ts`), the news fetch (`fetchNewsPage`, used by `lib/earnings.ts` `newsPages`, formerly `alpacaNews`), and the home route's duplicate inline client (`getDailyBarsRevalidated`, same 5-minute Next fetch cache). New for later steps: `fetchUsAssets` (asset list) and `getDailyBarsPaced` (sequential, shared request gate at 150/min, exponential backoff honouring Retry-After, failed chunks reported, never treated as "no bars").
- **Leaks removed:**
  - **Client bundle (verified):** `StockAnalysis.tsx` / `OptionContractModal.tsx` imported `isIntradayInterval` from `lib/alpaca.ts`, which shipped `ALPACA_API_KEY`/`ALPACA_SECRET_KEY` names, the data host URL and a console warning to the browser. A baseline build had vendor strings in 3 `.next/static` files; after: 0.
  - `/api/test-alpaca` and `/api/test-tradier` (public; returned the first 5 characters of each API key, host URLs and raw vendor payloads) removed; replaced by `/api/diagnostics/market-data` (pass/fail, counts, timings only). `/diagnostics` page updated.
  - `/api/stocks/[symbol]/ohlc` no longer returns `source: 'alpaca' | 'tradier'` (nothing in the client read it). `dailyBars.ts` uses `'primary' | 'fallback'` internally; `toVendorBars` → `toBars`.
  - Option-bars 403 message no longer names the vendor or echoes its message.
  - Earnings results: `source` sent to clients is now `'news' | 'calendar'` (mapped in `toResult`); the stored DB values (`alpaca_news`, `alphavantage`) are unchanged.
  - UI text: earnings page footer "(Alpaca IEX)" and the extended-hours pill tooltip "last IEX trade" → neutral. Comments across app/lib/components neutralised.
- **Not changed:** env var names (`ALPACA_*`, `TRADIER_*`; server-only, verified no `NEXT_PUBLIC_`), scripts under `scripts/` (server tooling), docs, stored DB values.
- **Verified:** `tsc` clean; eslint 0 errors on changed files; `npm run build` passes; `.next/static` grep for vendor strings = 0 files (3 before, from a baseline build of the previous commit). Production server (`next start`) smoke test with live data: `/api/diagnostics/market-data` (quotes, daily bars, symbol search all ok), `/api/stocks/AAPL/ohlc?interval=daily` (from `nt_daily_bars`), `/api/stocks/SPX/ohlc?interval=1hour` (fallback path, volume 0), `/api/market/indices`, `/api/stocks/search?scope=remote`, `/api/home/data`, `/api/stocks/AAPL/quote` (session `regular`).
- **Not verified:** pages not opened in a browser; earnings cron (calendar/news via the facade) not run end to end, only type-checked (the news call is the same request as before); option-bars 403 path not triggered.

---

## 2026-10-22 — Quadrant chart: drag-to-pan and pinch-zoom on touch screens

Reported: on a phone the quadrant could not be moved.

- **Cause (code reading):** `components/charts/QuadrantChart.tsx` panned with `onMouseDown/Move/Up` only. A finger drag produces no mouse move events (only a tap synthesises mouse events), and the wrapper's `touch-action: none` stops the browser scrolling instead, so nothing happened. The component is shared with the scan-alerts latest/historical pages, which get the fix too.
- **Fix:** Pointer Events (mouse, touch, pen) for pan; two fingers pinch-zoom around their midpoint (minimum span 5% of the full range); pointer capture starts once a pan begins (so a plain tap/click still reaches a dot, and a mouse drag that leaves the plot keeps working); a pan or pinch suppresses the dot click as before. The + / − / Reset buttons are unchanged. Hint text now says pinch.
- **Verified:** `tsc` clean. **Not verified:** not tried on a phone or in a touch-emulating browser (pan, pinch, tapping a dot, mouse drag and wheel on desktop). `touch-action: none` is kept, so a finger on the chart does not scroll the page; scroll from the margins or the area outside the plot.

---

## 2026-10-22 — Daily bars stored in Postgres: far fewer Alpaca calls for the stock chart and levels

Requested: keep the past daily data and fetch only today's from Alpaca (like the quadrant page), to cut Alpaca calls and the join work.

- **`lib/dailyBars.ts` (new), tables `nt_daily_bars` (symbol, bar_date, o/h/l/c/v) and `nt_daily_bars_cover` (per symbol, the date range already pulled; created on first use, like `nt_price_cache`).** Days before today (US/Eastern) are final: pulled from Alpaca once and stored. A request fetches only the missing edge: older days when the user scrolls back, newer days since the last visit. Weekends/holidays are not re-asked because coverage is by date range. Today is never stored: one live Alpaca call, reused for 15 s so the chart and levels requests of one page load share it.
- **Failures:** a failed fetch stores nothing and records no coverage (retried next request); stored days are still served; the OHLC route reports the error only if there is nothing to show. Tradier is the fallback for indices (SPX), as before.
- **Used by:** `/api/stocks/[symbol]/ohlc` for `interval=daily` (the chart and the option-contract modal); the levels route's per-date reference close (`lib/dayBars.ts`, which no longer calls Alpaca itself). Intraday intervals still go straight to Alpaca (not stored: too much data, short ranges).
- **Effect:** a daily-chart open was 2 Alpaca bar calls (chart + the levels reference I added earlier today); now 1 small call for today (0 outside trading days or when cached), and the first visit to a stock fills its history once. Scroll-back chunks and Price Levels table ranges: 0 Alpaca calls once stored.
- **SPLITS NOT HANDLED (agreed, to be planned):** Alpaca bars are split-adjusted, so after a split the stored earlier days are stale. `invalidateDailyBars(symbol)` clears a symbol so it is re-pulled adjusted (manual fix until a split check exists); the 30% guard in `referenceClose` stops a stale unadjusted/adjusted mismatch from skewing level proximity.
- **Verified (live Neon + Alpaca, LITE and SPX):** first fill 37 bars in 0.5 s; repeat 0.1 s; widening the range back to July fetched only the older edge (80 bars, 0.28 s); stored bars equal a direct Alpaca fetch (0 mismatches of 37); the ohlc route handler run directly returns the same bars with `timestamp`/`date` fields, from the table in 0.1 s; SPX via Tradier. `tsc` clean. The Alpaca call counts are from the design (the client counted no requests: the Alpaca client is its own axios instance); timings are the evidence. **Not verified:** in a browser; concurrent requests; the quadrant page was not moved onto this table.
- **History backfill and daily top-up (`warmDailyBars()` in `lib/dailyBars.ts`):** fills every tracked symbol (`nt_market_expiries`, source `eod`, seen in the last 30 days; 633 today) in bulk, 100 symbols per request series (`getDailyBarsChunk` in `lib/alpaca.ts`, which throws on failure, unlike `getDailyBarsMulti`). Symbols are grouped by the date range they are missing, so the daily run is one request for everyone. Coverage only advances for symbols whose chunk succeeded; symbols Alpaca has no bars for and that were never stored (SPX, NDX; indices) are left to the lazy Tradier path. Runs: (1) at the end of the catalog step of `/api/cron/market-catalog` (every 30 min, 8:30-11:30 CT weekdays), before the option-volume capture, with a 20 s budget; resumable, so the history backfill needs no manual step; (2) `GET /api/cron/daily-bars` (cron secret, no time window, 50 s budget, `?days=` default 380, `?symbols=`) for an on-demand run.
- **History backfill was run once from this machine against the shared Neon DB (the live tables):** 633 symbols, 8 chunked request series, 163,707 bars in 57 s (the DB inserts are most of it); stored range 2025-10-07 to 2026-10-21, 631 symbols / 164,572 bars; a second run planned only the 2 symbols Alpaca has no bars for (SPX and one more). The cron's 20 s budget means the first cron day takes a few runs if the backfill had not been done; the daily top-up afterwards is 1 request.
- **Left in the table:** LITE's lazy test rows are now part of the full set. SPX's test rows were deleted.
- **Follow-ups:** split detection plan; the quadrant's past-date closes (`lib/quadrantPrices.ts`, 12.5 s first open) could read this table; move the new tables into the bootstrap scripts if wanted (created on first use, like `nt_price_cache`); the 2 symbols with no Alpaca bars are retried (one cheap request) every run.

---

## 2026-10-22 — Stock page: level proximity measured against each date's own close; Open/High/Low in the Price Levels table

Requested: the levels' proximity % was computed at the stored close, which is a day behind the date shown; use the same date's OHLC (as the quadrant page does) and highlight the matching level; show Open/High/Low next to Close in the table.

- **Cause (known, see 2026-10-16):** `eod_usmkts_price.close` for load date D is session D−1's close. Re-checked on LITE: stored 850.70 for 10-22 vs Alpaca closes 10-21 = 851.22, 10-22 = 765.00 (intraday).
- **Fix (server, `app/api/stocks/[symbol]/levels/route.ts`, range mode):** `lib/dayBars.ts` fetches the daily bars for the requested range in parallel with the DB read (Alpaca, Tradier for indices; a failure just means no bars). For each row with a bar, `calculated`, `closestLevel` and the seven levels' `value` are computed against **that date's own close**; the response row gets `close` = that close, `eodClose` = the stored one, and `open/high/low`. Rows with no usable bar (today before the open, fetch failure) keep the stored close, which is then the actual last close. A bar more than 30% away from the stored close is ignored (split-adjusted bar vs unadjusted levels, bad print). Cost: one extra Alpaca daily-bars call per levels range request (chart open, scroll-back chunk, table range); no new client calls.
- **Client (`StockAnalysis.tsx`):** the crosshair tooltip's level percentages and highlighted level, the Price Levels History percentages/highlight, and the chart's dashed price lines / blue closest level for a historical expiry (and the Analysis line's price, via `latestRefClose`) now follow the date's own close. With a live price (current expiry) the latest row is still measured against the live price as before. The table gains Open, High, Low and Close (the date's own close), plus "EOD close" (stored, previous session) hidden by default; saved column choices keep their ids, new columns follow the saved order.
- **Level prices themselves are unchanged**; only the % distance, the highlight and the price shown change. I changed the table's Close too rather than showing a stored close beside the candle's OHLC (that would have looked wrong); the stored one is available as "EOD close".
- **Verified:** `tsc` clean. Live check (LITE, SPX): `getDayBars` returns each session's bar by ET date (10-12 to 10-22), `referenceClose` accepts 765.00 against stored 850.70, SPX falls back to Tradier. **Not verified:** the route end to end (needs a signed-in session) and nothing viewed in a browser: tooltip, table columns, highlight; scroll-back chunks (they use the same route). Level lines are still drawn against split-adjusted candles as before.
- **Not changed:** quadrant, watchlists, earnings, home and scan alerts keep their own reference prices; the details route's `stockData.close` (used for the header fallback) is still the stored close.

---

## 2026-10-22 — Stock page: live quote in the header for historical expiries too

Reported: with Historical expiry selected, the header price was the last stored EOD `close` (`stockData.close`), not the live ticker quote.

- The header price, Live / At close tag, day change, day range and extended-hours move (chart header and the collapsed bar) now use the live quote in every mode. New `TVChart` prop `quotePrice`; `livePrice` (still current-mode only, `basisPrice`) keeps driving what must stay tied to the expiry: the last-candle live nudge, the closest-level marker, the levels rebased onto the live price and the Analysis line. So a historical expiry's candles and levels are untouched.
- **Verified:** `tsc` clean. **Not verified:** not viewed in a browser. In historical mode the Analysis line still measures the stored close, so it can differ from the header price.

---

## 2026-10-22 — OI tracker: underlying Close column

Requested: the underlying's close price in the OI flow contract table, between Type and Mny %.

- `app/oi-tracker/page.tsx`: new "Close" column (`r.close`, already on `OiContractRow` as the report's underlying close from the last load in range; shows "—" when 0). No query change. The stock modal's Contracts tab is unchanged.
- **Verified:** `tsc` clean. **Not verified:** not viewed in a browser; the report's `close` for load date D is presumed to be the previous session's close like `eod_usmkts_price` (unverified for `us_opt_chg_rpt`).

---

## 2026-10-22 — OI tracker: Trade date column, and SPX / NDX / SPY / QQQ excluded by default (toggle)

Requested: a trade-date column for when the OI change took place; a way to leave out SPX, NDX, SPY, QQQ, on by default.

- **Trade date** = the trading *session* whose activity produced the change, i.e. the day before the report's load date (see "OI change on load date D reflects session D−1" in `docs/oi-tracker.md`), not the load date. `OiContractRow` gains `tradeDate` (latest session in the range) and `firstTradeDate`; `lib/oiTracker.ts` carries `m.session` through the `r`/`a` CTEs (`MIN/MAX(session)`). The contract table shows "Trade date"; over several days it shows "Trade date (last)" plus "Trade date (first)", since rows are summed per contract. Also in the stock modal's Contracts tab. Grouped views are unchanged (the "By date" grouping already lists load dates).
- **Exclusion:** `exclude=SPX,NDX,SPY,QQQ` query param (`excludeSymbols` in `OiScreenParams`, `NOT (symbol_und = ANY(...))` in SQL), sent by the page for the OI flow, By stock and Strategies tabs, so KPIs and rankings drop them too. A filter-bar toggle "SPX · NDX · SPY · QQQ: Excluded / Included", **Excluded by default**; the choice is kept in this browser (`localStorage` `oiTracker.excludeBig`) and read before the first request, so it causes no second load. Ignored while a symbol list is typed in (explicit symbols win). The stock modal is a single symbol and unaffected; matching is exact (SPXS, SPXL etc. stay in).
- **Verified (live DB, 2026-10-22 load):** SPX/QQQ/SPY/NDX are the underlying names in `us_opt_chg_rpt`; contracts 13,814 → 10,961 with the exclusion; `tradeDate` is 2026-10-21 for the 10-22 load; a 4-load range gives first/last sessions per contract. `tsc` clean, eslint 0 errors.
- **Not verified:** not viewed in a browser (column placement, toggle, remembered choice).

---

## 2026-10-21 — Stock chart: "Alt" toggle, saved chart settings, resizable height, reset

Requested: an Alt button beside Price / OI that hides Call Low and Put High when on; save the chart's settings (other buttons, date/interval selection, height) per user and use them to load the right data first time; a reset to defaults.

- **Alt** (`TVChart.tsx`): on = Call Low and Put High are not drawn (level lines, dashed price lines and the crosshair tooltip rows); off (default) = shown, as before. Folded into the level-isolate visibility effect, and new level series start with it applied (a chart rebuilt after an interval switch would otherwise show them).
- **Saved settings:** one pref `chart.settings` in `nt_user_prefs` (localStorage `chartprefs` when signed out): interval, expiry, period (1D…ALL), Price, OI, Fit levels, Alt, chart height (360-1200 px), timeframe overlay open/closed. Validator `normalizeChartPrefs` in `lib/chartPrefs.ts` (invalid fields fall back to defaults); registered in `lib/userPrefs.ts`. Hook `components/charts/useChartPrefs.ts`: one GET per page load (module cache, so the watchlist chart remounting per symbol doesn't refetch), debounced 600 ms PUT, flush on unmount.
- **Fewer API calls:** `StockAnalysis` waits for the saved settings before its first load, so the OHLC request uses the saved interval and the levels request the saved expiry, rather than loading daily/nearest and reloading. Signed in this costs one small prefs GET up front; signed out, none. The saved expiry is used only if the stock still lists it (else the nearest); past (historical-mode) expiries aren't saved. The saved period is re-applied whenever the data window is replaced (open, symbol, interval switch), which also fixes the highlighted period button not matching the view after an interval switch.
- **Height:** drag the grip at the bottom of the chart (double-click = default); saved when the drag ends. Not on the embedded watchlist chart (fixed 520).
- **Reset:** the ↺ button in the chart toolbar returns toggles, period, height, interval (daily) and expiry (nearest) to the defaults and deletes the saved pref.
- **Verified:** `tsc` and eslint (0 errors) pass; `normalizeChartPrefs` run on good/clamped/invalid input. **Not verified:** nothing run in a browser: the Alt toggle on live data, the resize drag, saving/loading signed in vs out, the request count on open (expected: no duplicate OHLC/levels load), reset.
- **Follow-ups:** the resize handle overlaps the bottom ~10 px of the time axis around the centre; the embedded chart shares interval/expiry/toggles with the main chart by design.

---

## 2026-10-21 — Tables: reorder and resize columns (saved), reset, and Earnings "Refresh quotes"

Requested: let users move and resize table columns on every page, saved like the show/hide choice, with a reset; add a quotes refresh to the Earnings page.

- **Storage:** `cols.<tableId>` in `nt_user_prefs` (or localStorage when signed out) now holds `{ hidden, order, widths }` (`ColumnPrefs`, `lib/tableColumns.ts`; `normalizeColumnPrefs` validates on server and client, clamps widths to 40-1200 px). Older saves (a bare list of hidden ids) are read as `{hidden}`. Ids missing from `order` follow the saved ones in the table's own order, so new columns appear without a migration. One GET/PUT per table, as before.
- **Hook** (`components/ui/useColumnPrefs.ts`): adds `layout`, `order`, `ordered(ids)`; `menu` now carries `order`/`onOrder`; reset clears visibility, order and widths (DELETE).
- **`components/ui/ColRow.tsx` (new):** a `<tr>` that reorders its cells and applies widths. Cells of registry columns carry `data-col="<id>"`; only those cells are permuted, within the positions they hold (action/remove cells stay put). Header rows get a resize handle on each cell's right edge (double-click resets that column; a click without movement does not pin a width) and cells can be dragged onto another header to reorder. Resized columns clip long cell text with an ellipsis.
- **Columns menu:** drag or ▲▼ to reorder, "Reset columns".
- **Converted tables:** earnings, performance (both), scan alerts latest/historical, quadrant, watchlists, watchlist chart panel (its own colgroup/localStorage resizing was replaced by the shared system, so its old saved widths `watchlistWChart.colWidths` are no longer read), stock page earnings history, price levels history and option chain, OI tracker `DataTable` (all OI tables with a `tableId`).
- **Earnings page:** "Refresh quotes" button re-fetches `/api/earnings/list` (fresh quotes and reactions, `cache: no-store`) in place without the full-page spinner, shows "Quotes as of hh:mm:ss", keeps the old rows and says so if a refresh fails.
- **To add to a new table:** `data-col` on every registry `<th>`/`<td>`, `<ColRow layout={cols.layout}>` for the header (`header`) and body rows; a header cell that must stay sticky needs `sticky` in its own className (ColRow otherwise sets `position: relative`).
- **Verified:** `tsc`, eslint (0 errors) and `npm run build` pass. A server-render test of `ColRow` (order permutation within slots, fragments, falsy cells, widths, handles) and of `normalizeColumnPrefs`/`resolveOrder` (legacy list, clamping, bad input). **Not verified:** nothing was exercised in a browser: drag-to-reorder, resize, sticky headers on the stock tables and watchlist panel, the Refresh button, and signed-in saving/loading of the new shape.
- **Follow-ups:** the Symbol column of tables whose registry omits it stays first; the watchlist chart panel keeps `table-layout: fixed`, so very wide saved totals scroll horizontally.

---

## 2026-10-21 — Stock chart: Call Low and Put High lines

Requested: plot call low and put high on the chart, current and historical, whenever data exists.

- `components/charts/TVChart.tsx`: two more level line series (`call_low`, `put_high`, colours from `getLevelColor`), fed from each day's `sevenLevels` (already returned by the levels route, so no API change); values of 0 ("no data") are skipped like the other levels. The dashed price lines for the current levels also include these two, taken from the newest loaded day. They obey the existing level-isolate filter and "Fit levels" toggle.
- **Verified:** `tsc` clean. **Not verified:** not viewed in a browser. The level chips below the chart still list only the 5 ladder levels (extended ones are in the tooltip and now on the chart).

---

## 2026-10-21 — Historical expiry chart showed another expiry's levels in the crosshair tooltip

Reported: with a past expiry (QQQ 2026-10-19) selected, the tooltip on the 2026-10-21 bar listed Algo Levels, and the level lines/labels did not match the Price Levels History table.

- **Verified (DB):** `eod_usmkts_price` has no QQQ rows for expiry 2026-10-19 after trade date 2026-10-19, and the 10-19 row (put/call int 713.16, call int 730.69, ...) matches the table. The tooltip's 745.49 / 730.22 / 710.40 therefore came from a different expiry.
- **Cause (by code reading; the trigger was not reproduced):** the levels effect in `components/stock/StockAnalysis.tsx` replaced `historicalLevels` / `levels` / OI only on a successful response with a body. A non-OK response (e.g. the 429 from the 10-a-minute range limit when clicking through expiries), an exception, or an empty history left the previous expiry's data in state, and the chart kept using it.
- **Fix:** `levelsExpiry` records which expiry the map was loaded for and the chart only gets the map while it equals the selected expiry; every failure path (non-OK, exception, empty history) now clears map, price-line levels, closest level and OI.
- **Verified:** `tsc` and eslint clean. **Not verified:** not run in a browser.
- **Not changed (by design):** the stored `close` for load date D is session D-1's close (see 2026-10-16 entry), so the 10-19 row's close (709.80) differs from the 10-19 candle's close.

---

## 2026-10-21 — Securities refresh: market caps, tiers, and 66 symbols that had no `securities` row

Requested: re-check which market-cap tier each stock belongs in; SPCX was missing from mega.

- **Cause (verified):** SPCX (and 65 other symbols on the latest EOD load) had no row in `public.securities`, so every cap/sector/industry filter ignored them. The table is a one-off yfinance load from 2026-04-20 (owned by the sister app's loader); nothing in this repo wrote `market_cap`/`market_cap_tier`.
- **New:** `scripts/refresh-securities.mjs` (dry run by default, `--apply` writes) + `scripts/fetch-market-caps.py` (yfinance, 3 workers, retries on 429; needs `pip install yfinance`). Updates `market_cap` + `market_cap_tier` of existing rows, inserts missing symbols (id = uuid, market_id 1, source `yfinance`), never deletes, never touches indices/weights/earnings columns. Lookups that fail are skipped, so re-running is safe and idempotent.
- **Tier cutoffs:** mega ≥ $200B, large ≥ $10B, mid ≥ $2B, small ≥ $300M, micro ≥ $50M, else nano. mega/large/mid fit the existing data exactly; the small/micro/nano boundaries are the usual convention, **the original loader's rule was not seen**.
- **Result (verified by query):** SPCX inserted as mega ($2.1T); 66 rows inserted, 0 symbols on the latest EOD load are now missing from `securities`; ~27 existing stocks changed tier (e.g. PANW, DELL, TMO, CRWD, MRVL, TD large→mega; PEP, MCD, TMUS mega→large). Tier counts: mega 69, large 402, mid 121, small 17, micro 2, none 33.
- **Not done / follow-ups:** 26 ETFs/indices/delisted names (SPX, NDX, TQQQ, SOXL, CMA, SNV, ...) and the 7 new ETFs have no market cap and keep a NULL tier. 9 lookups still failed on the last pass (FR, DAL, BLDR, MS, FIVE, SYF, COHR, BR, TMF), so those caps are from earlier passes; re-run to refresh. New rows have no `indices`, `sp500_weight` or `nasdaq100_weight`, and MANE has no name. The sister app's loader may overwrite these rows on its next run. The script is manual: no cron, and new listings will go missing again until it is re-run (a candidate for the `market-catalog` cron).

---

## 2026-10-21 — Quadrant chart: vertical drag-to-pan was inverted

Reported: dragging the quadrant background moved the stocks the opposite way vertically (drag down, stocks go up).

- **Cause** (`components/charts/QuadrantChart.tsx`, `onMouseMove`): the Y axis is a normal (non-inverted) numeric axis, so dragging down must shift the visible window up (`+ddy`); the code used `-ddy`. X was already correct (`-ddx`). The wheel-zoom code correctly treats Y as top = max, which is why only pan was wrong. The component is shared with the scan-alerts latest/historical pages, so they get the fix too.
- **Fix:** Y pan now adds `ddy` to the domain.
- **Verified:** by reading the code and axis setup only. **Not verified:** not run in a browser; please drag on `/quadrant` and a scan-alerts page to confirm the stocks follow the mouse in both directions.

---

## 2026-10-19 — Plan restriction: monthly & quarterly expiries only (no weeklies)

Requested: let selected plans see only monthly and quarterly expiry data, switchable on and off. Decisions (asked): a **per-plan feature flag**, enforced **server-side on every expiry-aware route**.

### Design

- New feature code `standard_expiry_only` (`FEATURE_STANDARD_EXPIRY_ONLY`, `lib/features.ts`) is a *restriction*, not a grant: ticking it on a plan in `/admin/plans` (or granting it to a user in the user editor) limits them to monthly/quarterly expiries; unticking lifts it. **No plan has it by default, so nothing changes until an admin enables it.** `ALL_FEATURES` entries gained `restriction?: true`; `/upgrade` and `/profile` show it inverted as "Weekly expiries" (✓ when not restricted).
- Rule (`lib/expiryAccess.ts`): standard = the 3rd Friday of a month (quarterlies are a subset), same as `expiryKind()`. A monthly moved to Thursday for a Friday holiday counts as weekly (as elsewhere in the app).
- Enforcement: lists are filtered; an explicit weekly `?expiry=` is rejected with 403 (`WEEKLY_EXPIRY_ERROR`); "no expiry given" defaults pick among standard expiries only (SQL predicate `NOT $standardOnly OR (DOW=5 AND DAY BETWEEN 15 AND 21)`).

### Changed

- `lib/db.ts`: optional `standardOnly` on `getLatestStockData`, `getHistoricalStockData`, `getStockDataAsOf`, `getNearestExpiryLatestForSymbols`. `lib/scanAlerts.ts`: `standardOnly` on `getScanAlerts` and `getAlertsForSymbolsByExpiry` (also feeds watchlist performance). `lib/oiTracker.ts`: `standardOnly` in `buildBase` (set only by `scopeExpiry()` in `lib/oiTrackerApi.ts`, never from the query string).
- Routes: stock `expiry-dates`, `levels`, details, `opt-chain`, `option-bars`, `scan-alerts` (chart markers); watchlist `levels`, `alerts`, `performance` (+ `[symbol]`); `earnings/levels`; `quadrant/data`; `scan-alerts/latest|historical`; `oi-tracker/screen|strategies|stock|meta` (incl. live chain and full-OI rows); **Telegram cron** (`std_only` per subscriber; weekly alerts are skipped but the cursor still advances, so lifting the restriction later does not blast a backlog). OI tracker page hides the "Weekly" filter when restricted.

### Verified

- `npx tsc --noEmit` clean; eslint on changed API/lib files: 0 errors.
- The SQL predicate against the live DB (AAPL, recent rows): unrestricted lists weeklies and monthlies; restricted returns only 3rd Fridays (2026-10-16, 11-20, 12-18, ...).

### Not verified / follow-ups

- No signed-in end-to-end run with a restricted plan (routes not exercised over HTTP; UI not opened). Enable on a test plan and check the stock, quadrant, OI tracker pages and a 403 on a weekly `?expiry=`.
- **Not restricted:** the public, CDN-cached `/api/home/data` (same data for everyone by design), and My tracked OI positions (a user's own entries). Say if either should be.
- `getStockFullOi`-style callers outside the routes listed, and `us_opt_chg_rpt`/earnings *list* routes, were not found to expose expiry choice; unverified beyond a code search.
- Anonymous visitors get the FREE plan's features, so the restriction applies to them if set on FREE.

---

## 2026-10-18 — Quadrant reference prices: tested, and a cache bug fixed before release

Tested the uncommitted quadrant price work from 2026-10-16 (entry below) before pushing it, including the parts that entry lists as unverified.

### Bug found and fixed (`lib/quadrantPrices.ts`)

- **Problem (reproduced):** the cache rows (`quadrant:latest`, `quadrant:close:<date>`) were reused for any request, but a row only holds the symbols it was captured for, and the route asks for the symbols of the
  *selected expiry*. On the latest load date those counts are 631 (2026-10-16), 326, 21, 6 and so on. After a request for a 6-symbol expiry, a request for the 631-symbol set got **4 of 631** prices: the small capture
  was marked `final` after the close and then served to everyone until the next session (the whole weekend), so nearly every dot silently fell back to the stored (previous-session) close. The day-close cache had the same
  flaw and was only protected by luck (the 4-of-6 capture was below its 80% completeness rule; a 20-symbol capture would have been stored).
  It matters today: the default expiry is now the 21-stock 2026-10-19 weekly.
- **Fix:** a cached row is reused only for symbols it covers. Missing symbols are priced and merged into the row (keeping its capture time and `final` flag), and a refresh includes the symbols the previous capture held, so a small
  request cannot shrink the cache. Symbols the vendor has no price for are stored as 0 ("attempted") so they are not requested again; 0 is never returned to callers. Up to 10 unpriced symbols count as "the vendor has none"; for a
  larger missing set, "nothing priced" is treated as a vendor failure and nothing is stored. In-flight de-duplication is now per symbol set.

### Verified

- Library against live Alpaca and the database (test rows removed afterwards): small set first, then 326, then 631 symbols: 4, 324/326 and 629/631 priced (the 2 missing are symbols with no vendor price); the repeat call is
  served from the table (52 ms, same `asOf`); the stored row holds 631 symbols with 2 remembered as "no price"; day close: a 20-symbol capture, then 631: 629/631, repeat 56 ms; the older 2026-10-15 row settles after one lookup (second call
  54 ms). The same small-first scenario on the unfixed code gave 4/631.
- The route's own code (`app/api/quadrant/data/route.ts`) run with only the login guard stubbed: a 6-stock expiry first, then the default expiry: 19 of 21 stocks on `last-close` and 2 `stored`; AAPL measured against 343.39 (the 10-16
  close) instead of the stored 342.00; the past date 2026-10-15 returns 628 stocks with `day-close`; `price` metadata present; the second call served from the cache (113 ms, same `asOf`).
- The real quadrant page and the scan-alerts page (which shares `QuadrantChart`) mounted in Chromium with mocked data: the badge reads "Live · 10:42 AM ET", "Last close" or "Close of 2026-10-16"; the Price and Prev close
  columns show `-` for a stock without a price; dots are positioned by the reference price; in the live state the page re-reads once per 5 simulated minutes (+1 request in 6 minutes) with no loading spinner and the new price shown,
  while "last close" (15 min cap) and past dates do not poll; no page errors on either page.
- `tsc`, eslint (0 errors) and `npm run build` pass.

### Not verified

- A signed-in browser session against the real route (the route was run with its login guard stubbed; the page with a mocked API).
- Pre-market behaviour of Alpaca's daily bar and cross-instance races (both noted in the entry below).
- `nt_price_cache` is created on first use by `ensureTable()` (it already exists in the shared database); it is not in the migrate scripts' table lists.

---

## 2026-10-16 — Quadrant: one reference price per stock (live / last close / that day's close), shared 5-minute cache

Requested: the quadrant plotted stocks from the EOD levels and did not use the current day's price; use the day's own
close for history, and a live price intraday, cached for all users (about every 5 minutes), keeping the last read after
the close until the next session.

### Findings (verified)

- **`trade_date` is the load date; the stored `close` is the previous session's.** Across 16 symbols and about 11 weeks
  (795 symbol-days) the stored close matched Alpaca's previous-session close in 781 and the same-day close in 14
  (the 14 were not investigated). E.g. the 2026-10-16 row: AAPL 342.00 vs Alpaca 10-15 close 341.91.
- The route already rebased the levels onto a live price for the latest date (so `closestLevel` / `closestValue` were live),
  but it still returned the stored `close`, and `QuadrantChart` placed the dot with `ladderX(close, levels)`. Dots were
  grouped by the live level and positioned by the old close. Past dates used the stored (D-1) close.
- Ruled out: the single 631-symbol snapshot request works (HTTP 200, 629 symbols with today's bar).

### What changed

- `lib/quadrantPrices.ts` (new), table `nt_price_cache` (created on first use, like `nt_rate_limit_hits`):
  - **Latest load date:** regular session -> last trade (via `buildQuote`), refreshed at most every 5 minutes for all users;
    otherwise the last regular close, captured once after the close (marked `final` 5 minutes after it, so the bar has
    settled) and served unchanged until the next regular session. Holidays/early closes come from `lib/marketSession.ts`.
  - **Past load dates:** the close of that date's own session from Alpaca daily bars, stored once per date (immutable).
  - A failed Alpaca call never overwrites a good row; the previous capture is served.
- `app/api/quadrant/data/route.ts`: uses the above; rows carry `refPrice` / `refSource` (`live`, `last-close`, `day-close`,
  `stored` = no price, EOD close used); response has `price: { source, asOf, session, nextChangeAt, isLatest }`.
  `livePrice` is kept (set for the latest date only).
- `components/charts/QuadrantChart.tsx`: x position and tooltip use `refPrice`. `app/quadrant/page.tsx`: a badge
  ("Live · 10:42 ET", "Last close", "Close of <date>"), a silent background refresh on the latest date (every 5 min in
  the regular session, 15 min pre/post, sleeping to the next boundary when closed), and columns "Price" and "Prev close"
  (the stored close). Saved column choices keep their ids. `types/stock.ts`: `refPrice`, `refSource` on `QuadrantStock`.

### Verified

- Against the live DB and Alpaca (script calling the module): first live read 1.2 s, 629 prices; second call served from
  the table (same `asOf`); 10-15 closes AAPL 341.91, NVDA 217.33 (match Alpaca); second call served from the stored row.
- With a faked clock: 16:01 ET capture not final; 16:10 ET capture final; the same row served at 23:00 ET and at 07:00 ET
  Monday (pre-market). (The fake clock only moved time; the prices themselves were read mid-session. Test rows deleted.)
- `tsc` and eslint (0 errors on the touched files).

### Not verified

- **No HTTP / browser check** of `/quadrant` (needs a signed-in Pro session): the badge, the silent refresh and the moved dots
  were not seen. `npm run build` was not run.
- Alpaca's pre-market `dailyBar` roll (same caveat as the 2026-10-14 quotes entry).
- Cross-instance races: two serverless instances can refetch in the same minute when a live row expires (harmless, one extra call).
- The first open of a past date fetches its bars (**12.5 s** measured for 631 symbols) before it is stored. Follow-up: warm it
  from a cron, or the previous trading day's close right after the session.
- Past-date closes are split-adjusted bars compared against unadjusted levels, as elsewhere in the app.
- Between the 09:30 open and the morning load (about 10:00 ET), the latest load date is still the previous one, so live prices
  are compared with the previous morning's levels (unchanged behaviour).

---

## 2026-10-17 — Rate limits: higher limit for users with live levels, admin-editable; far fewer level-history requests

Requested (after the stuck-chart / throttling report below): implement both options: raise the limit for users with the levels feature and cut
the duplicate requests, and make the rate limit configurable in the admin dashboard.

### What changed

**1. Limits are settings, with two tiers** (`lib/rateLimitConfig.ts`, new)
- Each limiter has a *standard* limit (anonymous and unentitled users, counted by IP when signed out) and, where it makes sense, an *entitled* limit for users with
  `FEATURE_LEVELS`. Window stays 60 s. Defaults:

  | Limiter | Standard | Entitled |
  |---|---|---|
  | `levels_range` (chart history) | 10 | **30** |
  | `levels_point` (stock header / one day) | 60 | **120** |
  | `oi_tracker` (Pro-only) | 90 | single tier |

- Stored in `nt_app_settings` (new table, key `rate_limits`); a saved value overrides the defaults and deleting it restores them. Read through a 30 s per-instance
  cache, so a change reaches every server within about 30 s (the one that saved applies it at once). Invalid or unreadable stored values fall back to the defaults.
- `/api/stocks/[symbol]/levels` and `/api/stocks/[symbol]` now *record* the hit in parallel with the user lookup (`recordHit`, keeping the latency optimisation from issue #4)
  and judge it afterwards with the right tier (`applyTieredLimit`). `lib/oiTrackerApi.ts` reads its limit from the config.

**2. Admin editor** — `/admin/settings` (new nav item "Settings"; also linked from the Heavy API users panel on the dashboard)
- `components/admin/RateLimitsEditor.tsx`, `app/admin/settings/page.tsx`, `app/api/admin/settings/rate-limits/route.ts` (GET / PUT / DELETE, admin only, 403 otherwise).
- Validation (server side): every limiter present, whole numbers 1–10,000, entitled limit never lower than the standard one, nothing for a limiter with no entitled tier,
  no unknown limiters. Shows "customised" badges, defaults, who changed it and when, and "Reset to defaults".

**3. The Heavy API users tile counts real rejections**
- The limit now differs per user, so "hits above one constant" no longer tells who was throttled. `nt_rate_limit_hits` has a new `blocked` column, incremented when a request in that
  minute is rejected; "Throttled min" = minutes with `blocked > 0`. (Flags from before this change drop off immediately: their rows have `blocked = 0`.)

**4. Fewer level-history requests** (`components/stock/StockAnalysis.tsx`)
- `levelsCoverageRef` records which symbol, expiry and date range the page already holds levels for (set when levels are fetched, widened when a scroll-back chunk is merged).
  Requests inside it are skipped: the mount effect (interval switches), the refetch effect, the scroll-back chunk's own levels call, and the Price Levels History panel,
  which now builds its rows from the loaded levels instead of asking again.

### Verified

- Library against the live DB (test rows removed, production left on the defaults): tiers resolve (10 / 30, 60 / 120, 90 single); 8 invalid submissions rejected and one valid one accepted;
  save → effective → customised view → reset; 15 hits in a window are rejected at the standard limit (and recorded), allowed at the entitled limit, and the counter-down case fails open;
  the heavy-users query flags the rejected minute and does **not** flag an entitled user who made 15 calls and was never rejected; `checkRateLimit` still allows 3 then rejects the 4th.
- Admin editor mounted in Chromium with a mocked API: Save disabled until a change; a server rejection (entitled < standard) shows its message; a valid save updates the badge and
  "last changed" text; Reset restores 10 / 30 / 60 / 120 / 90. Signed out, `/admin/settings` redirects to login and the API returns 403 for GET, PUT and DELETE.
- Request counts on a production build (anonymous, Chromium, counter cleared first), AAPL: opening the stock **2** level-history calls (was 4), switching to 1H **0** (was 3), 5m **0** (was 3),
  back to 1D 0, switching expiry 2; the sequence open → 1H → 5m → 1D → expiry cost 12 calls before and 2 + 0 + 0 + 0 + 2 = 4 now. The Price Levels History table still has its rows (3, same as
  the separate request returned). Dragging the chart back 6 times loads 5 older chunks at 1 chart-data + 1 level call each; the loading overlay clears and there are no page errors.
- `tsc`, eslint (0 errors) and `npm run build` pass.

### Not verified

- **Not seen with a real admin or entitled login:** the settings page and API were exercised with a mocked API (and the library directly); whether `levelAccessFor(...) === 'latest'` selects the entitled tier for a real Pro
  account is covered by the unit test of `applyTieredLimit` and by reading the route, not by a signed-in request.
- Expiry switch still costs 2 calls (the refetch for the new expiry and the history panel's own request run at the same time).
- Windows that were open before the deploy keep running their old code and need a reload.
- A user scrolling far back quickly makes one level call per chunk (5 chunks in 11 s in the test), which still needs the entitled limit to stay clear of 429.

### Deploy steps

- DDL already run on the shared database (additive): `node --env-file=.env.local scripts/bootstrap-app-settings.mjs` creates `nt_app_settings` and adds `nt_rate_limit_hits.blocked`.
  Running it again is safe, and the limiter also adds the column itself if it is missing.

---

## 2026-10-17 — Fix: stock chart stuck on "Loading … chart…" (my regression from 2026-10-16), and what the throttling is

Reported on production, in browser windows that were already open: the chart sits in a loading state forever, and "Heavy API users" shows
users throttled for minutes.

### Cause (reproduced on the production build)

- **Stuck overlay.** `skipLevelsRefetchRef` (added 2026-10-16 so a load-more doesn't re-request levels for the whole range) skips the
  levels-refetch effect once. The run that effect had just started (`setLevelsRefreshing(true)`) is cancelled by the same data change, and a cancelled
  run never clears the overlay (its `finally` is guarded by `cancelled`). With the refetch skipped, nothing cleared it, so
  `Loading <expiry> chart…` stayed on screen with every request already finished. Reproduced on AAPL (default expiry 2026-10-19, the Monday
  weekly, now that Friday's expired); it blocked clicks on the interval buttons for 30 s.
  Why it showed up now: the bug is in the code pushed in `28c462c`; open windows from before that deploy run older code (below).
- **Throttling is real and caused by call volume.** The tile reads the rate-limiter counters: "Throttled min" = minutes in which a user made
  10 or more `/api/stocks/[symbol]/levels?range=true` calls (`LEVEL_RANGE_RATE`, 10 per minute). Measured cost of normal use on the current build:
  about 4 calls to open a stock, about 3 per interval switch, 2 to 3 per expiry switch, so a few quick actions cross 10. In the counters
  (read-only query, last 48 h) there are 4 limiter buckets: two real accounts with 1 to 2 minutes at the limit now and then (one burst of 37 calls in an
  hour on 2026-10-16 18:00 UTC), one anonymous address, and `ip:::1`, which is my own local test traffic (it uses the same database).
- **Open windows keep running whichever bundle they loaded.** Tabs opened after `b699076` and before `6a586d3` run the 8px / 60-day version, which
  fetched about 4 older chunks (about 13 level calls) on every open; those tabs only get the fixes after a reload.

### What changed

- `components/stock/StockAnalysis.tsx`: when the levels refetch is skipped, `setLevelsRefreshing(false)` is called, so the overlay always clears.

### Verified (production build, Chromium, rate-limit counter cleared first)

- Before: the overlay `Loading 2026-10-19 chart…` still present 12 s after load, all requests 200.
- After: overlay gone after the default load, after switching to 1H, 5m and back to 1D, after switching expiry, and after dragging the chart back; no page
  errors. (The two 429s in that run were my test exceeding 10 calls in a minute: 12 calls in about 40 s.)

### Follow-up

- The 10 per minute limit and the request volume are addressed in the entry above (higher limit for users with live levels, editable at `/admin/settings`, and far fewer requests per page).
- Windows that were open before the deploy need a reload; nothing server-side can fix their client code.

---

## 2026-10-16 — Stock chart: 60-bar windows, 12px candles, free right fifth (and a load-more loop fixed)

Requested: load 60 bars instead of 100/120, make candles 12px, and use only 4/5 of the plot width, leaving 1/5 free on the right.

### What changed

- `components/stock/StockAnalysis.tsx`: daily `initialDays` / `chunkDays` 120 → 85 calendar days (about 60 trading bars).
- `components/charts/TVChart.tsx`:
  - `MAX_BAR_SPACING` 10 → 12px.
  - `FREE_RIGHT_FRACTION = 0.2`: `fitBarsCapped` sets `rightOffset` so the latest bar sits at 80% of the plot. Bars are fitted into the left 80% (spacing at most 12px).
  - The 1W / 1M / 3M / 6M / 1Y / YTD buttons now set a *logical* (bar-position) range ending 25% of its length past the last bar. A time range snapped to the last bar and showed no margin (seen in a screenshot).
- **Bug found and fixed on the way:** with the free margin, the chart loaded older history without end (15–31 OHLC chunks per page load, most of their level calls rejected with 429).
  - Cause 1: the data effect re-fitted the view after every chunk, which squeezed all bars together (spacing 6 → 7.5 → 5 → 3.8 px). The old guard (`isLoadingMore` / `loadingMoreRef`) was already false by then because the parent batches `setOhlcData` and `setIsLoadingMore(false)`. During that re-fit the chart reported a stale range and fired another load.
  - Fix: fit only when the data is replaced (first bar later or last bar earlier than before, or a new chart), tracked with `fittedRangeRef`; merely extending the data no longer touches the view.
  - Cause 2: the load-more triggers treated the margins we add on purpose as "scrolled past the data". They now need a 2-bar overshoot beyond the margins (`from < -2`, `to > last + rightOffset + 2`).
- `StockAnalysis.tsx`: after a load-more merges a chunk, the effect that re-requested levels for the whole loaded range is skipped once (`skipLevelsRefetchRef`), since the handler already fetched that chunk's levels. One level call per chunk instead of two.

### Verified (production build, Chromium, rate-limit counter cleared before each page)

- Page load now makes 2 OHLC and 4 level calls on AAPL (1490px), NVDA (1920px) and SPY (1280px), with no 429s. Before the fix, 15–31 OHLC calls with up to 23 rejected level calls.
- Screenshots: candles about 12px apart; the latest candle at about 80% of the plot width at 1490 and 1920px; with 3M and ALL selected at 1280px, also about 80% (measured from the images: 0.80).
- `tsc` passes; no page errors.

### Not verified

- Intraday intervals (1m–1H) keep their old windows; they use the same fit and load-more code but were not viewed.
- Free space with the 1W / 1M / 6M / 1Y / YTD buttons (3M and ALL were checked; the code path is shared).
- The embedded W Chart view (needs a login), phone widths, and a very wide screen (2560px+) where more than two chunks may be needed on open (each chunk costs one level call, against a limit of 10 a minute).
- Scrolling back by hand beyond the loaded data was not exercised after the fix.

---

## 2026-10-16 — Docs refresh

Updated the documents that still described the app as it was in January, after the chart, earnings, OI tracker and column work:
- `README.md`: features, project structure, signed-in API groups, other tables and bootstrap scripts, and a pointer to `CLAUDE.md` / `docs/CHANGES.md`.
- `QUICK_START.md` and `PROJECT_MASTER_PLAN.md`: the "future" items that now exist (authentication, watchlists, alerts) marked done, and a changelog line saying the plan predates the current app.
- `CLAUDE.md`: the chart rules learned today (price scale follows the candles, 10px cap, 120-day windows and the levels range limit of 10 calls a minute, zeros mean "no data" and are never plotted).
- Not changed: `docs/ADMIN_DASHBOARD_PROMPT.md` (admin pages weren't touched), `docs/earnings.md` and `docs/oi-tracker.md` (updated alongside their changes).
- The README's setup steps and level formula were left as they are; they were not re-verified here.

---

## 2026-10-16 — Column selection (Columns menu) on every table, saved per user

Requested: the same select / deselect columns option, with saved preferences loaded with the page, for the watchlists and OI tracker
pages and every other page that shows table data.

### What changed

One shared mechanism, then each table opted in:

- `lib/tableColumns.ts`: `ColumnMeta` (id, label, hint, `required`, `defaultOff`) and the list of table ids the preferences API accepts.
- `components/ui/useColumnPrefs.ts`: loads the saved choice and saves every change (debounced 500 ms).
  - **Signed in:** stored on the account in `nt_user_prefs` under `cols.<tableId>` (`/api/prefs/[key]`, which only serves the caller's own row).
  - **Signed out** (the stock page is public): stored in this browser's localStorage, with no request at all.
  - The value stored is the list of **hidden** columns. A column added to a table later is therefore visible by default.
  - The table stays invisible until the saved choice is known, so there is no flash of the default columns.
- `components/ui/ColumnsMenu.tsx`: the popover. A checkbox per column, "Show all", "Reset to default", a save status line
  ("Saved to your account" / "Saved in this browser"). Required columns (the row's link) can't be hidden. Escape closes the menu before it closes a modal.
- `lib/userPrefs.ts`: the key must be `cols.<known table id>` and the value a list of at most 60 well-formed ids.
  Anything else is rejected. This replaces the earnings-only validator from the earlier entry.

Tables, by table id:

| Table | Id | Where |
|---|---|---|
| Earnings tracker | `earnings` | `app/earnings/page.tsx` (moved onto the shared pieces) |
| Watchlists quotes | `watchlists` | `app/watchlists/page.tsx` (replaces its old non-saved "Customize" picker; Symbol is required, the other 11 columns are all selectable now) |
| Watchlist W Chart panel | `watchlistChart` | `app/watchlists/view/page.tsx` (hidden columns also leave the fixed width calculation) |
| Latest / historical scan alerts | `scanLatest`, `scanHistorical` | `app/scan-alerts/*/page.tsx` |
| Quadrant stock list | `quadrant` | `app/quadrant/page.tsx` |
| Performance (drill-down) and per-symbol | `performance`, `performanceSymbol` | `app/performance/**` |
| Stock page: price levels history, option chain, earnings history | `stockPriceHistory`, `stockOptionChain`, `stockEarnings` | `components/stock/StockAnalysis.tsx`, `EarningsPanel.tsx` |
| OI tracker (all tabs) | `oiFlowContract`, `oiFlowUnderlying`, `oiFlowExpiry`, `oiFlowStrike`, `oiFlowDate`, `oiTracked`, `oiStockContracts`, `oiStockExpiries`, `oiStockLive` | `components/oi/DataTable.tsx` takes a `tableId`, so every OI table gets the menu from that one change |

Not included: the admin pages (`/admin`, `/admin/users`, the drill-down and history modals, the behaviour panel); they are internal reports.

Behaviour notes:
- Conditional columns keep their conditions: Ext. hrs only shows while a row has an extended-hours print, and Earnings columns only for the earnings feature,
  even when ticked.
- On the option chain, a filter typed into a column the user then hides is ignored, so rows can't stay filtered invisibly.
- The embedded chart on the W Chart page doesn't load the stock tables' preferences (it doesn't show those tables).
- The earlier saved-value format (`earnings.columns`, a list of visible columns) was dropped; 0 rows existed.

### Verified

- Server (`lib/userPrefs.ts`, live DB, two test users, rows deleted): all 20 table ids accepted; unknown table, old key, extra suffix, non-list,
  non-string, malformed id and more than 60 entries rejected; duplicates collapse; "show all" (empty list) is stored; one user can't read or overwrite another's;
  tables are independent; delete resets.
- Browser (Chromium), the real page components mounted as a signed-in user on a temporary route (deleted afterwards) with mocked data and an in-memory preferences API:
  for **earnings, OI flow (contracts), latest scan alerts, historical scan alerts, quadrant list, watchlists, watchlist W Chart, stock earnings history and OI tracked positions**:
  unticking a column removes its header, the right key and hidden id are saved, the choice survives a reload, and "Reset to default" restores the column and clears the saved row.
  No page errors.
- Stock page, signed out, against real data (AAPL): price history 14 → 11 columns and option chain 12 → 10; saved to localStorage; the same columns after a reload;
  zero `/api/prefs` requests; Reset restores the default 14. A strike filter of 999999 cut the option chain from 295 rows to 1, and hiding the Strike column brought back all 295.
- `tsc`, eslint (0 errors) and `npm run build` pass.

### Not verified

- **Not seen in a browser:** the Performance page's drill-down tables and the per-symbol Performance page (their routes need params and a real session), the
  OI tracker's By-stock / group-by tables and the stock OI modal tables (they share `DataTable`, exercised through the contract and tracked tables), and Ext. hrs / the Earnings
  columns with live data.
- The real signed-in round trip against the real `/api/prefs` route (the browser tests used a mock of it; the route and library were tested separately and the route returns 401 signed out).
- Narrow screens, and the Columns menu inside the modal on top of other modals.

---

## 2026-10-16 — Stock chart: level and OI lines connect across days with no data (no more zeros, no gaps)

Reported (MSI screenshot): where levels or OI aren't available for some dates the lines show gaps. Instead they should
connect to the next available data point, show no point for the missing date, and never treat missing as 0.

### Cause (verified)

- **Gaps were my earlier change.** `breakAtGaps()` (2026-10-15 chart entries) made the point before a gap transparent so a
  line wouldn't be drawn across it. That is the opposite of what is wanted; it's removed.
- **Missing data is stored as zeros, not null.** In `eod_usmkts_price` (rows since 2025-10-01: 1.73M) there are no nulls in
  `call_oi`, `put_oi` or any level, but about 28.4k rows have call OI **and** put OI both 0, and 27.9k of those also have
  every level at 0; no row has OI at 0 with levels present. So "both OI values are 0" is the "no data" marker.
- Levels were already skipped when 0 (`price > 0` in `TVChart`), but **OI zeros were plotted as real zeros**
  (the OI lines dropped to 0 on those days), and the API coerced missing values to 0 with `COALESCE`.

### What changed

- `app/api/stocks/[symbol]/levels/route.ts`: a day whose call OI and put OI are both 0 now returns `oi: null` instead of zeros
  (a single-sided 0 is kept as real). The client already skips items with a null `oi` for the OI series, and the tooltip
  shows no OI block for such a day.
- `components/charts/TVChart.tsx`: removed `breakAtGaps()`; level and OI series get a point only for days that have data, so the
  curved line runs straight on to the next available point. The line style stays curved.
- `components/stock/StockAnalysis.tsx`: the `oi` type allows `null`. The Price Levels History table already shows "—" for a missing `oi`.

### Verified

- API against the production build for YETI (expiry 2027-05-21): the four zero days (09-22 to 09-25) return `oi: null`, and
  the real days keep their values.
- Real MSI history rendered in an isolated page with simulated missing windows: the old behavior drops the OI lines to 0
  and back; the new behavior skips those days and the curved line connects across smoothly (plain segments looked the same but
  angular; curved kept).
- Production build: `/stock/AAPL` and `/stock/MSI` load with no page errors; `tsc` passes.

### Not verified

- The exact MSI "Current" view from the screenshot with a Pro account (anonymous sessions get only about 10 days of level history).
- The tooltip on a day with no OI was not hovered in a browser (code path: `currentOiData` undefined).
- A very long gap with the curved style can overshoot slightly between points.

---

## 2026-10-16 — Earnings tracker: Market cap column and per-user column selection (saved to the account)

> **Superseded in part by the next entry up ("Column selection on every table")**: the saved value is now the list of *hidden* columns
> under the key `cols.earnings`, and the menu and hook are shared components. The Market cap column and the behaviour described below are unchanged.

Requested: add a market cap column to the earnings tracker, and a personal option to select and deselect columns;
save the preferences and use them when the page loads.

### What changed

- **Market cap column** (`marketCap`): compact dollars (`$4.0T`, `$17.2B`, `$850.0M`); `—` when `securities.market_cap` is missing
  (30 of 578 rows). Sortable (missing values always last). The tooltip shows the full value and the cap tier. The data was already in
  `/api/earnings/list` (`marketCap`, `marketCapTier`) and used for sorting and the Market cap filter; it just wasn't shown.
- **Columns menu** (button above the table): a checkbox per column, plus "Show all" and "Reset to default". Symbol is always shown (the row link).
  "Ext. hrs" stays conditional: it appears only when ticked *and* a row has a pre/after-hours print, as before.
- **Saved per user.** The choice is stored in the new table `nt_user_prefs (user_id, key, value jsonb)` (DDL run on the live DB) through
  `GET/PUT/DELETE /api/prefs/[key]`, which needs a login and only serves the caller's own row. The page loads the saved list with the
  first render (it waits for it, so the table doesn't flash the default columns), and each change is saved after 500 ms with a status line in the menu.
  If the request fails the choice still applies for that visit.
- A column added later is off for users who already saved a choice. The default for everyone else is all columns, Market cap included.

Files:
- `scripts/bootstrap-user-prefs.mjs` (new; added to the migrate lists)
- `lib/userPrefs.ts` (new; key whitelist + validators, ownership in SQL)
- `lib/earningsColumns.ts` (new; shared column registry)
- `app/api/prefs/[key]/route.ts` (new)
- `app/earnings/page.tsx` (the table is now driven by a column list)

The prefs table is generic: another page adds a key with its own validator in `lib/userPrefs.ts`.

### Verified

- `lib/userPrefs.ts` against the live DB with two test user ids (rows deleted afterwards):
  - Saves and reads back; Symbol is forced on.
  - An unknown column, a non-list, a list of non-strings and an unknown key are all rejected without changing the stored value.
  - B sees nothing of A's choice, B's write doesn't touch A's, deleting B's leaves A's.
  - Duplicates collapse to registry order.
- The real `EarningsPage` component in Chromium, on a temporary route (since deleted) with mocked list/levels/prefs responses:
  - 17 default headers (18 columns with Ext. hrs), with the Market cap column showing `$4.0T`, `$17.2B`, `$850.0M`, `—`.
  - The Symbol checkbox is disabled.
  - Unticking Company, Sector and Chg $ updates the table and sends one `PUT` with the new list.
  - After a reload the saved choice is applied.
  - "Reset to default" sends a `DELETE` and restores all columns.
  - Sorting by Market cap works in both directions with the missing value last.
  - No page errors.
- `tsc`, eslint (0 errors) and `npm run build` pass.

### Not verified

- The real page as a signed-in Pro user against the real API (needs a login); the API route's own login check was not exercised over HTTP while signed in
  (signed out it should return 401, checked below).
- Narrow screens and the table's horizontal scroll with all columns on.

---

## 2026-10-15 — Chart follow-up: curved lines restored, level history no longer rate-limited on load

Reported (screenshot of ROKU): the price level lines looked like a ladder instead of curves. Clarified: all five
level lines and the OI lines.

### Cause (verified)

1. **Ladder = my previous change.** I had set `lineType: 1` (step) on all eight line series (5 levels + Call OI, Put OI,
   OI Diff) to avoid loops that the curved style draws at the edges of data gaps.
2. **Regression found while checking it: HTTP 429 on level history.**
   - `/api/stocks/[symbol]/levels?range=true` allows **10 calls a minute** (`LEVEL_RANGE_RATE`).
   - With candles capped at 8px, the first 60 days no longer filled the chart, so it auto-loaded about four older
     chunks on open.
   - Each chunk fires two range calls: `handleLoadMore`'s own, plus the effect that re-fetches levels for the whole
     loaded range whenever `ohlcData` changes.
   - Measured: one AAPL page load made 13 level calls, 9 of them 429, so most of the level and OI history was
     missing from the chart.

### What changed

- `components/charts/TVChart.tsx`: all eight line series are `lineType: 2` (curved) again. The gap-breaking from the
  previous entry stays.
- `components/stock/StockAnalysis.tsx`: daily `initialDays` 60 → 120 and `chunkDays` 60 → 120 (first tried 200 / 180;
  the user asked for 100–120).
- `components/charts/TVChart.tsx`: `MAX_BAR_SPACING` 8 → 10px on request.
  - 120 days is about 85 bars; one 120-day chunk loads on open to reach the ~120 bars that fill the chart at 10px.
  - Wider screens may load one more chunk, which is still under the limit.

### Verified

- Request counts on a fresh page load (production build, rate-limit counter cleared first), with the final 10px /
  120-day settings: AAPL at 1490px, NVDA at 1920px and SPY at 1280px each made 2 OHLC and 5 level calls, with
  no 429s. The first attempt (60-day windows, 8px) made 13 level calls on AAPL, 9 of them 429.
- Screenshots at those widths: candles about 10px apart, filling the plot from early March to today.
- Line styles compared in an isolated page using ROKU's real Oct 16 history from the DB (163 days, Feb 20 – Oct 15):
  step is the ladder; curved is smooth, with small dips where a level jumps; plain is straight and slightly angular.
  Curved was chosen as requested.
- `tsc` passes; eslint 0 errors.

### Not verified / notes

- **I could not see the real chart with full level history.** My browser session is anonymous, and the levels
  route limits non-Pro viewers to about 10 days (`DELAYED_RANGE_DAYS`), so level lines look sparse there. The
  curved-style check used the DB data in an isolated page instead. Please look at a Pro account's stock page.
- Curved lines can still show small hooks at the edge of a *real* gap in the data (a sparse expiry); with dense
  history there are none.
- Free-tier (delayed) viewers get a ~10-day sample of level history per request, so their level and OI lines are
  short fragments, and the curved style shows small hooks at their ends. This only affects viewers without live levels.
- The duplicate whole-range levels fetch on every `ohlcData` change is unchanged (it costs one extra call per chunk).
- Not run: 1m–1H intervals, whose windows are unchanged.

---

## 2026-10-15 — OI tracker: watchlist filter

Requested: add the watchlist filters to the open interest tracker.

### What changed

The OI tracker's filter bar has a **Watchlist** dropdown, the same one the latest scan alerts page uses.
- It lists the user's own watchlists, then the curated sector/index lists. It defaults to All stocks.
- It applies to the OI flow, By stock and Strategies views. It combines with Symbols, Sector and Index, and the
  result is the overlap.

Files:
- `lib/oiTracker.ts`: `watchlistId` / `userId` params, and `resolveSymbols()` intersecting symbols, securities
  filters and watchlist. An empty list returns no rows, not everything.
- `lib/oiTrackerApi.ts`: `watchlist` query param, and `scopeWatchlist()`, which binds the list to the caller. Without
  the Watchlists feature the filter is ignored.
- `app/api/oi-tracker/{meta,screen,strategies}`; `app/oi-tracker/page.tsx`.

Ownership is checked by the existing `getWatchlistSymbols()`: a list id that isn't the caller's resolves to no symbols.

### Verified (lib against the live DB, load 2026-10-15)

- `sys:etf` (20 symbols) narrowed 464 stocks to the 11 ETFs with OI changes, all of them in the list.
- A real user's 35-symbol list returned only those symbols.
- The same list id requested as another user returned 0 rows; a non-existent id also returned 0 rows.
- `sys:etf` combined with symbols SPY, AAPL gave SPY only.
- Strategy legs were restricted to the list.
- `tsc`, eslint (0 errors) and `npm run build` pass.

### Not verified

- The dropdown was not seen in a browser (the page needs a Pro login).

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
- **Width cap.** `fitBarsCapped()` replaces `fitContent()` on initial load and on "ALL": at most 10px per bar (8px at first; raised to 10px on request, see the follow-up entry).
  - A shorter history is drawn right-aligned at that spacing.
  - The empty space on the left triggers the existing load-more, which fills it with older bars.
  - The period buttons (1W, 1M, …) are unchanged.
- **Lines break at gaps.** `breakAtGaps()` makes the point before a gap transparent, because a segment takes its
  starting point's colour. Level and OI lines were switched to step style in that change; that was reverted in the entry above (curved again).

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
