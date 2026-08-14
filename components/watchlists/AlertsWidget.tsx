'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { getLevelColor, getLevelDisplayName, formatCurrency } from '@/lib/utils';

interface Alert {
  id: string;
  symbol: string;
  level: 'put_low' | 'put_int' | 'put_call_int' | 'call_int' | 'call_high' | null;
  direction: 'buy_above' | 'sell_below';
  price: number | null;
  expiryDate: string;
  loadDateTime: string;
}

function fmtTime(iso: string): string {
  try {
    return format(new Date(iso), 'MMM d, h:mm a');
  } catch {
    return iso;
  }
}

/**
 * Compact "latest fired alerts" feed for a watchlist's symbols — sidebar
 * companion to the table. `expiry`, when set, pins the fetch to that one
 * exact expiry so this stays consistent with whatever expiry the table is
 * showing; omitted, it falls back to the route's own recent-expiries window.
 */
export default function AlertsWidget({
  watchlistId,
  expiry,
  symbolFilter,
  onClearSymbolFilter,
}: {
  watchlistId: string;
  expiry?: string;
  /** When set (from clicking a row in the watchlist table), pins the feed to just this symbol and takes over from the free-text search box. */
  symbolFilter?: string | null;
  onClearSymbolFilter?: () => void;
}) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [levelsRedacted, setLevelsRedacted] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!watchlistId) return;
    let cancelled = false;
    setAlerts(null);
    const url = `/api/watchlists/${watchlistId}/alerts${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ''}`;
    fetch(url)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return;
        setAlerts(json.success ? json.data.alerts : []);
        setLevelsRedacted(json.success ? json.data.levelsRedacted : false);
      })
      .catch(() => { if (!cancelled) setAlerts([]); });
    return () => { cancelled = true; };
  }, [watchlistId, expiry]);

  const visibleAlerts = useMemo(() => {
    if (!alerts) return alerts;
    if (symbolFilter) return alerts.filter(a => a.symbol === symbolFilter);
    const q = search.trim().toUpperCase();
    return q ? alerts.filter(a => a.symbol.includes(q)) : alerts;
  }, [alerts, search, symbolFilter]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Latest Alerts</h3>
        <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 uppercase tracking-wide">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Live
        </span>
      </div>

      {symbolFilter ? (
        <button
          onClick={onClearSymbolFilter}
          className="w-full mb-3 flex items-center justify-between px-2.5 py-1.5 border border-blue-200 rounded-lg text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
        >
          Showing: {symbolFilter}
          <span aria-hidden>✕</span>
        </button>
      ) : (
        alerts !== null && alerts.length > 0 && (
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by symbol…"
            className="w-full mb-3 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
          />
        )
      )}

      {alerts === null && (
        <p className="text-xs text-gray-400">Loading…</p>
      )}

      {alerts?.length === 0 && (
        <p className="text-xs text-gray-400">No alerts have fired yet for this watchlist&apos;s current expiries.</p>
      )}

      {alerts !== null && alerts.length > 0 && visibleAlerts?.length === 0 && (
        <p className="text-xs text-gray-400">No alerts match &quot;{symbolFilter || search}&quot;.</p>
      )}

      {visibleAlerts && visibleAlerts.length > 0 && (
        <div className="space-y-1.5 max-h-[520px] overflow-y-auto">
          {visibleAlerts.map(a => (
            <Link
              key={a.id}
              href={`/stock/${encodeURIComponent(a.symbol)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-2.5 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm text-gray-900">{a.symbol}</span>
                <span className={`text-xs font-semibold ${a.direction === 'buy_above' ? 'text-green-600' : 'text-red-600'}`}>
                  {a.direction === 'buy_above' ? '▲ Buy above' : '▼ Sell below'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                {a.level ? (
                  <span
                    className="text-[11px] font-medium px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: `${getLevelColor(a.level)}1A`, color: getLevelColor(a.level) }}
                  >
                    {getLevelDisplayName(a.level)}{a.price != null ? ` · ${formatCurrency(a.price)}` : ''}
                  </span>
                ) : (
                  <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">Delayed</span>
                )}
                <span className="text-[10px] text-gray-400">{fmtTime(a.loadDateTime)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {levelsRedacted && (
        <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-100">
          Level and price are hidden on your plan.{' '}
          <Link href="/upgrade?feature=levels" className="text-blue-600 font-medium hover:underline">Upgrade</Link> to see them live.
        </p>
      )}
    </div>
  );
}
