'use client';

import { useRef } from 'react';
import { nearest, type ChainCtx, type Leg } from '@/lib/payoff/chain';
import { fmtStrike } from './format';

/**
 * A price ruler with one handle per option leg (green = bought, red = sold, ▲ call,
 * ▼ put) and spot marked. Drag a handle to move that leg's strike; it snaps to the
 * strikes listed for the leg's expiry and type. Port of options-alert-lab's StrikeRuler.
 */
export default function StrikeRuler({ legs, ctxs, spot, onStrike }: {
  legs: Leg[];
  ctxs: Map<string, ChainCtx>;
  spot: number;
  onStrike: (id: string, strike: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const opts = legs.filter(l => l.kind === 'option' && l.strike !== undefined);
  if (!opts.length || spot <= 0) return null;

  const strikes = opts.map(l => l.strike!);
  const lo = Math.min(spot * 0.85, ...strikes) * 0.98;
  const hi = Math.max(spot * 1.15, ...strikes) * 1.02;
  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const ticks = Array.from({ length: 6 }, (_, i) => lo + ((hi - lo) * i) / 5);

  const listed = (l: Leg) => {
    const ctx = l.expiry ? ctxs.get(l.expiry) : undefined;
    return ctx ? (l.right === 'C' ? ctx.calls : ctx.puts) : [];
  };

  const startDrag = (l: Leg) => (e: React.PointerEvent) => {
    const bar = barRef.current;
    const ks = listed(l);
    if (!bar || !ks.length) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    let last = l.strike!;
    const move = (ev: PointerEvent) => {
      const r = bar.getBoundingClientRect();
      const v = lo + ((ev.clientX - r.left) / r.width) * (hi - lo);
      const k = nearest(ks, v);
      if (k !== last) { last = k; onStrike(l.id, k); }
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="select-none pt-7 pb-12 px-2" aria-label="Strike ruler (calls above, puts below)">
      <div ref={barRef} className="relative h-1.5 rounded bg-gray-200">
        <div className="absolute -top-2 h-5 w-px bg-gray-800" style={{ left: `${pct(spot)}%` }} title={`Spot ${spot.toFixed(2)}`} />
        <span className="absolute top-3 -translate-x-1/2 text-[10px] font-semibold text-gray-800" style={{ left: `${pct(spot)}%` }}>spot</span>
        {ticks.map((t, i) => (
          <span key={i} className="absolute top-3 -translate-x-1/2 text-[10px] text-gray-400" style={{ left: `${pct(t)}%` }}>{t.toFixed(0)}</span>
        ))}
        {opts.map((l, i) => (
          <button
            key={l.id}
            onPointerDown={startDrag(l)}
            title={`${l.qty > 0 ? 'Buy' : 'Sell'} ${Math.abs(l.qty)} ${fmtStrike(l.strike!)} ${l.right === 'C' ? 'call' : 'put'}${l.expiry ? ` ${l.expiry}` : ''}. Drag to change the strike.`}
            className={`absolute -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] font-bold text-white shadow cursor-ew-resize touch-none ${l.qty > 0 ? 'bg-green-600' : 'bg-red-600'}`}
            style={{ left: `${pct(l.strike!)}%`, top: l.right === 'C' ? '-24px' : '28px', zIndex: i + 1 }}
          >
            {l.right === 'C' ? '▲' : '▼'}{fmtStrike(l.strike!)}
          </button>
        ))}
      </div>
    </div>
  );
}
