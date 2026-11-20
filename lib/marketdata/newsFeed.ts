/**
 * News and earnings-figure sources, in priority order (docs/CHANGES.md, 2026-11-19 "news and earnings feed"):
 *
 *   1. the secondary feed (provider/feed.ts): per-symbol news, newest first, and a per-symbol earnings calendar;
 *   2. the primary feed (provider/primary.ts): the news API the app used before, which carries no per-symbol limit;
 *   3. the fallback market-data vendor (provider/fallback.ts) has NO news: it only contributes reported EPS (see
 *      lib/earnings.ts, `syncStructuredActuals`).
 *
 * Server-only, and the only place that decides between the sources. No vendor names here (they stay in provider/*).
 */
import { fetchLatestNews as fetchPrimaryNews } from './provider/primary';
import { fetchEarningsRows, fetchNewsBody, fetchSymbolNews, hasFeedKeys } from './provider/feed.ts';
import type { FeedNews } from './provider/feedMap.ts';
import type { EarningsFigures, NewsArticle, NewsArticleFull } from './types';

export { FeedRateLimited } from './provider/feed.ts';

/** Bodies are separate calls, so only the newest few articles of a list carry one (the stock page excerpts the top of its list). */
const BODY_TOP = 5;
/** Concurrent per-symbol requests for a multi-symbol list (the landing card reads about a dozen symbols). */
const FEED_CONCURRENCY = 4;

const toFull = (n: FeedNews, content = ''): NewsArticleFull => ({
  id: n.id, ref: n.ref, headline: n.headline, symbols: n.symbols, created_at: n.createdAt,
  summary: n.summary, content, url: n.url, source: n.source, images: [],
});

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.allSettled(items.slice(i, i + size).map(fn))));
  return out;
}

/** Newest-first merge of per-symbol lists: a story tagged with several of the symbols appears once. */
async function latestFromFeed(symbols: string[], limit: number, includeContent: boolean): Promise<NewsArticleFull[]> {
  const settled = await inBatches(symbols, FEED_CONCURRENCY, s => fetchSymbolNews(s));
  const ok = settled.filter((r): r is PromiseFulfilledResult<FeedNews[]> => r.status === 'fulfilled');
  // Nothing readable at all: let the caller fall back instead of showing an empty list.
  if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
  const seen = new Set<string>();
  const merged: FeedNews[] = [];
  for (const n of ok.flatMap(r => r.value).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (seen.has(n.ref)) continue;
    seen.add(n.ref);
    merged.push(n);
  }
  const top = merged.slice(0, Math.max(1, limit));
  if (!includeContent) return top.map(n => toFull(n));
  // A body that fails to load only drops that article's excerpt; the list itself is still shown.
  const bodies = await Promise.allSettled(top.slice(0, BODY_TOP).map(n => fetchNewsBody(n.ref)));
  return top.map((n, i) => toFull(n, bodies[i]?.status === 'fulfilled' ? bodies[i].value : ''));
}

/**
 * Latest articles, newest first. A list for named symbols is read from the secondary feed first and from the primary
 * feed when that fails or returns nothing; a market-wide read (no symbols) has no per-symbol form, so it stays on the
 * primary feed. Throws only when the primary feed also fails.
 */
export async function fetchLatestNews(opts: { symbols?: string[]; limit: number; includeContent: boolean }): Promise<NewsArticleFull[]> {
  const symbols = (opts.symbols ?? []).filter(Boolean);
  if (symbols.length > 0 && hasFeedKeys()) {
    try {
      const items = await latestFromFeed(symbols, opts.limit, opts.includeContent);
      if (items.length > 0) return items;
    } catch (e) {
      console.warn('[marketdata] secondary news feed failed, using the primary feed:', e instanceof Error ? e.message : e);
    }
  }
  return fetchPrimaryNews(opts);
}

/**
 * Headlines for one symbol as `NewsArticle`s tagged with the symbols the feed lists on each story (what the earnings
 * parser's single-symbol rule needs). `pages` pages of 20, newest first. Throws on failure (FeedRateLimited on 429).
 */
export async function fetchSymbolHeadlines(symbol: string, pages = 1): Promise<NewsArticle[]> {
  const items = await fetchSymbolNews(symbol, { pages });
  return items.map(n => ({ id: n.id, ref: n.ref, headline: n.headline, symbols: n.symbols, created_at: n.createdAt, source: n.source, summary: n.summary }));
}

export const hasEarningsFeed = hasFeedKeys;

/** The symbol's earnings calendar rows (estimate and actual EPS / revenue). Throws on failure (FeedRateLimited on 429). */
export async function fetchEarningsFigures(symbol: string): Promise<EarningsFigures[]> {
  return fetchEarningsRows(symbol);
}
