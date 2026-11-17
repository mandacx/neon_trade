/**
 * News readers for the stock page's News tab and the landing page's latest-news card (docs/CHANGES.md,
 * 2026-11-16 "news"). Server-only; goes through the market-data facade.
 *
 * Caching: 60 s per instance per (symbol | market-wide), shared between concurrent callers. A manual
 * refresh (`refresh: true`, the stock page's Refresh button) skips the cache and calls the feed, except
 * that a list fetched in the last REFRESH_FLOOR_MS is reused (double clicks, several tabs).
 */
import { fetchLatestNews, type NewsArticleFull } from '@/lib/marketdata';
import { newsExcerpt, plainText } from '@/lib/newsText';
import type { NewsItem, NewsResponse } from '@/types/news';

/**
 * Excerpt length shown on the stock page: aim for TARGET words, never more than MAX; 0 turns excerpts
 * off (summary + link only). Enabled at 150-250 words on the owner's decision (2026-11-16) although the
 * feed provider's support page says its API data cannot be redistributed and no document found says how
 * much article text may be shown: confirm with the provider, and set both to 0 to switch it off
 * (see docs/CHANGES.md, 2026-11-16 "news").
 */
export const NEWS_EXCERPT_TARGET = 150;
export const NEWS_EXCERPT_MAX = 250;

const CACHE_MS = 60_000;
const REFRESH_FLOOR_MS = 5_000;
const STOCK_LIMIT = 20;
const HOME_LIMIT = 8;
const HOME_POOL = 50;
const HOME_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'JPM', 'AMD'];
const MAX_SYMBOLS_SHOWN = 6;

interface Entry { at: number; data: NewsResponse }
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<NewsResponse>>();

const excerptsOn = () => NEWS_EXCERPT_MAX > 0;

function toItem(a: NewsArticleFull, withExcerpt: boolean): NewsItem {
  const ex = withExcerpt && a.content ? newsExcerpt(a.content, NEWS_EXCERPT_TARGET, NEWS_EXCERPT_MAX) : null;
  const img = a.images.find(i => i.size === 'small') ?? a.images.find(i => i.size === 'thumb') ?? a.images[0];
  return {
    id: a.id,
    headline: plainText(a.headline),
    summary: plainText(a.summary),
    excerpt: ex && ex.text ? ex.text : null,
    truncated: ex ? ex.truncated : false,
    url: a.url && /^https:\/\//i.test(a.url) ? a.url : null,
    source: plainText(a.source),
    createdAt: a.created_at,
    symbols: a.symbols.slice(0, MAX_SYMBOLS_SHOWN),
    imageUrl: img?.url && /^https:\/\//i.test(img.url) ? img.url : null,
  };
}

async function load(key: string, symbols: string[], limit: number, withContent: boolean): Promise<NewsResponse> {
  const articles = await fetchLatestNews({ symbols, limit, includeContent: withContent });
  const data: NewsResponse = { items: articles.filter(a => a.headline).map(a => toItem(a, withContent)), fetchedAt: new Date().toISOString() };
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function cached(key: string, symbols: string[], limit: number, withContent: boolean, refresh: boolean): Promise<NewsResponse> {
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < (refresh ? REFRESH_FLOOR_MS : CACHE_MS)) return hit.data;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = load(key, symbols, limit, withContent).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Latest articles that mention `symbol` (upper-case, already validated by the caller). Throws if the feed fails. */
export function getSymbolNews(symbol: string, refresh = false): Promise<NewsResponse> {
  return cached(`s:${symbol}`, [symbol], STOCK_LIMIT, excerptsOn(), refresh);
}

/**
 * Latest headlines for the landing page (never carries an excerpt). Throws if the feed fails.
 * The unfiltered market-wide feed is bursts of one-line analyst-rating items (verified 2026-11-16: the
 * newest 50 were all one source, none with a picture, spanning ~70 seconds), so it is read for the most
 * widely followed symbols (HOME_SYMBOLS) instead, and stories that come with a picture are listed first
 * (newest first within each group), HOME_LIMIT in all.
 */
export async function getMarketNews(): Promise<NewsResponse> {
  const all = await cached('m', HOME_SYMBOLS, HOME_POOL, false, false);
  const ranked = [...all.items.filter(i => i.imageUrl), ...all.items.filter(i => !i.imageUrl)].slice(0, HOME_LIMIT);
  return { items: ranked, fetchedAt: all.fetchedAt };
}
