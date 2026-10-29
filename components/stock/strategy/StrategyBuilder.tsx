'use client';

import { useEffect, useMemo, useState } from 'react';
import Term from '@/components/ui/Term';
import type { Leg } from '@/lib/payoff/chain';
import { analyze, curve, daysToNearExpiry, heatmap } from '@/lib/payoff/evaluate';
import PayoffChart from './PayoffChart';
import MetricsPanel from './MetricsPanel';
import PayoffTable from './PayoffTable';

const RANGES = [0.05, 0.1, 0.2, 0.35, 0.5];
const IV_CHIPS = [-20, -10, -5, 0, 5, 10, 20];
const NICE = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 250, 500];

/** A uniform price grid (the payoff chart spaces points by index). */
function uniformGrid(spot: number, range: number): { grid: number[]; step: number } {
  const lo0 = Math.max(0.01, spot * (1 - range)), hi0 = spot * (1 + range);
  const step = NICE.find(s => (hi0 - lo0) / s <= 400) ?? 1000;
  const lo = Math.max(step, Math.floor(lo0 / step) * step), hi = Math.ceil(hi0 / step) * step;
  const n = Math.round((hi - lo) / step) + 1;
  return { grid: Array.from({ length: n }, (_, i) => Math.round((lo + i * step) * 1e6) / 1e6), step };
}

/**
 * Scenario view of a position: payoff chart (expiry, today and a chosen date),
 * date / IV / range controls, metrics and the price × date P&L table. All maths
 * runs in the browser (lib/payoff), so edits re-price instantly.
 */
export default function StrategyBuilder({ legs, spot, atmIv, asOf }: {
  legs: Leg[];
  spot: number;
  /** ATM IV of the selected expiry, for the probability of profit. */
  atmIv: number | null;
  /** When the quotes were read (ISO); dates on the slider count from it. */
  asOf: string;
}) {
  // 'auto' fits every strike and breakeven with some margin; the chips fix it to ±n%.
  const [rangeSel, setRange] = useState<number | 'auto'>('auto');
  const [ivShift, setIvShift] = useState(0);
  const [day, setDay] = useState(0);
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const live = useMemo(() => legs.filter(l => !l.missing && l.qty !== 0), [legs]);
  const dte = useMemo(() => daysToNearExpiry(live), [live]);
  const maxDay = Math.max(0, Math.floor(dte));
  useEffect(() => { if (day > maxDay) setDay(maxDay); }, [day, maxDay]);

  const a = useMemo(() => analyze(live, spot, atmIv), [live, spot, atmIv]);
  const range = useMemo(() => {
    if (rangeSel !== 'auto') return rangeSel;
    const xs = [...live.filter(l => l.kind === 'option').map(l => l.strike!), ...(a?.breakevens ?? [])];
    const far = Math.max(0, ...xs.map(x => Math.abs(x - spot) / spot));
    return Math.min(0.6, Math.max(0.05, far * 1.3 + 0.03));
  }, [rangeSel, live, a, spot]);
  const { grid, step } = useMemo(() => uniformGrid(spot, range), [spot, range]);
  const dateLabel = (d: number) => new Date(Date.parse(asOf) + d * 86_400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  const series = useMemo(() => ({
    expiry: curve(live, grid, { day: dte, ivShift }),
    today: curve(live, grid, { day: 0, ivShift }),
    date: day > 0 && day < dte ? curve(live, grid, { day, ivShift }) : undefined,
    dateLabel: day > 0 && day < dte ? dateLabel(day) : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [live, grid, dte, day, ivShift]);
  const hm = useMemo(() => (view === 'table' ? heatmap(live, spot, { range, ivShift }) : null), [view, live, spot, range, ivShift]);

  if (!a) return <p className="text-sm text-gray-400 py-6 text-center">Pick a strategy or add legs to see the payoff.</p>;

  return (
    <div className="space-y-3">
      <MetricsPanel a={a} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {(['chart', 'table'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={`px-2.5 py-1 rounded-md text-xs font-semibold ${view === v ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
              {v === 'chart' ? 'Payoff chart' : 'P&L table'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-600">
          <span className="mr-1">Range ±</span>
          <button onClick={() => setRange('auto')} title={`Fit all strikes and breakevens (±${Math.round(range * 100)}%)`}
            className={`px-2 py-0.5 rounded ${rangeSel === 'auto' ? 'bg-gray-900 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>Auto</button>
          {RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)} className={`px-2 py-0.5 rounded ${rangeSel === r ? 'bg-gray-900 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>{Math.round(r * 100)}%</button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-600">
          <Term k="ivShift" className="mr-1">IV shift</Term>
          {IV_CHIPS.map(v => (
            <button key={v} onClick={() => setIvShift(v)} className={`px-2 py-0.5 rounded tabular-nums ${ivShift === v ? 'bg-violet-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>{v > 0 ? `+${v}` : v}</button>
          ))}
        </div>
      </div>

      {view === 'chart' && maxDay > 0 && (
        <div className="flex items-center gap-3 text-xs text-gray-600">
          <Term k="dateLine">Date</Term>
          <input type="range" min={0} max={maxDay} value={day} onChange={e => setDay(Number(e.target.value))} className="flex-1 max-w-md accent-amber-500" aria-label="Scenario date" />
          <span className="tabular-nums w-40">{day === 0 ? 'Today' : `${dateLabel(day)} · +${day}d`} <span className="text-gray-400">(exp {dateLabel(dte)})</span></span>
        </div>
      )}

      {view === 'chart' ? (
        <PayoffChart series={series} step={step} spot={spot} breakevens={a.breakevens} />
      ) : hm && (
        <PayoffTable hm={hm} spot={spot} maxLoss={a.unboundedLoss ? Math.min(...hm.pnl.flat()) : a.maxLoss} dateLabel={dateLabel} />
      )}
      <p className="text-[11px] text-gray-400">
        Black-76 with the forward and discounting fitted from this chain&apos;s put-call parity; each leg priced at its mid.
        POP uses a lognormal at the at-the-money IV. Estimates only: no commissions, early exercise or dividends beyond what the quotes imply.
      </p>
    </div>
  );
}
