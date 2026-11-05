/**
 * Crypto levels: readers over nt_crypto_levels / nt_crypto_option_chain (docs/crypto.md).
 *
 * The tables are filled by the source pushing rows directly (role nt_us_stocks_rw); the app only reads
 * them. There is no sync from the crypto database any more (removed 2026-11-05).
 *
 * Levels are named as on the stock side; the source columns map as
 *   pe_oi_diff_tgt_low -> put_low,  pe_oi_intersection -> put_int,  pe_oi_diff_tgt_high -> put_high,
 *   comb_oi_intersection -> comb_int (put_call_int),
 *   ce_oi_diff_tgt_low -> call_low, ce_oi_intersection -> call_int, ce_oi_diff_tgt_high -> call_high.
 * A row with call_oi = put_oi = 0 has no data (its levels are placeholders) and is sent without levels.
 */
import { sql } from '@/lib/db';
import { getOrSet } from '@/lib/ttlCache';
import { parseInstrumentSlug, toInstrument, type CryptoInstrument } from '@/lib/cryptoInstruments';

export interface CryptoInstrumentRow extends CryptoInstrument {
  latestTradeDate: string;
}

/** Every instrument with stored levels, BTC / ETH first, then by coin, coin-settled before USDC. */
export async function listCryptoInstruments(): Promise<CryptoInstrumentRow[]> {
  const rows = await sql`
    SELECT currency, settlement_ccy, max(trade_date)::text AS latest
    FROM public.nt_crypto_levels
    GROUP BY 1, 2
    ORDER BY CASE currency WHEN 'BTC' THEN 0 WHEN 'ETH' THEN 1 ELSE 2 END, currency,
             (currency = settlement_ccy) DESC, settlement_ccy
  `;
  return rows.map(r => ({ ...toInstrument(r.currency, r.settlement_ccy), latestTradeDate: r.latest }));
}

/** The stored instrument for a URL slug, or null (cached 60 s, so routes don't pay a query each). */
export async function resolveCryptoInstrument(slug: string): Promise<CryptoInstrumentRow | null> {
  const parsed = parseInstrumentSlug(slug);
  if (!parsed) return null;
  const all = await getOrSet('crypto:instruments', 60_000, listCryptoInstruments);
  return all.find(i => i.coin === parsed.coin && i.settlement === parsed.settlement) ?? null;
}

export interface CryptoExpiry {
  expiry: string;
  firstTradeDate: string;
  lastTradeDate: string;
  /** In the instrument's latest snapshot (i.e. not expired yet). */
  current: boolean;
}

export async function getCryptoExpiries(coin: string, settlement: string): Promise<{ latestTradeDate: string | null; expiries: CryptoExpiry[] }> {
  const rows = await sql`
    WITH latest AS (
      SELECT max(trade_date) AS d FROM public.nt_crypto_levels WHERE currency = ${coin} AND settlement_ccy = ${settlement}
    )
    SELECT expiry_dt::text AS expiry, min(trade_date)::text AS first, max(trade_date)::text AS last,
           bool_or(trade_date = (SELECT d FROM latest)) AS current, (SELECT d FROM latest)::text AS latest
    FROM public.nt_crypto_levels
    WHERE currency = ${coin} AND settlement_ccy = ${settlement}
    GROUP BY expiry_dt
    ORDER BY expiry_dt
  `;
  return {
    latestTradeDate: rows[0]?.latest ?? null,
    expiries: rows.map(r => ({ expiry: r.expiry, firstTradeDate: r.first, lastTradeDate: r.last, current: r.current })),
  };
}

export type CryptoLevelName = 'put_low' | 'put_int' | 'put_high' | 'put_call_int' | 'call_low' | 'call_int' | 'call_high';
export const CRYPTO_LEVEL_ORDER: CryptoLevelName[] = ['put_low', 'put_int', 'put_high', 'put_call_int', 'call_low', 'call_int', 'call_high'];

export interface CryptoLevelRow {
  tradeDate: string;
  expiry: string;
  /** Underlying price when the snapshot was taken. */
  cmp: number | null;
  strikeSize: number | null;
  /** null when the row has no data (see the file comment); a single missing level is null too. */
  levels: Record<CryptoLevelName, number | null> | null;
  callOi: number;
  putOi: number;
  snapshotTs: string | null;
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

function toLevelRow(r: Record<string, unknown>): CryptoLevelRow {
  const callOi = n(r.call_oi) ?? 0;
  const putOi = n(r.put_oi) ?? 0;
  const hasData = callOi !== 0 || putOi !== 0;
  return {
    tradeDate: String(r.trade_date),
    expiry: String(r.expiry_dt),
    cmp: n(r.cmp),
    strikeSize: n(r.strike_size),
    levels: hasData ? {
      put_low: n(r.put_low), put_int: n(r.put_int), put_high: n(r.put_high), put_call_int: n(r.comb_int),
      call_low: n(r.call_low), call_int: n(r.call_int), call_high: n(r.call_high),
    } : null,
    callOi,
    putOi,
    snapshotTs: r.snapshot_ts ? new Date(r.snapshot_ts as string).toISOString() : null,
  };
}

/** Every stored trade date for one expiry, oldest first (a few dozen rows at most). */
export async function getCryptoLevelHistory(coin: string, settlement: string, expiry: string): Promise<CryptoLevelRow[]> {
  const rows = await sql`
    SELECT trade_date::text AS trade_date, expiry_dt::text AS expiry_dt, cmp, strike_size,
           put_low, put_int, put_high, comb_int, call_low, call_int, call_high, call_oi, put_oi, snapshot_ts
    FROM public.nt_crypto_levels
    WHERE currency = ${coin} AND settlement_ccy = ${settlement} AND expiry_dt = ${expiry}::date
    ORDER BY trade_date
  `;
  return rows.map(toLevelRow);
}

/** The latest snapshot's rows for every instrument (the overview page), nearest expiry first. */
export async function getLatestCryptoLevels(): Promise<Array<CryptoLevelRow & { coin: string; settlement: string }>> {
  const rows = await sql`
    SELECT l.currency, l.settlement_ccy, l.trade_date::text AS trade_date, l.expiry_dt::text AS expiry_dt, l.cmp,
           l.strike_size, l.put_low, l.put_int, l.put_high, l.comb_int, l.call_low, l.call_int, l.call_high,
           l.call_oi, l.put_oi, l.snapshot_ts
    FROM public.nt_crypto_levels l
    JOIN (
      SELECT currency, settlement_ccy, max(trade_date) AS d FROM public.nt_crypto_levels GROUP BY 1, 2
    ) m ON m.currency = l.currency AND m.settlement_ccy = l.settlement_ccy AND m.d = l.trade_date
    ORDER BY l.currency, l.settlement_ccy, l.expiry_dt
  `;
  return rows.map(r => ({ ...toLevelRow(r), coin: r.currency, settlement: r.settlement_ccy }));
}

export interface CryptoStrikeRow {
  strike: number;
  callOi: number;
  putOi: number;
  /** Change from the previous stored trade date for this expiry; null when there is none. */
  callOiChg: number | null;
  putOiChg: number | null;
}

/**
 * Open interest by strike for one expiry on one trade date (default: the latest stored for that expiry),
 * with the change from the trade date before it.
 */
export async function getCryptoOiByStrike(coin: string, settlement: string, expiry: string, tradeDate?: string | null): Promise<{
  tradeDate: string | null; prevTradeDate: string | null; underlying: number | null; strikes: CryptoStrikeRow[];
}> {
  const dates = await sql`
    SELECT DISTINCT trade_date::text AS d FROM public.nt_crypto_option_chain
    WHERE currency = ${coin} AND settlement_ccy = ${settlement} AND expiry_dt = ${expiry}::date
      AND (${tradeDate ?? null}::date IS NULL OR trade_date <= ${tradeDate ?? null}::date)
    ORDER BY 1 DESC LIMIT 2
  `;
  const day = dates[0]?.d ?? null;
  const prev = dates[1]?.d ?? null;
  if (!day) return { tradeDate: null, prevTradeDate: null, underlying: null, strikes: [] };
  const rows = await sql`
    SELECT c.strike_pr, c.ce_oi, c.pe_oi, c.underlying_price, p.ce_oi AS p_ce, p.pe_oi AS p_pe
    FROM public.nt_crypto_option_chain c
    LEFT JOIN public.nt_crypto_option_chain p
      ON p.currency = c.currency AND p.settlement_ccy = c.settlement_ccy AND p.expiry_dt = c.expiry_dt
     AND p.strike_pr = c.strike_pr AND p.trade_date = ${prev}::date
    WHERE c.currency = ${coin} AND c.settlement_ccy = ${settlement} AND c.expiry_dt = ${expiry}::date
      AND c.trade_date = ${day}::date
    ORDER BY c.strike_pr
  `;
  return {
    tradeDate: day,
    prevTradeDate: prev,
    underlying: n(rows[0]?.underlying_price),
    strikes: rows.map(r => {
      const callOi = n(r.ce_oi) ?? 0;
      const putOi = n(r.pe_oi) ?? 0;
      return {
        strike: Number(r.strike_pr),
        callOi,
        putOi,
        callOiChg: prev ? callOi - (n(r.p_ce) ?? 0) : null,
        putOiChg: prev ? putOi - (n(r.p_pe) ?? 0) : null,
      };
    }),
  };
}
