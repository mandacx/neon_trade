'use client';

import { useState } from 'react';
import Term from '@/components/ui/Term';
import type { Heatmap } from '@/lib/payoff/evaluate';
import { fmtSignedMoney, fmtMoney } from './format';

type Metric = 'pnl' | 'pct' | 'risk' | 'value';
const METRICS: Array<[Metric, string, string]> = [
  ['pnl', 'P/L $', 'Profit or loss in dollars.'],
  ['pct', 'P/L %', 'Profit or loss as a % of the money paid (debit) or received (credit).'],
  ['risk', '% of max risk', 'Profit or loss as a % of the maximum loss.'],
  ['value', 'Position value', 'What the position is worth (negative = it costs that much to close).'],
];

/**
 * P&L across stock price (rows, high at top) and date (columns, today → expiry).
 * Port of options-alert-lab's PayoffHeatmap; cells are tinted by sign and size.
 */
export default function PayoffTable({ hm, spot, maxLoss, dateLabel }: {
  hm: Heatmap;
  spot: number;
  /** Max loss at expiry (≤ 0); used by "% of max risk". */
  maxLoss: number;
  dateLabel: (day: number) => string;
}) {
  const [metric, setMetric] = useState<Metric>('pnl');
  const base = Math.abs(hm.v0) || 1;
  const risk = Math.abs(maxLoss) || 1;
  const show = (r: number, c: number): { text: string; v: number } => {
    const pnl = hm.pnl[r][c];
    switch (metric) {
      case 'pct': return { v: pnl, text: `${pnl >= 0 ? '+' : ''}${((pnl / base) * 100).toFixed(0)}%` };
      case 'risk': return { v: pnl, text: `${pnl >= 0 ? '+' : ''}${((pnl / risk) * 100).toFixed(0)}%` };
      case 'value': return { v: hm.value[r][c], text: fmtMoney(hm.value[r][c]) };
      default: return { v: pnl, text: fmtSignedMoney(pnl) };
    }
  };
  const maxAbs = Math.max(1, ...hm.pnl.flat().map(Math.abs));
  const spotRow = hm.prices.reduce((b, p, i) => (Math.abs(p - spot) < Math.abs(hm.prices[b] - spot) ? i : b), 0);

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-2">
        {METRICS.map(([m, label, hint]) => (
          <button key={m} title={hint} onClick={() => setMetric(m)}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold ${metric === m ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="overflow-auto max-h-[60vh]">
        <table className="text-[11px] tabular-nums whitespace-nowrap border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 bg-white px-2 py-1 text-left text-gray-500 font-medium">Price \ Date</th>
              {hm.days.map((d, i) => (
                <th key={i} className="sticky top-0 z-10 bg-white px-2 py-1 text-right text-gray-500 font-medium">
                  {i === hm.days.length - 1 ? <Term k="expiryLine">Exp</Term> : d === 0 ? <Term k="t0">Now</Term> : dateLabel(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hm.prices.map((p, r) => (
              <tr key={r}>
                <th className={`sticky left-0 z-10 bg-white px-2 py-0.5 text-left font-semibold ${r === spotRow ? 'text-blue-700' : 'text-gray-700'}`}>
                  {p.toFixed(2)} <span className="font-normal text-gray-400">{spot > 0 ? `${p >= spot ? '+' : ''}${(((p - spot) / spot) * 100).toFixed(0)}%` : ''}</span>
                </th>
                {hm.days.map((_, c) => {
                  const { text, v } = show(r, c);
                  const alpha = Math.min(0.75, 0.08 + (Math.abs(hm.pnl[r][c]) / maxAbs) * 0.67);
                  const bg = hm.pnl[r][c] >= 0 ? `rgba(34,197,94,${alpha})` : `rgba(239,68,68,${alpha})`;
                  return (
                    <td key={c} style={{ background: bg }} className={`px-2 py-0.5 text-right text-gray-900 ${r === spotRow ? 'outline outline-1 outline-blue-500 -outline-offset-1' : ''}`}>
                      {metric === 'value' ? fmtMoney(v) : text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
