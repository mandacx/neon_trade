'use client';

import { useEffect, useState } from 'react';
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

/** Compact "latest fired alerts" feed for a watchlist's symbols — sidebar companion to the table. */
export default function AlertsWidget({ watchlistId }: { watchlistId: string }) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [levelsRedacted, setLevelsRedacted] = useState(false);

  useEffect(() => {
    if (!watchlistId) return;
    let cancelled = false;
    setAlerts(null);
    fetch(`/api/watchlists/${watchlistId}/alerts`)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return;
        setAlerts(json.success ? json.data.alerts : []);
        setLevelsRedacted(json.success ? json.data.levelsRedacted : false);
      })
      .catch(() => { if (!cancelled) setAlerts([]); });
    return () => { cancelled = true; };
  }, [watchlistId]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Latest Alerts</h3>
        <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 uppercase tracking-wide">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Live
        </span>
      </div>

      {alerts === null && (
        <p className="text-xs text-gray-400">Loading…</p>
      )}

      {alerts?.length === 0 && (
        <p className="text-xs text-gray-400">No alerts have fired yet for this watchlist&apos;s current expiries.</p>
      )}

      {alerts && alerts.length > 0 && (
        <div className="space-y-1.5 max-h-[520px] overflow-y-auto">
          {alerts.map(a => (
            <Link
              key={a.id}
              href={`/stock/${encodeURIComponent(a.symbol)}`}
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
