'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Modal from '@/components/ui/Modal';
import OptionContractModal from '@/components/stock/OptionContractModal';
import DataTable, { type Column } from '@/components/oi/DataTable';
import {
  ExpiryCell, HintBadge, Money, Segmented, SignedCount, Spinner, StrategyList, TrackForm, TypeBadge, VolToChg,
  fmtExp, fmtStrike, inputClass, labelClass, strategyToLegs, type TrackLegInput,
} from '@/components/oi/oiShared';
import { fmtCount, fmtMoneyCompact, fmtSigned } from '@/lib/format';
import type { OiContractRow, OiGroupRow, OiSummary, StrategyCandidate } from '@/types/oiTracker';

interface LiveOption {
  contract: string; vol: number | null; barDate: string | null; prevVol: number | null; last: number | null;
  bid: number | null; ask: number | null; iv: number | null; delta: number | null; gamma: number | null; theta: number | null;
}
interface StockData {
  symbol: string; from: string; to: string; loadDates: string[]; summary: OiSummary;
  volumeCoverage: { loads: number; withVolume: number };
  contracts: OiContractRow[]; truncated: boolean; byExpiry: OiGroupRow[]; byStrike: OiGroupRow[]; byDate: OiGroupRow[];
  fullOi: { tradeDate: string | null; rows: Array<{ expiry: string; callOi: number; putOi: number }> };
  strategies: StrategyCandidate[]; tol: number; minLeg: number;
  live: { contracts: Record<string, LiveOption>; top: LiveOption[]; count: number } | null;
  quote: { price: number | null; prevClose: number | null } | null;
}
type Row = OiContractRow & { live: LiveOption | null };
type Tab = 'contracts' | 'ladder' | 'expiries' | 'timeline' | 'strategies' | 'live';

const RANGES: Array<[string, string]> = [['1', '1D'], ['5', '5D'], ['10', '10D'], ['20', '20D'], ['60', '60D']];

function parseOcc(c: string) {
  const m = /^([A-Z][A-Z0-9.]*?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(c);
  return m ? { expiry: `20${m[2]}-${m[3]}-${m[4]}`, optType: m[5] === 'C' ? 'call' as const : 'put' as const, strike: Number(m[6]) / 1000 } : null;
}

export default function StockOiModal({ symbol, loadDates, to, initialRange = '1', onClose, onTracked }: {
  symbol: string;
  /** Available load dates, newest first. */
  loadDates: string[];
  to: string;
  initialRange?: string;
  onClose: () => void;
  onTracked?: () => void;
}) {
  const [range, setRange] = useState(initialRange);
  const [tol, setTol] = useState(3);
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('contracts');
  const [ladderExpiry, setLadderExpiry] = useState('');
  const [contractModal, setContractModal] = useState<OiContractRow | null>(null);
  const [track, setTrack] = useState<{ legs: TrackLegInput[]; label?: string } | null>(null);

  const from = useMemo(() => {
    const idx = loadDates.indexOf(to);
    const older = idx >= 0 ? loadDates.slice(idx) : loadDates;
    return older[Math.min(Number(range), older.length) - 1] ?? to;
  }, [loadDates, to, range]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/oi-tracker/stock/${encodeURIComponent(symbol)}?from=${from}&to=${to}&tol=${tol}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(j => { if (j.success) setData(j.data); else setError(j.error || 'Failed to load'); })
      .catch(e => { if (e.name !== 'AbortError') setError('Failed to load'); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [symbol, from, to, tol]);

  const rows: Row[] = useMemo(() => (data?.contracts ?? []).map(r => ({ ...r, live: data?.live?.contracts[r.contract] ?? null })), [data]);
  const hasLive = !!data?.live;
  const close = data?.contracts[0]?.close ?? data?.byStrike[0]?.close ?? null;

  const trackRow = (r: OiContractRow) => setTrack({ legs: [{ underlying: r.underlying, contract: r.contract, optType: r.optType, strike: r.strike, expiry: r.expiry, oiChg: r.oiChg, ltp: r.ltp, hint: r.hint }] });

  const contractCols: Column<Row>[] = [
    { key: 'expiry', label: 'Expiry', type: 'date', value: r => r.expiry, render: r => <ExpiryCell expiry={r.expiry} dte={r.dte} /> },
    { key: 'strike', label: 'Strike', type: 'number', value: r => r.strike, render: r => <span className="font-semibold">{fmtStrike(r.strike)}</span> },
    { key: 'type', label: 'Type', type: 'text', value: r => r.optType, render: r => <TypeBadge t={r.optType} /> },
    { key: 'mny', label: 'Mny %', type: 'number', value: r => r.moneynessPct, render: r => <span className={r.itm ? 'text-blue-700 font-semibold' : 'text-gray-500'} title={r.itm ? 'In the money' : 'Out of the money'}>{r.moneynessPct.toFixed(1)}%</span>, title: '(strike − close) / close; blue = in the money' },
    { key: 'oi', label: 'OI', type: 'number', value: r => r.oi, render: r => r.oi.toLocaleString() },
    { key: 'chg', label: 'OI chg', type: 'number', value: r => r.oiChg, render: r => <SignedCount v={r.oiChg} /> },
    { key: 'newPct', label: 'New %', type: 'number', value: r => r.newPct, render: r => (r.newPct == null ? '—' : `${r.newPct.toFixed(0)}%`), title: 'OI change as % of the OI before it' },
    { key: 'vol', label: 'Vol (OI day)', type: 'number', value: r => r.vol, render: r => fmtCount(r.vol), title: 'Volume of the session that produced the OI change' },
    { key: 'volToChg', label: 'Vol/Chg', type: 'number', value: r => r.volToChg, render: r => <VolToChg v={r.volToChg} /> },
    ...(hasLive ? [
      { key: 'liveVol', label: 'Vol (live)', type: 'number', value: (r: Row) => r.live?.vol ?? null, render: (r: Row) => <span title={r.live?.barDate ? `Session ${r.live.barDate}` : undefined}>{fmtCount(r.live?.vol)}</span>, title: 'Latest session volume from the live chain' },
      { key: 'iv', label: 'IV', type: 'number', value: (r: Row) => r.live?.iv ?? null, render: (r: Row) => (r.live?.iv == null ? '—' : `${(r.live.iv * 100).toFixed(0)}%`) },
      { key: 'delta', label: 'Δ', type: 'number', value: (r: Row) => r.live?.delta ?? null, render: (r: Row) => (r.live?.delta == null ? '—' : r.live.delta.toFixed(2)) },
      { key: 'bidask', label: 'Bid / Ask', type: 'number', value: (r: Row) => r.live?.bid ?? null, render: (r: Row) => (r.live?.bid == null ? '—' : `${r.live.bid.toFixed(2)} / ${r.live.ask?.toFixed(2) ?? '—'}`), filterable: false },
    ] as Column<Row>[] : []),
    { key: 'ltp', label: 'LTP', type: 'number', value: r => r.ltp, render: r => r.ltp.toFixed(2), title: 'Option LTP from the OI report' },
    { key: 'chgValue', label: 'Chg $', type: 'number', value: r => r.chgValue, render: r => <Money v={r.chgValue} />, title: 'OI change × 100 × LTP' },
    { key: 'oiValue', label: 'OI $', type: 'number', value: r => r.oiValue, render: r => <Money v={r.oiValue} signed={false} />, title: 'OI × 100 × LTP' },
    { key: 'hint', label: 'Side?', type: 'text', value: r => r.hint?.side ?? '', render: r => <HintBadge hint={r.hint} />, title: 'Hint from the premium move in the session behind the OI change' },
    { key: 'act', label: '', type: 'text', value: () => null, sortable: false, filterable: false, render: r => (
      <button onClick={e => { e.stopPropagation(); trackRow(r); }} className="text-[11px] font-semibold text-blue-600 hover:text-blue-800">Track</button>
    ) },
  ];

  const fullOiByExpiry = useMemo(() => new Map((data?.fullOi.rows ?? []).map(r => [r.expiry, r])), [data]);
  const expiryCols: Column<OiGroupRow>[] = [
    { key: 'expiry', label: 'Expiry', type: 'date', value: r => r.expiry, render: r => <ExpiryCell expiry={r.expiry!} /> },
    { key: 'callOpened', label: 'Calls +', type: 'number', value: r => r.callOpened, render: r => <SignedCount v={r.callOpened} /> },
    { key: 'callClosed', label: 'Calls −', type: 'number', value: r => r.callClosed, render: r => <SignedCount v={r.callClosed} /> },
    { key: 'putOpened', label: 'Puts +', type: 'number', value: r => r.putOpened, render: r => <SignedCount v={r.putOpened} /> },
    { key: 'putClosed', label: 'Puts −', type: 'number', value: r => r.putClosed, render: r => <SignedCount v={r.putClosed} /> },
    { key: 'pc', label: 'P/C opened', type: 'number', value: r => r.pcOpened, render: r => (r.pcOpened == null ? '—' : r.pcOpened.toFixed(2)) },
    { key: 'callChgValue', label: 'Call $', type: 'number', value: r => r.callChgValue, render: r => <Money v={r.callChgValue} /> },
    { key: 'putChgValue', label: 'Put $', type: 'number', value: r => r.putChgValue, render: r => <Money v={r.putChgValue} /> },
    { key: 'vol', label: 'Vol', type: 'number', value: r => r.vol, render: r => fmtCount(r.vol) },
    { key: 'fullCall', label: 'Total call OI', type: 'number', value: r => fullOiByExpiry.get(r.expiry!)?.callOi ?? null, render: r => fmtCount(fullOiByExpiry.get(r.expiry!)?.callOi), title: 'All call OI at this expiry (levels table), not just changed contracts' },
    { key: 'fullPut', label: 'Total put OI', type: 'number', value: r => fullOiByExpiry.get(r.expiry!)?.putOi ?? null, render: r => fmtCount(fullOiByExpiry.get(r.expiry!)?.putOi) },
    { key: 'contracts', label: '#', type: 'number', value: r => r.contracts },
  ];

  // Strike ladder: aggregate per strike (all expiries) or from contract rows of one expiry.
  const ladder = useMemo(() => {
    const m = new Map<number, { strike: number; callOi: number; putOi: number; callChg: number; putChg: number }>();
    if (!data) return [];
    if (!ladderExpiry) {
      for (const g of data.byStrike) m.set(g.strike!, { strike: g.strike!, callOi: g.callOi, putOi: g.putOi, callChg: g.callChg, putChg: g.putChg });
    } else {
      for (const r of data.contracts.filter(c => c.expiry === ladderExpiry)) {
        const e = m.get(r.strike) ?? { strike: r.strike, callOi: 0, putOi: 0, callChg: 0, putChg: 0 };
        if (r.optType === 'call') { e.callOi += r.oi; e.callChg += r.oiChg; } else { e.putOi += r.oi; e.putChg += r.oiChg; }
        m.set(r.strike, e);
      }
    }
    return [...m.values()].sort((a, b) => b.strike - a.strike);
  }, [data, ladderExpiry]);
  const ladderMax = Math.max(1, ...ladder.flatMap(l => [Math.abs(l.callChg), Math.abs(l.putChg)]));
  const nearestStrike = close == null || ladder.length === 0 ? null : ladder.reduce((b, l) => (Math.abs(l.strike - close) < Math.abs(b.strike - close) ? l : b)).strike;

  const liveTopCols: Column<LiveOption>[] = [
    { key: 'contract', label: 'Contract', type: 'text', value: r => r.contract, render: r => {
      const o = parseOcc(r.contract);
      return o ? <span className="flex items-center gap-1.5"><ExpiryCell expiry={o.expiry} /><b>{fmtStrike(o.strike)}</b><TypeBadge t={o.optType} /></span> : r.contract;
    } },
    { key: 'vol', label: 'Volume', type: 'number', value: r => r.vol, render: r => <b>{(r.vol ?? 0).toLocaleString()}</b> },
    { key: 'prevVol', label: 'Prev vol', type: 'number', value: r => r.prevVol, render: r => (r.prevVol ?? 0).toLocaleString() },
    { key: 'x', label: 'Vol ×', type: 'number', value: r => (r.prevVol ? (r.vol ?? 0) / r.prevVol : null), render: r => (r.prevVol ? `${((r.vol ?? 0) / r.prevVol).toFixed(1)}×` : '—'), title: 'Latest session volume / the session before' },
    { key: 'last', label: 'Last', type: 'number', value: r => r.last, render: r => r.last?.toFixed(2) ?? '—' },
    { key: 'iv', label: 'IV', type: 'number', value: r => r.iv, render: r => (r.iv == null ? '—' : `${(r.iv * 100).toFixed(0)}%`) },
    { key: 'delta', label: 'Δ', type: 'number', value: r => r.delta, render: r => r.delta?.toFixed(2) ?? '—' },
    { key: 'barDate', label: 'Session', type: 'date', value: r => r.barDate },
  ];

  const s = data?.summary;
  const chgPct = data?.quote?.price != null && data.quote.prevClose ? ((data.quote.price - data.quote.prevClose) / data.quote.prevClose) * 100 : null;

  return (
    <>
      <Modal onClose={onClose} widthClassName="max-w-[96rem]" title={
        <span className="flex flex-wrap items-center gap-3">
          <span>{symbol} · Open interest</span>
          {data?.quote?.price != null && (
            <span className="text-sm font-semibold text-gray-700">${data.quote.price.toFixed(2)}
              {chgPct != null && <span className={`ml-1 text-xs ${chgPct >= 0 ? 'text-green-700' : 'text-red-700'}`}>{chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%</span>}
            </span>
          )}
          <a href={`/stock/${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-600 hover:underline">Chart ↗</a>
        </span>
      }>
        <div className="flex flex-wrap items-end gap-4 mb-3">
          <div>
            <label className={labelClass}>Load dates up to {to}</label>
            <Segmented value={range} options={RANGES} onChange={setRange} />
          </div>
          <div>
            <label className={labelClass}>View</label>
            <Segmented<Tab> value={tab} onChange={setTab} options={[
              ['contracts', 'Contracts'], ['ladder', 'Strike ladder'], ['expiries', 'Expiries'], ['timeline', 'Timeline'],
              ['strategies', `Strategies${data ? ` (${data.strategies.length})` : ''}`], ...(hasLive ? [['live', 'Live volume'] as [Tab, string]] : []),
            ]} />
          </div>
          {data && <span className="text-[11px] text-gray-400 pb-1.5">{data.from === data.to ? data.to : `${data.from} → ${data.to}`} · {data.loadDates.length} load{data.loadDates.length === 1 ? '' : 's'}</span>}
        </div>

        {s && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
            {[
              ['Contracts changed', s.contracts.toLocaleString(), ''],
              ['Opened', fmtSigned(s.opened), fmtMoneyCompact(s.openedValue)],
              ['Closed', fmtSigned(s.closed), fmtMoneyCompact(s.closedValue)],
              ['Call chg $', fmtMoneyCompact(s.callChgValue), ''],
              ['Put chg $', fmtMoneyCompact(s.putChgValue), ''],
              ['Volume (OI sessions)', fmtCount(s.vol), data && data.volumeCoverage.withVolume < data.volumeCoverage.loads ? `${data.volumeCoverage.withVolume}/${data.volumeCoverage.loads} days captured` : ''],
            ].map(([k, v, sub]) => (
              <div key={k} className="bg-gray-50 rounded-lg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{k}</div>
                <div className="text-sm font-bold text-gray-900 tabular-nums">{v}</div>
                {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
              </div>
            ))}
          </div>
        )}

        <div className="border border-gray-200 rounded-lg">
          {loading ? <Spinner label={`Loading ${symbol} open interest…`} /> : error ? <div className="p-8 text-center text-sm text-red-600">{error}</div> : !data ? null : (
            <>
              {tab === 'contracts' && (
                <DataTable rows={rows} columns={contractCols} rowKey={r => r.contract} csvName={`${symbol}-oi-${data.from}-${data.to}`}
                  initialSort={{ key: 'vol', dir: 'desc' }} onRowClick={r => setContractModal(r)} maxHeight="60vh"
                  searchPlaceholder="Search expiry, strike, type…"
                  toolbar={data.truncated ? <span className="text-[11px] text-amber-700">Showing the 2,000 largest changes</span> : undefined} />
              )}
              {tab === 'expiries' && (
                <DataTable rows={data.byExpiry} columns={expiryCols} rowKey={r => r.key} csvName={`${symbol}-oi-expiries`} initialSort={{ key: 'expiry', dir: 'asc' }} maxHeight="60vh"
                  toolbar={data.fullOi.tradeDate ? <span className="text-[11px] text-gray-400">Total OI as of {data.fullOi.tradeDate}</span> : undefined} />
              )}
              {tab === 'ladder' && (
                <div className="p-3">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <select value={ladderExpiry} onChange={e => setLadderExpiry(e.target.value)} className={inputClass}>
                      <option value="">All expiries</option>
                      {data.byExpiry.map(g => <option key={g.expiry!} value={g.expiry!}>{fmtExp(g.expiry)}</option>)}
                    </select>
                    <span className="text-[11px] text-gray-500">Bars: OI change per strike (green opened, red closed). Calls left, puts right. {close != null && <>Underlying close <b>{close.toFixed(2)}</b> (highlighted).</>}</span>
                  </div>
                  <div className="max-h-[60vh] overflow-auto text-xs">
                    <div className="grid grid-cols-[1fr_80px_1fr] gap-x-2 sticky top-0 bg-white py-1 font-semibold text-gray-500 text-[11px] uppercase">
                      <div className="text-right">Calls (OI · chg)</div><div className="text-center">Strike</div><div>Puts (chg · OI)</div>
                    </div>
                    {ladder.map(l => (
                      <div key={l.strike} className={`grid grid-cols-[1fr_80px_1fr] gap-x-2 items-center py-0.5 ${l.strike === nearestStrike ? 'bg-yellow-50' : ''}`}>
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-[10px] text-gray-400 tabular-nums">{fmtCount(l.callOi)}</span>
                          <span className={`tabular-nums w-16 text-right ${l.callChg >= 0 ? 'text-green-700' : 'text-red-700'}`}>{l.callChg ? fmtSigned(l.callChg) : ''}</span>
                          <div className="w-40 flex justify-end"><div className={`h-3 rounded-l ${l.callChg >= 0 ? 'bg-green-400' : 'bg-red-400'}`} style={{ width: `${(Math.abs(l.callChg) / ladderMax) * 100}%` }} /></div>
                        </div>
                        <div className="text-center font-semibold tabular-nums">{fmtStrike(l.strike)}</div>
                        <div className="flex items-center gap-2">
                          <div className="w-40"><div className={`h-3 rounded-r ${l.putChg >= 0 ? 'bg-green-400' : 'bg-red-400'}`} style={{ width: `${(Math.abs(l.putChg) / ladderMax) * 100}%` }} /></div>
                          <span className={`tabular-nums w-16 ${l.putChg >= 0 ? 'text-green-700' : 'text-red-700'}`}>{l.putChg ? fmtSigned(l.putChg) : ''}</span>
                          <span className="text-[10px] text-gray-400 tabular-nums">{fmtCount(l.putOi)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {tab === 'timeline' && (
                <div className="p-3">
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[...data.byDate].reverse().map(g => ({ date: g.loadDate, 'Calls opened': g.callOpened, 'Calls closed': g.callClosed, 'Puts opened': g.putOpened, 'Puts closed': g.putClosed }))} stackOffset="sign">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtCount(v)} />
                        <Tooltip formatter={(v: number) => v.toLocaleString()} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="Calls opened" stackId="c" fill="#16a34a" />
                        <Bar dataKey="Calls closed" stackId="c" fill="#86efac" />
                        <Bar dataKey="Puts opened" stackId="p" fill="#dc2626" />
                        <Bar dataKey="Puts closed" stackId="p" fill="#fca5a5" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Contracts opened (+) and closed (−) per load date, from the OI change report. Pick 10D–60D above for a longer history.</p>
                </div>
              )}
              {tab === 'strategies' && (
                <div>
                  <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-100 text-xs">
                    <label className="font-semibold text-gray-600">Qty tolerance</label>
                    <input type="range" min={0.5} max={5} step={0.5} value={tol} onChange={e => setTol(Number(e.target.value))} />
                    <span className="tabular-nums font-semibold">{tol}%</span>
                    <span className="text-gray-400">legs ≥ {data.minLeg} contracts</span>
                  </div>
                  <StrategyList candidates={data.strategies} showUnderlying={false} onTrack={c => setTrack({ legs: strategyToLegs(c), label: c.label })} />
                </div>
              )}
              {tab === 'live' && data.live && (
                <DataTable rows={data.live.top} columns={liveTopCols} rowKey={r => r.contract} initialSort={{ key: 'vol', dir: 'desc' }} maxHeight="60vh"
                  csvName={`${symbol}-live-volume`} toolbar={<span className="text-[11px] text-gray-400">Top 100 by latest session volume, of {data.live.count.toLocaleString()} live contracts</span>} />
              )}
            </>
          )}
        </div>
      </Modal>
      {contractModal && (
        <OptionContractModal symbol={contractModal.underlying} expiry={contractModal.expiry} strike={contractModal.strike} optType={contractModal.optType} onClose={() => setContractModal(null)} />
      )}
      {track && <TrackForm legs={track.legs} label={track.label} onClose={() => setTrack(null)} onDone={onTracked} />}
    </>
  );
}
