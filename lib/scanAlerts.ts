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
export async function getRecentScanAlerts(limit: number = 20): Promise<ScanAlert[]> {
  try {
    const rows = (await sql(
      `SELECT ${SCAN_ALERT_SELECT} FROM public.intra_us_scanner_eod ORDER BY load_dt_tm DESC LIMIT $1`,
      [limit]
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
