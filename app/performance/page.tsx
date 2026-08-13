'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { getLevelDisplayName, getLevelColor, formatCurrency, formatPercentage, OUTCOME_LABEL, OUTCOME_CLASS, PerformanceOutcome } from '@/lib/utils';

interface WatchlistOption { id: string; name: string; isSystem: boolean; symbolCount: number }
interface LevelBreakdown { level: string; total: number; favorable: number; unfavorable: number; flat: number; winRate: number | null }
interface SymbolRanking { symbol: string; count: number; winRate: number }
interface PerformanceSummary {
  total: number;
  resolved: number;
  favorable: number;
  unfavorable: number;
  flat: number;
  notYetExpired: number;
  awaitingData: number;
  /** Continuation: price kept moving away from the level it triggered at. */
  winRate: number | null;
  /** Reversion: it turned back toward the level (share of directional outcomes). */
  reversionRate: number | null;
  avgMovePct: number | null;
  byLevel: LevelBreakdown[];
  bestSymbols: SymbolRanking[];
  worstSymbols: SymbolRanking[];
}
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
}

const EXPIRY_COUNT_OPTIONS = [3, 6, 12, 24];
const RESOLVED: PerformanceOutcome[] = ['favorable', 'unfavorable', 'flat'];

// Every drill-down entry point (a stat tile or a level row) resolves to one of
// these. 'continuation'/'favorable' and 'reversion'/'unfavorable' are
// deliberately the same underlying set — favorable IS a continuation instance
// — they're just two labeled doors into the same list.
type DrillKey = 'continuation' | 'reversion' | 'favorable' | 'unfavorable' | 'pending' | 'flat' | 'all' | `level:${string}`;

function rowsForDrill(alerts: PerformanceRow[], key: DrillKey): { title: string; rows: PerformanceRow[] } {
  switch (true) {
    case key === 'continuation' || key === 'favorable':
      return { title: 'Favorable outcomes (continuation)', rows: alerts.filter(a => a.outcome === 'favorable') };
    case key === 'reversion' || key === 'unfavorable':
      return { title: 'Unfavorable outcomes (reversion)', rows: alerts.filter(a => a.outcome === 'unfavorable') };
    case key === 'flat':
      return { title: 'Flat outcomes', rows: alerts.filter(a => a.outcome === 'flat') };
    case key === 'pending':
      return { title: 'Pending — not yet resolved', rows: alerts.filter(a => a.outcome === 'not_yet_expired' || a.outcome === 'awaiting_data') };
    case key === 'all':
      return { title: 'All alerts seen', rows: alerts };
    case key.startsWith('level:'): {
      const level = key.slice('level:'.length);
      // Matches the byLevel stat, which is computed from resolvedRows only —
      // clicking a level bar shows exactly what it's a percentage of.
      return { title: `${getLevelDisplayName(level)} — resolved alerts`, rows: alerts.filter(a => a.level === level && RESOLVED.includes(a.outcome)) };
    }
    default:
      return { title: '', rows: [] };
  }
}

function groupBySymbol(rows: PerformanceRow[]): Array<{ symbol: string; rows: PerformanceRow[] }> {
  const map = new Map<string, PerformanceRow[]>();
  for (const r of rows) {
    const arr = map.get(r.symbol);
    if (arr) arr.push(r);
    else map.set(r.symbol, [r]);
  }
  const groups = [...map.entries()].map(([symbol, rs]) => ({
    symbol,
    rows: [...rs].sort((a, b) => (a.loadDateTime < b.loadDateTime ? 1 : -1)),
  }));
  groups.sort((a, b) => b.rows.length - a.rows.length || a.symbol.localeCompare(b.symbol));
  return groups;
}

function StatTile({
  label, value, sub, tone, onClick, active,
}: { label: string; value: string; sub?: string; tone?: 'green' | 'red' | 'gray'; onClick?: () => void; active?: boolean }) {
  const toneClass = tone === 'green' ? 'text-green-600' : tone === 'red' ? 'text-red-600' : 'text-gray-900';
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`bg-white rounded-xl border p-4 ${active ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'} ${onClick ? 'hover:border-blue-300 cursor-pointer transition-colors' : ''}`}
    >
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function SymbolRankList({ title, rows, watchlistId, tone }: { title: string; rows: SymbolRanking[]; watchlistId: string; tone: 'green' | 'red' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-xs font-semibold text-gray-700 mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-400">Not enough resolved alerts yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(r => (
            <li key={r.symbol} className="flex items-center justify-between text-xs">
              <Link href={`/performance/${encodeURIComponent(r.symbol)}?watchlist=${encodeURIComponent(watchlistId)}`} className="font-medium text-gray-800 hover:text-blue-600">
                {r.symbol}
              </Link>
              <span className={`tabular-nums font-semibold ${tone === 'green' ? 'text-green-600' : 'text-red-600'}`}>
                {formatPercentage(r.winRate, 0)} <span className="text-gray-400 font-normal">({r.count})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Drill-down: the alerts behind a stat tile or level row, grouped by symbol. */
function DrillPanel({ title, rows, watchlistId, onClose }: { title: string; rows: PerformanceRow[]; watchlistId: string; onClose: () => void }) {
  const groups = useMemo(() => groupBySymbol(rows), [rows]);
  // Small result sets stay fully open; a big one (e.g. "All alerts seen" across
  // a whole watchlist) opens collapsed so it doesn't dump a huge page of tables.
  const autoOpen = groups.length <= 8;

  return (
    <div className="bg-white rounded-xl border border-blue-200 ring-1 ring-blue-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-xs font-semibold text-gray-700">{title}</h3>
          <p className="text-[11px] text-gray-400">
            {rows.length} alert{rows.length === 1 ? '' : 's'} across {groups.length} symbol{groups.length === 1 ? '' : 's'}
          </p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs font-semibold px-2 py-1 shrink-0">
          ✕ Close
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-gray-400">No alerts in this category.</p>
      ) : (
        <div className="space-y-2 max-h-[34rem] overflow-y-auto pr-1">
          {groups.map(g => (
            <details key={g.symbol} open={autoOpen} className="group border border-gray-100 rounded-lg">
              <summary className="cursor-pointer list-none px-3 py-2 flex items-center justify-between text-xs font-semibold text-gray-700 hover:bg-gray-50 rounded-lg">
                <span className="flex items-center gap-2">
                  <span className="text-gray-400 inline-block transition-transform group-open:rotate-90">▶</span>
                  <Link
                    href={`/performance/${encodeURIComponent(g.symbol)}?watchlist=${encodeURIComponent(watchlistId)}`}
                    className="hover:text-blue-600"
                    onClick={e => e.stopPropagation()}
                  >
                    {g.symbol}
                  </Link>
                </span>
                <span className="text-gray-400 font-normal">{g.rows.length}</span>
              </summary>
              <div className="overflow-x-auto border-t border-gray-100">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                      <th className="text-left px-3 py-1.5">Date</th>
                      <th className="text-left px-3 py-1.5">Level</th>
                      <th className="text-left px-3 py-1.5">Direction</th>
                      <th className="text-right px-3 py-1.5">Trigger</th>
                      <th className="text-left px-3 py-1.5">Expiry</th>
                      <th className="text-right px-3 py-1.5">Close</th>
                      <th className="text-right px-3 py-1.5">Move</th>
                      <th className="text-right px-3 py-1.5">Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map(r => (
                      <tr key={r.id} className="border-t border-gray-50 tabular-nums">
                        <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{r.tradeDate}</td>
                        <td className="px-3 py-1.5">
                          <span className="inline-flex items-center gap-1.5 font-medium text-gray-700">
                            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: getLevelColor(r.level) }} />
                            {getLevelDisplayName(r.level)}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-gray-600">{r.direction === 'buy_above' ? '▲ Buy above' : '▼ Sell below'}</td>
                        <td className="px-3 py-1.5 text-right text-gray-700">{formatCurrency(r.price)}</td>
                        <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{r.expiryDate}</td>
                        <td className="px-3 py-1.5 text-right text-gray-700">{r.expiryClose !== null ? formatCurrency(r.expiryClose) : '—'}</td>
                        <td className={`px-3 py-1.5 text-right font-semibold ${r.movePct === null ? 'text-gray-400' : r.movePct > 0 ? 'text-green-600' : r.movePct < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                          {r.movePct !== null ? formatPercentage(r.movePct, 2) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${OUTCOME_CLASS[r.outcome]}`}>
                            {OUTCOME_LABEL[r.outcome]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PerformancePage() {
  const searchParams = useSearchParams();
  const initialWatchlistId = searchParams.get('watchlist') ?? '';

  const [watchlists, setWatchlists] = useState<WatchlistOption[]>([]);
  const [watchlistId, setWatchlistId] = useState(initialWatchlistId);
  const [expiryCount, setExpiryCount] = useState(6);
  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  const [alerts, setAlerts] = useState<PerformanceRow[]>([]);
  const [drillKey, setDrillKey] = useState<DrillKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/watchlists')
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setWatchlists(json.data.watchlists);
          if (!initialWatchlistId && json.data.watchlists.length > 0) setWatchlistId(json.data.watchlists[0].id);
        }
      });
  }, [initialWatchlistId]);

  useEffect(() => {
    if (!watchlistId) return;
    setLoading(true);
    setError(null);
    setDrillKey(null); // the underlying alerts are about to change out from under it
    fetch(`/api/watchlists/${encodeURIComponent(watchlistId)}/performance?expiryCount=${expiryCount}`)
      .then(res => res.json())
      .then(json => {
        setLoading(false);
        if (!json.success) { setError(json.error ?? 'Could not load performance data.'); return; }
        setSummary(json.data.summary);
        setAlerts(json.data.alerts ?? []);
      });
  }, [watchlistId, expiryCount]);

  const pending = (summary?.notYetExpired ?? 0) + (summary?.awaitingData ?? 0);
  const drill = drillKey ? rowsForDrill(alerts, drillKey) : null;
  const toggle = (key: DrillKey) => setDrillKey(prev => (prev === key ? null : key));

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-6 max-w-5xl">
          <h1 className="text-lg font-bold text-gray-900 mb-1">Performance</h1>
          <p className="text-xs text-gray-400 mb-5">How past scan alerts actually played out by their option expiry. Click any tile or level to see the alerts behind it.</p>

          <div className="flex flex-wrap items-center gap-3 mb-5">
            <select
              value={watchlistId}
              onChange={e => setWatchlistId(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <optgroup label="My Watchlists">
                {watchlists.filter(w => !w.isSystem).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </optgroup>
              <optgroup label="Sectors & Indices">
                {watchlists.filter(w => w.isSystem).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </optgroup>
            </select>
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mr-1">Expiries</span>
              {EXPIRY_COUNT_OPTIONS.map(n => (
                <button
                  key={n}
                  onClick={() => setExpiryCount(n)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${expiryCount === n ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {loading && <p className="text-xs text-gray-400">Loading…</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}

          {summary && !loading && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatTile label="Continuation" value={summary.winRate !== null ? formatPercentage(summary.winRate, 0) : '—'} sub={`${summary.resolved} resolved`} onClick={() => toggle('continuation')} active={drillKey === 'continuation' || drillKey === 'favorable'} />
                <StatTile label="Reversion" value={summary.reversionRate !== null ? formatPercentage(summary.reversionRate, 0) : '—'} sub="of directional moves" onClick={() => toggle('reversion')} active={drillKey === 'reversion' || drillKey === 'unfavorable'} />
                <StatTile label="Favorable" value={String(summary.favorable)} tone="green" onClick={() => toggle('favorable')} active={drillKey === 'favorable' || drillKey === 'continuation'} />
                <StatTile label="Unfavorable" value={String(summary.unfavorable)} tone="red" onClick={() => toggle('unfavorable')} active={drillKey === 'unfavorable' || drillKey === 'reversion'} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatTile label="Pending" value={String(pending)} sub={`${summary.notYetExpired} upcoming, ${summary.awaitingData} awaiting data`} tone="gray" onClick={() => toggle('pending')} active={drillKey === 'pending'} />
                <StatTile label="Flat" value={String(summary.flat)} sub="within ±0.1%" tone="gray" onClick={() => toggle('flat')} active={drillKey === 'flat'} />
                <StatTile label="Avg move" value={summary.avgMovePct !== null ? formatPercentage(summary.avgMovePct, 2) : '—'} sub="signed to the alert" tone="gray" />
                <StatTile label="Alerts seen" value={String(summary.total)} sub={`${summary.resolved} scoreable`} tone="gray" onClick={() => toggle('all')} active={drillKey === 'all'} />
              </div>

              {/* Direction is "which side of the level price sat on", so
                  Continuation and Reversion are two readings of the same data —
                  which one is the signal is a domain call, not a code one. */}
              <p className="text-[11px] text-gray-400 -mt-2">
                <strong className="text-gray-500">Continuation</strong> = price kept moving away from the level it triggered at.
                {' '}<strong className="text-gray-500">Reversion</strong> = it turned back toward the level (share of directional
                outcomes, flats excluded). Only alerts whose expiry has passed are scored.
              </p>

              {drill && (
                <DrillPanel title={drill.title} rows={drill.rows} watchlistId={watchlistId} onClose={() => setDrillKey(null)} />
              )}

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-xs font-semibold text-gray-700 mb-3">By level</h3>
                {summary.byLevel.length === 0 ? (
                  <p className="text-[11px] text-gray-400">No resolved alerts yet for this watchlist.</p>
                ) : (
                  <div className="space-y-2">
                    {summary.byLevel.map(l => {
                      const key: DrillKey = `level:${l.level}`;
                      const active = drillKey === key;
                      return (
                        <div
                          key={l.level}
                          onClick={() => toggle(key)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(key); } }}
                          className={`flex items-center gap-3 rounded-lg -mx-1 px-1 py-0.5 cursor-pointer transition-colors ${active ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-gray-50'}`}
                        >
                          <span className="w-24 text-xs font-medium text-gray-700 flex items-center gap-1.5 shrink-0">
                            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: getLevelColor(l.level) }} />
                            {getLevelDisplayName(l.level)}
                          </span>
                          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full bg-green-500" style={{ width: `${(l.winRate ?? 0) * 100}%` }} />
                          </div>
                          <span className="w-24 text-right text-xs tabular-nums text-gray-500 shrink-0">
                            {l.winRate !== null ? formatPercentage(l.winRate, 0) : '—'} <span className="text-gray-400">({l.total})</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {/* Named by what they measure, not "best"/"worst": with overall
                    continuation running below 50%, a low-continuation symbol may
                    be the strongest reversion candidate rather than a bad one. */}
                <SymbolRankList title="Highest continuation" rows={summary.bestSymbols} watchlistId={watchlistId} tone="green" />
                <SymbolRankList title="Lowest continuation (most reverting)" rows={summary.worstSymbols} watchlistId={watchlistId} tone="red" />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
