/**
 * INTERNAL PROVIDER ADAPTER (secondary news + earnings feed: per-symbol news headlines and bodies, per-symbol earnings
 * calendar with estimate / actual). Server-only. Import only from lib/marketdata/index.ts or lib/marketdata/newsFeed.ts,
 * and never put this vendor's name, hosts or field names in API responses, routes or UI text.
 *
 * Facts (docs read and live calls, 2026-11-19; docs/CHANGES.md, 2026-11-19 "news and earnings feed"):
 *  - every call is a signed GET (feedMap.signedHeaders); the key can also place orders, so nothing here ever calls a
 *    trading path, and the key and secret are never logged;
 *  - news is per symbol (one `symbol`), newest 20 per page, `pagination_key` for older pages, no time window, no body in
 *    the list (a detail call returns it); related_symbols is set on company stories ([] on market round-ups);
 *  - the earnings calendar is per symbol (`symbol` + `category=US_STOCK` are both required), limit 60 requests / 60 s.
 */
import { mapEarningsRows, mapNews, signedHeaders, type FeedEarningsRow, type FeedNews, type RawNewsItem } from './feedMap.ts';

const BASE_URL = process.env.WEBULL_API_URL || 'https://api.webull.com';

const appKey = () => process.env.WEBULL_API_KEY || '';
const appSecret = () => process.env.WEBULL_API_SECRET || '';

export const hasFeedKeys = (): boolean => !!appKey() && !!appSecret();

/** HTTP 429: callers stop their pass instead of retrying (the account limit is shared by every caller). */
export class FeedRateLimited extends Error {
  constructor() { super('secondary feed rate limited'); }
}

async function signedGet<T>(path: string, query: Record<string, string>, timeoutMs: number): Promise<T> {
  if (!hasFeedKeys()) throw new Error('secondary feed keys not set');
  const url = new URL(BASE_URL);
  const headers = signedHeaders({ host: url.host, path, query, appKey: appKey(), appSecret: appSecret() });
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${BASE_URL}${path}${qs ? `?${qs}` : ''}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 429) throw new FeedRateLimited();
  // The message may reach server logs: status only, never the URL or headers.
  if (!res.ok) throw new Error(`secondary feed HTTP ${res.status} ${path}`);
  return (await res.json()) as T;
}

/**
 * Newest-first news for one symbol, up to `pages` pages of 20. [] when the symbol has none. Throws on HTTP failure
 * (FeedRateLimited on 429). Symbols are tagged from the item's related_symbols, which is [] for market round-ups.
 */
export async function fetchSymbolNews(symbol: string, opts: { pages?: number } = {}): Promise<FeedNews[]> {
  const out: FeedNews[] = [];
  let key: string | null = null;
  const pages = Math.max(1, Math.min(5, opts.pages ?? 1));
  for (let i = 0; i < pages; i++) {
    const query: Record<string, string> = { symbol: symbol.toUpperCase(), category: 'US_STOCK' };
    if (key) query.pagination_key = key;
    const body: { data?: RawNewsItem[]; pagination_key?: string } = await signedGet('/market-data/news/stock-news/list', query, 6000);
    for (const raw of body.data ?? []) {
      const n = mapNews(raw);
      if (n) out.push(n);
    }
    key = body.pagination_key ?? null;
    if (!key) break;
  }
  return out;
}

/** Full article body (HTML or text, as the publisher sent it) by exact id; '' when there is none. Throws on HTTP failure. */
export async function fetchNewsBody(ref: string): Promise<string> {
  const body = await signedGet<{ content?: string }>('/market-data/news/detail/get', { news_id: ref }, 6000);
  return typeof body.content === 'string' ? body.content : '';
}

/** The symbol's earnings calendar: about six quarters with estimate and (when reported) actual EPS and revenue. */
export async function fetchEarningsRows(symbol: string): Promise<FeedEarningsRow[]> {
  const body = await signedGet<unknown>('/market-data/fundamentals/earnings-calendars/list', { symbol: symbol.toUpperCase(), category: 'US_STOCK' }, 6000);
  return mapEarningsRows(body);
}
