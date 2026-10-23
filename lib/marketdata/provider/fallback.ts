/**
 * INTERNAL PROVIDER ADAPTER (fallback: symbol search, and bars for symbols the primary has none for,
 * e.g. SPX). Server-only. Import only from lib/marketdata/index.ts; never expose this vendor's name.
 */
import axios, { type AxiosInstance } from 'axios';
import type { Bar } from '../types';
import type { ChartInterval } from '../intervals';

const TRADIER_API_URL = process.env.TRADIER_API_URL || 'https://api.tradier.com/v1';
const TRADIER_API_KEY = process.env.TRADIER_API_KEY || '';

if (!TRADIER_API_KEY) {
  console.warn('Warning: fallback market-data key is not set; symbol search and index bars will fail.');
}

// Create axios instance with default config
const tradierClient: AxiosInstance = axios.create({
  baseURL: TRADIER_API_URL,
  timeout: 2000,
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
 * OHLC bars in Alpaca's shape, for symbols Alpaca has no bars for (indices
 * such as SPX — its stock-bars API returns `{"bars":{}}` for them). Index bars
 * carry no volume (Tradier reports 0). Intraday is limited by Tradier to a
 * recent window that differs per interval; it is read from the 400 message
 * ("start: must be on or after YYYY-MM-DD") rather than hardcoded, and the
 * request is retried once from that date (older ranges return no bars).
 * 30min/1hour are built from 15min bars, bucketed on US/Eastern clock time.
 */
export async function getBarsForChart(symbol: string, interval: ChartInterval, from: string, to: string): Promise<Bar[]> {
  const sym = symbol.toUpperCase();
  const longTimeout = { timeout: 10_000 };

  if (interval === 'daily' || interval === 'weekly' || interval === 'monthly') {
    const res = await tradierClient.get('/markets/history', { params: { symbol: sym, interval, start: from, end: to }, ...longTimeout });
    const day = res.data?.history?.day;
    const rows: any[] = !day ? [] : Array.isArray(day) ? day : [day];
    return rows.map(r => ({
      // Alpaca stamps daily bars at US/Eastern midnight; match it so day keys line up.
      t: easternMidnightIso(r.date),
      o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume) || 0,
    }));
  }

  const source: '1min' | '5min' | '15min' = interval === '1min' ? '1min' : interval === '5min' ? '5min' : '15min';
  // Resolves to the rows, or to the oldest start date Tradier allows when `start` is too old.
  const fetchRows = async (start: string): Promise<{ rows: any[] } | { oldest: string }> => {
    const res = await tradierClient.get('/markets/timesales', {
      params: { symbol: sym, interval: source, start: `${start} 00:00`, end: `${to} 23:59`, session_filter: 'open' },
      validateStatus: () => true,
      ...longTimeout,
    });
    if (res.status === 400) {
      const oldest = /on or after (\d{4}-\d{2}-\d{2})/.exec(JSON.stringify(res.data ?? ''))?.[1];
      if (oldest) return { oldest };
    }
    if (res.status >= 400) throw new Error(`index intraday bars HTTP ${res.status}`);
    const data = res.data?.series?.data;
    return { rows: !data ? [] : Array.isArray(data) ? data : [data] };
  };

  let first = await fetchRows(from);
  if ('oldest' in first) {
    if (first.oldest > to) return []; // the whole range is older than Tradier keeps
    first = await fetchRows(first.oldest);
  }
  const rows = 'rows' in first ? first.rows : [];

  const bars: Bar[] = rows.map(r => ({
    t: new Date(Number(r.timestamp) * 1000).toISOString(),
    o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume) || 0,
  }));
  if (interval === '30min' || interval === '1hour') return aggregateBars(bars, interval === '30min' ? 30 : 60);
  return bars;
}

/** UTC ISO instant of 00:00 America/New_York on a 'YYYY-MM-DD' date (04:00Z in EDT, 05:00Z in EST). */
export function easternMidnightIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const hourET = (ms: number) =>
    Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date(ms))) % 24;
  for (const utcHour of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, utcHour);
    if (hourET(ms) === 0) return new Date(ms).toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d, 5)).toISOString();
}

/** Merge ascending bars into N-minute buckets aligned to US/Eastern clock time. */
function aggregateBars(bars: Bar[], minutes: number): Bar[] {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const out: Bar[] = [];
  let key = '';
  for (const b of bars) {
    const parts = fmt.formatToParts(new Date(b.t));
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    const mins = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
    const k = `${get('year')}-${get('month')}-${get('day')}#${Math.floor(mins / minutes)}`;
    const last = out[out.length - 1];
    if (k === key && last) {
      last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; last.v += b.v;
    } else {
      key = k;
      // Stamp the bucket at its clock boundary (e.g. 09:00 for the 09:30 bar), as Alpaca does.
      const start = Math.floor(Date.parse(b.t) / 60_000) * 60_000 - (mins % minutes) * 60_000;
      out.push({ ...b, t: new Date(start).toISOString() });
    }
  }
  return out;
}

/**
 * Search for symbols
 */
/**
 * Company-name search (/markets/search), e.g. "nvidia" → NVDA. Like
 * searchSymbols, resolves to [] on any error or timeout.
 */
export async function searchCompanies(query: string): Promise<Array<{ symbol: string; description: string }>> {
  try {
    const response = await tradierClient.get('/markets/search', {
      params: { q: query, indexes: false },
    });
    const securities = response.data?.securities?.security;
    if (!securities) return [];
    const results = Array.isArray(securities) ? securities : [securities];
    return results
      .filter((s: any) => !s.type || s.type === 'stock' || s.type === 'etf')
      .map((s: any) => ({ symbol: s.symbol, description: s.description }));
  } catch (error) {
    console.error('Error searching companies from Tradier:', error);
    return [];
  }
}

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
