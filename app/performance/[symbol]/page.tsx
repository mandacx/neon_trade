'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import ColumnsMenu from '@/components/ui/ColumnsMenu';
import { useColumnPrefs } from '@/components/ui/useColumnPrefs';
import type { ColumnMeta } from '@/lib/tableColumns';
import { getLevelDisplayName, getLevelColor, formatCurrency, formatPercentage, OUTCOME_LABEL, OUTCOME_CLASS, PerformanceOutcome } from '@/lib/utils';

interface PerformanceRow {
  id: string;
  symbol: string;
  level: string;
  direction: 'buy_above' | 'sell_below';
  price: number;
  tradeDate: string;
  expiryDate: string;
  loadDateTime: string;
  expiryClose: number | null;
  movePct: number | null;
  outcome: PerformanceOutcome;
  /** Earnings feature only: true = a report landed inside the alert window. */
  earningsInWindow?: boolean | null;
}

/** Columns of the alerts table, in display order. Saved per user (the Columns menu). */
const ALERT_COLUMNS: ColumnMeta[] = [
  { id: 'date', label: 'Date', required: true },
  { id: 'level', label: 'Level' },
  { id: 'direction', label: 'Direction' },
  { id: 'trigger', label: 'Trigger' },
  { id: 'expiry', label: 'Expiry' },
  { id: 'close', label: 'Expiry close' },
  { id: 'move', label: 'Move' },
  { id: 'outcome', label: 'Outcome' },
];

export default function PerformanceDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const watchlistId = searchParams.get('watchlist') ?? '';
  // Route params can arrive URL-encoded; decode for display and use,
  // re-encoding only when building API URLs.
  const symbol = decodeURIComponent((params?.symbol as string) || '');

  const [rows, setRows] = useState<PerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Columns the user switched off: loaded with the page, saved to their account.
  const cols = useColumnPrefs('performanceSymbol', ALERT_COLUMNS);
  const show = (id: string) => cols.isShown(id);

  useEffect(() => {
    if (!watchlistId || !symbol) { setLoading(false); setError('Missing watchlist context.'); return; }
    setLoading(true);
    setError(null);
    fetch(`/api/watchlists/${encodeURIComponent(watchlistId)}/performance/${encodeURIComponent(symbol)}?expiryCount=24`)
      .then(res => res.json())
      .then(json => {
        setLoading(false);
        if (!json.success) { setError(json.error ?? 'Could not load performance data.'); return; }
        setRows(json.data.rows);
      });
  }, [watchlistId, symbol]);

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-6 max-w-4xl">
          <Link href={`/performance?watchlist=${encodeURIComponent(watchlistId)}`} className="text-xs font-semibold text-blue-600">← Back to performance</Link>
          <h1 className="text-lg font-bold text-gray-900 mt-2 mb-1">{symbol}</h1>
          <p className="text-xs text-gray-400 mb-5">Every fired alert and how it played out by its option expiry.</p>

          {loading && <p className="text-xs text-gray-400">Loading…</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}

          {!loading && !error && (
            rows.length === 0 ? (
              <div className="bg-white rounded-xl border border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
                No alerts found for {symbol} in the recent expiry window.
              </div>
            ) : (
              <>
              <div className="flex justify-end mb-2"><ColumnsMenu metas={ALERT_COLUMNS} {...cols.menu} /></div>
              <div className={`bg-white rounded-xl border border-gray-200 overflow-x-auto ${cols.hideUntilReady}`}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                      <th className="text-left px-3 py-2">Date</th>
                      {show('level') && (<th className="text-left px-3 py-2">Level</th>)}
                      {show('direction') && (<th className="text-left px-3 py-2">Direction</th>)}
                      {show('trigger') && (<th className="text-right px-3 py-2">Trigger</th>)}
                      {show('expiry') && (<th className="text-left px-3 py-2">Expiry</th>)}
                      {show('close') && (<th className="text-right px-3 py-2">Expiry close</th>)}
                      {show('move') && (<th className="text-right px-3 py-2">Move</th>)}
                      {show('outcome') && (<th className="text-right px-3 py-2">Outcome</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} className="border-b border-gray-50 tabular-nums">
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.tradeDate}</td>
                        {show('level') && (<td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: getLevelColor(r.level) }} />
                            {getLevelDisplayName(r.level)}
                          </span>
                        </td>)}
                        {show('direction') && (<td className="px-3 py-2 text-gray-600">{r.direction === 'buy_above' ? '▲ Buy above' : '▼ Sell below'}</td>)}
                        {show('trigger') && (<td className="px-3 py-2 text-right text-gray-700">{formatCurrency(r.price)}</td>)}
                        {show('expiry') && (<td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.expiryDate}{r.earningsInWindow && <span className="ml-1.5 text-[9px] font-bold px-1 py-px rounded bg-amber-100 text-amber-800" title="An earnings report landed between this alert and its expiry">ER</span>}</td>)}
                        {show('close') && (<td className="px-3 py-2 text-right text-gray-700">{r.expiryClose !== null ? formatCurrency(r.expiryClose) : '—'}</td>)}
                        {show('move') && (<td className={`px-3 py-2 text-right font-semibold ${r.movePct === null ? 'text-gray-400' : r.movePct > 0 ? 'text-green-600' : r.movePct < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                          {r.movePct !== null ? formatPercentage(r.movePct, 2) : '—'}
                        </td>)}
                        {show('outcome') && (<td className="px-3 py-2 text-right">
                          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${OUTCOME_CLASS[r.outcome]}`}>
                            {OUTCOME_LABEL[r.outcome]}
                          </span>
                        </td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )
          )}
        </div>
      </div>
    </>
  );
}
