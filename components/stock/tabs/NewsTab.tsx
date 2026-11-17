'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NewsItem, NewsResponse } from '@/types/news';

/** How often an open page re-reads the news by itself (stock tab and landing card). */
export const NEWS_POLL_MS = 15 * 60_000;

/** "5m ago", "3h ago", "2d ago", then a short date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Soft tile colours; a ticker always gets the same one (hash of its letters), so a stock's rows look alike. */
const TILE_COLORS = [
  'bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700', 'bg-violet-100 text-violet-700', 'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700', 'bg-indigo-100 text-indigo-700', 'bg-lime-100 text-lime-800',
];
const tileColor = (s: string) => TILE_COLORS[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TILE_COLORS.length];

/**
 * Small picture on the left of a news row: the article's own image when the feed has one. When it has none (the feed currently
 * carries none), or it fails to load, a tile with the stock's ticker letters, so every row has the same shape and the text
 * keeps the same width. Without a ticker, a neutral newspaper tile.
 */
export function NewsThumb({ url, size, symbol }: { url: string | null; size: 'sm' | 'md'; symbol?: string | null }) {
  const [failed, setFailed] = useState(false);
  const box = size === 'md' ? 'w-16 h-12 sm:w-24 sm:h-16' : 'w-16 h-12';
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`${box} object-cover rounded-md bg-gray-100 shrink-0`} />;
  }
  const t = (symbol ?? '').trim().toUpperCase();
  if (/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)) {
    const txt = t.length <= 3 ? 'text-lg sm:text-xl' : t.length <= 5 ? 'text-sm sm:text-base' : 'text-xs sm:text-sm';
    return <div aria-hidden className={`${box} rounded-md ${tileColor(t)} flex items-center justify-center shrink-0 font-bold tracking-tight overflow-hidden ${txt}`}>{t}</div>;
  }
  return (
    <div aria-hidden className={`${box} rounded-md bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400 flex items-center justify-center shrink-0`}>
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 4h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2V4z" /><path d="M18 9h1a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2" /><path d="M8 8h7M8 12h7M8 16h4" />
      </svg>
    </div>
  );
}

function NewsCard({ item, current, now }: { item: NewsItem; current: string; now: number }) {
  const others = item.symbols.filter(s => s !== current);
  const body = item.excerpt ?? item.summary;
  return (
    <article className="flex gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0">
      <NewsThumb url={item.imageUrl} size="md" symbol={current} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
          {item.source && <span className="font-semibold capitalize text-gray-600">{item.source}</span>}
          <span title={new Date(item.createdAt).toLocaleString()}>{timeAgo(item.createdAt, now)}</span>
          {others.map(s => (
            <a key={s} href={`/stock/${s}`} className="text-blue-600 hover:underline">{s}</a>
          ))}
        </div>
        <h3 className="text-sm font-semibold text-gray-900 leading-snug">
          {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-700">{item.headline}</a> : item.headline}
        </h3>
        {body && (
          <div className="mt-0.5 text-[13px] leading-snug text-gray-600 space-y-1">
            {body.split('\n\n').map((p, i, all) => (
              <p key={i}>{p}{item.excerpt && item.truncated && i === all.length - 1 ? ' …' : ''}</p>
            ))}
          </div>
        )}
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-block text-xs font-semibold text-blue-600 hover:underline">
            {item.excerpt && item.truncated ? 'Read more' : 'Read full story'}{item.source ? ` at ${item.source.replace(/^./, c => c.toUpperCase())}` : ''} →
          </a>
        )}
      </div>
    </article>
  );
}

/**
 * Stock page News tab. Loads once when first opened (the page mounts a tab on first visit and keeps it);
 * "Refresh" asks the server to re-read the feed instead of using its 60 s cache.
 */
export default function NewsTab({ symbol }: { symbol: string }) {
  const [data, setData] = useState<NewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(0);

  // `silent` (the 15-minute poll) updates the list in place: no spinner, and a failure keeps what is shown.
  const load = useCallback(async (refresh: boolean, silent = false) => {
    const mine = ++seq.current;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const res = await fetch(`/api/stocks/${encodeURIComponent(symbol)}/news${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (mine !== seq.current) return;
      if (res.ok && body?.success) setData(body.data as NewsResponse);
      else if (!silent) setError(res.status === 429 ? 'Too many refreshes. Wait a minute and try again.' : (body?.message || body?.error || 'News is unavailable right now.'));
    } catch {
      if (mine === seq.current && !silent) setError('Could not reach the server.');
    } finally {
      if (mine === seq.current) { if (!silent) setLoading(false); setNow(Date.now()); }
    }
  }, [symbol]);

  useEffect(() => { void load(false); }, [load]);
  // Re-read every 15 minutes while the browser tab is visible (the server cache is 60 s, so this is one feed call).
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) void load(false, true); }, NEWS_POLL_MS);
    return () => clearInterval(id);
  }, [load]);
  // Keep "5m ago" labels honest while the tab stays open.
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);

  const items = data?.items ?? [];
  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-800 text-sm">{symbol} news</h2>
          <div className="text-[11px] text-gray-400" aria-live="polite">
            {data ? `Updated ${new Date(data.fetchedAt).toLocaleTimeString()}` : 'Latest headlines'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Fetch the latest news now"
        >
          <span className={loading ? 'inline-block animate-spin' : 'inline-block'} aria-hidden>↻</span>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div role="alert" className="px-4 py-3 text-xs text-red-700 bg-red-50 border-b border-red-100">{error}</div>
      )}
      {!data && loading && (
        <div className="divide-y divide-gray-100">
          {[0, 1, 2].map(i => <div key={i} className="px-4 py-4 animate-pulse"><div className="h-3 w-24 bg-gray-100 rounded mb-2" /><div className="h-4 w-3/4 bg-gray-100 rounded" /></div>)}
        </div>
      )}
      {data && items.length === 0 && !error && (
        <div className="px-4 py-8 text-center text-sm text-gray-400">No recent news for {symbol}.</div>
      )}
      {items.map(it => <NewsCard key={it.id} item={it} current={symbol} now={now} />)}
    </div>
  );
}
