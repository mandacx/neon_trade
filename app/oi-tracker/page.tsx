'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '@/components/layout/Header';
import DataTable, { type Column } from '@/components/oi/DataTable';
import StockOiModal from '@/components/oi/StockOiModal';
import TrackedPanel from '@/components/oi/TrackedPanel';
import {
  ExpiryCell, HintBadge, Money, Segmented, SignedCount, Spinner, StrategyList, TrackForm, TypeBadge, VolToChg,
  fmtExp, fmtStrike, inputClass, labelClass, strategyToLegs, type TrackLegInput,
} from '@/components/oi/oiShared';
import { fmtCount, fmtMoneyCompact, fmtSigned } from '@/lib/format';
import type { OiContractRow, OiGroupBy, OiGroupRow, OiScreenResult, StrategyCandidate } from '@/types/oiTracker';

type Tab = 'flow' | 'stocks' | 'strategies' | 'tracked';
type FlowGroup = Exclude<OiGroupBy, 'underlying'>;
interface Meta {
  loadDates: string[]; latest: string | null; expiries: string[]; maxLoads: number; maxLoadsContract: number;
  filters: { sectors: string[]; indices: Array<{ code: string; name: string }> };
  /** The user's own watchlists first, then curated sector/index lists; empty without the Watchlists feature. */
  watchlists: Array<{ id: string; name: string; isSystem: boolean; symbolCount: number }>;
}

const RANGES: Array<[string, string]> = [['1', '1 day'], ['5', '5D'], ['10', '10D'], ['20', '20D'], ['60', '60D'], ['custom', 'Custom']];
const RANK_BY: Array<[string, string]> = [
  ['abs_chg_value', '|Chg $|'], ['abs_chg', '|OI chg|'], ['chg', 'OI opened'], ['oi_value', 'OI $'], ['vol', 'Volume'],
  ['new_pct', 'New position %'], ['notional', 'Notional'],
];

export default function OiTrackerPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('flow');

  // Period
  const [to, setTo] = useState('');
  const [range, setRange] = useState('1');
  const [customFrom, setCustomFrom] = useState('');

  // Server-side filters
  const [groupBy, setGroupBy] = useState<FlowGroup>('contract');
  const [symbolsInput, setSymbolsInput] = useState('');
  const [symbols, setSymbols] = useState('');
  const [optType, setOptType] = useState('');
  const [direction, setDirection] = useState<'both' | 'opened' | 'closed'>('both');
  const [expiryKind, setExpiryKind] = useState('');
  const [expiry, setExpiry] = useState('');
  const [dteMin, setDteMin] = useState('');
  const [dteMax, setDteMax] = useState('');
  const [minAbsChg, setMinAbsChg] = useState('');
  const [valueBasis, setValueBasis] = useState<'chg' | 'oi'>('chg');
  const [valueBucket, setValueBucket] = useState<'all' | 'b' | 'm' | 'k'>('all');
  const [moneyness, setMoneyness] = useState<'all' | 'itm' | 'otm'>('all');
  const [sector, setSector] = useState('');
  const [indexCode, setIndexCode] = useState('');
  const [watchlistId, setWatchlistId] = useState('');
  const [rankBy, setRankBy] = useState('abs_chg_value');
  const [limit, setLimit] = useState('500');

  // Strategies
  const [tol, setTol] = useState(3);
  const [minLeg, setMinLeg] = useState('500');

  // Data
  const [screen, setScreen] = useState<OiScreenResult | null>(null);
  const [screenLoading, setScreenLoading] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<{ candidates: StrategyCandidate[]; total: number; legsScanned: number; truncated: boolean } | null>(null);
  const [stratLoading, setStratLoading] = useState(false);

  // Overlays
  const [modalSymbol, setModalSymbol] = useState<string | null>(null);
  const [track, setTrack] = useState<{ legs: TrackLegInput[]; label?: string } | null>(null);
  const [trackedKey, setTrackedKey] = useState(0);

  useEffect(() => {
    fetch('/api/oi-tracker/meta')
      .then(r => r.json())
      .then(j => {
        if (!j.success) { setMetaError(j.error || 'Failed to load'); return; }
        setMeta(j.data);
        setTo(j.data.latest ?? '');
      })
      .catch(() => setMetaError('Failed to load'));
  }, []);

  const from = useMemo(() => {
    if (!meta || !to) return '';
    if (range === 'custom') return customFrom && customFrom <= to ? customFrom : to;
    const older = meta.loadDates.filter(d => d <= to);
    return older[Math.min(Number(range), older.length) - 1] ?? to;
  }, [meta, to, range, customFrom]);

  const filterQs = useMemo(() => {
    const p = new URLSearchParams({ from, to });
    if (symbols) p.set('symbols', symbols);
    if (optType) p.set('optType', optType);
    if (expiryKind) p.set('expiryKind', expiryKind);
    if (expiry) p.set('expiries', expiry);
    if (dteMin) p.set('dteMin', dteMin);
    if (dteMax) p.set('dteMax', dteMax);
    if (sector) p.set('sector', sector);
    if (indexCode) p.set('index', indexCode);
    if (watchlistId) p.set('watchlist', watchlistId);
    return p;
  }, [from, to, symbols, optType, expiryKind, expiry, dteMin, dteMax, sector, indexCode, watchlistId]);

  const screenGroup: OiGroupBy = tab === 'stocks' ? 'underlying' : groupBy;
  useEffect(() => {
    if (!from || !to || (tab !== 'flow' && tab !== 'stocks')) return;
    const p = new URLSearchParams(filterQs);
    p.set('groupBy', screenGroup);
    p.set('direction', direction);
    if (minAbsChg) p.set('minAbsChg', minAbsChg);
    p.set('valueBasis', valueBasis);
    p.set('valueBucket', valueBucket);
    p.set('moneyness', moneyness);
    if (screenGroup === 'contract') p.set('sort', rankBy);
    else if (screenGroup !== 'date') p.set('sort', rankBy === 'vol' ? 'vol' : rankBy === 'oi_value' ? 'oi_value' : 'abs_chg_value');
    p.set('limit', limit);
    const ctrl = new AbortController();
    setScreenLoading(true);
    setScreenError(null);
    fetch(`/api/oi-tracker/screen?${p}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(j => { if (j.success) setScreen(j.data); else setScreenError(j.message || j.error || 'Failed to load'); })
      .catch(e => { if (e.name !== 'AbortError') setScreenError('Failed to load'); })
      .finally(() => { if (!ctrl.signal.aborted) setScreenLoading(false); });
    return () => ctrl.abort();
  }, [tab, filterQs, screenGroup, direction, minAbsChg, valueBasis, valueBucket, moneyness, rankBy, limit, from, to]);

  useEffect(() => {
    if (tab !== 'strategies' || !from || !to) return;
    const p = new URLSearchParams(filterQs);
    p.set('tol', String(tol));
    p.set('minLeg', minLeg || '500');
    const ctrl = new AbortController();
    setStratLoading(true);
    fetch(`/api/oi-tracker/strategies?${p}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(j => setStrategies(j.success ? j.data : null))
      .catch(() => {})
      .finally(() => { if (!ctrl.signal.aborted) setStratLoading(false); });
    return () => ctrl.abort();
  }, [tab, filterQs, tol, minLeg, from, to]);

  const trackRow = (r: OiContractRow) => setTrack({ legs: [{ underlying: r.underlying, contract: r.contract, optType: r.optType, strike: r.strike, expiry: r.expiry, oiChg: r.oiChg, ltp: r.ltp, hint: r.hint }] });
  const multiDay = !!screen && screen.loadDates.length > 1;

  const contractCols: Column<OiContractRow>[] = [
    { key: 'symbol', label: 'Symbol', type: 'text', value: r => r.underlying, render: r => <span className="font-bold text-gray-900 text-xs">{r.underlying}</span> },
    { key: 'expiry', label: 'Expiry', type: 'date', value: r => r.expiry, render: r => <ExpiryCell expiry={r.expiry} dte={r.dte} /> },
    { key: 'strike', label: 'Strike', type: 'number', value: r => r.strike, render: r => <b>{fmtStrike(r.strike)}</b> },
    { key: 'type', label: 'Type', type: 'text', value: r => r.optType, render: r => <TypeBadge t={r.optType} /> },
    { key: 'mny', label: 'Mny %', type: 'number', value: r => r.moneynessPct, render: r => <span className={r.itm ? 'text-blue-700 font-semibold' : 'text-gray-500'}>{r.moneynessPct.toFixed(1)}%</span>, title: '(strike − underlying close) / close; blue = in the money' },
    { key: 'oi', label: 'OI', type: 'number', value: r => r.oi, render: r => r.oi.toLocaleString() },
    { key: 'chg', label: multiDay ? 'OI chg (sum)' : 'OI chg', type: 'number', value: r => r.oiChg, render: r => <SignedCount v={r.oiChg} /> },
    { key: 'newPct', label: 'New %', type: 'number', value: r => r.newPct, render: r => (r.newPct == null ? <span className="text-[10px] text-emerald-700 font-bold">NEW</span> : `${r.newPct.toFixed(0)}%`), title: 'OI change as % of the OI before it (NEW = no prior OI)' },
    { key: 'ltp', label: 'LTP', type: 'number', value: r => r.ltp, render: r => r.ltp.toFixed(2), title: 'Option LTP from the OI report' },
    { key: 'chgValue', label: 'Chg $', type: 'number', value: r => r.chgValue, render: r => <Money v={r.chgValue} />, title: 'OI change × 100 × LTP' },
    { key: 'oiValue', label: 'OI $', type: 'number', value: r => r.oiValue, render: r => <Money v={r.oiValue} signed={false} />, title: 'OI × 100 × LTP' },
    { key: 'notional', label: 'Notional', type: 'number', value: r => r.notional, render: r => <span className="text-gray-500">{fmtMoneyCompact(r.notional)}</span>, title: 'OI × 100 × underlying close: stock exposure controlled' },
    { key: 'vol', label: 'Volume', type: 'number', value: r => r.vol, render: r => fmtCount(r.vol), title: 'Volume of the session(s) that produced the OI change' },
    { key: 'volToChg', label: 'Vol/Chg', type: 'number', value: r => r.volToChg, render: r => <VolToChg v={r.volToChg} /> },
    { key: 'hint', label: 'Side?', type: 'text', value: r => r.hint?.side ?? '', render: r => <HintBadge hint={r.hint} /> },
    ...(multiDay ? [{ key: 'days', label: 'Days', type: 'number', value: (r: OiContractRow) => r.days, title: 'Load dates in range where this contract changed' } as Column<OiContractRow>] : []),
    { key: 'act', label: '', type: 'text', value: () => null, sortable: false, filterable: false, render: r => (
      <button onClick={e => { e.stopPropagation(); trackRow(r); }} className="text-[11px] font-semibold text-blue-600 hover:text-blue-800">Track</button>
    ) },
  ];

  const groupKeyCols: Record<Exclude<OiGroupBy, 'contract'>, Column<OiGroupRow>[]> = {
    underlying: [
      { key: 'symbol', label: 'Symbol', type: 'text', value: r => r.underlying, render: r => <span className="font-bold text-gray-900 text-xs">{r.underlying}</span> },
      { key: 'close', label: 'Close', type: 'number', value: r => r.close, render: r => r.close?.toFixed(2) ?? '—' },
    ],
    expiry: [
      { key: 'symbol', label: 'Symbol', type: 'text', value: r => r.underlying, render: r => <span className="font-bold text-gray-900 text-xs">{r.underlying}</span> },
      { key: 'expiry', label: 'Expiry', type: 'date', value: r => r.expiry, render: r => <ExpiryCell expiry={r.expiry!} /> },
    ],
    strike: [
      { key: 'symbol', label: 'Symbol', type: 'text', value: r => r.underlying, render: r => <span className="font-bold text-gray-900 text-xs">{r.underlying}</span> },
      { key: 'strike', label: 'Strike', type: 'number', value: r => r.strike, render: r => <b>{fmtStrike(r.strike!)}</b> },
      { key: 'close', label: 'Close', type: 'number', value: r => r.close, render: r => r.close?.toFixed(2) ?? '—' },
    ],
    date: [{ key: 'date', label: 'Load date', type: 'date', value: r => r.loadDate, render: r => <b className="text-xs">{r.loadDate}</b> }],
  };
  const groupCols = (g: Exclude<OiGroupBy, 'contract'>): Column<OiGroupRow>[] => [
    ...groupKeyCols[g],
    { key: 'callOpened', label: 'Calls +', type: 'number', value: r => r.callOpened, render: r => <SignedCount v={r.callOpened} />, title: 'Call contracts opened (OI up)' },
    { key: 'callClosed', label: 'Calls −', type: 'number', value: r => r.callClosed, render: r => <SignedCount v={r.callClosed} />, title: 'Call contracts closed (OI down)' },
    { key: 'putOpened', label: 'Puts +', type: 'number', value: r => r.putOpened, render: r => <SignedCount v={r.putOpened} /> },
    { key: 'putClosed', label: 'Puts −', type: 'number', value: r => r.putClosed, render: r => <SignedCount v={r.putClosed} /> },
    { key: 'net', label: 'Net', type: 'number', value: r => r.netChg, render: r => <SignedCount v={r.netChg} /> },
    { key: 'pc', label: 'P/C opened', type: 'number', value: r => r.pcOpened, render: r => (r.pcOpened == null ? '—' : r.pcOpened.toFixed(2)), title: 'Puts opened ÷ calls opened' },
    { key: 'callChgValue', label: 'Call $', type: 'number', value: r => r.callChgValue, render: r => <Money v={r.callChgValue} /> },
    { key: 'putChgValue', label: 'Put $', type: 'number', value: r => r.putChgValue, render: r => <Money v={r.putChgValue} /> },
    { key: 'absChgValue', label: '|Chg $|', type: 'number', value: r => r.absChgValue, render: r => <b>{fmtMoneyCompact(r.absChgValue)}</b>, title: 'Sum of absolute dollar changes: total activity' },
    { key: 'oiValue', label: 'OI $', type: 'number', value: r => r.oiValue, render: r => fmtMoneyCompact(r.oiValue) },
    { key: 'vol', label: 'Volume', type: 'number', value: r => r.vol, render: r => fmtCount(r.vol) },
    { key: 'contracts', label: '#', type: 'number', value: r => r.contracts, title: 'Contracts that changed' },
    ...(g === 'date' ? [] : [{ key: 'top', label: 'Largest leg', type: 'text', value: (r: OiGroupRow) => r.topContract, render: (r: OiGroupRow) => (
      <span className="text-[11px] text-gray-500 font-mono">{r.topContract} <SignedCount v={r.topChg} /></span>
    ) } as Column<OiGroupRow>]),
  ];

  const s = screen?.summary;
  const applySymbols = () => setSymbols(symbolsInput.split(/[\s,]+/).map(x => x.trim().toUpperCase()).filter(Boolean).join(','));
  const contractCapNote = groupBy === 'contract' && !symbols && tab === 'flow' && screen && meta && Number(range === 'custom' ? 0 : range) > meta.maxLoadsContract;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="container mx-auto px-4 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">Options OI Tracker</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Where open interest is being opened and closed: by contract, stock, expiry, strike and day, with the volume behind it, dollar size,
            possible multi-leg strategies and your own tracked positions. Click a row to open that stock&apos;s full OI view.
          </p>
        </div>

        {metaError ? <div className="bg-white rounded-xl border p-8 text-center text-sm text-red-600">{metaError}</div> : !meta ? <Spinner label="Loading…" /> : (
          <>
            {/* Period + tabs */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-3">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className={labelClass}>View</label>
                  <Segmented<Tab> value={tab} onChange={setTab} options={[['flow', 'OI flow'], ['stocks', 'By stock'], ['strategies', 'Strategies'], ['tracked', 'My tracked']]} />
                </div>
                {tab !== 'tracked' && (
                  <>
                    <div>
                      <label className={labelClass}>Load date</label>
                      <select value={to} onChange={e => setTo(e.target.value)} className={inputClass}>
                        {meta.loadDates.slice(0, 250).map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Range (load dates, aggregated)</label>
                      <Segmented value={range} options={RANGES} onChange={setRange} />
                    </div>
                    {range === 'custom' && (
                      <div>
                        <label className={labelClass}>From</label>
                        <input type="date" value={customFrom} max={to} onChange={e => setCustomFrom(e.target.value)} className={inputClass} />
                      </div>
                    )}
                    {tab === 'flow' && (
                      <div>
                        <label className={labelClass}>Group by</label>
                        <Segmented<FlowGroup> value={groupBy} onChange={setGroupBy} options={[['contract', 'Contract'], ['expiry', 'Stock + expiry'], ['strike', 'Stock + strike'], ['date', 'Trade date']]} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Filters */}
            {tab !== 'tracked' && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className={labelClass}>Symbols</label>
                    <input value={symbolsInput} onChange={e => setSymbolsInput(e.target.value)} onBlur={applySymbols} onKeyDown={e => { if (e.key === 'Enter') applySymbols(); }}
                      placeholder="e.g. NVDA, SPY" className={`${inputClass} w-36`} />
                  </div>
                  <div>
                    <label className={labelClass}>Type</label>
                    <Segmented value={optType} onChange={setOptType} options={[['', 'All'], ['call', 'Calls'], ['put', 'Puts']]} />
                  </div>
                  {tab !== 'strategies' && (
                    <div>
                      <label className={labelClass}>Positions</label>
                      <Segmented value={direction} onChange={setDirection} options={[['both', 'All'], ['opened', 'Opened (+)'], ['closed', 'Closed (−)']]} />
                    </div>
                  )}
                  <div>
                    <label className={labelClass}>Expiry type</label>
                    <Segmented value={expiryKind} onChange={setExpiryKind} options={[['', 'All'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly']]} />
                  </div>
                  <div>
                    <label className={labelClass}>Expiry</label>
                    <select value={expiry} onChange={e => setExpiry(e.target.value)} className={inputClass}>
                      <option value="">All expiries</option>
                      {meta.expiries.map(d => <option key={d} value={d}>{fmtExp(d)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>DTE</label>
                    <div className="flex items-center gap-1">
                      <input type="number" value={dteMin} onChange={e => setDteMin(e.target.value)} placeholder="min" className={`${inputClass} w-16`} />
                      <input type="number" value={dteMax} onChange={e => setDteMax(e.target.value)} placeholder="max" className={`${inputClass} w-16`} />
                    </div>
                  </div>
                  {tab !== 'strategies' && (
                    <>
                      <div>
                        <label className={labelClass}>Min |OI chg|</label>
                        <input type="number" value={minAbsChg} onChange={e => setMinAbsChg(e.target.value)} placeholder="e.g. 1000" className={`${inputClass} w-24`} />
                      </div>
                      <div>
                        <label className={labelClass}>$ size of</label>
                        <div className="flex gap-1">
                          <Segmented value={valueBasis} onChange={setValueBasis} options={[['chg', 'Change'], ['oi', 'Total OI']]} />
                          <Segmented value={valueBucket} onChange={setValueBucket} options={[['all', 'Any'], ['b', '$1B+'], ['m', '$1M–1B'], ['k', '$1K–1M']]} />
                        </div>
                      </div>
                      <div>
                        <label className={labelClass}>Moneyness</label>
                        <Segmented value={moneyness} onChange={setMoneyness} options={[['all', 'All'], ['itm', 'ITM'], ['otm', 'OTM']]} />
                      </div>
                    </>
                  )}
                  {meta.watchlists.length > 0 && (
                    <div>
                      <label className={labelClass}>Watchlist</label>
                      <select value={watchlistId} onChange={e => setWatchlistId(e.target.value)} className={`${inputClass} max-w-[200px]`}>
                        <option value="">All stocks</option>
                        {meta.watchlists.some(w => !w.isSystem) && (
                          <optgroup label="My watchlists">
                            {meta.watchlists.filter(w => !w.isSystem).map(w => <option key={w.id} value={w.id}>{w.name} ({w.symbolCount})</option>)}
                          </optgroup>
                        )}
                        <optgroup label="Lists">
                          {meta.watchlists.filter(w => w.isSystem).map(w => <option key={w.id} value={w.id}>{w.name} ({w.symbolCount})</option>)}
                        </optgroup>
                      </select>
                    </div>
                  )}
                  <div>
                    <label className={labelClass}>Sector</label>
                    <select value={sector} onChange={e => setSector(e.target.value)} className={`${inputClass} max-w-[160px]`}>
                      <option value="">All sectors</option>
                      {meta.filters.sectors.map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Index</label>
                    <select value={indexCode} onChange={e => setIndexCode(e.target.value)} className={`${inputClass} max-w-[160px]`}>
                      <option value="">All</option>
                      {meta.filters.indices.map(x => <option key={x.code} value={x.code}>{x.name}</option>)}
                    </select>
                  </div>
                  {tab !== 'strategies' && (
                    <>
                      <div>
                        <label className={labelClass}>Rank by</label>
                        <select value={rankBy} onChange={e => setRankBy(e.target.value)} className={inputClass}>
                          {RANK_BY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Rows</label>
                        <select value={limit} onChange={e => setLimit(e.target.value)} className={inputClass}>
                          {['250', '500', '1000', '2000'].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                    </>
                  )}
                  {tab === 'strategies' && (
                    <>
                      <div>
                        <label className={labelClass}>Qty tolerance: {tol}%</label>
                        <input type="range" min={0.5} max={5} step={0.5} value={tol} onChange={e => setTol(Number(e.target.value))} className="w-36" />
                      </div>
                      <div>
                        <label className={labelClass}>Min leg (contracts)</label>
                        <select value={minLeg} onChange={e => setMinLeg(e.target.value)} className={inputClass}>
                          {['200', '500', '1000', '2500', '5000'].map(n => <option key={n} value={n}>{Number(n).toLocaleString()}</option>)}
                        </select>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* KPIs */}
            {(tab === 'flow' || tab === 'stocks') && s && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 mb-3">
                {[
                  ['Contracts changed', s.contracts.toLocaleString(), `${s.underlyings} stocks`],
                  ['Opened', fmtSigned(s.opened), fmtMoneyCompact(s.openedValue)],
                  ['Closed', fmtSigned(s.closed), fmtMoneyCompact(s.closedValue)],
                  ['Net', fmtSigned(s.opened + s.closed), fmtMoneyCompact(s.openedValue + s.closedValue)],
                  ['Call chg $', fmtMoneyCompact(s.callChgValue), ''],
                  ['Put chg $', fmtMoneyCompact(s.putChgValue), ''],
                  ['Volume', fmtCount(s.vol), screen!.volumeCoverage.withVolume < screen!.volumeCoverage.loads ? `captured for ${screen!.volumeCoverage.withVolume}/${screen!.volumeCoverage.loads} days` : 'sessions behind the OI change'],
                ].map(([k, v, sub]) => (
                  <div key={k} className="bg-white rounded-xl border border-gray-200 shadow-sm px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{k}</div>
                    <div className="text-base font-bold text-gray-900 tabular-nums">{v}</div>
                    {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Body */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              {tab === 'tracked' ? (
                <TrackedPanel refreshKey={trackedKey} onOpenStock={setModalSymbol} />
              ) : tab === 'strategies' ? (
                stratLoading ? <Spinner label="Matching legs…" /> : !strategies ? <div className="p-8 text-center text-sm text-gray-400">No data.</div> : (
                  <>
                    <div className="px-3 pt-2 text-[11px] text-gray-500">
                      {strategies.total.toLocaleString()} candidates from {strategies.legsScanned.toLocaleString()} legs
                      (each load date separately; legs of one stock whose OI change agrees within {tol}%){strategies.truncated ? ', showing the top 500' : ''}.
                    </div>
                    <StrategyList candidates={strategies.candidates} onOpenStock={setModalSymbol}
                      onTrack={c => setTrack({ legs: strategyToLegs(c), label: `${c.underlying} ${c.label}` })} />
                  </>
                )
              ) : screenLoading && !screen ? <Spinner label="Loading open interest…" /> : screenError ? (
                <div className="p-8 text-center text-sm text-red-600">{screenError}</div>
              ) : !screen ? null : (
                <div className={screenLoading ? 'opacity-50 pointer-events-none' : ''}>
                  {screen.groupBy === 'contract' ? (
                    <DataTable rows={screen.rows as OiContractRow[]} columns={contractCols} rowKey={r => r.contract}
                      onRowClick={r => setModalSymbol(r.underlying)} csvName={`oi-contracts-${screen.from}-${screen.to}`}
                      toolbar={<RangeNote screen={screen} capNote={!!contractCapNote} max={meta.maxLoadsContract} />} />
                  ) : (
                    <DataTable rows={screen.rows as OiGroupRow[]} columns={groupCols(screen.groupBy as Exclude<OiGroupBy, 'contract'>)} rowKey={r => r.key}
                      onRowClick={screen.groupBy === 'date' ? undefined : r => r.underlying && setModalSymbol(r.underlying)}
                      csvName={`oi-${screen.groupBy}-${screen.from}-${screen.to}`} toolbar={<RangeNote screen={screen} capNote={false} max={meta.maxLoads} />} />
                  )}
                </div>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-3">
              Source: the daily OI change report (contracts whose open interest moved by ~100+). OI on a load date reflects the previous session&apos;s trading,
              and Volume is that session&apos;s volume. + means positions opened, − closed; OI alone can&apos;t tell buyers from sellers, so &quot;Side?&quot; is only a hint from
              the premium&apos;s move in that session. $ values use the report&apos;s LTP. Possible strategies are legs whose sizes match; they can be coincidence.
            </p>
          </>
        )}
      </main>
      {modalSymbol && meta && (
        <StockOiModal symbol={modalSymbol} loadDates={meta.loadDates} to={to || meta.latest!} initialRange={range === 'custom' ? '1' : String(Math.min(Number(range), 60))}
          onClose={() => setModalSymbol(null)} onTracked={() => setTrackedKey(k => k + 1)} />
      )}
      {track && <TrackForm legs={track.legs} label={track.label} onClose={() => setTrack(null)} onDone={() => setTrackedKey(k => k + 1)} />}
    </div>
  );
}

function RangeNote({ screen, capNote, max }: { screen: OiScreenResult; capNote: boolean; max: number }) {
  return (
    <span className="text-[11px] text-gray-400">
      {screen.from === screen.to ? screen.to : `${screen.from} → ${screen.to} (${screen.loadDates.length} loads)`}
      {screen.truncated && <span className="text-amber-700"> · top rows only, raise Rows or narrow filters</span>}
      {capNote && <span className="text-amber-700"> · contract view covers the latest {max} loads; use a grouping or symbols for longer</span>}
    </span>
  );
}
