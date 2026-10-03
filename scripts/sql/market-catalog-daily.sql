-- Daily upsert for the market date catalog (lib/marketCatalog.ts).
-- Run from the daily load script right after a day's rows are loaded,
-- with $1 = the trade date / load date just loaded (YYYY-MM-DD).
--
-- Idempotent: re-running for the same day (e.g. after a reload) refreshes
-- that day's counts and only widens each expiry's first/last seen dates.
-- The tables must exist first — see scripts/bootstrap-market-catalog.mjs.
--
-- Run the two sections for whichever table(s) were loaded. They're
-- separate statements; send them one at a time if the driver doesn't accept
-- multi-statement queries with parameters.

-- ---------------------------------------------------------------- eod_usmkts_price
INSERT INTO public.nt_market_dates (source, trade_date, row_count, symbol_count)
SELECT 'eod', trade_date, COUNT(*), COUNT(DISTINCT symbol)
FROM public.eod_usmkts_price
WHERE trade_date = $1::date
GROUP BY trade_date
ON CONFLICT (source, trade_date) DO UPDATE SET
  row_count    = EXCLUDED.row_count,
  symbol_count = EXCLUDED.symbol_count,
  refreshed_at = now();

INSERT INTO public.nt_market_expiries AS e (source, symbol, expiry_dt, first_trade_date, last_trade_date)
SELECT 'eod', UPPER(symbol), expiry_dt, MIN(trade_date), MAX(trade_date)
FROM public.eod_usmkts_price
WHERE trade_date = $1::date AND expiry_dt IS NOT NULL AND symbol IS NOT NULL
GROUP BY UPPER(symbol), expiry_dt
ON CONFLICT (source, symbol, expiry_dt) DO UPDATE SET
  first_trade_date = LEAST(e.first_trade_date, EXCLUDED.first_trade_date),
  last_trade_date  = GREATEST(e.last_trade_date, EXCLUDED.last_trade_date),
  refreshed_at     = now();

-- ---------------------------------------------------------------- us_opt_chg_rpt
INSERT INTO public.nt_market_dates (source, trade_date, row_count, symbol_count)
SELECT 'opt_chg', load_dt, COUNT(*), COUNT(DISTINCT symbol_und)
FROM public.us_opt_chg_rpt
WHERE load_dt = $1::date
GROUP BY load_dt
ON CONFLICT (source, trade_date) DO UPDATE SET
  row_count    = EXCLUDED.row_count,
  symbol_count = EXCLUDED.symbol_count,
  refreshed_at = now();

INSERT INTO public.nt_market_expiries AS e (source, symbol, expiry_dt, first_trade_date, last_trade_date)
SELECT 'opt_chg', UPPER(symbol_und), expiry_dt, MIN(load_dt), MAX(load_dt)
FROM public.us_opt_chg_rpt
WHERE load_dt = $1::date AND expiry_dt IS NOT NULL AND symbol_und IS NOT NULL
GROUP BY UPPER(symbol_und), expiry_dt
ON CONFLICT (source, symbol, expiry_dt) DO UPDATE SET
  first_trade_date = LEAST(e.first_trade_date, EXCLUDED.first_trade_date),
  last_trade_date  = GREATEST(e.last_trade_date, EXCLUDED.last_trade_date),
  refreshed_at     = now();
