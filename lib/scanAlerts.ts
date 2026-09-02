import { sql } from '@/lib/db';
import { calculateLevels } from '@/lib/calculations';
import { SCAN_CODE_TO_LEVEL } from '@/lib/utils';
import { StockData, ScanAlert } from '@/types/stock';

function sanitizeNum(value: any): number {
  if (value === null || value === undefined || isNaN(value)) return 0;
  return Number(value);
}

function processRow(row: any): ScanAlert | null {
  const close = sanitizeNum(row.last_price);
  if (close <= 0) return null;

  const data: StockData = {
    SYMBOL: row.symbol,
    EXPIRY_DT: row.expiry_dt,
    TRADE_DATE: row.trade_date,
    OPEN: 0, HIGH: 0, LOW: 0, CLOSE: close,
    PUT_INT: sanitizeNum(row.put_int),
    CALL_INT: sanitizeNum(row.call_int),
    PUT_CALL_INT: sanitizeNum(row.cmb_int),
    call_low: 0,
    put_HIGH: 0,
    call_HIGH: sanitizeNum(row.call_high),
    put_LOW: sanitizeNum(row.put_low),
    UNUSED_PC: 0, UNUSED_PC_REV: 0, CALL_OI: 0, PUT_OI: 0, OI_DIFF: 0,
  };

  const levels = calculateLevels(data);
  if (levels.length === 0) return null;

  const closestLevel = SCAN_CODE_TO_LEVEL[row.scan_code] ?? levels[0].name;
  const matched = levels.find(l => l.name === closestLevel) ?? levels[0];

  return {
    symbol: row.symbol,
    close,
    prevClose: sanitizeNum(row.prvs_close),
    chg: sanitizeNum(row.chg),
    tradeDate: row.trade_date,
    expiryDate: row.expiry_dt,
    loadDateTime: row.load_dt_tm,
    scanCode: row.scan_code,
    levels,
    closestLevel,
    closestValue: matched.value,
  };
}

const SCAN_ALERT_SELECT = `
  symbol, last_price, prvs_close, chg,
  expiry_dt::text as expiry_dt, trade_date::text as trade_date,
  COALESCE(put_low, 0) as put_low, COALESCE(put_int, 0) as put_int,
  COALESCE(cmb_int, 0) as cmb_int, COALESCE(call_int, 0) as call_int,
  COALESCE(call_high, 0) as call_high,
  load_dt_tm::text as load_dt_tm, scan_code
`;

export interface ScanAlertQueryFilters {
  tradeDate?: string;
  expiryDate?: string;
  futureExpiryOnly?: boolean;
  yearMonth?: string; // 'YYYY-MM', scopes to that calendar month of trade_date
}

/**
 * Fetch scan alerts matching the given filters. Used by both the Latest page
 * (tradeDate + futureExpiryOnly) and the Historical page (yearMonth + optional
 * tradeDate/expiryDate).
 */
/** All scan alerts for one symbol (optionally date-bounded), oldest first — for chart markers. */
export async function getScanAlertsForSymbol(symbol: string, fromDate?: string, toDate?: string): Promise<ScanAlert[]> {
  const conditions: string[] = ['symbol = $1'];
  const params: any[] = [symbol.toUpperCase()];

  if (fromDate) {
    params.push(fromDate);
    conditions.push(`trade_date >= $${params.length}`);
  }
  if (toDate) {
    params.push(toDate);
    conditions.push(`trade_date <= $${params.length}`);
  }

  const query = `
    SELECT ${SCAN_ALERT_SELECT}
    FROM public.intra_us_scanner_eod
    WHERE ${conditions.join(' AND ')}
    ORDER BY trade_date ASC, load_dt_tm ASC
    LIMIT 5000
  `;

  try {
    const rows = (await sql(query, params)) as any[];
    return rows.map(processRow).filter((a): a is ScanAlert => a !== null);
  } catch (error) {
    console.error('Error fetching scan alerts for symbol:', error);
    return [];
  }
}

export async function getScanAlerts(filters: ScanAlertQueryFilters): Promise<ScanAlert[]> {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.tradeDate) {
    params.push(filters.tradeDate);
    conditions.push(`trade_date = $${params.length}`);
  }
  if (filters.yearMonth) {
    params.push(`${filters.yearMonth}-01`);
    conditions.push(`date_trunc('month', trade_date) = $${params.length}::date`);
  }
  if (filters.expiryDate) {
    params.push(filters.expiryDate);
    conditions.push(`expiry_dt = $${params.length}`);
  }
  if (filters.futureExpiryOnly) {
    conditions.push(`expiry_dt >= CURRENT_DATE`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `
    SELECT ${SCAN_ALERT_SELECT}
    FROM public.intra_us_scanner_eod
    ${where}
    ORDER BY trade_date DESC, load_dt_tm DESC
    LIMIT 20000
  `;

  try {
    const rows = (await sql(query, params)) as any[];
    return rows.map(processRow).filter((a): a is ScanAlert => a !== null);
  } catch (error) {
    console.error('Error fetching scan alerts:', error);
    throw error;
  }
}

/** Most recently loaded alerts across all symbols/expiries — for the scrolling ticker. */
// Lookback window for the ticker's "newest alerts" query, so it reads a recent
// slice instead of sorting the whole table to take 40 rows.
//
// This started life as a workaround: while intra_us_scanner_eod was a
// postgres_fdw foreign table, an unfiltered "newest N" dragged the entire
// remote table across the project boundary — 77.3s against 0.6s with this
// predicate. The table is local again, so it's now an ordinary bounded scan
// rather than a necessity, but it's still the right shape for a ticker.
//
// 4 days comfortably covers the ticker's limit (~2.2k alert rows land per 3
// trading days) and still reaches back past a weekend plus a Monday holiday —
// the longest the US market closes in a run. The cutoff is date-granular, so
// "4 days" means the whole of that fourth day back. If the ingestion pipeline
// stalls longer than that the ticker renders nothing, which beats captioning
// week-old alerts as "New Alerts".
const RECENT_ALERT_LOOKBACK_DAYS = 4;

export async function getRecentScanAlerts(limit: number = 20): Promise<ScanAlert[]> {
  try {
    const since = new Date(Date.now() - RECENT_ALERT_LOOKBACK_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const rows = (await sql(
      `SELECT ${SCAN_ALERT_SELECT} FROM public.intra_us_scanner_eod
       WHERE load_dt_tm >= $1
       ORDER BY load_dt_tm DESC LIMIT $2`,
      [since, limit]
    )) as any[];
    return rows.map(processRow).filter((a): a is ScanAlert => a !== null);
  } catch (error) {
    console.error('Error fetching recent scan alerts:', error);
    return [];
  }
}

export async function getLatestScanTradeDate(): Promise<string | null> {
  try {
    const rows = await sql`SELECT MAX(trade_date)::text as d FROM public.intra_us_scanner_eod`;
    return (rows[0] as any)?.d ?? null;
  } catch {
    return null;
  }
}

// The functions below DISTINCT/GROUP BY across the whole of
// intra_us_scanner_eod rather than filtering to a symbol set. That made them
// unusable while the table was a postgres_fdw foreign table pointing at the
// old project — the pattern doesn't push down, so each call pulled the entire
// remote table over the wire (see app/api/home/data/route.ts for the same
// story against eod_usmkts_price). They read a frozen local copy in the
// interim; the table is local again as of the 2026-09-02 cutover off the
// bridge, so these are ordinary local scans now.
export async function getScanTradeDates(limit: number = 30): Promise<string[]> {
  try {
    const rows = await sql`
      SELECT DISTINCT trade_date::text as d
      FROM public.intra_us_scanner_eod
      ORDER BY d DESC
      LIMIT ${limit}
    `;
    return rows.map((r: any) => r.d);
  } catch {
    return [];
  }
}

export async function getScanExpiryDates(opts: { futureOnly?: boolean } = {}): Promise<string[]> {
  try {
    const rows = opts.futureOnly
      ? await sql`
          SELECT DISTINCT expiry_dt::text as d
          FROM public.intra_us_scanner_eod
          WHERE expiry_dt >= CURRENT_DATE
          ORDER BY d ASC
        `
      : await sql`
          SELECT DISTINCT expiry_dt::text as d
          FROM public.intra_us_scanner_eod
          ORDER BY d ASC
        `;
    return rows.map((r: any) => r.d);
  } catch {
    return [];
  }
}

/** Distinct trade dates within a given 'YYYY-MM' month — for the Historical page's date dropdown. */
export async function getScanTradeDatesInMonth(yearMonth: string): Promise<string[]> {
  try {
    const rows = (await sql(
      `SELECT DISTINCT trade_date::text as d FROM public.intra_us_scanner_eod
       WHERE date_trunc('month', trade_date) = $1::date
       ORDER BY d DESC`,
      [`${yearMonth}-01`]
    )) as any[];
    return rows.map(r => r.d);
  } catch {
    return [];
  }
}

/** Distinct expiry dates seen within a given 'YYYY-MM' month — for the Historical page's expiry dropdown. */
export async function getScanExpiryDatesInMonth(yearMonth: string): Promise<string[]> {
  try {
    const rows = (await sql(
      `SELECT DISTINCT expiry_dt::text as d FROM public.intra_us_scanner_eod
       WHERE date_trunc('month', trade_date) = $1::date
       ORDER BY d ASC`,
      [`${yearMonth}-01`]
    )) as any[];
    return rows.map(r => r.d);
  } catch {
    return [];
  }
}

/** Distinct 'YYYY-MM' months with alert counts, most recent first — for the Historical page's Year/Month picker. */
export async function getScanAlertMonths(): Promise<{ yearMonth: string; count: number }[]> {
  try {
    const rows = await sql`
      SELECT to_char(trade_date, 'YYYY-MM') as ym, COUNT(*) as c
      FROM public.intra_us_scanner_eod
      GROUP BY ym
      ORDER BY ym DESC
    `;
    return rows.map((r: any) => ({ yearMonth: r.ym, count: Number(r.c) }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// TickerAlert — additive machinery for Watchlists/Performance/Telegram
// (Phases 3/4/6). Deliberately separate from the ScanAlert shape above (used
// by the Latest/Historical pages + ScanAlertsTicker) since those callers
// already depend on ScanAlert's exact fields/signatures.
//
// `intra_us_scanner_eod`'s `scan_code` is always a bare level label here
// (e.g. "CALL INT") — unlike some scanners there is no "Buy Above"/"Sell
// Below" text prefix, so direction is ALWAYS derived from last_price vs. the
// level's own price, never parsed from scan_code. The table's real primary
// key is (symbol, expiry_dt, trade_date, scan_code) — it's an upsert table
// the external scanner updates in place as it re-evaluates through the day,
// not an append-only event log, so that tuple is a safe, unique id with no
// separate seq_no/dedup problem to solve.
// ---------------------------------------------------------------------------

export type ScanLevelName = 'put_low' | 'put_int' | 'put_call_int' | 'call_int' | 'call_high';
export type ScanDirection = 'buy_above' | 'sell_below';

export interface TickerAlert {
  id: string;
  symbol: string;
  level: ScanLevelName;
  direction: ScanDirection;
  price: number;
  tradeDate: string;
  expiryDate: string;
  loadDateTime: string; // load_dt_tm
}

function toTickerAlert(row: any): TickerAlert | null {
  const level = SCAN_CODE_TO_LEVEL[row.scan_code] as ScanLevelName | undefined;
  if (!level) return null;

  const levelPriceByName: Record<ScanLevelName, number> = {
    put_low: sanitizeNum(row.put_low),
    put_int: sanitizeNum(row.put_int),
    put_call_int: sanitizeNum(row.cmb_int),
    call_int: sanitizeNum(row.call_int),
    call_high: sanitizeNum(row.call_high),
  };
  const price = levelPriceByName[level];
  const lastPrice = sanitizeNum(row.last_price);

  return {
    id: `${row.symbol}__${row.trade_date}__${row.expiry_dt}__${row.scan_code}`,
    symbol: row.symbol,
    level,
    direction: lastPrice >= price ? 'buy_above' : 'sell_below',
    price,
    tradeDate: row.trade_date,
    expiryDate: row.expiry_dt,
    loadDateTime: row.load_dt_tm,
  };
}

export interface AlertsByExpiryOptions {
  /** Most recent N distinct expiry_dt values across the symbol set, default 6, capped 24.
   * Kept generous because per-symbol US options expiry cycles can diverge a lot within one
   * watchlist (unlike NSE's weekly-index/monthly-stock split), so a small N can miss a
   * symbol's own recent alerts entirely if another symbol in the list has more expiries.
   * Ignored when `expiryDate` is set. */
  expiryCount?: number;
  /** Pin to one exact expiry_dt instead of the N-most-recent-distinct-expiries window — for the
   * watchlist-wide monthly-expiry toggle (see app/watchlists/page.tsx). Takes precedence over expiryCount. */
  expiryDate?: string;
}

/** Alerts for a set of symbols, bounded to one exact expiry or the N most recent distinct expiry_dt values across that symbol set. */
export async function getAlertsForSymbolsByExpiry(symbols: string[], opts: AlertsByExpiryOptions = {}): Promise<TickerAlert[]> {
  if (symbols.length === 0) return [];
  const upperSymbols = symbols.map(s => s.toUpperCase());

  try {
    const rows = opts.expiryDate
      ? await sql`
          SELECT
            symbol, last_price,
            expiry_dt::text as expiry_dt, trade_date::text as trade_date,
            COALESCE(put_low, 0) as put_low, COALESCE(put_int, 0) as put_int,
            COALESCE(cmb_int, 0) as cmb_int, COALESCE(call_int, 0) as call_int,
            COALESCE(call_high, 0) as call_high,
            load_dt_tm::text as load_dt_tm, scan_code
          FROM public.intra_us_scanner_eod
          WHERE symbol = ANY(${upperSymbols}) AND expiry_dt = ${opts.expiryDate}::date
          ORDER BY trade_date DESC, load_dt_tm DESC
          LIMIT 5000
        `
      : await sql`
          WITH recent_expiries AS (
            SELECT DISTINCT expiry_dt FROM public.intra_us_scanner_eod
            WHERE symbol = ANY(${upperSymbols})
            ORDER BY expiry_dt DESC
            LIMIT ${Math.min(opts.expiryCount ?? 6, 24)}
          )
          SELECT
            symbol, last_price,
            expiry_dt::text as expiry_dt, trade_date::text as trade_date,
            COALESCE(put_low, 0) as put_low, COALESCE(put_int, 0) as put_int,
            COALESCE(cmb_int, 0) as cmb_int, COALESCE(call_int, 0) as call_int,
            COALESCE(call_high, 0) as call_high,
            load_dt_tm::text as load_dt_tm, scan_code
          FROM public.intra_us_scanner_eod
          WHERE symbol = ANY(${upperSymbols}) AND expiry_dt IN (SELECT expiry_dt FROM recent_expiries)
          ORDER BY trade_date DESC, load_dt_tm DESC
          LIMIT 5000
        `;
    return (rows as any[]).map(toTickerAlert).filter((a): a is TickerAlert => a !== null);
  } catch (error) {
    console.error('Error fetching alerts for symbols by expiry:', error);
    return [];
  }
}

/**
 * Alerts loaded after `since` — for the Telegram cron cursor (Phase 6) and
 * any other polling consumer. Named distinctly from getRecentScanAlerts()
 * above (different signature/callers — that one is limit-only, for the
 * ticker) to avoid an accidental overload collision.
 */
export async function getScanAlertsSince(since: string, limit: number = 500): Promise<TickerAlert[]> {
  try {
    const rows = await sql`
      SELECT
        symbol, last_price,
        expiry_dt::text as expiry_dt, trade_date::text as trade_date,
        COALESCE(put_low, 0) as put_low, COALESCE(put_int, 0) as put_int,
        COALESCE(cmb_int, 0) as cmb_int, COALESCE(call_int, 0) as call_int,
        COALESCE(call_high, 0) as call_high,
        load_dt_tm::text as load_dt_tm, scan_code
      FROM public.intra_us_scanner_eod
      WHERE load_dt_tm > ${since}
      ORDER BY load_dt_tm ASC
      LIMIT ${limit}
    `;
    return (rows as any[]).map(toTickerAlert).filter((a): a is TickerAlert => a !== null);
  } catch (error) {
    console.error('Error fetching scan alerts since cursor:', error);
    return [];
  }
}

/** Nulls the level-revealing fields — used when the caller lacks FEATURE_LEVELS. */
export function redactTickerAlerts(alerts: TickerAlert[]): Array<Omit<TickerAlert, 'level' | 'price'> & { level: null; price: null }> {
  return alerts.map(a => ({ ...a, level: null, price: null }));
}
