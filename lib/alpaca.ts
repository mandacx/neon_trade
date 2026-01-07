import axios, { AxiosInstance } from 'axios';

const ALPACA_API_KEY = process.env.ALPACA_API_KEY || '';
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY || '';
// Use market data endpoint (same for both paper and live trading)
const ALPACA_BASE_URL = process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets';

if (!ALPACA_API_KEY || !ALPACA_SECRET_KEY) {
  console.warn('Warning: ALPACA_API_KEY or ALPACA_SECRET_KEY is not set. Alpaca API calls will fail.');
}

console.log('Alpaca configuration:', {
  baseURL: ALPACA_BASE_URL,
  hasApiKey: !!ALPACA_API_KEY,
  hasSecretKey: !!ALPACA_SECRET_KEY,
});

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
 * @param timeframe Timeframe: 1Min, 5Min, 15Min, 1Hour, 1Day, 1Week, 1Month
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
    const params: any = {
      symbols: symbol.toUpperCase(), // Note: 'symbols' not 'symbol'
      timeframe,
      adjustment: 'split', // Adjust for stock splits
      feed: 'iex', // Use IEX feed (available on free tier)
    };

    if (start) params.start = start;
    if (end) params.end = end;

    console.log(`Fetching bars for ${symbol}:`, { params, url: '/v2/stocks/bars' });

    // Use the multi-symbol bars endpoint
    const response = await alpacaClient.get<AlpacaHistoryResponse>(
      '/v2/stocks/bars',
      { params }
    );

    console.log(`Alpaca response for ${symbol}:`, {
      status: response.status,
      hasData: !!response.data,
      barsKeys: Object.keys(response.data?.bars || {}),
    });

    const bars = response.data?.bars?.[symbol.toUpperCase()] || [];
    
    console.log(`Retrieved ${bars.length} bars for ${symbol}`);
    
    return bars;
  } catch (error) {
    console.error('Error fetching historical data from Alpaca:', error);
    if (axios.isAxiosError(error)) {
      console.error('Response data:', error.response?.data);
      console.error('Response status:', error.response?.status);
      console.error('Request URL:', error.config?.url);
      console.error('Request params:', error.config?.params);
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
      `/v2/stocks/${symbol.toUpperCase()}/quotes/latest`
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
      `/v2/stocks/${symbol.toUpperCase()}/trades/latest`
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

/**
 * Convert interval string to Alpaca timeframe format
 */
export function convertIntervalToTimeframe(interval: 'daily' | 'weekly' | 'monthly'): string {
  switch (interval) {
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
