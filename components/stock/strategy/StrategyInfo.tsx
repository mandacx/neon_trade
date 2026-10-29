'use client';

import { useMemo } from 'react';
import { RISK_LABEL, type StrategyTemplate, type View } from '@/lib/payoff/strategies';
import { resolveTemplate, type ChainCtx, type Levels } from '@/lib/payoff/chain';
import { analyze, curve } from '@/lib/payoff/evaluate';
import { fmtStrike } from './format';

const VIEW_BADGE: Record<View, string> = {
  bullish: 'bg-green-100 text-green-800', bearish: 'bg-red-100 text-red-800',
  neutral: 'bg-sky-100 text-sky-800', volatile: 'bg-violet-100 text-violet-800',
};
const LETTERS = 'ABCDEFGH';

/** "Buy a call at strike A" lines; strike letters run A, B, C… from the lowest strike up. */
function recipe(t: StrategyTemplate, strikes: Array<number | undefined>): { lines: string[]; letters: Map<number, string> } {
  const distinct = [...new Set(strikes.filter((k): k is number => k != null))].sort((a, b) => a - b);
  const letters = new Map(distinct.map((k, i) => [k, LETTERS[i] ?? '?']));
  // Unresolved (no chain for a far leg): letter by the template's own strike rule instead.
  const ruleKey = (i: number) => { const r = t.legs[i].strike; return r ? `${r.anchor}:${r.steps}` : ''; };
  const ruleOrder = [...new Set(t.legs.map((_, i) => ruleKey(i)).filter(Boolean))];
  const lines = t.legs.map((l, i) => {
    const n = Math.abs(l.qty);
    if (l.kind === 'stock') return `${l.qty > 0 ? 'Buy' : 'Sell short'} ${n * 100} shares`;
    const k = strikes[i];
    const letter = k != null ? letters.get(k) : LETTERS[ruleOrder.indexOf(ruleKey(i))];
    const what = `${n === 1 ? 'a' : n} ${l.right === 'C' ? 'call' : 'put'}${n > 1 ? 's' : ''}`;
    return `${l.qty > 0 ? 'Buy' : 'Sell'} ${what} at strike ${letter}${l.far ? ' (later expiry)' : ''}`;
  });
  return { lines, letters };
}

/**
 * Explainer for one strategy (shown while a strategy is hovered in the picker, else for the
 * picked one): view, whether profit and loss are limited, description, the leg recipe with
 * lettered strikes and the expiry payoff with those strikes marked, priced from the live chain.
 */
export default function StrategyInfo({ t, near, far, levels }: {
  t: StrategyTemplate;
  near: ChainCtx;
  far: ChainCtx | null;
  levels: Levels;
}) {
  const info = useMemo(() => {
    const r = resolveTemplate(t, near, far, levels);
    const strikes = t.legs.map((_, i) => (r.legs?.[i]?.kind === 'option' ? r.legs[i].strike : undefined));
    const rec = recipe(t, strikes);
    if (!r.legs) return { ...rec, a: null, plot: null, notes: [] as string[] };
    const a = analyze(r.legs, near.spot, near.atmIv);
    const ks = [...rec.letters.keys()];
    // Frame the strikes and spot with a margin of about the strike spread (min 3% of spot), so a narrow
    // butterfly reads as a tent rather than a spike.
    const kLo = Math.min(near.spot, ...ks), kHi = Math.max(near.spot, ...ks);
    const pad = Math.max((kHi - kLo) * 0.8, near.spot * 0.03);
    const lo = Math.max(0.01, kLo - pad), hi = kHi + pad;
    const pts = curve(r.legs, Array.from({ length: 81 }, (_, i) => lo + ((hi - lo) * i) / 80), { day: a?.dte ?? 0 });
    return { ...rec, a, plot: { pts, lo, hi }, notes: r.notes ?? [] };
  }, [t, near, far, levels]);

  const W = 240, H = 110, PAD = 6;
  let svg: React.ReactNode = null;
  if (info.plot) {
    const { pts, lo, hi } = info.plot;
    const ys = pts.map(p => p.pnl);
    const top = Math.max(0, ...ys), bot = Math.min(0, ...ys);
    const span = top - bot || 1;
    const x = (s: number) => PAD + ((s - lo) / (hi - lo)) * (W - 2 * PAD);
    const y = (v: number) => PAD + ((top - v) / span) * (H - 2 * PAD - 12);
    const zero = y(0);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.s).toFixed(1)},${y(p.pnl).toFixed(1)}`).join('');
    const area = `${line}L${x(pts[pts.length - 1].s).toFixed(1)},${zero.toFixed(1)}L${x(pts[0].s).toFixed(1)},${zero.toFixed(1)}Z`;
    const id = `si-${t.id}`;
    svg = (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[260px]" aria-label={`${t.name} payoff at expiry`}>
        <defs>
          <clipPath id={`${id}-up`}><rect x="0" y="0" width={W} height={zero} /></clipPath>
          <clipPath id={`${id}-dn`}><rect x="0" y={zero} width={W} height={H} /></clipPath>
        </defs>
        <path d={area} fill="#22c55e" fillOpacity="0.25" clipPath={`url(#${id}-up)`} />
        <path d={area} fill="#ef4444" fillOpacity="0.25" clipPath={`url(#${id}-dn)`} />
        <line x1={PAD} x2={W - PAD} y1={zero} y2={zero} stroke="#9ca3af" strokeWidth="0.8" />
        <path d={line} fill="none" stroke="#111827" strokeWidth="1.4" />
        <line x1={x(near.spot)} x2={x(near.spot)} y1={PAD} y2={H - 14} stroke="#3b82f6" strokeWidth="0.8" strokeDasharray="2 2" />
        {[...info.letters].map(([k, L]) => (
          <g key={k}>
            <line x1={x(k)} x2={x(k)} y1={zero - 3} y2={zero + 3} stroke="#374151" strokeWidth="0.8" />
            <text x={x(k)} y={H - 2} textAnchor="middle" fontSize="9" fill="#374151" fontWeight="600">{L}</text>
          </g>
        ))}
      </svg>
    );
  }
  const a = info.a;
  const badge = 'text-[10px] font-semibold px-1.5 py-0.5 rounded';

  return (
    <div className="flex flex-col sm:flex-row gap-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
          <span className="text-sm font-bold text-gray-900 mr-1">{t.name}</span>
          <span className={`${badge} capitalize ${VIEW_BADGE[t.view]}`}>{t.view}</span>
          {a && <span className={`${badge} ${a.unboundedProfit ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{a.unboundedProfit ? 'Unlimited profit' : 'Limited profit'}</span>}
          {a && <span className={`${badge} ${a.unboundedLoss ? 'bg-red-100 text-red-800' : 'bg-lime-100 text-lime-800'}`}>{a.unboundedLoss ? 'Unlimited loss' : 'Limited loss'}</span>}
          <span className="text-[10px] text-gray-400">{RISK_LABEL[t.risk]}</span>
        </div>
        <p className="text-xs text-gray-700 leading-relaxed">{t.description}</p>
        <ul className="mt-2 text-xs text-gray-700 list-disc pl-4 space-y-0.5">
          {info.lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
        {info.letters.size > 0 && (
          <p className="mt-1.5 text-[11px] text-gray-500">
            {[...info.letters].map(([k, L]) => `${L} = ${fmtStrike(k)}`).join(' · ')} · spot {near.spot.toFixed(2)} (blue)
          </p>
        )}
        {info.notes.map((n, i) => <p key={i} className="mt-1 text-[11px] text-sky-800">{n}</p>)}
      </div>
      {svg && <div className="sm:w-[260px] shrink-0 flex flex-col items-center"><span className="self-start text-[10px] text-gray-400 mb-0.5">Profit / loss at expiry</span>{svg}</div>}
    </div>
  );
}
