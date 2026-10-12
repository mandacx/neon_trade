'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DrillCell, DrillMetric, DrillResult } from '@/lib/adminDrill';
import { HISTORY_MODAL_ATTR, type HistoryTarget } from '@/components/admin/HistoryModal';
import { addDaysYmd, formatCT, ctDateString } from '@/lib/time';

export type DrillPreset = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'month' | 'custom';

const PRESETS: Array<{ key: Exclude<DrillPreset, 'custom'>; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'month', label: 'This month' },
];

/** Inclusive Central Time date range for a preset. */
function rangeFor(preset: Exclude<DrillPreset, 'custom'>): { from: string; to: string } {
  const today = ctDateString();
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDaysYmd(today, -1); return { from: y, to: y }; }
    case '7d': return { from: addDaysYmd(today, -6), to: today };
    case '30d': return { from: addDaysYmd(today, -29), to: today };
    case '90d': return { from: addDaysYmd(today, -89), to: today };
    case 'month': return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

function Cell({ cell, onHistory }: { cell: DrillCell; onHistory?: (t: HistoryTarget) => void }) {
  if (cell == null) return <>—</>;
  if (typeof cell === 'object') {
    if (cell.iso) return <>{formatCT(cell.iso)}</>;
    const target: HistoryTarget | null = cell.user
      ? { kind: 'user', id: cell.user, label: cell.text ?? 'User' }
      : cell.session ? { kind: 'session', id: cell.session, label: 'Anonymous' } : null;
    if (target && onHistory) {
      return (
        <button onClick={() => onHistory(target)} className="text-blue-600 hover:underline font-medium break-all text-inherit" title={target.kind === 'user' ? 'Show this user’s history' : 'Show this session’s history'}>
          {cell.text}
        </button>
      );
    }
    return <>{cell.text ?? '—'}</>;
  }
  return <>{cell}</>;
}

function BarSeries({ series, label }: { series: DrillResult['series']; label: string }) {
  if (series.length === 0) return null;
  const max = Math.max(1, ...series.map(p => p.value));
  const total = series.reduce((n, p) => n + p.value, 0);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] font-semibold text-gray-600">{label}</span>
        <span className="text-[11px] text-gray-400">total {total}</span>
      </div>
      <div className="flex items-end gap-px h-24">
        {series.map(p => (
          <div key={p.day} className="flex-1 h-full flex flex-col justify-end min-w-0" title={`${p.day}: ${p.value}`}>
            <div className="w-full bg-blue-500 rounded-t" style={{ height: `${(p.value / max) * 100}%`, minHeight: p.value ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{series[0].day}</span>
        <span>{series[series.length - 1].day}</span>
      </div>
    </div>
  );
}

export default function DrillModal({
  metric, title, initialPreset = '7d', onClose, onHistory,
}: {
  metric: DrillMetric;
  title: string;
  initialPreset?: DrillPreset;
  onClose: () => void;
  /** Open the history of a user / session clicked in a table row. */
  onHistory?: (t: HistoryTarget) => void;
}) {
  const initial = initialPreset === 'custom' ? rangeFor('7d') : rangeFor(initialPreset);
  const [preset, setPreset] = useState<DrillPreset>(initialPreset);
  const [range, setRange] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [result, setResult] = useState<DrillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((from: string, to: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/drill?metric=${metric}&from=${from}&to=${to}`)
      .then(r => r.json())
      .then(json => { if (json.success) setResult(json.data); else { setResult(null); setError(json.error ?? 'Failed to load'); } })
      .catch(() => { setResult(null); setError('Failed to load'); })
      .finally(() => setLoading(false));
  }, [metric]);

  useEffect(() => { load(range.from, range.to); }, [load, range]);

  useEffect(() => {
    // Esc closes only the top-most modal: leave this one open under a history modal.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector(`[${HISTORY_MODAL_ATTR}]`)) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickPreset = (p: Exclude<DrillPreset, 'custom'>) => {
    const r = rangeFor(p);
    setPreset(p); setDraft(r); setRange(r);
  };
  const applyCustom = () => {
    if (!draft.from || !draft.to) return;
    setPreset('custom');
    setRange(draft);
  };
  const today = ctDateString();
  const customInvalid = !draft.from || !draft.to || draft.from > draft.to;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-2 sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900">{result?.title ?? title}</h2>
            <p className="text-[11px] text-gray-400">
              {range.from === range.to ? range.from : `${range.from} → ${range.to}`} · Central Time days
              {result && ` · ${result.rows.length}${result.truncated ? '+' : ''} row${result.rows.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs font-semibold px-2 py-1 shrink-0">✕ Close</button>
        </div>

        <div className="p-4 border-b border-gray-100 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => pickPreset(p.key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${preset === p.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
              >{p.label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[10px] font-semibold text-gray-400 uppercase">From
              <input type="date" max={today} value={draft.from} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} className="block mt-0.5 px-2 py-1 border border-gray-200 rounded-lg text-xs text-gray-700 normal-case" />
            </label>
            <label className="text-[10px] font-semibold text-gray-400 uppercase">To
              <input type="date" max={today} value={draft.to} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} className="block mt-0.5 px-2 py-1 border border-gray-200 rounded-lg text-xs text-gray-700 normal-case" />
            </label>
            <button
              onClick={applyCustom}
              disabled={customInvalid}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 ${preset === 'custom' ? 'bg-blue-600 text-white' : 'bg-gray-900 text-white'}`}
            >Apply dates</button>
            {customInvalid && draft.from && draft.to && <span className="text-[11px] text-red-600">“From” must not be after “To”.</span>}
          </div>
        </div>

        <div className="p-4 overflow-auto space-y-4">
          {loading && <p className="text-xs text-gray-400">Loading…</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {!loading && result && (
            <>
              {result.note && <p className="text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2">{result.note}</p>}
              {result.series.length > 1 && <BarSeries series={result.series} label={result.seriesLabel} />}
              {result.rows.length === 0 ? (
                <p className="text-xs text-gray-400">Nothing in this period.</p>
              ) : (
                <div className="overflow-auto max-h-[50vh] border border-gray-100 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                        {result.columns.map((c, i) => <th key={c} className={`px-3 py-2 font-semibold whitespace-nowrap ${i > 0 ? 'text-right' : ''}`}>{c}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {result.rows.map((row, ri) => (
                        <tr key={ri} className="hover:bg-gray-50">
                          {row.map((cell, ci) => (
                            <td key={ci} className={`px-3 py-1.5 ${ci === 0 ? 'font-medium text-gray-700 break-all' : 'text-right text-gray-500 whitespace-nowrap'}`}>
                              <Cell cell={cell} onHistory={onHistory} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.truncated && <p className="text-[11px] text-amber-600">Showing the first 500 rows; narrow the period to see the rest. The chart covers the full period.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
