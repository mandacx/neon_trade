/**
 * INTERNAL PROVIDER ADAPTER (primary market data: stock/option bars, snapshots, calendar, news). Server-only. Do not import from anywhere but lib/marketdata/index.ts, and never put
 * this vendor's name, hosts or field names in API responses, routes or UI text.
 */
import axios, { type AxiosInstance } from 'axios';
import type { Bar, CalendarRow, NewsArticle, OptionSnapshot, Snapshot } from '../types';
import type { ChartInterval } from '../intervals';

const ALPACA_API_KEY = process.env.ALPACA_API_KEY;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const ALPACA_BASE_URL = process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets';
/** The calendar lives on the trading host; the paper host is used so nothing here can touch a live account. */
const TRADING_URL = process.env.ALPACA_TRADING_URL || 'https://paper-api.alpaca.markets';

if (!ALPACA_API_KEY || !ALPACA_SECRET_KEY) {
  console.warn('Warning: primary market-data keys are not set; market-data calls will fail.');
}

const authHeaders = (): Record<string, string> => ({
  'APCA-API-KEY-ID': ALPACA_API_KEY ?? '',
  'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY ?? '',
});

export const hasKeys = (): boolean => !!ALPACA_API_KEY && !!ALPACA_SECRET_KEY;

// Create axios instance with default config
const alpacaClient: AxiosInstance = axios.create({
  baseURL: ALPACA_BASE_URL,
  headers: { ...authHeaders(), 'Accept': 'application/json' },
});

/*
 * Feeds. Intraday bars and snapshots use IEX (real time, but IEX-only volume, ~2% of the market).
 * DAILY bars use SIP (consolidated: real volume and the official OHLC). This plan serves SIP only up
 * to 15 minutes ago: any request whose `end` is later is refused ("subscription does not permit
 * querying recent SIP data"), and a date-only `end` means the END of that day, so it is refused for
 * today. `sipEnd` turns a requested end into an explicit instant capped at now - 16 minutes
 * (verified 2026-10-23).
 */
const SIP_DELAY_MS = 16 * 60_000;

/** 00:00 America/New_York on 'YYYY-MM-DD', as epoch ms. */
function etMidnightMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const hourET = (ms: number) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date(ms))) % 24;
  for (const utcHour of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, utcHour);
    if (hourET(ms) === 0) return ms;
  }
  return Date.UTC(y, m - 1, d, 5);
}

const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const nextDate = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Explicit SIP end instant (ISO): the requested end (a date means through that ET day), capped at now - 16 min. */
export function sipEnd(end: string | undefined, nowMs = Date.now()): string {
  const cap = nowMs - SIP_DELAY_MS;
  const wanted = end === undefined ? cap : isDateOnly(end) ? etMidnightMs(nextDate(end)) - 1000 : Date.parse(end);
  return new Date(Math.min(Number.isFinite(wanted) ? wanted : cap, cap)).toISOString();
}

/** A start instant in ms (a date means 00:00 ET that day). */
const startMs = (start: string) => (isDateOnly(start) ? etMidnightMs(start) : Date.parse(start));

const isDailyTimeframe = (tf: string) => tf === '1Day' || tf === '1Week' || tf === '1Month';

interface BarsResponse {
  bars: {
    [symbol: string]: Bar[];
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
): Promise<Bar[]> {
  try {
    const bars: Bar[] = [];
    let pageToken: string | undefined;
    const sip = isDailyTimeframe(timeframe);
    const endParam = sip ? sipEnd(end) : end;
    if (sip && start && startMs(start) > Date.parse(endParam!)) return bars; // nothing settled yet
    // Alpaca pages at 1000 bars/request by default; intraday ranges can exceed that.
    // Loop until exhausted, capped so a misbehaving response can't loop forever.
    for (let page = 0; page < 20; page++) {
      const params: any = {
        symbols: symbol.toUpperCase(), // Note: 'symbols' not 'symbol'
        timeframe,
        adjustment: 'split', // Adjust for stock splits
        feed: sip ? 'sip' : 'iex', // see "Feeds" above
        limit: 10000,
      };

      if (start) params.start = start;
      if (endParam) params.end = endParam;
      if (pageToken) params.page_token = pageToken;

      const response = await alpacaClient.get<BarsResponse>(
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

/**
 * Batch quote+day-range lookup for watchlists — one call for up to a few
 * hundred symbols via Alpaca's /v2/stocks/snapshots, instead of fanning out
 * a single-symbol call per row. Returns {} (not a throw) on failure so a
 * flaky Alpaca call degrades to an empty quotes column rather than taking
 * down the whole watchlist response.
 */
export async function getSnapshotsMulti(symbols: string[]): Promise<Record<string, Snapshot>> {
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
export async function getSnapshotsChunked(symbols: string[]): Promise<Record<string, Snapshot>> {
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
  if (startMs(start) > Date.parse(sipEnd(end))) return out; // nothing settled yet
  await inChunks(symbols.map(s => s.toUpperCase()), 100, 4, async chunk => {
    try {
      let pageToken: string | undefined;
      for (let page = 0; page < 10; page++) {
        const params: Record<string, string | number> = {
          symbols: chunk.join(','), timeframe: '1Day', adjustment: 'split', feed: 'sip', limit: 10000, start, end: sipEnd(end),
        };
        if (pageToken) params.page_token = pageToken;
        const response = await alpacaClient.get<BarsResponse>('/v2/stocks/bars', { params });
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

/**
 * Split-adjusted daily bars (full OHLCV) for up to ~100 symbols in one paged request series
 * (Alpaca returns at most 10,000 bars a page across all the symbols). Unlike getDailyBarsMulti this
 * THROWS on a failed request, so a caller storing the result never mistakes a failure for "no bars".
 */
export async function getDailyBarsChunk(symbols: string[], start: string, end: string): Promise<Record<string, Bar[]>> {
  const out: Record<string, Bar[]> = {};
  if (startMs(start) > Date.parse(sipEnd(end))) return out; // nothing settled yet
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const params: Record<string, string | number> = {
      symbols: symbols.map(s => s.toUpperCase()).join(','), timeframe: '1Day', adjustment: 'split', feed: 'sip', limit: 10000, start, end: sipEnd(end),
    };
    if (pageToken) params.page_token = pageToken;
    const response = await alpacaClient.get<BarsResponse>('/v2/stocks/bars', { params });
    for (const [sym, bars] of Object.entries(response.data?.bars ?? {})) (out[sym] ??= []).push(...bars);
    pageToken = response.data?.next_page_token;
    if (!pageToken) return out;
  }
  throw new Error('daily bars: too many pages');
}

/**
 * Convert interval string to the provider's timeframe format
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
export async function getOptionBars(occSymbol: string, timeframe: string, start: string, end: string): Promise<Bar[]> {
  try {
    const bars: Bar[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const params: any = { symbols: occSymbol, timeframe, limit: 10000, start, end };
      if (pageToken) params.page_token = pageToken;

      const response = await alpacaClient.get<BarsResponse>('/v1beta1/options/bars', { params });

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
): Promise<Bar | null> {
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
): Promise<{ bars: Record<string, Bar[]>; failed: string[] }> {
  const bars: Record<string, Bar[]> = {};
  const failed: string[] = [];
  await inChunks(symbols, 200, parallel, async chunk => {
    try {
      let pageToken: string | undefined;
      for (let page = 0; page < 20; page++) {
        const params: Record<string, string | number> = { symbols: chunk.join(','), timeframe, limit: 10000, start, end };
        if (pageToken) params.page_token = pageToken;
        const response = await alpacaClient.get<BarsResponse>('/v1beta1/options/bars', { params });
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

/**
 * Snapshots for specific option contracts. Verified: the endpoint refuses
 * more than 100 symbols per request ("symbol limit is 100"), so it is chunked.
 * Returns {} for chunks that fail.
 */
export async function getOptionSnapshotsMulti(symbols: string[]): Promise<Record<string, OptionSnapshot>> {
  const parts = await inChunks([...new Set(symbols)], 100, 4, async chunk => {
    try {
      const response = await alpacaClient.get('/v1beta1/options/snapshots', { params: { symbols: chunk.join(',') } });
      return (response.data?.snapshots ?? {}) as Record<string, OptionSnapshot>;
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
): Promise<Record<string, OptionSnapshot>> {
  const out: Record<string, OptionSnapshot> = {};
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

// ---------------------------------------------------------------------------
// Paced bulk daily bars (universe refresh, backfills). One shared gate spaces the
// request starts across every caller in this process, and a 429 / failure doubles
// a penalty that later successes halve, so bulk jobs never burst the rate limit.
// ---------------------------------------------------------------------------

/** Requests per minute the bulk paths allow themselves (the plan's limit is 200/min; leave headroom for live traffic). */
export const BULK_MAX_PER_MINUTE = 150;
let gateNext = 0;
let penaltyMs = 0;

async function paceGate(maxPerMinute: number): Promise<void> {
  const interval = Math.ceil(60_000 / Math.min(maxPerMinute, 200));
  const now = Date.now();
  const at = Math.max(now, gateNext);
  gateNext = at + interval + penaltyMs;
  if (at > now) await new Promise(r => setTimeout(r, at - now));
}

function retryAfterMs(error: unknown): number | null {
  if (!axios.isAxiosError(error)) return null;
  const h = error.response?.headers?.['retry-after'];
  const s = Number(h);
  return Number.isFinite(s) && s > 0 ? s * 1000 : null;
}

export interface PacedBarsResult {
  bars: Record<string, Bar[]>;
  /** Symbols whose chunk still failed after every retry: unknown, never "no bars". */
  failed: string[];
  requests: number;
  retries: number;
  /** False when `deadline` stopped the run before every chunk was tried. */
  done: boolean;
}

/**
 * Split-adjusted daily bars for many symbols, `chunk` symbols per request series, sequential and
 * paced. Failed chunks are retried with backoff (honouring Retry-After) up to `maxAttempts`.
 */
export async function getDailyBarsPaced(
  symbols: string[], start: string, end: string,
  opts: { chunk?: number; maxPerMinute?: number; maxAttempts?: number; deadline?: number } = {},
): Promise<PacedBarsResult> {
  const size = opts.chunk ?? 100;
  const maxAttempts = opts.maxAttempts ?? 4;
  const out: PacedBarsResult = { bars: {}, failed: [], requests: 0, retries: 0, done: true };
  const list = [...new Set(symbols.map(s => s.toUpperCase()))];
  for (let i = 0; i < list.length; i += size) {
    if (opts.deadline && Date.now() > opts.deadline) { out.done = false; break; }
    const part = list.slice(i, i + size);
    let ok = false;
    for (let attempt = 1; attempt <= maxAttempts && !ok; attempt++) {
      await paceGate(opts.maxPerMinute ?? BULK_MAX_PER_MINUTE);
      try {
        out.requests++;
        const got = await getDailyBarsChunk(part, start, end);
        for (const [sym, bars] of Object.entries(got)) out.bars[sym] = bars;
        ok = true;
        penaltyMs = Math.floor(penaltyMs / 2);
      } catch (error) {
        out.retries++;
        penaltyMs = Math.min(penaltyMs ? penaltyMs * 2 : 1000, 15_000);
        const wait = retryAfterMs(error) ?? penaltyMs;
        console.error('[marketdata] bulk bars chunk failed, attempt', attempt, axios.isAxiosError(error) ? error.response?.status : error);
        if (attempt < maxAttempts) await new Promise(r => setTimeout(r, wait));
      }
    }
    if (!ok) out.failed.push(...part);
  }
  return out;
}

/**
 * Daily bars for a few symbols through Next's fetch cache (`revalidate` seconds), for public,
 * CDN-cached pages such as the home dashboard. Resolves to {} on any failure.
 */
export async function getDailyBarsRevalidated(symbols: string[], start: string, end: string, revalidate: number): Promise<Record<string, Bar[]>> {
  if (symbols.length === 0 || !hasKeys()) return {};
  const params = new URLSearchParams({
    symbols: symbols.join(','), timeframe: '1Day', start, end: sipEnd(end), adjustment: 'split', feed: 'sip', limit: '1000',
  });
  try {
    const res = await fetch(`${ALPACA_BASE_URL}/v2/stocks/bars?${params}`, { headers: authHeaders(), next: { revalidate } });
    if (!res.ok) {
      console.error('[marketdata] daily bars HTTP', res.status, await res.text().catch(() => ''));
      return {};
    }
    const body = (await res.json()) as BarsResponse;
    return body?.bars ?? {};
  } catch (error) {
    console.error('[marketdata] daily bars fetch error', error);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Exchange calendar, news
// ---------------------------------------------------------------------------

/** Trading days in [start, end] with regular and extended session times. Throws on failure. */
export async function fetchCalendar(start: string, end: string): Promise<CalendarRow[]> {
  if (!hasKeys()) throw new Error('market-data keys not set');
  const res = await fetch(`${TRADING_URL}/v2/calendar?start=${start}&end=${end}`, {
    headers: authHeaders(), cache: 'no-store', signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`calendar HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{ date: string; open: string; close: string; session_open?: string; session_close?: string }>;
  return rows.map(r => ({ date: r.date, open: r.open, close: r.close, sessionOpen: r.session_open ?? null, sessionClose: r.session_close ?? null }));
}

/** One page of news headlines (newest last with sort=asc). Throws on HTTP failure. */
export async function fetchNewsPage(opts: { start: string; end?: string; symbols?: string[]; pageToken?: string | null }): Promise<{ news: NewsArticle[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({ start: opts.start, limit: '50', sort: 'asc', include_content: 'false' });
  if (opts.end) params.set('end', opts.end);
  if (opts.symbols?.length) params.set('symbols', opts.symbols.join(','));
  if (opts.pageToken) params.set('page_token', opts.pageToken);
  const res = await fetch(`${ALPACA_BASE_URL}/v1beta1/news?${params}`, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`news HTTP ${res.status}`);
  const body = (await res.json()) as { news?: NewsArticle[]; next_page_token?: string | null };
  return { news: body.news ?? [], nextPageToken: body.next_page_token ?? null };
}
