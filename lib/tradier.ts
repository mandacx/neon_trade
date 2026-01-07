import axios, { AxiosInstance } from 'axios';

const TRADIER_API_URL = process.env.TRADIER_API_URL || 'https://api.tradier.com/v1';
const TRADIER_API_KEY = process.env.TRADIER_API_KEY || '';

if (!TRADIER_API_KEY) {
  console.warn('Warning: TRADIER_API_KEY is not set. Tradier API calls will fail.');
}

// Create axios instance with default config
const tradierClient: AxiosInstance = axios.create({
  baseURL: TRADIER_API_URL,
  headers: {
    'Authorization': `Bearer ${TRADIER_API_KEY}`,
    'Accept': 'application/json',
  },
});

export interface TradierQuote {
  symbol: string;
  description: string;
  last: number;
  change: number;
  change_percentage: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  close: number;
  bid: number;
  ask: number;
}

export interface TradierHistoryBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Get quote for a symbol
 */
export async function getQuote(symbol: string): Promise<TradierQuote | null> {
  try {
    const response = await tradierClient.get('/markets/quotes', {
      params: { symbols: symbol.toUpperCase() },
    });

    const quotes = response.data?.quotes?.quote;
    
    if (!quotes || (Array.isArray(quotes) && quotes.length === 0)) {
      return null;
    }

    return Array.isArray(quotes) ? quotes[0] : quotes;
  } catch (error) {
    console.error('Error fetching quote from Tradier:', error);
    throw error;
  }
}

/**
 * Get historical price data (OHLCV)
 */
export async function getHistoricalData(
  symbol: string,
  interval: 'daily' | 'weekly' | 'monthly' = 'daily',
  start?: string,
  end?: string
): Promise<TradierHistoryBar[]> {
  try {
    const params: any = {
      symbol: symbol.toUpperCase(),
      interval,
    };

    if (start) params.start = start;
    if (end) params.end = end;

    const response = await tradierClient.get('/markets/history', { params });

    const history = response.data?.history;
    
    if (!history || !history.day) {
      return [];
    }

    const bars = Array.isArray(history.day) ? history.day : [history.day];
    
    return bars.map((bar: any) => ({
      date: bar.date,
      open: parseFloat(bar.open),
      high: parseFloat(bar.high),
      low: parseFloat(bar.low),
      close: parseFloat(bar.close),
      volume: parseInt(bar.volume),
    }));
  } catch (error) {
    console.error('Error fetching historical data from Tradier:', error);
    throw error;
  }
}

/**
 * Get time and sales data (tick data)
 */
export async function getTimeSales(
  symbol: string,
  interval: '1min' | '5min' | '15min' = '5min',
  start?: string,
  end?: string
): Promise<TradierHistoryBar[]> {
  try {
    const params: any = {
      symbol: symbol.toUpperCase(),
      interval,
    };

    if (start) params.start = start;
    if (end) params.end = end;

    const response = await tradierClient.get('/markets/timesales', { params });

    const series = response.data?.series;
    
    if (!series || !series.data) {
      return [];
    }

    const data = Array.isArray(series.data) ? series.data : [series.data];
    
    return data.map((item: any) => ({
      date: item.time,
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close),
      volume: parseInt(item.volume),
    }));
  } catch (error) {
    console.error('Error fetching time & sales from Tradier:', error);
    throw error;
  }
}

/**
 * Search for symbols
 */
export async function searchSymbols(query: string): Promise<Array<{ symbol: string; description: string }>> {
  try {
    const response = await tradierClient.get('/markets/lookup', {
      params: { q: query },
    });

    const securities = response.data?.securities?.security;
    
    if (!securities) {
      return [];
    }

    const results = Array.isArray(securities) ? securities : [securities];
    
    return results.map((security: any) => ({
      symbol: security.symbol,
      description: security.description,
    }));
  } catch (error) {
    console.error('Error searching symbols from Tradier:', error);
    return [];
  }
}

export default tradierClient;
