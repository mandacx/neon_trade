import { neon } from '@neondatabase/serverless';
import { StockData } from '@/types/stock';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

export const sql = neon(process.env.DATABASE_URL);

/**
 * Sanitize numeric values, replacing NaN, null, and undefined with 0
 */
function sanitizeNumeric(value: any): number {
  if (value === null || value === undefined || isNaN(value)) {
    return 0;
  }
  return Number(value);
}

/**
 * Sanitize stock data to replace NaN values with 0
 */
function sanitizeStockData(data: any): StockData {
  return {
    SYMBOL: data.SYMBOL || '',
    EXPIRY_DT: data.EXPIRY_DT || '',
    TRADE_DATE: data.TRADE_DATE || '',
    OPEN: sanitizeNumeric(data.OPEN),
    HIGH: sanitizeNumeric(data.HIGH),
    LOW: sanitizeNumeric(data.LOW),
    CLOSE: sanitizeNumeric(data.CLOSE),
    PUT_INT: sanitizeNumeric(data.PUT_INT),
    CALL_INT: sanitizeNumeric(data.CALL_INT),
    PUT_CALL_INT: sanitizeNumeric(data.PUT_CALL_INT),
    call_low: sanitizeNumeric(data.call_low),
    put_HIGH: sanitizeNumeric(data.put_HIGH),
    call_HIGH: sanitizeNumeric(data.call_HIGH),
    put_LOW: sanitizeNumeric(data.put_LOW),
    UNUSED_PC: sanitizeNumeric(data.UNUSED_PC),
    UNUSED_PC_REV: sanitizeNumeric(data.UNUSED_PC_REV),
    CALL_OI: sanitizeNumeric(data.CALL_OI),
    PUT_OI: sanitizeNumeric(data.PUT_OI),
    OI_DIFF: sanitizeNumeric(data.OI_DIFF),
  };
}

/**
 * Get latest stock data for a symbol
 */
export async function getLatestStockData(symbol: string): Promise<StockData | null> {
  try {
    const result = await sql`
      SELECT 
        symbol as "SYMBOL",
        expiry_dt::text as "EXPIRY_DT",
        trade_date::text as "TRADE_DATE",
        COALESCE(open, 0) as "OPEN",
        COALESCE(high, 0) as "HIGH",
        COALESCE(low, 0) as "LOW",
        COALESCE(close, 0) as "CLOSE",
        COALESCE(put_int, 0) as "PUT_INT",
        COALESCE(call_int, 0) as "CALL_INT",
        COALESCE(comb_int, 0) as "PUT_CALL_INT",
        COALESCE(call_low, 0) as call_low,
        COALESCE(put_high, 0) as "put_HIGH",
        COALESCE(call_high, 0) as "call_HIGH",
        COALESCE(put_low, 0) as "put_LOW",
        COALESCE(unused_pc, 0) as "UNUSED_PC",
        COALESCE(unused_pc_rev, 0) as "UNUSED_PC_REV",
        COALESCE(call_oi, 0) as "CALL_OI",
        COALESCE(put_oi, 0) as "PUT_OI",
        COALESCE((put_oi - call_oi), 0) as "OI_DIFF"
      FROM public.eod_usmkts_price
      WHERE symbol = ${symbol.toUpperCase()}
      ORDER BY trade_date DESC
      LIMIT 1
    `;

    if (result.length === 0) {
      return null;
    }

    return sanitizeStockData(result[0]);
  } catch (error) {
    console.error('Error fetching stock data:', error);
    throw error;
  }
}

/**
 * Get historical stock data for a symbol within date range
 */
export async function getHistoricalStockData(
  symbol: string,
  fromDate: string,
  toDate: string
): Promise<StockData[]> {
  try {
    const result = await sql`
      SELECT 
        symbol as "SYMBOL",
        expiry_dt::text as "EXPIRY_DT",
        trade_date::text as "TRADE_DATE",
        COALESCE(open, 0) as "OPEN",
        COALESCE(high, 0) as "HIGH",
        COALESCE(low, 0) as "LOW",
        COALESCE(close, 0) as "CLOSE",
        COALESCE(put_int, 0) as "PUT_INT",
        COALESCE(call_int, 0) as "CALL_INT",
        COALESCE(comb_int, 0) as "PUT_CALL_INT",
        COALESCE(call_low, 0) as call_low,
        COALESCE(put_high, 0) as "put_HIGH",
        COALESCE(call_high, 0) as "call_HIGH",
        COALESCE(put_low, 0) as "put_LOW",
        COALESCE(unused_pc, 0) as "UNUSED_PC",
        COALESCE(unused_pc_rev, 0) as "UNUSED_PC_REV",
        COALESCE(call_oi, 0) as "CALL_OI",
        COALESCE(put_oi, 0) as "PUT_OI",
        COALESCE((put_oi - call_oi), 0) as "OI_DIFF"
      FROM public.eod_usmkts_price
      WHERE symbol = ${symbol.toUpperCase()}
        AND trade_date BETWEEN ${fromDate} AND ${toDate}
      ORDER BY trade_date ASC
    `;

    return result.map(row => sanitizeStockData(row));
  } catch (error) {
    console.error('Error fetching historical data:', error);
    throw error;
  }
}

/**
 * Get the newest row for a symbol with trade_date <= asOf — used to serve
 * delayed (non-Pro) viewers a stale-but-real row instead of nulling out a
 * blocked latest row (see lib/levelAccess.ts).
 */
export async function getStockDataAsOf(symbol: string, asOf: string, expiryDate?: string | null): Promise<StockData | null> {
  try {
    const result = expiryDate
      ? await sql`
          SELECT
            symbol as "SYMBOL",
            expiry_dt::text as "EXPIRY_DT",
            trade_date::text as "TRADE_DATE",
            COALESCE(open, 0) as "OPEN",
            COALESCE(high, 0) as "HIGH",
            COALESCE(low, 0) as "LOW",
            COALESCE(close, 0) as "CLOSE",
            COALESCE(put_int, 0) as "PUT_INT",
            COALESCE(call_int, 0) as "CALL_INT",
            COALESCE(comb_int, 0) as "PUT_CALL_INT",
            COALESCE(call_low, 0) as call_low,
            COALESCE(put_high, 0) as "put_HIGH",
            COALESCE(call_high, 0) as "call_HIGH",
            COALESCE(put_low, 0) as "put_LOW",
            COALESCE(unused_pc, 0) as "UNUSED_PC",
            COALESCE(unused_pc_rev, 0) as "UNUSED_PC_REV",
            COALESCE(call_oi, 0) as "CALL_OI",
            COALESCE(put_oi, 0) as "PUT_OI",
            COALESCE((put_oi - call_oi), 0) as "OI_DIFF"
          FROM public.eod_usmkts_price
          WHERE symbol = ${symbol.toUpperCase()}
            AND expiry_dt = ${expiryDate}::date
            AND trade_date <= ${asOf}::date
          ORDER BY trade_date DESC
          LIMIT 1
        `
      : await sql`
          SELECT
            symbol as "SYMBOL",
            expiry_dt::text as "EXPIRY_DT",
            trade_date::text as "TRADE_DATE",
            COALESCE(open, 0) as "OPEN",
            COALESCE(high, 0) as "HIGH",
            COALESCE(low, 0) as "LOW",
            COALESCE(close, 0) as "CLOSE",
            COALESCE(put_int, 0) as "PUT_INT",
            COALESCE(call_int, 0) as "CALL_INT",
            COALESCE(comb_int, 0) as "PUT_CALL_INT",
            COALESCE(call_low, 0) as call_low,
            COALESCE(put_high, 0) as "put_HIGH",
            COALESCE(call_high, 0) as "call_HIGH",
            COALESCE(put_low, 0) as "put_LOW",
            COALESCE(unused_pc, 0) as "UNUSED_PC",
            COALESCE(unused_pc_rev, 0) as "UNUSED_PC_REV",
            COALESCE(call_oi, 0) as "CALL_OI",
            COALESCE(put_oi, 0) as "PUT_OI",
            COALESCE((put_oi - call_oi), 0) as "OI_DIFF"
          FROM public.eod_usmkts_price
          WHERE symbol = ${symbol.toUpperCase()}
            AND trade_date <= ${asOf}::date
          ORDER BY trade_date DESC
          LIMIT 1
        `;

    if (result.length === 0) {
      return null;
    }

    return sanitizeStockData(result[0]);
  } catch (error) {
    console.error('Error fetching stock data as-of:', error);
    throw error;
  }
}

/**
 * Get all stocks for the latest trading date
 */
export async function getAllStocksLatest(): Promise<StockData[]> {
  try {
    const result = await sql`
      SELECT 
        s.symbol as "SYMBOL",
        s.expiry_dt::text as "EXPIRY_DT",
        s.trade_date::text as "TRADE_DATE",
        COALESCE(s.open, 0) as "OPEN",
        COALESCE(s.high, 0) as "HIGH",
        COALESCE(s.low, 0) as "LOW",
        COALESCE(s.close, 0) as "CLOSE",
        COALESCE(s.put_int, 0) as "PUT_INT",
        COALESCE(s.call_int, 0) as "CALL_INT",
        COALESCE(s.comb_int, 0) as "PUT_CALL_INT",
        COALESCE(s.call_low, 0) as call_low,
        COALESCE(s.put_high, 0) as "put_HIGH",
        COALESCE(s.call_high, 0) as "call_HIGH",
        COALESCE(s.put_low, 0) as "put_LOW",
        COALESCE(s.unused_pc, 0) as "UNUSED_PC",
        COALESCE(s.unused_pc_rev, 0) as "UNUSED_PC_REV",
        COALESCE(s.call_oi, 0) as "CALL_OI",
        COALESCE(s.put_oi, 0) as "PUT_OI",
        COALESCE((s.put_oi - s.call_oi), 0) as "OI_DIFF"
      FROM public.eod_usmkts_price s
      WHERE s.trade_date = (
        SELECT MAX(trade_date) 
        FROM public.eod_usmkts_price
      )
      ORDER BY s.symbol
    `;

    return result.map(row => sanitizeStockData(row));
  } catch (error) {
    console.error('Error fetching all stocks:', error);
    throw error;
  }
}

/**
 * Get all stocks for a specific date
 */
export async function getAllStocksByDate(date: string): Promise<StockData[]> {
  try {
    const result = await sql`
      SELECT 
        symbol as "SYMBOL",
        expiry_dt::text as "EXPIRY_DT",
        trade_date::text as "TRADE_DATE",
        COALESCE(open, 0) as "OPEN",
        COALESCE(high, 0) as "HIGH",
        COALESCE(low, 0) as "LOW",
        COALESCE(close, 0) as "CLOSE",
        COALESCE(put_int, 0) as "PUT_INT",
        COALESCE(call_int, 0) as "CALL_INT",
        COALESCE(comb_int, 0) as "PUT_CALL_INT",
        COALESCE(call_low, 0) as "call_low",
        COALESCE(put_high, 0) as "put_HIGH",
        COALESCE(call_high, 0) as "call_HIGH",
        COALESCE(put_low, 0) as "put_LOW",
        COALESCE(unused_pc, 0) as "UNUSED_PC",
        COALESCE(unused_pc_rev, 0) as "UNUSED_PC_REV",
        COALESCE(call_oi, 0) as "CALL_OI",
        COALESCE(put_oi, 0) as "PUT_OI",
        COALESCE(put_oi - call_oi, 0) as "OI_DIFF"
      FROM public.eod_usmkts_price
      WHERE trade_date = ${date}
      ORDER BY symbol
    `;

    return result.map((row: any) => sanitizeStockData(row as StockData));
  } catch (error) {
    console.error('Error fetching stocks by date:', error);
    throw error;
  }
}

/**
 * Search stocks by symbol pattern
 */
export async function searchStocks(query: string, limit: number = 20): Promise<string[]> {
  try {
    const result = await sql`
      SELECT DISTINCT symbol
      FROM public.eod_usmkts_price
      WHERE symbol LIKE ${query.toUpperCase() + '%'}
      ORDER BY symbol
      LIMIT ${limit}
    `;

    return result.map((row: any) => row.symbol);
  } catch (error) {
    console.error('Error searching stocks:', error);
    throw error;
  }
}

/**
 * Get available trading dates
 */
export async function getAvailableDates(limit: number = 30): Promise<string[]> {
  try {
    const result = await sql`
      SELECT DISTINCT trade_date::text
      FROM public.eod_usmkts_price
      ORDER BY trade_date DESC
      LIMIT ${limit}
    `;

    return result.map((row: any) => row.trade_date);
  } catch (error) {
    console.error('Error fetching available dates:', error);
    throw error;
  }
}

/**
 * Get available expiry dates (future dates from today)
 */
export async function getAvailableExpiryDates(): Promise<string[]> {
  try {
    const result = await sql`
      SELECT DISTINCT expiry_dt::text
      FROM public.eod_usmkts_price
      WHERE expiry_dt >= CURRENT_DATE
      ORDER BY expiry_dt ASC
      LIMIT 50
    `;

    return result.map((row: any) => row.expiry_dt);
  } catch (error) {
    console.error('Error fetching expiry dates:', error);
    throw error;
  }
}

/**
 * Get all stocks by trade date and expiry date
 */
export async function getAllStocksByDateAndExpiry(tradeDate: string, expiryDate: string): Promise<StockData[]> {
  try {
    const result = await sql`
      SELECT 
        symbol as "SYMBOL",
        expiry_dt::text as "EXPIRY_DT",
        trade_date::text as "TRADE_DATE",
        COALESCE(open, 0) as "OPEN",
        COALESCE(high, 0) as "HIGH",
        COALESCE(low, 0) as "LOW",
        COALESCE(close, 0) as "CLOSE",
        COALESCE(put_int, 0) as "PUT_INT",
        COALESCE(call_int, 0) as "CALL_INT",
        COALESCE(comb_int, 0) as "PUT_CALL_INT",
        COALESCE(call_low, 0) as call_low,
        COALESCE(put_high, 0) as "put_HIGH",
        COALESCE(call_high, 0) as "call_HIGH",
        COALESCE(put_low, 0) as "put_LOW",
        COALESCE(unused_pc, 0) as "UNUSED_PC",
        COALESCE(unused_pc_rev, 0) as "UNUSED_PC_REV",
        COALESCE(call_oi, 0) as "CALL_OI",
        COALESCE(put_oi, 0) as "PUT_OI",
        COALESCE(put_oi - call_oi, 0) as "OI_DIFF"
      FROM public.eod_usmkts_price
      WHERE trade_date = ${tradeDate}
        AND expiry_dt = ${expiryDate}
      ORDER BY symbol
    `;

    return result.map((row: any) => sanitizeStockData(row as StockData));
  } catch (error) {
    console.error('Error fetching stocks by date and expiry:', error);
    throw error;
  }
}

/**
 * Get available expiry dates for a symbol. By default only unexpired
 * expiries (ascending). `historical: true` flips to already-expired
 * expiries, most recent first — the order the stock page's historical
 * expiry picker defaults its selection from.
 */
export async function getExpiryDates(symbol: string, opts?: { historical?: boolean }): Promise<string[]> {
  try {
    const result = opts?.historical
      ? await sql`
        SELECT DISTINCT expiry_dt::text
        FROM public.eod_usmkts_price
        WHERE symbol = ${symbol.toUpperCase()}
          AND expiry_dt IS NOT NULL
          AND expiry_dt < CURRENT_DATE
        ORDER BY expiry_dt DESC
      `
      : await sql`
        SELECT DISTINCT expiry_dt::text
        FROM public.eod_usmkts_price
        WHERE symbol = ${symbol.toUpperCase()}
          AND expiry_dt IS NOT NULL
          AND expiry_dt >= CURRENT_DATE
        ORDER BY expiry_dt ASC
      `;

    return result.map((row: any) => row.expiry_dt);
  } catch (error) {
    console.error('Error fetching expiry dates:', error);
    throw error;
  }
}

/**
 * Get stock data for a symbol and specific expiry date
 */
export async function getStockDataByExpiry(symbol: string, expiryDate: string): Promise<StockData | null> {
  try {
    const result = await sql`
      SELECT 
        symbol as "SYMBOL",
        expiry_dt::text as "EXPIRY_DT",
        trade_date::text as "TRADE_DATE",
        COALESCE(open, 0) as "OPEN",
        COALESCE(high, 0) as "HIGH",
        COALESCE(low, 0) as "LOW",
        COALESCE(close, 0) as "CLOSE",
        COALESCE(put_int, 0) as "PUT_INT",
        COALESCE(call_int, 0) as "CALL_INT",
        COALESCE(comb_int, 0) as "PUT_CALL_INT",
        COALESCE(call_low, 0) as "call_low",
        COALESCE(put_high, 0) as "put_HIGH",
        COALESCE(call_high, 0) as "call_HIGH",
        COALESCE(put_low, 0) as "put_LOW",
        COALESCE(unused_pc, 0) as "UNUSED_PC",
        COALESCE(unused_pc_rev, 0) as "UNUSED_PC_REV",
        COALESCE(call_oi, 0) as "CALL_OI",
        COALESCE(put_oi, 0) as "PUT_OI",
        COALESCE(put_oi - call_oi, 0) as "OI_DIFF"
      FROM public.eod_usmkts_price
      WHERE symbol = ${symbol.toUpperCase()}
        AND expiry_dt = ${expiryDate}::date
      ORDER BY trade_date DESC
      LIMIT 1
    `;

    if (result.length === 0) {
      return null;
    }

    return sanitizeStockData(result[0] as StockData);
  } catch (error) {
    console.error('Error fetching stock data by expiry:', error);
    throw error;
  }
}

/**
 * Batched "nearest level" lookup for a watchlist: per symbol, the latest
 * trade_date row within that symbol's own nearest FUTURE expiry cycle (not
 * just the newest trade_date overall, which could be an already-expired
 * contract). One query for the whole symbol set rather than N single-symbol
 * calls.
 */
export async function getNearestExpiryLatestForSymbols(symbols: string[]): Promise<StockData[]> {
  if (symbols.length === 0) return [];
  const upper = symbols.map(s => s.toUpperCase());
  try {
    const result = await sql`
      WITH nearest_expiry AS (
        SELECT symbol, MIN(expiry_dt) AS expiry_dt
        FROM public.eod_usmkts_price
        WHERE symbol = ANY(${upper}) AND expiry_dt >= CURRENT_DATE
        GROUP BY symbol
      ),
      ranked AS (
        SELECT
          p.symbol as "SYMBOL",
          p.expiry_dt::text as "EXPIRY_DT",
          p.trade_date::text as "TRADE_DATE",
          COALESCE(p.open, 0) as "OPEN",
          COALESCE(p.high, 0) as "HIGH",
          COALESCE(p.low, 0) as "LOW",
          COALESCE(p.close, 0) as "CLOSE",
          COALESCE(p.put_int, 0) as "PUT_INT",
          COALESCE(p.call_int, 0) as "CALL_INT",
          COALESCE(p.comb_int, 0) as "PUT_CALL_INT",
          COALESCE(p.call_low, 0) as call_low,
          COALESCE(p.put_high, 0) as "put_HIGH",
          COALESCE(p.call_high, 0) as "call_HIGH",
          COALESCE(p.put_low, 0) as "put_LOW",
          COALESCE(p.unused_pc, 0) as "UNUSED_PC",
          COALESCE(p.unused_pc_rev, 0) as "UNUSED_PC_REV",
          COALESCE(p.call_oi, 0) as "CALL_OI",
          COALESCE(p.put_oi, 0) as "PUT_OI",
          COALESCE((p.put_oi - p.call_oi), 0) as "OI_DIFF",
          ROW_NUMBER() OVER (PARTITION BY p.symbol ORDER BY p.trade_date DESC) AS rn
        FROM public.eod_usmkts_price p
        JOIN nearest_expiry ne ON ne.symbol = p.symbol AND ne.expiry_dt = p.expiry_dt
      )
      SELECT * FROM ranked WHERE rn = 1
    `;
    return result.map((row: any) => sanitizeStockData(row));
  } catch (error) {
    console.error('Error fetching nearest-expiry latest data for symbols:', error);
    return [];
  }
}

/**
 * Batched level lookup pinned to one EXACT expiry_dt across a symbol set —
 * for the watchlist-wide monthly-expiry toggle (see app/watchlists/page.tsx),
 * as opposed to getNearestExpiryLatestForSymbols' per-symbol "nearest
 * future" pick. A symbol with no row at this exact expiry simply doesn't
 * appear in the result — callers should treat a missing symbol as "no data
 * for this expiry", not an error.
 */
export async function getStockDataForSymbolsAtExpiry(symbols: string[], expiryDate: string): Promise<StockData[]> {
  if (symbols.length === 0) return [];
  const upper = symbols.map(s => s.toUpperCase());
  try {
    const result = await sql`
      WITH ranked AS (
        SELECT
          p.symbol as "SYMBOL",
          p.expiry_dt::text as "EXPIRY_DT",
          p.trade_date::text as "TRADE_DATE",
          COALESCE(p.open, 0) as "OPEN",
          COALESCE(p.high, 0) as "HIGH",
          COALESCE(p.low, 0) as "LOW",
          COALESCE(p.close, 0) as "CLOSE",
          COALESCE(p.put_int, 0) as "PUT_INT",
          COALESCE(p.call_int, 0) as "CALL_INT",
          COALESCE(p.comb_int, 0) as "PUT_CALL_INT",
          COALESCE(p.call_low, 0) as call_low,
          COALESCE(p.put_high, 0) as "put_HIGH",
          COALESCE(p.call_high, 0) as "call_HIGH",
          COALESCE(p.put_low, 0) as "put_LOW",
          COALESCE(p.unused_pc, 0) as "UNUSED_PC",
          COALESCE(p.unused_pc_rev, 0) as "UNUSED_PC_REV",
          COALESCE(p.call_oi, 0) as "CALL_OI",
          COALESCE(p.put_oi, 0) as "PUT_OI",
          COALESCE((p.put_oi - p.call_oi), 0) as "OI_DIFF",
          ROW_NUMBER() OVER (PARTITION BY p.symbol ORDER BY p.trade_date DESC) AS rn
        FROM public.eod_usmkts_price p
        WHERE p.symbol = ANY(${upper}) AND p.expiry_dt = ${expiryDate}::date
      )
      SELECT * FROM ranked WHERE rn = 1
    `;
    return result.map((row: any) => sanitizeStockData(row));
  } catch (error) {
    console.error('Error fetching stock data for symbols at expiry:', error);
    return [];
  }
}

/**
 * True if `symbol` is a known ticker in this app's own data (securities or
 * eod_usmkts_price). Used to validate watchlist additions — the search box
 * (app/api/stocks/search) surfaces a broader universe via Tradier, but a
 * symbol outside this app's options-levels pipeline has no levels/OI to show
 * on a watchlist row, so additions are restricted to this narrower set.
 */
export async function symbolExists(symbol: string): Promise<boolean> {
  const upper = symbol.toUpperCase();
  try {
    const rows = await sql`SELECT 1 FROM public.securities WHERE symbol = ${upper} LIMIT 1`;
    if (rows.length > 0) return true;
    const rows2 = await sql`SELECT 1 FROM public.eod_usmkts_price WHERE symbol = ${upper} LIMIT 1`;
    return rows2.length > 0;
  } catch (error) {
    console.error('Error checking symbol existence:', error);
    return false;
  }
}
