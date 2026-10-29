'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import ColumnsMenu from '@/components/ui/ColumnsMenu';
import ColRow from '@/components/ui/ColRow';
import Term from '@/components/ui/Term';
import { useColumnPrefs } from '@/components/ui/useColumnPrefs';
import type { ColumnMeta } from '@/lib/tableColumns';
import OiTrendModal from './OiTrendModal';
import LiveVolumeTable, { type LiveOption } from '@/components/oi/LiveVolumeTable';
import { useAuthContext } from '@/components/providers/AuthContextProvider';
import { FEATURE_OI_TRACKER, hasFeature } from '@/lib/features';
import { parseOcc } from '@/lib/occ';
import { Spinner } from './shared';

// Open Interest tab of the stock page (docs/strategy-builder.md, "Open Interest tab"):
// - "Open interest trend" button: a modal that reads the levels history only when opened;
// - OI change by strike (selected expiry) beside the per-contract OI change report
//   (public.us_opt_chg_rpt via /api/stocks/[symbol]/opt-chain), sharing one window picker
//   counted in loads (trading days), 1D by default;
// - the contract table can widen to every expiry of the symbol (a second request, made only
//   when switched on); the strike ladder always stays on the selected expiry, where strikes
//   of different expiries don't get summed together.
// - a "Live volume" view (contracts ranked by live session volume, all expiries; Pro feature
//   `oi_tracker`, same as the OI tracker page), fetched only when that view is opened.
// Mounted the first time the tab is opened, so nothing here is fetched before that.

const OPT_CHAIN_COLUMNS: ColumnMeta[] = [
  { id: 'symbol', label: 'Symbol', required: true },
  { id: 'expiry', label: 'Expiry' },
  { id: 'loadDate', label: 'Trade Date' },
  { id: 'cmp', label: 'CMP' },
  { id: 'strike', label: 'Strike Price' },
  { id: 'optType', label: 'Opt Typ' },
  { id: 'ltp', label: 'Opt LTP' },
  { id: 'oi', label: 'OI' },
  { id: 'oiChg', label: 'Chg OI' },
  { id: 'absOiChg', label: 'ABS Chg OI' },
  { id: 'chgPrice', label: 'Chg OI $' },
  { id: 'absChgPrice', label: 'ABS Chg OI $' },
];

type OptChainRow = {
  optType: 'put' | 'call'; strike: number; ltp: number; oi: number; oiChg: number; close: number; loadDate: string;
  /** Session behind the OI change (the day before the load date). */ tradeDate?: string;
  expiry?: string;
};
type OptChainSortKey = 'loadDate' | 'expiry' | 'close' | 'strike' | 'optType' | 'ltp' | 'oi' | 'oiChg' | 'absOiChg' | 'chgOpenIntPrice' | 'absChgOpenIntPrice';
interface Loaded { rows: OptChainRow[]; from: string | null; to: string | null; truncated: boolean }

// Windows count loads (one per trading day), resolved by the route from the market catalog.
type OptChainPreset = '1d' | '2d' | '3d' | '5d' | '10d' | '30d' | '90d' | 'all';
const PRESETS: OptChainPreset[] = ['1d', '2d', '3d', '5d', '10d', '30d', '90d', 'all'];
const PRESET_LOADS: Record<OptChainPreset, number> = { '1d': 1, '2d': 2, '3d': 3, '5d': 5, '10d': 10, '30d': 30, '90d': 90, all: 260 };

type Scope = 'expiry' | 'all';
type ChangeDir = 'all' | 'added' | 'cut';
type Moneyness = 'all' | 'itm' | 'otm';
interface Filters {
  search: string; type: 'all' | 'call' | 'put'; date: string; expiry: string; dir: ChangeDir; money: Moneyness;
  strikeMin: string; strikeMax: string; minChg: string; minValue: string;
}
const NO_FILTERS: Filters = { search: '', type: 'all', date: '', expiry: '', dir: 'all', money: 'all', strikeMin: '', strikeMax: '', minChg: '', minValue: '' };

function OptChainSortLabel({ label, active, dir, onClick, align = 'right' }: {
  label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void; align?: 'left' | 'right';
}) {
  return (
    <button onClick={onClick} className={`flex items-center gap-0.5 hover:text-gray-700 ${align === 'right' ? 'ml-auto' : ''}`}>
      {label}
      <span className={active ? 'text-blue-500' : 'text-gray-300'}>{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </button>
  );
}

interface LadderRow { strike: number; callChg: number; putChg: number; callOi: number | null; putOi: number | null }

/** Loads the OI change report for one scope + window; `enabled` false leaves it idle (no request). */
function useOptChain(symbol: string, expiry: string, expiryMode: 'current' | 'historical', selectedExpiry: string, preset: OptChainPreset, enabled: boolean) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled || !symbol || !selectedExpiry) return;
    // For an already-expired expiry, the window ends at the expiry, not today.
    const to = expiryMode === 'historical' ? selectedExpiry : format(new Date(), 'yyyy-MM-dd');
    const q = preset === 'all' && expiry !== 'all' ? `from=2000-01-01&to=${to}` : `loads=${PRESET_LOADS[preset]}&to=${to}`;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stocks/${symbol}/opt-chain?expiry=${expiry}&${q}`)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return;
        setData(json.success
          ? { rows: json.data.rows || [], from: json.data.from, to: json.data.to, truncated: !!json.data.truncated }
          : { rows: [], from: null, to: null, truncated: false });
      })
      .catch(() => { if (!cancelled) setData({ rows: [], from: null, to: null, truncated: false }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, symbol, expiry, expiryMode, selectedExpiry, preset]);
  return { data, loading };
}

const inputCls = 'px-2 py-1 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white';
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</span>
      {children}
    </label>
  );
}

/** Contracts ranked by live session volume (every unexpired expiry). Read once when first shown, then only on Refresh. */
function LiveVolumeView({ symbol, onOpenContract }: {
  symbol: string;
  onOpenContract: (strike: number, optType: 'call' | 'put', expiry: string, occRoot?: string) => void;
}) {
  const { features, loggedIn } = useAuthContext();
  const entitled = hasFeature(features, FEATURE_OI_TRACKER);
  const [data, setData] = useState<{ top: LiveOption[]; count: number; asOf: string; session: string | null; stale: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/oi-tracker/live/${encodeURIComponent(symbol.toUpperCase())}`)
      .then(async res => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) { setError(json?.message ?? json?.error ?? 'Could not load live volume.'); return; }
        setData(json.data);
      })
      .catch(() => setError('Could not reach the server.'))
      .finally(() => setLoading(false));
  }, [symbol]);
  useEffect(() => { if (entitled) load(); }, [entitled, load]);

  if (!entitled) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 text-center text-sm text-gray-600">
        Live option volume by contract is part of the Pro OI tracker.{' '}
        <Link href={loggedIn ? '/upgrade?feature=oi_tracker' : '/login'} className="font-semibold text-blue-600 hover:underline">{loggedIn ? 'Upgrade' : 'Sign in'}</Link>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h3 className="text-base font-bold">
          Live volume <span className="text-xs font-normal text-gray-400">all expiries{data ? ` · as of ${new Date(data.asOf).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET` : ''}</span>
        </h3>
        <div className="flex items-center gap-2">
          {loading && <Spinner />}
          <button onClick={load} disabled={loading} className="px-2.5 py-1 rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">↻ Refresh</button>
        </div>
      </div>
      {error && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mb-2">{error}</p>}
      {data ? (
        data.top.length ? (
          <LiveVolumeTable symbol={symbol} rows={data.top} count={data.count} session={data.session} stale={data.stale} onOpenContract={c => {
            const o = parseOcc(c);
            if (o) onOpenContract(o.strike, o.optType, o.expiry, o.root !== symbol.toUpperCase() ? o.root : undefined);
          }} />
        ) : <p className="text-center py-6 text-sm text-gray-500">No live volume for {symbol.toUpperCase()} yet.</p>
      ) : !error && <p className="text-center py-6 text-sm text-gray-500">Loading…</p>}
    </div>
  );
}

export default function OpenInterestTab({ symbol, selectedExpiry, expiryMode, onOpenContract }: {
  symbol: string;
  selectedExpiry: string;
  expiryMode: 'current' | 'historical';
  onOpenContract: (strike: number, optType: 'call' | 'put', expiry: string, occRoot?: string) => void;
}) {
  const [view, setView] = useState<'changes' | 'live'>('changes');
  const [liveOpened, setLiveOpened] = useState(false);
  const [preset, setPreset] = useState<OptChainPreset>('1d');
  const [scope, setScope] = useState<Scope>('expiry');
  const [trendOpen, setTrendOpen] = useState(false);
  const ocCols = useColumnPrefs('stockOptionChain', OPT_CHAIN_COLUMNS);
  const oc = (id: string) => ocCols.isShown(id);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const setFilter = <K extends keyof Filters>(k: K, v: Filters[K]) => setF(prev => ({ ...prev, [k]: v }));
  const [sortKey, setSortKey] = useState<OptChainSortKey>('absOiChg');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const one = useOptChain(symbol, selectedExpiry, expiryMode, selectedExpiry, preset, true);
  const every = useOptChain(symbol, 'all', expiryMode, selectedExpiry, preset, scope === 'all');
  const table = scope === 'all' ? every : one;
  const tableRows = useMemo(() => table.data?.rows ?? [], [table.data]);
  const anyLoading = one.loading || (scope === 'all' && every.loading);

  // Filters that point at values of the other scope / window would hide everything.
  useEffect(() => { setF(prev => ({ ...prev, date: '', expiry: '' })); }, [scope, preset, selectedExpiry]);

  function handleSort(key: OptChainSortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  const dates = useMemo(() => [...new Set(tableRows.map(r => r.tradeDate ?? r.loadDate))].sort().reverse(), [tableRows]);
  const expiries = useMemo(() => [...new Set(tableRows.map(r => r.expiry ?? selectedExpiry))].sort(), [tableRows, selectedExpiry]);

  const visibleRows = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    const num = (s: string) => (s.trim() === '' ? null : Number(s));
    const sMin = num(f.strikeMin), sMax = num(f.strikeMax), minChg = num(f.minChg), minValue = num(f.minValue);
    const dir = sortDir === 'asc' ? 1 : -1;
    return tableRows
      // Notional $ value of the OI change: contracts changed * premium * 100 shares/contract.
      .map(r => ({ ...r, expiry: r.expiry ?? selectedExpiry, chgOpenIntPrice: r.oiChg * r.ltp * 100 }))
      .filter(r => {
        if (f.type !== 'all' && r.optType !== f.type) return false;
        if (f.date && (r.tradeDate ?? r.loadDate) !== f.date) return false;
        if (f.expiry && r.expiry !== f.expiry) return false;
        if (f.dir === 'added' && r.oiChg <= 0) return false;
        if (f.dir === 'cut' && r.oiChg >= 0) return false;
        if (f.money !== 'all') {
          const itm = r.optType === 'call' ? r.strike < r.close : r.strike > r.close;
          if ((f.money === 'itm') !== itm) return false;
        }
        if (sMin !== null && r.strike < sMin) return false;
        if (sMax !== null && r.strike > sMax) return false;
        if (minChg !== null && Math.abs(r.oiChg) < minChg) return false;
        if (minValue !== null && Math.abs(r.chgOpenIntPrice) < minValue) return false;
        if (q && !String(r.strike).includes(q) && !r.optType.includes(q) && !r.expiry.includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        let av: number | string, bv: number | string;
        switch (sortKey) {
          case 'absOiChg': av = Math.abs(a.oiChg); bv = Math.abs(b.oiChg); break;
          case 'absChgOpenIntPrice': av = Math.abs(a.chgOpenIntPrice); bv = Math.abs(b.chgOpenIntPrice); break;
          default: av = a[sortKey]; bv = b[sortKey];
        }
        if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
        return ((av as number) - (bv as number)) * dir;
      });
  }, [tableRows, f, sortKey, sortDir, selectedExpiry]);
  const activeFilters = (Object.keys(NO_FILTERS) as (keyof Filters)[]).filter(k => f[k] !== NO_FILTERS[k]).length;

  // OI change summed per strike over the window (selected expiry only), with the latest reported OI.
  // The report only lists contracts whose OI moved, so "latest OI" is the last load the contract appeared in.
  const ladderRows = one.data?.rows;
  const ladder = useMemo(() => {
    const by = new Map<number, LadderRow & { callAt: string; putAt: string }>();
    for (const r of ladderRows ?? []) {
      const row = by.get(r.strike) ?? { strike: r.strike, callChg: 0, putChg: 0, callOi: null, putOi: null, callAt: '', putAt: '' };
      if (r.optType === 'call') { row.callChg += r.oiChg; if (r.loadDate >= row.callAt) { row.callAt = r.loadDate; row.callOi = r.oi; } }
      else { row.putChg += r.oiChg; if (r.loadDate >= row.putAt) { row.putAt = r.loadDate; row.putOi = r.oi; } }
      by.set(r.strike, row);
    }
    return [...by.values()].sort((a, b) => b.strike - a.strike);
  }, [ladderRows]);
  const maxChg = Math.max(1, ...ladder.map(r => Math.max(Math.abs(r.callChg), Math.abs(r.putChg))));
  const close = ladderRows?.length ? ladderRows.reduce((a, b) => (a.loadDate >= b.loadDate ? a : b)).close : null;
  const range = one.data?.from ? `${one.data.from === one.data.to ? one.data.from : `${one.data.from} to ${one.data.to}`}` : null;

  const subNav = (
    <div className="flex gap-5 border-b border-gray-200" role="tablist" aria-label="Open interest views">
      {([['changes', 'OI changes'], ['live', 'Live volume']] as const).map(([v, label]) => (
        <button key={v} role="tab" aria-selected={view === v}
          onClick={() => { setView(v); if (v === 'live') setLiveOpened(true); }}
          className={`-mb-px pb-1.5 text-sm font-semibold border-b-2 transition-colors ${view === v ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {subNav}
      {liveOpened && (
        <div hidden={view !== 'live'}>
          <LiveVolumeView symbol={symbol} onOpenContract={onOpenContract} />
        </div>
      )}
      <div hidden={view !== 'changes'} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 min-w-0 max-w-full">
          <span className="text-xs text-gray-500" title="Windows count trading days (one OI report per session)">Window</span>
          <div className="flex min-w-0 gap-1 bg-gray-100 p-1 rounded-lg overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {PRESETS.map(p => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                title={p === 'all' ? 'All reports kept' : `Last ${PRESET_LOADS[p]} trading day${PRESET_LOADS[p] > 1 ? 's' : ''}`}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${preset === p ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
              >
                {p === 'all' ? 'All' : p.toUpperCase()}
              </button>
            ))}
          </div>
          {anyLoading && <Spinner />}
        </div>
        {range && <span className="text-xs text-gray-400">Reports {range}</span>}
        <button
          onClick={() => setTrendOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400"
          title="Total call and put open interest per day for the selected expiry (opens a chart)"
        >
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M1.5 13.5h13M2.5 11l3.5-4 3 2.5 4.5-6" /></svg>
          Open interest trend
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start">
        <div className="bg-white rounded-lg shadow-md p-4 min-w-0">
          <h3 className="text-base font-bold mb-2">
            <Term k="oiChg">OI change</Term> by strike
            <span className="ml-2 text-xs font-normal text-gray-400">expiry {selectedExpiry}</span>
          </h3>
          {ladder.length === 0 ? (
            <div className="text-center py-4 text-gray-500 text-sm">{one.loading || !one.data ? 'Loading…' : 'No OI changes reported in this window.'}</div>
          ) : (
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white [&_th]:shadow-[inset_0_-1px_0_0_#e5e7eb] text-gray-500">
                  <tr>
                    <th className="text-right py-1.5 px-1.5 font-medium"><Term k="oi">Put OI</Term></th>
                    <th className="text-right py-1.5 px-1.5 font-medium w-1/3"><Term k="oiChg">Put ΔOI</Term></th>
                    <th className="text-center py-1.5 px-1.5 font-medium"><Term k="strike">Strike</Term></th>
                    <th className="text-left py-1.5 px-1.5 font-medium w-1/3"><Term k="oiChg">Call ΔOI</Term></th>
                    <th className="text-left py-1.5 px-1.5 font-medium"><Term k="oi">Call OI</Term></th>
                  </tr>
                </thead>
                <tbody>
                  {ladder.map((r, i) => {
                    const spotRow = close != null && r.strike >= close && (ladder[i + 1]?.strike ?? -Infinity) < close;
                    return (
                      <tr key={r.strike} className={`border-b border-gray-100 last:border-0 ${spotRow ? 'shadow-[inset_0_-2px_0_0_#3b82f6]' : ''}`}>
                        <td className="text-right py-1 px-1.5 text-gray-600">{r.putOi != null ? r.putOi.toLocaleString() : '—'}</td>
                        <td className="py-1 px-1.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className={r.putChg > 0 ? 'text-green-700' : r.putChg < 0 ? 'text-red-700' : 'text-gray-400'}>{r.putChg > 0 ? '+' : ''}{r.putChg.toLocaleString()}</span>
                            <div className="h-2.5 rounded-sm" style={{ width: `${(Math.abs(r.putChg) / maxChg) * 100}%`, maxWidth: '60%', background: r.putChg >= 0 ? '#ef4444' : '#fca5a5' }} />
                          </div>
                        </td>
                        <td className="text-center py-1 px-1.5 font-mono">
                          <button className="hover:text-blue-700 hover:underline" title="Open the put / call chart" onClick={() => onOpenContract(r.strike, Math.abs(r.callChg) >= Math.abs(r.putChg) ? 'call' : 'put', selectedExpiry)}>{r.strike}</button>
                        </td>
                        <td className="py-1 px-1.5">
                          <div className="flex items-center gap-1.5">
                            <div className="h-2.5 rounded-sm" style={{ width: `${(Math.abs(r.callChg) / maxChg) * 100}%`, maxWidth: '60%', background: r.callChg >= 0 ? '#22c55e' : '#86efac' }} />
                            <span className={r.callChg > 0 ? 'text-green-700' : r.callChg < 0 ? 'text-red-700' : 'text-gray-400'}>{r.callChg > 0 ? '+' : ''}{r.callChg.toLocaleString()}</span>
                          </div>
                        </td>
                        <td className="text-left py-1 px-1.5 text-gray-600">{r.callOi != null ? r.callOi.toLocaleString() : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[11px] text-gray-400 mt-2">
                Σ OI change per strike over the window (solid bar = opened, pale = closed); OI is the latest reported for that contract.
                {close != null && ' Blue line: underlying close of the latest load.'}
              </p>
            </div>
          )}
        </div>

        {/* Per-contract OI change report; a row opens the contract chart. */}
        <div className="bg-white rounded-lg shadow-md p-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h3 className="text-base font-bold">Open interest change by contracts</h3>
            <div className="flex items-center gap-2">
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg" role="group" aria-label="Expiries">
                {(['expiry', 'all'] as Scope[]).map(s => (
                  <button key={s} onClick={() => setScope(s)}
                    title={s === 'expiry' ? 'Only the expiry selected above' : 'Every expiry of this symbol (one more request)'}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${scope === s ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                    {s === 'expiry' ? `Expiry ${selectedExpiry}` : 'All expiries'}
                  </button>
                ))}
              </div>
              <ColumnsMenu metas={OPT_CHAIN_COLUMNS} {...ocCols.menu} />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2 mb-3">
            <Field label="Search"><input value={f.search} onChange={e => setFilter('search', e.target.value)} placeholder="Strike, type, expiry…" className={`${inputCls} w-36`} /></Field>
            <Field label="Type">
              <select value={f.type} onChange={e => setFilter('type', e.target.value as Filters['type'])} className={inputCls}>
                <option value="all">All</option><option value="call">Calls</option><option value="put">Puts</option>
              </select>
            </Field>
            <Field label={<Term k="oiChg">Change</Term>}>
              <select value={f.dir} onChange={e => setFilter('dir', e.target.value as ChangeDir)} className={inputCls}>
                <option value="all">All</option><option value="added">OI added</option><option value="cut">OI cut</option>
              </select>
            </Field>
            <Field label={<span title="ITM: call strike below the underlying close, put strike above it">Moneyness</span>}>
              <select value={f.money} onChange={e => setFilter('money', e.target.value as Moneyness)} className={inputCls}>
                <option value="all">All</option><option value="itm">ITM</option><option value="otm">OTM</option>
              </select>
            </Field>
            {dates.length > 1 && (
              <Field label="Trade date">
                <select value={f.date} onChange={e => setFilter('date', e.target.value)} className={inputCls}>
                  <option value="">All</option>
                  {dates.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
            )}
            {scope === 'all' && expiries.length > 1 && (
              <Field label="Expiry">
                <select value={f.expiry} onChange={e => setFilter('expiry', e.target.value)} className={inputCls}>
                  <option value="">All</option>
                  {expiries.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
            )}
            <Field label="Strike">
              <span className="flex items-center gap-1">
                <input value={f.strikeMin} onChange={e => setFilter('strikeMin', e.target.value)} inputMode="decimal" placeholder="min" className={`${inputCls} w-16`} />
                <span className="text-gray-400">–</span>
                <input value={f.strikeMax} onChange={e => setFilter('strikeMax', e.target.value)} inputMode="decimal" placeholder="max" className={`${inputCls} w-16`} />
              </span>
            </Field>
            <Field label="Min |ΔOI|"><input value={f.minChg} onChange={e => setFilter('minChg', e.target.value)} inputMode="numeric" placeholder="e.g. 500" className={`${inputCls} w-20`} /></Field>
            <Field label="Min |$ ΔOI|"><input value={f.minValue} onChange={e => setFilter('minValue', e.target.value)} inputMode="numeric" placeholder="e.g. 100000" className={`${inputCls} w-24`} /></Field>
            {activeFilters > 0 && (
              <button onClick={() => setF(NO_FILTERS)} className="px-2 py-1 text-xs text-blue-600 hover:underline">Clear filters ({activeFilters})</button>
            )}
            <span className="ml-auto text-[11px] text-gray-400 pb-1">
              {visibleRows.length !== tableRows.length ? `${visibleRows.length.toLocaleString()} of ${tableRows.length.toLocaleString()} rows` : `${tableRows.length.toLocaleString()} rows`}
            </span>
          </div>
          {scope === 'all' && every.data?.truncated && (
            <p className="text-[11px] text-amber-700 mb-2">Showing the {tableRows.length.toLocaleString()} largest OI changes in this window; pick a shorter window to see them all.</p>
          )}

          {tableRows.length === 0 ? (
            <div className="text-center py-4 text-gray-500 text-sm">
              {table.loading || !table.data ? 'Loading…' : `No OI changes reported${scope === 'expiry' ? ` for expiry ${selectedExpiry}` : ''} in this window.`}
            </div>
          ) : (
            <div className={`overflow-auto max-h-[70vh] ${ocCols.hideUntilReady}`}>
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-white [&_th]:shadow-[inset_0_-1px_0_0_#e5e7eb]">
                  <ColRow layout={ocCols.layout} header className="text-gray-500 align-bottom">
                    <th data-col="symbol" className="sticky text-left py-1.5 pr-2 font-medium">Symbol</th>
                    {oc('expiry') && (<th data-col="expiry" className="sticky text-left py-1.5 px-1.5 font-medium">
                      <OptChainSortLabel label="Expiry" align="left" active={sortKey === 'expiry'} dir={sortDir} onClick={() => handleSort('expiry')} />
                    </th>)}
                    {oc('loadDate') && (<th data-col="loadDate" className="sticky text-left py-1.5 px-1.5 font-medium">
                      <OptChainSortLabel label="Trade Date" align="left" active={sortKey === 'loadDate'} dir={sortDir} onClick={() => handleSort('loadDate')} />
                    </th>)}
                    {oc('cmp') && (<th data-col="cmp" className="sticky text-right py-1.5 px-1.5 font-medium">
                      <OptChainSortLabel label="CMP" active={sortKey === 'close'} dir={sortDir} onClick={() => handleSort('close')} />
                    </th>)}
                    {oc('strike') && (<th data-col="strike" className="sticky text-right py-1.5 px-1.5 font-medium">
                      <OptChainSortLabel label="Strike Price" active={sortKey === 'strike'} dir={sortDir} onClick={() => handleSort('strike')} />
                    </th>)}
                    {oc('optType') && (<th data-col="optType" className="sticky text-left py-1.5 px-1.5 font-medium">
                      <OptChainSortLabel label="Opt Typ" align="left" active={sortKey === 'optType'} dir={sortDir} onClick={() => handleSort('optType')} />
                    </th>)}
                    {oc('ltp') && (<th data-col="ltp" className="sticky text-right py-1.5 px-1.5 font-medium">
                      <OptChainSortLabel label="Opt LTP" active={sortKey === 'ltp'} dir={sortDir} onClick={() => handleSort('ltp')} />
                    </th>)}
                    {oc('oi') && (<th data-col="oi" className="sticky text-right py-1.5 px-1.5 font-medium">
                      <OptChainSortLabel label="OI" active={sortKey === 'oi'} dir={sortDir} onClick={() => handleSort('oi')} />
                    </th>)}
                    {oc('oiChg') && (<th data-col="oiChg" className="sticky text-right py-1.5 px-1.5 font-medium">
                      <OptChainSortLabel label="Chg OI" active={sortKey === 'oiChg'} dir={sortDir} onClick={() => handleSort('oiChg')} />
                    </th>)}
                    {oc('absOiChg') && (<th data-col="absOiChg" className="sticky text-right py-1.5 px-1.5 font-medium">
                      <OptChainSortLabel label="ABS Chg OI" active={sortKey === 'absOiChg'} dir={sortDir} onClick={() => handleSort('absOiChg')} />
                    </th>)}
                    {oc('chgPrice') && (<th data-col="chgPrice" className="sticky text-right py-1.5 px-1.5 font-medium">
                      <OptChainSortLabel label="Chg OI $" active={sortKey === 'chgOpenIntPrice'} dir={sortDir} onClick={() => handleSort('chgOpenIntPrice')} />
                    </th>)}
                    {oc('absChgPrice') && (<th data-col="absChgPrice" className="sticky text-right py-1.5 pl-1.5 font-medium">
                      <OptChainSortLabel label="ABS Chg OI $" active={sortKey === 'absChgOpenIntPrice'} dir={sortDir} onClick={() => handleSort('absChgOpenIntPrice')} />
                    </th>)}
                  </ColRow>
                </thead>
                <tbody>
                  {visibleRows.map((r, i) => (
                    <ColRow
                      layout={ocCols.layout}
                      key={`${r.loadDate}-${r.expiry}-${r.optType}-${r.strike}-${i}`}
                      onClick={() => onOpenContract(r.strike, r.optType, r.expiry)}
                      title="View option contract chart"
                      className="border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer"
                    >
                      <td data-col="symbol" className="py-1.5 pr-2 text-gray-600">{symbol.toUpperCase()}</td>
                      {oc('expiry') && (<td data-col="expiry" className="py-1.5 px-1.5 text-gray-600">{r.expiry}</td>)}
                      {oc('loadDate') && (<td data-col="loadDate" className="py-1.5 px-1.5 text-gray-600" title={`Session behind the OI change; reported in the ${r.loadDate} load`}>{r.tradeDate ?? r.loadDate}</td>)}
                      {oc('cmp') && (<td data-col="cmp" className="text-right py-1.5 px-1.5 text-gray-600">{r.close}</td>)}
                      {oc('strike') && (<td data-col="strike" className="text-right py-1.5 px-1.5 font-mono">{r.strike}</td>)}
                      {oc('optType') && (<td data-col="optType" className={`py-1.5 px-1.5 font-semibold capitalize ${r.optType === 'call' ? 'text-green-600' : 'text-red-600'}`}>{r.optType}</td>)}
                      {oc('ltp') && (<td data-col="ltp" className="text-right py-1.5 px-1.5 text-gray-600">{r.ltp}</td>)}
                      {oc('oi') && (<td data-col="oi" className="text-right py-1.5 px-1.5 text-gray-600">{r.oi.toLocaleString()}</td>)}
                      {oc('oiChg') && (<td data-col="oiChg" className={`text-right py-1.5 px-1.5 font-semibold ${r.oiChg > 0 ? 'text-green-600' : r.oiChg < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                        {r.oiChg > 0 ? '+' : ''}{r.oiChg.toLocaleString()}
                      </td>)}
                      {oc('absOiChg') && (<td data-col="absOiChg" className="text-right py-1.5 px-1.5 text-gray-600">{Math.abs(r.oiChg).toLocaleString()}</td>)}
                      {oc('chgPrice') && (<td data-col="chgPrice" className={`text-right py-1.5 px-1.5 font-semibold ${r.chgOpenIntPrice > 0 ? 'text-green-600' : r.chgOpenIntPrice < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                        {r.chgOpenIntPrice > 0 ? '+' : ''}{r.chgOpenIntPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>)}
                      {oc('absChgPrice') && (<td data-col="absChgPrice" className="text-right py-1.5 pl-1.5 text-gray-600">{Math.abs(r.chgOpenIntPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>)}
                    </ColRow>
                  ))}
                  {visibleRows.length === 0 && (
                    <tr><td colSpan={OPT_CHAIN_COLUMNS.filter(c => oc(c.id)).length} className="text-center py-4 text-gray-400">No rows match your filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      </div>

      {trendOpen && <OiTrendModal symbol={symbol.toUpperCase()} expiry={selectedExpiry} expiryMode={expiryMode} onClose={() => setTrendOpen(false)} />}
    </div>
  );
}
