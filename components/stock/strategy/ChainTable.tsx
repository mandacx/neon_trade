'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ColumnsMenu from '@/components/ui/ColumnsMenu';
import Term from '@/components/ui/Term';
import { useColumnPrefs } from '@/components/ui/useColumnPrefs';
import type { GlossaryKey } from '@/lib/payoff/glossary';
import type { Right } from '@/lib/payoff/bs';
import type { OptQuote, OptionChain } from '@/lib/payoff/chain';
import type { ColumnMeta } from '@/lib/tableColumns';
import { fmtPct, fmtPx, fmtStrike } from './format';

const NEAR_ROWS = 12;
const ROW = 'h-7';

type ColId = 'ltp' | 'bid' | 'mid' | 'ask' | 'chart' | 'iv' | 'delta' | 'vol' | 'gamma' | 'theta' | 'vega';
// Listed from the strike outwards (the menu's order); calls mirror it, so the same column sits the
// same distance from the strike on both sides.
const COLS: Array<ColumnMeta & { id: ColId; w: number; term?: GlossaryKey; short: string }> = [
  { id: 'bid', label: 'Bid', short: 'Bid', term: 'bid', w: 56, hint: 'Click to sell' },
  { id: 'mid', label: 'Mid', short: 'Mid', term: 'mid', w: 56 },
  { id: 'ask', label: 'Ask', short: 'Ask', term: 'ask', w: 56, hint: 'Click to buy' },
  { id: 'ltp', label: 'LTP (last)', short: 'LTP', term: 'last', w: 56 },
  { id: 'chart', label: 'Chart', short: 'Chart', w: 44, hint: 'Price, volume and OI-change chart' },
  { id: 'iv', label: 'IV', short: 'IV', term: 'iv', w: 52 },
  { id: 'delta', label: 'Delta (Δ)', short: 'Δ', term: 'delta', w: 48 },
  { id: 'vol', label: 'Volume', short: 'Vol', term: 'vol', w: 60 },
  { id: 'gamma', label: 'Gamma (Γ)', short: 'Γ', term: 'gamma', w: 52, defaultOff: true },
  { id: 'theta', label: 'Theta (Θ)', short: 'Θ', term: 'theta', w: 52, defaultOff: true },
  { id: 'vega', label: 'Vega', short: 'Vega', term: 'vega', w: 52, defaultOff: true },
];
const BY_ID = new Map(COLS.map(c => [c.id, c]));

/**
 * Live chain: calls left, puts right of a fixed strike column, with the same user-chosen columns
 * mirrored on both sides (Columns menu, saved as `stockChain`). When the columns don't fit, both
 * sides scroll sideways together (wheel / trackpad on either side, or the slider under the table),
 * so the strike stays in the middle. Clicking a bid adds a sold leg and an ask a bought leg; the
 * chart cell opens that contract's price, volume and OI-change chart.
 */
export default function ChainTable({ chain, onAdd, onOpenContract }: {
  chain: OptionChain;
  onAdd: (right: Right, strike: number, side: 1 | -1) => void;
  onOpenContract: (strike: number, optType: 'call' | 'put') => void;
}) {
  const [all, setAll] = useState(false);
  const cols = useColumnPrefs('stockChain', COLS);
  const shown = cols.ordered(COLS.map(c => c.id)).filter(id => cols.isShown(id)).map(id => BY_ID.get(id)!);
  const sideW = shown.reduce((w, c) => w + c.w, 0);

  const spot = chain.spot;
  const atm = chain.rows.reduce((b, r, i) => (Math.abs(r.strike - spot) < Math.abs(chain.rows[b].strike - spot) ? i : b), 0);
  const rows = all ? chain.rows : chain.rows.slice(Math.max(0, atm - NEAR_ROWS), atm + NEAR_ROWS + 1);
  const firstAbove = rows.findIndex(r => r.strike >= spot);

  // ---- mirrored sideways scroll: `offset` = how far both sides have moved away from the strike.
  const callHead = useRef<HTMLDivElement>(null), callBody = useRef<HTMLDivElement>(null);
  const putHead = useRef<HTMLDivElement>(null), putBody = useRef<HTMLDivElement>(null);
  const [maxOffset, setMaxOffset] = useState(0);
  const [offset, setOffsetState] = useState(0);
  const offsetRef = useRef(0);
  const apply = useCallback((o: number) => {
    const set = (el: HTMLDivElement | null, v: number) => { if (el && Math.abs(el.scrollLeft - v) >= 1) el.scrollLeft = v; };
    const max = (el: HTMLDivElement | null) => (el ? el.scrollWidth - el.clientWidth : 0);
    set(putBody.current, o); set(putHead.current, o);
    set(callBody.current, max(callBody.current) - o); set(callHead.current, max(callHead.current) - o);
    offsetRef.current = o;
    setOffsetState(o);
  }, []);
  const measure = useCallback(() => {
    const el = putBody.current;
    const m = el ? Math.max(0, el.scrollWidth - el.clientWidth) : 0;
    setMaxOffset(m);
    apply(Math.min(offsetRef.current, m));
  }, [apply]);
  useLayoutEffect(() => { measure(); }, [measure, sideW, rows.length]);
  useEffect(() => {
    const el = putBody.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  const onPutScroll = () => { const el = putBody.current; if (el && Math.abs(el.scrollLeft - offsetRef.current) >= 1) apply(el.scrollLeft); };
  const onCallScroll = () => {
    const el = callBody.current;
    if (!el) return;
    const o = el.scrollWidth - el.clientWidth - el.scrollLeft;
    if (Math.abs(o - offsetRef.current) >= 1) apply(o);
  };

  const cell = (c: (typeof COLS)[number], q: OptQuote | undefined, right: Right, strike: number, itm: boolean) => {
    const base = `${ROW} shrink-0 flex items-center justify-end px-1 tabular-nums border-b border-gray-100 ${itm ? (right === 'C' ? 'bg-green-50/70' : 'bg-red-50/70') : ''}`;
    const style = { width: c.w };
    const dash = <span className="text-gray-300">—</span>;
    let body: React.ReactNode = dash;
    if (q) {
      switch (c.id) {
        case 'bid':
        case 'ask': {
          const side: 1 | -1 = c.id === 'ask' ? 1 : -1;
          const v = side === -1 ? q.bid : q.ask;
          body = v == null || v <= 0 ? dash : (
            <button onClick={() => onAdd(right, strike, side)}
              title={`${side === 1 ? 'Buy' : 'Sell'} the ${fmtStrike(strike)} ${right === 'C' ? 'call' : 'put'} (priced at the mid)`}
              className={`px-1 py-0.5 rounded ${side === 1 ? 'hover:bg-green-600 hover:text-white text-green-800' : 'hover:bg-red-600 hover:text-white text-red-800'}`}>
              {fmtPx(v)}
            </button>
          );
          break;
        }
        case 'mid': body = q.mid != null ? <span className="text-gray-800">{fmtPx(q.mid)}</span> : dash; break;
        case 'ltp': body = q.last != null ? <span className="text-gray-700">{fmtPx(q.last)}</span> : dash; break;
        case 'chart':
          body = (
            <button onClick={() => onOpenContract(strike, right === 'C' ? 'call' : 'put')}
              title={`Open the ${fmtStrike(strike)} ${right === 'C' ? 'call' : 'put'} chart: price, volume, OI change`}
              aria-label={`${fmtStrike(strike)} ${right === 'C' ? 'call' : 'put'} chart`}
              className={`mx-auto p-1 rounded ${right === 'C' ? 'text-green-700 hover:bg-green-100' : 'text-red-700 hover:bg-red-100'}`}>
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M1.5 13.5h13M2.5 11l3.5-4 3 2.5 4.5-6" /></svg>
            </button>
          );
          break;
        case 'iv': body = q.iv ? <span className="text-gray-600">{fmtPct(q.iv)}</span> : dash; break;
        case 'delta': body = q.delta != null ? <span className="text-gray-600">{q.delta.toFixed(2)}</span> : dash; break;
        case 'gamma': body = q.gamma != null ? <span className="text-gray-600">{q.gamma.toFixed(3)}</span> : dash; break;
        case 'theta': body = q.theta != null ? <span className="text-gray-600">{q.theta.toFixed(2)}</span> : dash; break;
        case 'vega': body = q.vega != null ? <span className="text-gray-600">{q.vega.toFixed(2)}</span> : dash; break;
        case 'vol': body = q.vol != null ? <span className="text-gray-500">{q.vol.toLocaleString()}</span> : dash; break;
      }
    }
    return <div key={c.id} className={`${base} ${c.id === 'chart' ? '!justify-center' : ''}`} style={style}>{body}</div>;
  };
  const head = (c: (typeof COLS)[number], align: 'left' | 'right') => (
    <div key={c.id} style={{ width: c.w }} className={`shrink-0 px-1 py-1 font-medium ${c.id === 'chart' ? 'text-center' : align === 'right' ? 'text-right' : 'text-right'}`}>
      {c.term ? <Term k={c.term}>{c.short}</Term> : c.short}
    </div>
  );
  const hideBar = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
  const callsOut = [...shown].reverse();
  const spotLine = (i: number) => (i === firstAbove ? 'shadow-[inset_0_2px_0_0_#3b82f6]' : '');

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] text-gray-400">Bid sells, ask buys; positions price at the mid.</span>
        <ColumnsMenu metas={COLS} {...cols.menu} />
      </div>
      <div className={`rounded border border-gray-200 text-xs ${cols.hideUntilReady}`}>
        {/* Header: same split and gutter as the body so columns line up; the side labels don't scroll. */}
        <div className="flex bg-gray-50 text-[11px] font-bold border-b border-gray-100 overflow-y-hidden [scrollbar-gutter:stable]">
          <div className="flex-1 py-0.5 text-center text-green-700">Calls</div>
          <div className="w-16 shrink-0 bg-gray-100" />
          <div className="flex-1 py-0.5 text-center text-red-700">Puts</div>
        </div>
        <div className="flex bg-gray-50 text-[11px] text-gray-500 border-b border-gray-200 overflow-y-hidden [scrollbar-gutter:stable]">
          <div ref={callHead} className="flex-1 min-w-0 overflow-hidden">
            <div className="flex ml-auto" style={{ width: sideW }}>{callsOut.map(c => head(c, 'right'))}</div>
          </div>
          <div className="w-16 shrink-0 flex items-center justify-center font-medium bg-gray-100"><Term k="strike">Strike</Term></div>
          <div ref={putHead} className="flex-1 min-w-0 overflow-hidden">
            <div className="flex" style={{ width: sideW }}>{shown.map(c => head(c, 'left'))}</div>
          </div>
        </div>
        <div className="max-h-[65vh] overflow-y-auto [scrollbar-gutter:stable]">
          <div className="flex">
            <div ref={callBody} onScroll={onCallScroll} className={`flex-1 min-w-0 overflow-x-auto overflow-y-hidden ${hideBar}`}>
              <div className="ml-auto" style={{ width: sideW }}>
                {rows.map((r, i) => (
                  <div key={r.strike} className={`flex ${spotLine(i)}`}>{callsOut.map(c => cell(c, r.call, 'C', r.strike, r.strike < spot))}</div>
                ))}
              </div>
            </div>
            <div className="w-16 shrink-0 bg-gray-50">
              {rows.map((r, i) => (
                <div key={r.strike} className={`${ROW} flex items-center justify-center font-mono font-semibold border-b border-gray-100 ${spotLine(i)}`}>{fmtStrike(r.strike)}</div>
              ))}
            </div>
            <div ref={putBody} onScroll={onPutScroll} className={`flex-1 min-w-0 overflow-x-auto overflow-y-hidden ${hideBar}`}>
              <div style={{ width: sideW }}>
                {rows.map((r, i) => (
                  <div key={r.strike} className={`flex ${spotLine(i)}`}>{shown.map(c => cell(c, r.put, 'P', r.strike, r.strike > spot))}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      {maxOffset > 0 && (
        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-400">
          <span className="whitespace-nowrap">More columns</span>
          <input type="range" min={0} max={maxOffset} value={Math.min(offset, maxOffset)} onChange={e => apply(Number(e.target.value))}
            aria-label="Scroll both sides of the chain sideways" className="flex-1 accent-gray-500" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] text-gray-400">
        <span>Shaded = <Term k="itm">in the money</Term>; blue line = spot {spot.toFixed(2)}.</span>
        {chain.rows.length > rows.length || all ? (
          <button onClick={() => setAll(v => !v)} className="text-blue-600 hover:underline">
            {all ? `Show ${NEAR_ROWS * 2 + 1} strikes around the money` : `Show all ${chain.rows.length} strikes`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
