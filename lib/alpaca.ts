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

/** Run `fn` over `items` in groups of `size`, at most `parallel` groups at a time. */
async function inChunks<T, R>(items: T[], size: number, parallel: number, fn: (chunk: T[]) => Promise<R>): Promise<R[]> {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  const out: R[] = [];
  for (let i = 0; i < chunks.length; i += parallel) {
    out.push(...(await Promise.all(chunks.slice(i, i + parallel).map(fn))));
  }
  return out;
}

/** getSnapshotsMulti for large symbol sets (the earnings page can need ~600), chunked to keep the URL short. */
export async function getSnapshotsChunked(symbols: string[]): Promise<Record<string, AlpacaSnapshot>> {
  const parts = await inChunks(symbols, 150, 4, getSnapshotsMulti);
  return Object.assign({}, ...parts);
}

export interface DailyClose { date: string; close: number }

/**
 * Split-adjusted daily closes for many symbols in one go (Alpaca multi-symbol
 * bars, paged). `date` is the bar's US/Eastern session date (daily bars are
 * stamped at ET midnight, so the UTC date part is the session date). A failed
 * chunk is skipped, so callers get partial data instead of an error.
 */
export async function getDailyBarsMulti(symbols: string[], start: string, end: string): Promise<Record<string, DailyClose[]>> {
  const out: Record<string, DailyClose[]> = {};
  await inChunks(symbols.map(s => s.toUpperCase()), 100, 4, async chunk => {
    try {
      let pageToken: string | undefined;
      for (let page = 0; page < 10; page++) {
        const params: Record<string, string | number> = {
          symbols: chunk.join(','), timeframe: '1Day', adjustment: 'split', feed: 'iex', limit: 10000, start, end,
        };
        if (pageToken) params.page_token = pageToken;
        const response = await alpacaClient.get<AlpacaHistoryResponse>('/v2/stocks/bars', { params });
        for (const [sym, bars] of Object.entries(response.data?.bars ?? {})) {
          (out[sym] ??= []).push(...bars.map(b => ({ date: b.t.slice(0, 10), close: b.c })));
        }
        pageToken = response.data?.next_page_token;
        if (!pageToken) break;
      }
    } catch (error) {
      console.error('Error fetching daily bars from Alpaca:', axios.isAxiosError(error) ? error.response?.status : error);
    }
  });
  for (const bars of Object.values(out)) bars.sort((a, b) => a.date.localeCompare(b.date));
  return out;
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

/**
 * Daily (or other timeframe) bars for many option contracts (OCC symbols) at
 * once. Verified: /v1beta1/options/bars accepts 200 symbols per request
 * (about 2.7s each when not cached; rate limit 200 requests/min). Like
 * getOptionBars, a range that includes the current trading day is refused on
 * this subscription, so callers pass completed sessions only. A failed chunk
 * is logged and skipped, so callers get partial data instead of an error;
 * `failed` lists the symbols whose chunk failed (callers must not mark those
 * as "no trade").
 */
export async function getOptionBarsMulti(
  symbols: string[], start: string, end: string, timeframe = '1Day', parallel = 3
): Promise<{ bars: Record<string, AlpacaBar[]>; failed: string[] }> {
  const bars: Record<string, AlpacaBar[]> = {};
  const failed: string[] = [];
  await inChunks(symbols, 200, parallel, async chunk => {
    try {
      let pageToken: string | undefined;
      for (let page = 0; page < 20; page++) {
        const params: Record<string, string | number> = { symbols: chunk.join(','), timeframe, limit: 10000, start, end };
        if (pageToken) params.page_token = pageToken;
        const response = await alpacaClient.get<AlpacaHistoryResponse>('/v1beta1/options/bars', { params });
        for (const [sym, list] of Object.entries(response.data?.bars ?? {})) (bars[sym] ??= []).push(...list);
        pageToken = response.data?.next_page_token;
        if (!pageToken) break;
      }
    } catch (error) {
      console.error('Error fetching option bars (multi) from Alpaca:', axios.isAxiosError(error) ? `${error.response?.status} ${JSON.stringify(error.response?.data)}` : error);
      failed.push(...chunk);
    }
  });
  return { bars, failed };
}

export interface AlpacaOptionSnapshot {
  dailyBar?: AlpacaBar;
  prevDailyBar?: AlpacaBar;
  latestTrade?: { p: number; s: number; t: string };
  latestQuote?: { bp: number; ap: number; bs: number; as: number; t: string };
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number; rho?: number };
  impliedVolatility?: number;
}

/**
 * Snapshots for specific option contracts. Verified: the endpoint refuses
 * more than 100 symbols per request ("symbol limit is 100"), so it is chunked.
 * Returns {} for chunks that fail.
 */
export async function getOptionSnapshotsMulti(symbols: string[]): Promise<Record<string, AlpacaOptionSnapshot>> {
  const parts = await inChunks([...new Set(symbols)], 100, 4, async chunk => {
    try {
      const response = await alpacaClient.get('/v1beta1/options/snapshots', { params: { symbols: chunk.join(',') } });
      return (response.data?.snapshots ?? {}) as Record<string, AlpacaOptionSnapshot>;
    } catch (error) {
      console.error('Error fetching option snapshots from Alpaca:', axios.isAxiosError(error) ? error.response?.status : error);
      return {};
    }
  });
  return Object.assign({}, ...parts);
}

/**
 * The whole option chain of one underlying (snapshots keyed by OCC symbol),
 * optionally narrowed to expiries in [expiryFrom, expiryTo]. Pages of 1,000,
 * capped at `maxPages` so a very large chain (SPY, SPX) can't run away.
 */
export async function getOptionChainSnapshots(
  underlying: string, opts: { expiryFrom?: string; expiryTo?: string; maxPages?: number } = {}
): Promise<Record<string, AlpacaOptionSnapshot>> {
  const out: Record<string, AlpacaOptionSnapshot> = {};
  try {
    let pageToken: string | undefined;
    for (let page = 0; page < (opts.maxPages ?? 10); page++) {
      const params: Record<string, string | number> = { limit: 1000 };
      if (opts.expiryFrom) params.expiration_date_gte = opts.expiryFrom;
      if (opts.expiryTo) params.expiration_date_lte = opts.expiryTo;
      if (pageToken) params.page_token = pageToken;
      const response = await alpacaClient.get(`/v1beta1/options/snapshots/${underlying.toUpperCase()}`, { params });
      Object.assign(out, response.data?.snapshots ?? {});
      pageToken = response.data?.next_page_token ?? undefined;
      if (!pageToken) break;
    }
  } catch (error) {
    console.error('Error fetching option chain from Alpaca:', axios.isAxiosError(error) ? error.response?.status : error);
  }
  return out;
}
