# Crypto levels (`/crypto`, feature `crypto_levels`)

Put / call open-interest levels for crypto options, on the same lines as the stock page: live candles,
the selected expiry's levels drawn per trade date, current and historical expiries, a levels table and
open interest by strike. Prices and candles are free; levels, expiries and OI need `crypto_levels`.

## Data

**Source:** a separate Neon database (the sister app's) holds `public.deribit_levels` (one row per
currency + settlement currency + expiry + trade date) and `public.deribit_option_chain` (per strike).
One snapshot a day at ~08:08 UTC, just after the 08:00 UTC option expiry. Instruments as of 2026-10-30:
BTC and ETH coin-settled and USDC-settled; AVAX, HYPE, SOL, TRX, XRP USDC-settled. History starts 2026-10-23.

**Link (postgres_fdw):** `scripts/bootstrap-crypto-fdw.mjs` (idempotent) does all of it:
1. In the crypto DB: role `nt_crypto_ro` (LOGIN, `default_transaction_read_only = on`), `SELECT` on the two
   tables only. Its password is generated once into `.env.local` as `CRYPTO_RO_DATABASE_URL`.
   `CRYPTO_DATABASE_URL` (admin) is only used by this script, never by the app.
2. In the main DB: server `crypto_src` (direct host, not the pooler), a user mapping for the current role,
   schema `crypto` with both tables imported as foreign tables.
3. Local copies `nt_crypto_levels`, `nt_crypto_option_chain` and the one-row `nt_crypto_sync`, then a full sync.

Re-run the script after rotating the read-only password or if the source columns change.

**Why local copies:** the source is another compute that can scale to zero. The app reads only the
local tables; `syncCryptoTables()` (`lib/crypto.ts`) upserts from the foreign tables (trade dates from the
last stored one minus a day) at most every 10 minutes, claimed by one conditional `UPDATE` on
`nt_crypto_sync` so concurrent requests don't all sync. The levels and instruments routes call
`ensureCryptoFresh()` first. A failed sync is logged and stored rows keep being served. No cron needed.

**Column mapping** (inferred from the names and their order, e.g. BTC 2026-10-30
`pe_low < pe_int < pe_high < comb < ce_low < ce_int < ce_high`, the same order as the stock table;
not defined anywhere in either database):

| source | ours / chart name |
|---|---|
| `pe_oi_diff_tgt_low` | `put_low` |
| `pe_oi_intersection` | `put_int` |
| `pe_oi_diff_tgt_high` | `put_high` |
| `comb_oi_intersection` | `comb_int` (`put_call_int`) |
| `ce_oi_diff_tgt_low` | `call_low` |
| `ce_oi_intersection` | `call_int` |
| `ce_oi_diff_tgt_high` | `call_high` |

**No-data rows:** `call_oi = put_oi = 0` means no open interest; their levels are placeholders (e.g. all
`10.0`) and are sent as `levels: null`. Individual target levels can be null too; the chart skips them.

**`cmp`** differs per expiry on the same snapshot (e.g. BTC 2026-10-30: 77,830 for 10-31, 78,126 for
11-27), which fits a per-expiry forward/underlying. Historical level proximity is measured from the
row's own `cmp`; the header and overview use the live price.

## Live prices and candles (vendor-masked)

`lib/marketdata/provider/crypto.ts`, reached only through the facade as `getCryptoTickers` /
`getCryptoBars`. Public endpoints, no key. Every coin is priced from its USDC perpetual (BTC and ETH
too), so **one** book-summary request covers all quotes (cached 3 s per instance) and the candles and
header price come from the same instrument. Candles cached 60 s (daily) / 15 s (intraday) per rounded
window. Errors never name the vendor. `DERIBIT_API_URL` (optional, server-side) overrides the base URL.

**Crypto day:** daily candles open at 08:00 UTC, the same moment as expiry and (8 minutes before) the
levels snapshot. A bar's day key is the UTC date of `t − 8h` (`cryptoDayKey`, `lib/cryptoInstruments.ts`),
so the levels for trade date D are drawn on every bar from D 08:00 to D+1 08:00 UTC.

## Routes (neutral paths)

| route | access | what |
|---|---|---|
| `GET /api/crypto/instruments` | free (levels only with the feature) | instruments, quotes, nearest expiry's levels |
| `GET /api/crypto/tickers` | free | quotes only, no DB read per call (pages poll it every 5 s) |
| `GET /api/crypto/[slug]/ohlc?interval=&from=&to=` | free | candles; `from`/`to` epoch ms, at most two chunks wide |
| `GET /api/crypto/[slug]/levels?expiry=` | `crypto_levels` | expiry list (current = in the latest snapshot) + every trade date of one expiry |
| `GET /api/crypto/[slug]/oi?expiry=&date=` | `crypto_levels` | OI by strike + change vs the previous stored date |

Slugs: `btc` (coin-settled), `btc-usdc`, `sol-usdc`, ... (`instrumentSlug`), checked against the stored
instruments. Intervals: 5m, 15m, 30m, 1H, 1D.

## Pages

- `app/crypto/page.tsx`: ticker strip and a table of every market (price, 24h change / range / volume;
  with the feature: nearest expiry, closest of the five core levels to the live price, Put / Call Int, OI).
- `app/crypto/[slug]/page.tsx` → `components/crypto/CryptoAnalysis.tsx`: reuses `TVChart`
  (with `pricePrecision`, chosen from the price, e.g. TRX 5 decimals, and `timeZone="UTC"`), the
  coin-settled / USDC switch, expiry pills by kind (daily, weekly = Friday, monthly = last Friday,
  quarterly = last Friday of Mar/Jun/Sep/Dec), Current / Historical toggle, levels-by-date table and
  OI-by-strike ladder. `onLoadMore` must keep one identity (refs), or `TVChart` rebuilds and loops.
- Nav: Header → Trackers → "₿ Crypto Levels" (PRO badge without the feature), and the mobile menu.

## Enabling

Tick "Crypto Price Levels" for a plan at `/admin/plans`, or
`node --env-file=.env.local scripts/add-crypto-levels-feature.mjs [--plans=PRO,EXPERT]`.

## Follow-ups

- No rate limiter on the crypto routes (the stock OHLC route has none either); the upstream calls are cached.
- Chart settings are not saved per user on the crypto page (the stock page's `chart.settings` pref is not reused).
- `deribit_option_raw` (per-contract mark / IV / volume) is not linked; it could feed a live chain later.
