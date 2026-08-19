import axios, { AxiosInstance } from 'axios';

const ALPACA_API_KEY = process.env.ALPACA_API_KEY;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const ALPACA_BASE_URL = process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets';

if (!ALPACA_API_KEY || !ALPACA_SECRET_KEY) {
  console.warn('Warning: ALPACA_API_KEY or ALPACA_SECRET_KEY is not set. Alpaca API calls will fail.');
}

// Create axios instance with default config
const alpacaClient: AxiosInstance = axios.create({
  baseURL: ALPACA_BASE_URL,
  headers: {
    'APCA-API-KEY-ID': ALPACA_API_KEY,
    'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
    'Accept': 'application/json',
  },
});

export interface AlpacaBar {
  t: string; // timestamp
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
  n?: number; // number of trades
  vw?: number; // volume weighted average price
}

export interface AlpacaHistoryResponse {
  bars: {
    [symbol: string]: AlpacaBar[];
  };
  next_page_token?: string;
}

/**
 * Get historical price data (OHLCV) from Alpaca
 * @param symbol Stock symbol
 * @param timeframe Timeframe: 1Min, 5Min, 15Min, 30Min, 1Hour, 1Day, 1Week, 1Month
 * @param start Start date in RFC3339 format or YYYY-MM-DD
 * @param end End date in RFC3339 format or YYYY-MM-DD
 */
export async function getHistoricalBars(
  symbol: string,
  timeframe: string = '1Day',
  start?: string,
  end?: string
): Promise<AlpacaBar[]> {
  try {
    const bars: AlpacaBar[] = [];
    let pageToken: string | undefined;
    // Alpaca pages at 1000 bars/request by default; intraday ranges can exceed that.
    // Loop until exhausted, capped so a misbehaving response can't loop forever.
    for (let page = 0; page < 20; page++) {
      const params: any = {
        symbols: symbol.toUpperCase(), // Note: 'symbols' not 'symbol'
        timeframe,
        adjustment: 'split', // Adjust for stock splits
        feed: 'iex', // Use IEX feed (available on free tier)
        limit: 10000,
      };

      if (start) params.start = start;
      if (end) params.end = end;
      if (pageToken) params.page_token = pageToken;

      const response = await alpacaClient.get<AlpacaHistoryResponse>(
        '/v2/stocks/bars',
        { params }
      );

      bars.push(...(response.data?.bars?.[symbol.toUpperCase()] || []));
      pageToken = response.data?.next_page_token;
      if (!pageToken) break;
    }

    return bars;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Alpaca API error:', error.response?.status, error.response?.data);
    } else {
      console.error('Error fetching historical data from Alpaca:', error);
    }
    throw error;
  }
}

/**
 * Get latest quote for a symbol
 */
export async function getLatestQuote(symbol: string) {
  try {
    const response = await alpacaClient.get(
      `/v2/stocks/${symbol.toUpperCase()}/quotes/latest`,
      { params: { feed: 'iex' } }
    );

    return response.data?.quote;
  } catch (error) {
    console.error('Error fetching quote from Alpaca:', error);
    if (axios.isAxiosError(error)) {
      console.error('Response data:', error.response?.data);
      console.error('Response status:', error.response?.status);
    }
    throw error;
  }
}

/**
 * Get latest trade for a symbol
 */
export async function getLatestTrade(symbol: string) {
  try {
    const response = await alpacaClient.get(
      `/v2/stocks/${symbol.toUpperCase()}/trades/latest`,
      { params: { feed: 'iex' } }
    );

    return response.data?.trade;
  } catch (error) {
    console.error('Error fetching trade from Alpaca:', error);
    if (axios.isAxiosError(error)) {
      console.error('Response data:', error.response?.data);
      console.error('Response status:', error.response?.status);
    }
    throw error;
  }
}

export interface AlpacaSnapshot {
  latestTrade?: { p: number; s: number; t: string };
  dailyBar?: { o: number; h: number; l: number; c: number; v: number; t: string };
  prevDailyBar?: { c: number };
}

/**
 * Batch quote+day-range lookup for watchlists — one call for up to a few
 * hundred symbols via Alpaca's /v2/stocks/snapshots, instead of fanning out
 * a single-symbol call per row. Returns {} (not a throw) on failure so a
 * flaky Alpaca call degrades to an empty quotes column rather than taking
 * down the whole watchlist response.
 */
export async function getSnapshotsMulti(symbols: string[]): Promise<Record<string, AlpacaSnapshot>> {
  if (symbols.length === 0) return {};
  try {
    const response = await alpacaClient.get('/v2/stocks/snapshots', {
      params: { symbols: symbols.map(s => s.toUpperCase()).join(','), feed: 'iex' },
    });
    return response.data?.snapshots ?? response.data ?? {};
  } catch (error) {
    console.error('Error fetching snapshots from Alpaca:', error);
    if (axios.isAxiosError(error)) {
      console.error('Response data:', error.response?.data);
      console.error('Response status:', error.response?.status);
    }
    return {};
  }
}

export type ChartInterval = '1min' | '5min' | '15min' | '30min' | '1hour' | 'daily' | 'weekly' | 'monthly';

/**
 * Convert interval string to Alpaca timeframe format
 */
export function convertIntervalToTimeframe(interval: ChartInterval): string {
  switch (interval) {
    case '1min':
      return '1Min';
    case '5min':
      return '5Min';
    case '15min':
      return '15Min';
    case '30min':
      return '30Min';
    case '1hour':
      return '1Hour';
    case 'daily':
      return '1Day';
    case 'weekly':
      return '1Week';
    case 'monthly':
      return '1Month';
    default:
      return '1Day';
  }
}

/** Is this interval finer than one day (i.e. multiple bars per trading day)? */
export function isIntradayInterval(interval: ChartInterval): boolean {
  return interval === '1min' || interval === '5min' || interval === '15min' || interval === '30min' || interval === '1hour';
}

/**
 * Builds the standard OCC option symbol Alpaca's options endpoints key on,
 * e.g. buildOccOptionSymbol('AAPL', '2026-08-21', 'put', 290) -> 'AAPL260821P00290000'.
 * Root symbol is used as-is (Alpaca does not left-pad it to 6 chars like the
 * official OCC spec) — verified against real occ_symbol values already
 * present elsewhere in this database.
 */
export function buildOccOptionSymbol(underlying: string, expiryDate: string, optType: 'call' | 'put', strike: number): string {
  const [y, m, d] = expiryDate.split('-');
  const cp = optType === 'call' ? 'C' : 'P';
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, '0');
  return `${underlying.toUpperCase()}${y.slice(2)}${m}${d}${cp}${strikeStr}`;
}

/**
 * Historical OHLCV bars for a single option contract (OCC symbol) via
 * Alpaca's Options Market Data API. Confirmed live: this account's
 * subscription 403s ("subscription does not permit querying recent OPRA
 * data") for any request whose range includes the CURRENT trading day —
 * everything through the prior trading day works fine. Callers should cap
 * `end` at yesterday rather than relying on this to throw (see
 * app/api/stocks/[symbol]/option-bars/route.ts).
 */
export async function getOptionBars(occSymbol: string, timeframe: string, start: string, end: string): Promise<AlpacaBar[]> {
  try {
    const bars: AlpacaBar[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const params: any = { symbols: occSymbol, timeframe, limit: 10000, start, end };
      if (pageToken) params.page_token = pageToken;

      const response = await alpacaClient.get<AlpacaHistoryResponse>('/v1beta1/options/bars', { params });

      bars.push(...(response.data?.bars?.[occSymbol] || []));
      pageToken = response.data?.next_page_token;
      if (!pageToken) break;
    }
    return bars;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Alpaca options API error:', error.response?.status, error.response?.data);
    } else {
      console.error('Error fetching option bars from Alpaca:', error);
    }
    throw error;
  }
}

/**
 * Today's running OHLCV for a single option contract, via Alpaca's options
 * snapshot endpoint (/v1beta1/options/snapshots/{underlying}). Unlike
 * getOptionBars, this is NOT blocked for the current trading day on this
 * account's subscription — it's the only way to see any current-day option
 * data at all, but it returns exactly one point (today's bar so far), never
 * a historical intraday series. Returns null on any failure or if the
 * contract has no bar yet (e.g. hasn't traded today).
 */
export async function getOptionTodaySnapshotBar(
  underlying: string,
  expiryDate: string,
  strike: number,
  occSymbol: string
): Promise<AlpacaBar | null> {
  try {
    const response = await alpacaClient.get(`/v1beta1/options/snapshots/${underlying.toUpperCase()}`, {
      params: { expiration_date: expiryDate, strike_price_gte: strike, strike_price_lte: strike },
    });
    return response.data?.snapshots?.[occSymbol]?.dailyBar ?? null;
  } catch (error) {
    console.error('Error fetching option snapshot from Alpaca:', axios.isAxiosError(error) ? error.response?.data : error);
    return null;
  }
}
