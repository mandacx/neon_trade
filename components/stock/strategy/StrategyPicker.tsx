'use client';

import { useMemo, useState } from 'react';
import Term from '@/components/ui/Term';
import { GROUP_ORDER, RISK_LABEL, STRATEGIES, VIEWS, needsFarExpiry, type StrategyTemplate, type View } from '@/lib/payoff/strategies';
import { resolveTemplate, type ChainCtx, type Levels } from '@/lib/payoff/chain';
import { analyze, curve, type Analysis } from '@/lib/payoff/evaluate';
import { fmtMoney, fmtPct } from './format';
import StrategyInfo from './StrategyInfo';

const VIEW_STYLE: Record<View, { chip: string; active: string; badge: string }> = {
  bullish: { chip: 'border-green-300 text-green-800 hover:bg-green-50', active: 'bg-green-600 border-green-600 text-white', badge: 'bg-green-100 text-green-800' },
  bearish: { chip: 'border-red-300 text-red-800 hover:bg-red-50', active: 'bg-red-600 border-red-600 text-white', badge: 'bg-red-100 text-red-800' },
  neutral: { chip: 'border-sky-300 text-sky-800 hover:bg-sky-50', active: 'bg-sky-600 border-sky-600 text-white', badge: 'bg-sky-100 text-sky-800' },
  volatile: { chip: 'border-violet-300 text-violet-800 hover:bg-violet-50', active: 'bg-violet-600 border-violet-600 text-white', badge: 'bg-violet-100 text-violet-800' },
};
export const viewBadge = (v: View) => VIEW_STYLE[v].badge;

interface CardData { t: StrategyTemplate; a: Analysis | null; spark: string | null; error?: string; pendingFar?: boolean }

/** Expiry P&L over ±25% of spot as an SVG path in a 100×32 box (zero line at its own height). */
function sparkline(t: StrategyTemplate, near: ChainCtx, far: ChainCtx | null, levels: Levels): { a: Analysis | null; spark: string | null; error?: string } {
  const r = resolveTemplate(t, near, far, levels);
  if (!r.legs) return { a: null, spark: null, error: r.error };
  const a = analyze(r.legs, near.spot, near.atmIv);
  const grid = Array.from({ length: 61 }, (_, i) => near.spot * (0.75 + (0.5 * i) / 60));
  const pts = curve(r.legs, grid, { day: a?.dte ?? 0 });
  const ys = pts.map(p => p.pnl);
  const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys);
  const span = hi - lo || 1;
  const y = (v: number) => 30 - ((v - lo) / span) * 28;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${((i / 60) * 100).toFixed(1)},${y(p.pnl).toFixed(1)}`).join('');
  return { a, spark: `${d}|${y(0).toFixed(1)}`, error: undefined };
}

export default function StrategyPicker({ near, far, farExpiry, levels, enabled, activeId, onPick }: {
  near: ChainCtx;
  far: ChainCtx | null;
  /** The later expiry calendar/diagonal strategies use (null when none is listed). */
  farExpiry: string | null;
  levels: Levels;
  /** Template ids the admin has enabled. */
  enabled: Set<string>;
  activeId: string | null;
  onPick: (t: StrategyTemplate) => void;
}) {
  const [mode, setMode] = useState<'view' | 'list'>('view');
  const [view, setView] = useState<View>('bullish');
  const [query, setQuery] = useState('');
  // Explainer: the hovered (or focused) strategy, else the picked one.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const infoT = STRATEGIES.find(t => t.id === (hoverId ?? activeId)) ?? null;
  const hoverProps = (id: string) => ({ onMouseEnter: () => setHoverId(id), onFocus: () => setHoverId(id), onBlur: () => setHoverId(null) });
  const available = useMemo(() => STRATEGIES.filter(t => enabled.has(t.id)), [enabled]);

  const cards: CardData[] = useMemo(() => available.filter(t => t.view === view).map(t => {
    if (needsFarExpiry(t) && !far) return { t, a: null, spark: null, pendingFar: !!farExpiry, error: farExpiry ? undefined : 'No later expiry listed.' };
    return { t, ...sparkline(t, near, far, levels) };
  }), [available, view, near, far, farExpiry, levels]);

  const q = query.trim().toLowerCase();
  const listed = available.filter(t => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.view.includes(q));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {(['view', 'list'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold ${mode === m ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
              {m === 'view' ? 'By market view' : 'All strategies'}
            </button>
          ))}
        </div>
        {mode === 'view' ? (
          <div className="flex flex-wrap gap-1.5">
            {VIEWS.map(v => (
              <button key={v.id} title={v.hint} onClick={() => setView(v.id)}
                className={`px-3 py-1 rounded-full border text-xs font-bold transition-colors ${view === v.id ? VIEW_STYLE[v.id].active : `bg-white ${VIEW_STYLE[v.id].chip}`}`}>
                {v.label}
              </button>
            ))}
          </div>
        ) : (
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search strategies…"
            className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs w-52 focus:outline-none focus:ring-1 focus:ring-blue-400" />
        )}
      </div>

      {mode === 'view' ? (
        cards.length === 0 ? (
          <p className="text-xs text-gray-400 py-3">No {view} strategies are enabled.</p>
        ) : (
          <>
            <p className="text-[11px] text-gray-500 mb-2">{VIEWS.find(v => v.id === view)?.hint} Priced at today&apos;s mids; click one to load it below.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2" onMouseLeave={() => setHoverId(null)}>
              {cards.map(c => {
                const [path, zero] = c.spark?.split('|') ?? [];
                const a = c.a;
                return (
                  <button key={c.t.id} onClick={() => onPick(c.t)} {...hoverProps(c.t.id)}
                    disabled={!!c.error}
                    className={`text-left rounded-lg border p-2.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${activeId === c.t.id ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/40' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900">{c.t.name}</span>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">{RISK_LABEL[c.t.risk]}</span>
                    </div>
                    {path ? (
                      <svg viewBox="0 0 100 32" className="w-full h-10 my-1" preserveAspectRatio="none" aria-hidden>
                        <line x1="0" x2="100" y1={zero} y2={zero} stroke="#d1d5db" strokeWidth="0.5" />
                        <line x1="50" x2="50" y1="0" y2="32" stroke="#e5e7eb" strokeWidth="0.5" strokeDasharray="1 1" />
                        <path d={path} fill="none" stroke="#2563eb" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
                      </svg>
                    ) : (
                      <div className="h-10 my-1 flex items-center text-[11px] text-gray-400">
                        {c.pendingFar ? `Uses ${farExpiry} as the later expiry: click to load` : c.error ?? ''}
                      </div>
                    )}
                    {a && (
                      <div className="grid grid-cols-2 gap-x-2 text-[11px] text-gray-600">
                        <span><Term k={a.netPremium >= 0 ? 'netDebit' : 'netCredit'}>{a.netPremium >= 0 ? 'Debit' : 'Credit'}</Term> {fmtMoney(Math.abs(a.netPremium))}</span>
                        <span><Term k="pop">POP</Term> {a.pop != null ? fmtPct(a.pop) : '—'}</span>
                        <span><Term k="maxProfit">Max P</Term> <span className="text-green-700">{a.unboundedProfit ? '∞' : fmtMoney(a.maxProfit)}</span></span>
                        <span><Term k="maxLoss">Max L</Term> <span className="text-red-700">{a.unboundedLoss ? '∞' : fmtMoney(a.maxLoss)}</span></span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )
      ) : (
        <div className="max-h-80 overflow-auto pr-1 space-y-3" onMouseLeave={() => setHoverId(null)}>
          {GROUP_ORDER.map(g => {
            const items = listed.filter(t => t.group === g);
            if (!items.length) return null;
            return (
              <div key={g}>
                <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">{g}</div>
                <div className="grid sm:grid-cols-2 gap-1">
                  {items.map(t => (
                    <button key={t.id} onClick={() => onPick(t)} {...hoverProps(t.id)}
                      className={`flex items-start gap-2 text-left rounded-md px-2 py-1.5 ${activeId === t.id ? 'bg-blue-50 ring-1 ring-blue-400' : 'hover:bg-gray-50'}`}>
                      <span className={`mt-0.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${viewBadge(t.view)}`}>{t.view}</span>
                      <span>
                        <span className="block text-xs font-semibold text-gray-900">{t.name}</span>
                        <span className="block text-[11px] text-gray-500 leading-snug line-clamp-1">{t.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {listed.length === 0 && <p className="text-xs text-gray-400">No strategy matches “{query}”.</p>}
        </div>
      )}
      <div className="mt-3">
        {infoT ? (
          <StrategyInfo t={infoT} near={near} far={needsFarExpiry(infoT) ? far : null} levels={levels} />
        ) : (
          <p className="text-[11px] text-gray-400 border border-dashed border-gray-200 rounded-lg px-3 py-2">Hover a strategy to see how it works: its legs, risk and payoff.</p>
        )}
      </div>
    </div>
  );
}
