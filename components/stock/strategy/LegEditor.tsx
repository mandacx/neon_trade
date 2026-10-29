'use client';

import Term from '@/components/ui/Term';
import { nearest, newLegId, priceLeg, type ChainCtx, type Leg } from '@/lib/payoff/chain';
import type { Right } from '@/lib/payoff/bs';
import { fmtPct, fmtPx, fmtStrike } from './format';

/**
 * Editable leg rows: buy/sell, quantity, call/put/stock, expiry, strike (◄ ► or
 * pick), with the leg's mid, IV and delta. Every edit re-prices the leg from its
 * expiry's chain; `onNeedChain` loads a chain the leg moves to.
 */
export default function LegEditor({ legs, onChange, ctxs, expiries, spot, onNeedChain }: {
  legs: Leg[];
  onChange: (legs: Leg[]) => void;
  ctxs: Map<string, ChainCtx>;
  /** Expiries a leg can move to (the selected one first). */
  expiries: string[];
  spot: number;
  onNeedChain: (expiry: string) => Promise<ChainCtx | null>;
}) {
  const strikesFor = (l: Leg) => {
    const ctx = l.expiry ? ctxs.get(l.expiry) : undefined;
    return !ctx || !l.right ? [] : l.right === 'C' ? ctx.calls : ctx.puts;
  };

  const update = (id: string, patch: Partial<Leg>) => {
    onChange(legs.map(l => {
      if (l.id !== id) return l;
      const next: Leg = { ...l, ...patch, prevPremium: undefined };
      if (next.kind === 'option') {
        const ctx = next.expiry ? ctxs.get(next.expiry) : undefined;
        const ks = ctx ? (next.right === 'C' ? ctx.calls : ctx.puts) : [];
        if (ks.length && (next.strike === undefined || !ks.includes(next.strike))) next.strike = nearest(ks, next.strike ?? spot);
        return priceLeg(next, ctx, spot);
      }
      return priceLeg({ ...next, right: undefined, strike: undefined, expiry: undefined }, undefined, spot);
    }));
  };

  const setExpiry = async (l: Leg, expiry: string) => {
    const ctx = ctxs.get(expiry) ?? (await onNeedChain(expiry));
    if (!ctx) return;
    const ks = l.right === 'C' ? ctx.calls : ctx.puts;
    onChange(legs.map(x => (x.id === l.id ? priceLeg({ ...x, expiry, strike: ks.length ? nearest(ks, x.strike ?? spot) : x.strike, prevPremium: undefined }, ctx, spot) : x)));
  };

  const step = (l: Leg, dir: 1 | -1) => {
    const ks = strikesFor(l);
    const i = ks.indexOf(l.strike ?? NaN);
    const j = Math.min(Math.max((i < 0 ? ks.indexOf(nearest(ks, spot)) : i) + dir, 0), ks.length - 1);
    if (ks[j] !== undefined) update(l.id, { strike: ks[j] });
  };

  const addLeg = () => {
    const expiry = expiries[0];
    const ctx = ctxs.get(expiry);
    const strike = ctx?.calls.length ? nearest(ctx.calls, spot) : undefined;
    onChange([...legs, priceLeg({ id: newLegId(), kind: 'option', right: 'C', qty: 1, strike, expiry, premium: 0 }, ctx, spot)]);
  };

  const cell = 'px-1.5 py-1.5 border border-gray-200 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400';

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="text-gray-500 text-[11px]">
            <tr className="text-left">
              <th className="py-1 pr-2 font-medium">Side</th>
              <th className="py-1 px-1 font-medium"><Term k="qty">Qty</Term></th>
              <th className="py-1 px-1 font-medium">Type</th>
              <th className="py-1 px-1 font-medium">Expiry</th>
              <th className="py-1 px-1 font-medium"><Term k="strike">Strike</Term></th>
              <th className="py-1 px-1 font-medium text-right"><Term k="mid">Price</Term></th>
              <th className="py-1 px-1 font-medium text-right"><Term k="iv">IV</Term></th>
              <th className="py-1 px-1 font-medium text-right"><Term k="delta">Δ</Term></th>
              <th />
            </tr>
          </thead>
          <tbody>
            {legs.map(l => {
              const ks = strikesFor(l);
              const long = l.qty > 0;
              return (
                <tr key={l.id} className={`border-t border-gray-100 ${l.missing ? 'bg-amber-50' : ''}`}>
                  <td className="py-1 pr-2">
                    <button onClick={() => update(l.id, { qty: -l.qty })} title="Switch buy / sell"
                      className={`w-12 py-1 rounded text-[11px] font-bold ${long ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {long ? 'BUY' : 'SELL'}
                    </button>
                  </td>
                  <td className="py-1 px-1">
                    <input type="number" min={1} max={999} value={Math.abs(l.qty)} aria-label="Quantity"
                      onChange={e => { const n = Math.max(1, Math.min(999, Math.floor(Number(e.target.value) || 1))); update(l.id, { qty: long ? n : -n }); }}
                      className={`${cell} w-14 text-right`} />
                  </td>
                  <td className="py-1 px-1">
                    <select value={l.kind === 'stock' ? 'S' : l.right} aria-label="Leg type" className={cell}
                      onChange={e => {
                        const v = e.target.value;
                        if (v === 'S') update(l.id, { kind: 'stock' });
                        else update(l.id, { kind: 'option', right: v as Right, expiry: l.expiry ?? expiries[0] });
                      }}>
                      <option value="C">Call</option>
                      <option value="P">Put</option>
                      <option value="S">Stock ×100</option>
                    </select>
                  </td>
                  <td className="py-1 px-1">
                    {l.kind === 'option' ? (
                      <select value={l.expiry} aria-label="Expiry" className={cell} onChange={e => setExpiry(l, e.target.value)}>
                        {(l.expiry && !expiries.includes(l.expiry) ? [l.expiry, ...expiries] : expiries).map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="py-1 px-1">
                    {l.kind === 'option' ? (
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => step(l, -1)} className="px-1.5 py-1 rounded hover:bg-gray-100 text-gray-500" aria-label="Lower strike">◄</button>
                        <select value={l.strike ?? ''} aria-label="Strike" className={`${cell} w-20 text-right`}
                          onChange={e => update(l.id, { strike: Number(e.target.value) })}>
                          {(ks.length ? ks : l.strike !== undefined ? [l.strike] : []).map(k => <option key={k} value={k}>{fmtStrike(k)}</option>)}
                        </select>
                        <button onClick={() => step(l, 1)} className="px-1.5 py-1 rounded hover:bg-gray-100 text-gray-500" aria-label="Higher strike">►</button>
                      </div>
                    ) : <span className="text-gray-400">at {fmtPx(spot)}</span>}
                  </td>
                  <td className="py-1 px-1 text-right tabular-nums">
                    {l.missing ? <span className="text-amber-700" title="No quote for this contract in the chain">no quote</span> : (
                      <>
                        {l.prevPremium !== undefined && <span className="line-through text-gray-400 mr-1" title="Price before the last quote refresh">{fmtPx(l.prevPremium)}</span>}
                        <span title={l.kind === 'option' && l.bid != null && l.ask != null ? `Bid ${fmtPx(l.bid)} · Ask ${fmtPx(l.ask)}` : undefined}>{fmtPx(l.premium)}</span>
                      </>
                    )}
                  </td>
                  <td className="py-1 px-1 text-right tabular-nums text-gray-600">{l.kind === 'option' && l.iv ? fmtPct(l.iv) : '—'}</td>
                  <td className="py-1 px-1 text-right tabular-nums text-gray-600">{l.delta != null ? l.delta.toFixed(2) : '—'}</td>
                  <td className="py-1 pl-1">
                    <button onClick={() => onChange(legs.filter(x => x.id !== l.id))} className="px-1.5 py-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" aria-label="Remove leg" title="Remove leg">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-2">
        <button onClick={addLeg} className="px-2.5 py-1 rounded-md border border-dashed border-gray-300 text-xs font-semibold text-gray-600 hover:bg-gray-50">+ Add leg</button>
        {legs.length > 0 && <button onClick={() => onChange([])} className="text-xs text-gray-500 hover:text-red-600">Clear</button>}
        <span className="text-[11px] text-gray-400">Tip: click a bid (sell) or ask (buy) in the chain below to add that contract.</span>
      </div>
    </div>
  );
}
