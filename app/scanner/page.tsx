'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import DataTable, { type Column } from '@/components/oi/DataTable';
import { Spinner, inputClass, labelClass } from '@/components/oi/oiShared';
import {
  ALLOWED_N, CAP_TIERS, CAP_TIER_LABELS, DEFAULT_PARAMS, EXCHANGES, LIMITS, PERIODS, PRESETS, PV_COMBOS, PV_COMBO_LABELS,
  SCANS, SCAN_GROUPS, SCAN_INFO, SMA_LENGTHS, TYPES, TYPE_LABELS, UNIVERSES, UNIVERSE_LABELS,
  normalizeParams, toQuery, type ScanParams,
} from '@/lib/scanner/config';

/** Mirrors ScanRow / ScanMeta in lib/scanner/run.ts (server-only module). */
interface Row {
  rank: number; symbol: string; name: string | null; exchange: string | null; sector: string | null; industry: string | null;
  kind: 'stock' | 'etf'; price: number; change: number | null; changePct: number | null; open: number; high: number; low: number;
  high52: number | null; low52: number | null; volume: number; avgDollarVolM: number; marketCapB: number | null;
  session: 'pre' | 'regular' | 'post' | 'closed'; hasLevels: boolean; metric: number; detail: string; flag: string | null;
}
interface Meta {
  asOf: string; live: boolean; partialToday: boolean; volumeDelayedFeed: boolean; volumeScanSettledOnly: boolean;
  lastStoredDate: string | null; latestSessionDate: string; sessionState: Row['session']; nextChangeAt: string | null;
  universe: string; scanned: number; matched: number; returned: number;
}
interface Result { params: ScanParams; rows: Row[]; meta: Meta; filters: { sectors: string[]; industries: Record<string, string[]> } }

const REFRESH_MS = 30_000;

// ---------------------------------------------------------------- formatting (en-US, $)
const num = (v: unknown) => (v == null || v === '' ? null : Number(v)); // NUMERIC can arrive as a string
const price = (v: unknown) => { const n = num(v); return n == null || !Number.isFinite(n) ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const signedMoney = (v: unknown) => { const n = num(v); return n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const signedPct = (v: unknown) => { const n = num(v); return n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`; };
const compact = (v: unknown) => { const n = num(v); return n == null ? '—' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n); };
const capText = (b: number | null) => (b == null ? '—' : b >= 1000 ? `$${(b / 1000).toFixed(2)}T` : b >= 1 ? `$${b.toFixed(b >= 100 ? 0 : 1)}B` : `$${Math.round(b * 1000)}M`);
const tone = (v: number | null) => (v == null || v === 0 ? 'text-gray-700' : v > 0 ? 'text-green-700' : 'text-red-700');
const arrow = (v: number | null) => (v == null || v === 0 ? '' : v > 0 ? '▲ ' : '▼ ');

function metricText(p: ScanParams, m: number): string {
  switch (p.scan) {
    case 'streak_up': case 'streak_down': case 'ma_cross': case 'earnings_upcoming': return String(Math.round(m));
    case 'volume': case 'price_volume': return `${m.toFixed(1)}×`;
    case 'inside_day': return `${Math.round(m * 100)}%`;
    case 'open_high': case 'open_low': case 'roc': case 'sma_position': case 'rs_spy': return signedPct(m);
    default: return `${m.toFixed(2)}%`;
  }
}

function etDay(d: string | null) {
  if (!d) return '';
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function StatusPill({ meta }: { meta: Meta }) {
  if (meta.live) {
    return <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden /> Live</span>;
  }
  const label = meta.sessionState === 'pre' ? 'Pre-market' : meta.sessionState === 'post' ? 'After hours' : `As of close ${etDay(meta.latestSessionDate)}`;
  return <span className="text-[11px] font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">{label}</span>;
}

// ---------------------------------------------------------------- page
export default function UsScannerPage() {
  const [params, setParams] = useState<ScanParams>(DEFAULT_PARAMS);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const metaRef = useRef<Meta | null>(null);
  const reqId = useRef(0);

  // Restore the shared/bookmarked URL once on mount (the server validates it again).
  useEffect(() => {
    setParams(normalizeParams(Object.fromEntries(new URLSearchParams(window.location.search))));
    setReady(true);
  }, []);

  const qs = useMemo(() => toQuery(params), [params]);

  const run = useCallback(async (quiet = false) => {
    const id = ++reqId.current;
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`/api/market/scanner?${qs}`, { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (id !== reqId.current) return;
      if (!res.ok || !body?.success) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      setResult(body.data);
      metaRef.current = body.data.meta;
      setError(null);
    } catch (e) {
      if (id !== reqId.current) return;
      // A failed background refresh keeps the rows on screen.
      if (!quiet) setError(e instanceof Error ? e.message : 'error');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [qs]);

  // Run on every change (typing in number boxes is debounced), and keep the URL shareable.
  useEffect(() => {
    if (!ready) return;
    window.history.replaceState(null, '', `/scanner?${qs}`);
    const t = setTimeout(() => run(), 300);
    return () => clearTimeout(t);
  }, [qs, ready, run]);

  // Auto-refresh every 30 s, only while the tab is visible and the regular session is open.
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && metaRef.current?.sessionState === 'regular') run(true);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [ready, run]);

  const set = <K extends keyof ScanParams>(k: K, v: ScanParams[K]) => setParams(p => ({ ...p, [k]: v }));
  const chooseScan = (scan: ScanParams['scan']) => setParams(p => ({ ...p, scan, n: ALLOWED_N[scan].includes(p.n) ? p.n : ALLOWED_N[scan][0] }));
  const info = SCAN_INFO[params.scan];
  const sectors = result?.filters.sectors ?? [];
  const industries = params.sector ? result?.filters.industries[params.sector] ?? [] : [];

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the URL bar has the same link */ }
  }

  const columns: Column<Row>[] = useMemo(() => [
    {
      // Rank and symbol share the first column so it can stay pinned while the table scrolls sideways.
      key: 'symbol', label: '# Symbol', type: 'text', value: r => r.symbol, title: 'Rank and symbol; the symbol opens the chart in a new tab',
      render: r => (
        <span className="flex items-center gap-1.5">
          <span className="w-6 text-right text-[11px] text-gray-400 tabular-nums">{r.rank}</span>
          <Link href={`/stock/${encodeURIComponent(r.symbol)}`} target="_blank" rel="noopener noreferrer" title={r.name ?? r.symbol}
            className="font-semibold text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded" onClick={e => e.stopPropagation()}>
            {r.symbol}
          </Link>
          {r.kind === 'etf' && <span className="text-[9px] font-bold text-slate-600 bg-slate-100 rounded px-1">ETF</span>}
          {r.hasLevels && <span className="text-[9px] font-bold text-green-700 bg-green-50 border border-green-200 rounded px-1" title="Option price levels available on the chart">Levels</span>}
          {r.flag && <span className="text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded px-1 cursor-help" title={r.flag}>Check corporate action</span>}
        </span>
      ),
    },
    {
      key: 'detail', label: 'Why it matched', type: 'text', value: r => r.detail, sortable: false,
      render: r => <span className="block max-w-[340px] truncate text-gray-700" title={r.detail}>{r.detail}</span>,
    },
    { key: 'price', label: 'Price', type: 'number', value: r => r.price, render: r => price(r.price) },
    { key: 'change', label: 'Chg $', type: 'number', value: r => r.change, render: r => <span className={tone(r.change)}>{signedMoney(r.change)}</span> },
    { key: 'changePct', label: 'Chg %', type: 'number', value: r => r.changePct, render: r => <span className={`font-semibold ${tone(r.changePct)}`}>{arrow(r.changePct)}{signedPct(r.changePct)}</span> },
    { key: 'open', label: 'Open', type: 'number', value: r => r.open, render: r => price(r.open) },
    { key: 'high', label: 'High', type: 'number', value: r => r.high, render: r => price(r.high) },
    { key: 'low', label: 'Low', type: 'number', value: r => r.low, render: r => price(r.low) },
    { key: 'high52', label: '52W High', type: 'number', value: r => r.high52, render: r => price(r.high52) },
    { key: 'low52', label: '52W Low', type: 'number', value: r => r.low52, render: r => price(r.low52) },
    { key: 'volume', label: 'Volume', type: 'number', value: r => r.volume, render: r => compact(r.volume), title: 'Latest session volume (partial while the market is open)' },
    { key: 'avgDollarVolM', label: 'Avg $ vol', type: 'number', value: r => r.avgDollarVolM, render: r => `$${compact(r.avgDollarVolM * 1e6)}`, title: 'Average daily dollar volume, last 20 settled sessions' },
    { key: 'marketCapB', label: 'Mkt Cap', type: 'number', value: r => r.marketCapB, render: r => capText(r.marketCapB) },
    { key: 'sector', label: 'Sector', type: 'text', value: r => r.sector },
    { key: 'metric', label: info.metricLabel, type: 'number', value: r => r.metric, render: r => <span className="font-semibold">{metricText(params, r.metric)}</span> },
  ], [info.metricLabel, params]);

  const showN = !!info.nLabel && ALLOWED_N[params.scan].length > 1;
  const resetFilters = () => setParams({ ...DEFAULT_PARAMS, scan: params.scan, n: ALLOWED_N[params.scan].includes(params.n) ? params.n : ALLOWED_N[params.scan][0] });

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="container mx-auto px-4 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">US Market Scanner</h1>
          <p className="text-sm text-gray-600 mt-0.5">
            Liquid US stocks - streaks, 52-week extremes, volume surges, gaps, momentum and breakouts. Live during market hours (09:30-16:00 ET).
          </p>
        </div>

        {/* Sticky filter bar: presets and actions */}
        {/* Sticky from the tablet width up; on a phone it would cover half the screen. Presets scroll sideways on a phone. */}
        <div className="sm:sticky sm:top-0 z-20 bg-gray-50/95 backdrop-blur py-2 mb-2 flex flex-nowrap sm:flex-wrap items-center gap-2 overflow-x-auto">
          <span className="shrink-0 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Presets</span>
          {PRESETS.map(pr => (
            <button key={pr.key} onClick={() => setParams({ ...DEFAULT_PARAMS, ...pr.params })}
              className="shrink-0 min-h-[40px] sm:min-h-0 text-xs font-medium px-2.5 py-1 rounded-full border border-gray-200 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
              {pr.label}
            </button>
          ))}
          <div className="ml-auto shrink-0 flex items-center gap-2">
            <button onClick={() => run()} className="min-h-[40px] sm:min-h-0 text-xs font-semibold text-blue-700 hover:text-blue-900 px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded">Refresh</button>
            <button onClick={copyLink} className="min-h-[40px] sm:min-h-0 text-xs font-semibold text-gray-700 border border-gray-200 bg-white rounded px-2 py-1 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
            <button onClick={resetFilters} className="min-h-[40px] sm:min-h-0 text-xs font-semibold text-gray-700 border border-gray-200 bg-white rounded px-2 py-1 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
              Reset filters
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-3">
          {/* Scan chips by category */}
          <div className="flex flex-col gap-2">
            {SCAN_GROUPS.map(g => (
              <div key={g} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-1.5">
                <span className="sm:w-28 shrink-0 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{g}</span>
                <div className="flex flex-nowrap sm:flex-wrap gap-1.5 overflow-x-auto pb-0.5 sm:pb-0">
                {SCANS.filter(s => s.group === g).map(s => {
                  const active = s.key === params.scan;
                  return (
                    <button key={s.key} onClick={() => chooseScan(s.key)} aria-pressed={active}
                      className={`shrink-0 min-h-[40px] sm:min-h-0 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                        active ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-700 hover:border-blue-400'}`}>
                      {s.label}
                    </button>
                  );
                })}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-3 mb-3 border-l-2 border-blue-200 pl-2">{info.help}</p>

          {/* Filter grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {showN && (
              <div>
                <label htmlFor="f-n" className={labelClass}>{info.nLabel}</label>
                <select id="f-n" className={`${inputClass} w-full`} value={params.n} onChange={e => set('n', Number(e.target.value))}>
                  {ALLOWED_N[params.scan].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            {info.dirLabels && (
              <div>
                <label htmlFor="f-dir" className={labelClass}>Direction</label>
                <select id="f-dir" className={`${inputClass} w-full`} value={params.dir} onChange={e => set('dir', e.target.value as ScanParams['dir'])}>
                  <option value="up">{info.dirLabels[0]}</option>
                  <option value="down">{info.dirLabels[1]}</option>
                </select>
              </div>
            )}
            {info.usesPeriod && (
              <div>
                <label htmlFor="f-period" className={labelClass}>Period</label>
                <select id="f-period" className={`${inputClass} w-full`} value={params.period} onChange={e => set('period', e.target.value as ScanParams['period'])}>
                  {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )}
            {info.usesSma && (
              <div>
                <label htmlFor="f-sma" className={labelClass}>Moving average (sessions)</label>
                <select id="f-sma" className={`${inputClass} w-full`} value={params.sma} onChange={e => set('sma', Number(e.target.value) as ScanParams['sma'])}>
                  {SMA_LENGTHS.map(n => <option key={n} value={n}>SMA {n}</option>)}
                </select>
              </div>
            )}
            {info.usesCombo && (
              <div>
                <label htmlFor="f-combo" className={labelClass}>Combination</label>
                <select id="f-combo" className={`${inputClass} w-full`} value={params.combo} onChange={e => set('combo', e.target.value as ScanParams['combo'])}>
                  {PV_COMBOS.map(c => <option key={c} value={c}>{PV_COMBO_LABELS[c]}</option>)}
                </select>
              </div>
            )}
            {info.usesVolX && (
              <NumberField id="f-volx" label="Volume surge >= (x)" value={params.volX} step={0.1} min={1} onChange={v => set('volX', v ?? 1)} />
            )}
            {info.usesGap && (
              <NumberField id="f-gap" label="Min gap (%)" value={params.minGapPct} step={0.5} min={0} onChange={v => set('minGapPct', v ?? 0)} />
            )}
            {info.usesTol && (
              <NumberField id="f-tol" label="Tolerance (% of open)" value={params.tolPct} step={0.05} min={0} onChange={v => set('tolPct', v ?? 0)} />
            )}
            {info.usesAtr && (
              <>
                <NumberField id="f-atrmin" label="ATR % min" value={params.atrMin} step={0.5} min={0} onChange={v => set('atrMin', v ?? 0)} />
                <NumberField id="f-atrmax" label="ATR % max" value={params.atrMax} step={0.5} min={0} onChange={v => set('atrMax', v)} />
              </>
            )}

            <div>
              <label htmlFor="f-universe" className={labelClass}>Universe</label>
              <select id="f-universe" className={`${inputClass} w-full`} value={params.universe} onChange={e => set('universe', e.target.value as ScanParams['universe'])}
                title={params.universe === 'TOP1000' ? 'Approximation: the 1000 largest US-listed common stocks by market cap (the official Russell 1000 list is not available).' : undefined}>
                {UNIVERSES.map(u => <option key={u} value={u}>{UNIVERSE_LABELS[u]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-type" className={labelClass}>Type</label>
              <select id="f-type" className={`${inputClass} w-full`} value={params.type} onChange={e => set('type', e.target.value as ScanParams['type'])}>
                {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-sector" className={labelClass}>Sector</label>
              <select id="f-sector" className={`${inputClass} w-full`} value={params.sector ?? ''} onChange={e => setParams(p => ({ ...p, sector: e.target.value || null, industry: null }))}>
                <option value="">All sectors</option>
                {sectors.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="f-industry" className={labelClass}>Industry</label>
              <select id="f-industry" className={`${inputClass} w-full`} value={params.industry ?? ''} disabled={!params.sector}
                onChange={e => set('industry', e.target.value || null)} title={params.sector ? undefined : 'Pick a sector first'}>
                <option value="">{params.sector ? 'All industries' : 'Pick a sector first'}</option>
                {industries.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <span id="l-price" className={labelClass}>Price ($)</span>
              <div className="flex gap-1" role="group" aria-labelledby="l-price">
                <NumberInput ariaLabel="Minimum price" value={params.minPrice} min={0} step={1} onChange={v => set('minPrice', v ?? 0)} placeholder="min" />
                <NumberInput ariaLabel="Maximum price" value={params.maxPrice} min={0} step={1} onChange={v => set('maxPrice', v)} placeholder="max" />
              </div>
            </div>
            <NumberField id="f-dv" label="Min avg dollar volume ($M/day)" value={params.minDollarVolM} step={5} min={0} onChange={v => set('minDollarVolM', v ?? 0)} />
            <NumberField id="f-av" label="Min avg volume (shares)" value={params.minAvgVol || null} step={100000} min={0} onChange={v => set('minAvgVol', v ?? 0)} />
            <div>
              <label htmlFor="f-cap" className={labelClass}>Market cap</label>
              <select id="f-cap" className={`${inputClass} w-full`} value={params.capTier} onChange={e => set('capTier', e.target.value as ScanParams['capTier'])}>
                {CAP_TIERS.map(c => <option key={c} value={c}>{CAP_TIER_LABELS[c]}</option>)}
              </select>
            </div>
            <NumberField id="f-mcap" label="Min market cap ($B)" value={params.minMktCapB || null} step={1} min={0} onChange={v => set('minMktCapB', v ?? 0)} />
            <div>
              <span id="l-chg" className={labelClass}>Change today (%)</span>
              <div className="flex gap-1" role="group" aria-labelledby="l-chg">
                <NumberInput ariaLabel="Minimum change today %" value={params.minChgPct} step={0.5} onChange={v => set('minChgPct', v)} placeholder="min" />
                <NumberInput ariaLabel="Maximum change today %" value={params.maxChgPct} step={0.5} onChange={v => set('maxChgPct', v)} placeholder="max" />
              </div>
            </div>
            <div>
              <label htmlFor="f-near" className={labelClass}>Near 52W high: within {params.nearHighPct === null ? 'off' : `${params.nearHighPct}%`}</label>
              <div className="flex items-center gap-2">
                <input id="f-near" type="range" min={0} max={30} step={1} value={params.nearHighPct ?? 30} className="w-full accent-blue-600"
                  onChange={e => set('nearHighPct', Number(e.target.value) >= 30 ? null : Number(e.target.value))} aria-valuetext={params.nearHighPct === null ? 'off' : `${params.nearHighPct}%`} />
              </div>
            </div>
            <div>
              <label htmlFor="f-limit" className={labelClass}>Result limit</label>
              <select id="f-limit" className={`${inputClass} w-full`} value={params.limit} onChange={e => set('limit', Number(e.target.value))}>
                {LIMITS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <legend className={`${labelClass} mb-0 mr-2 float-left`}>Exchange</legend>
              {EXCHANGES.map(ex => (
                <label key={ex} className="flex items-center gap-1 text-xs text-gray-700 min-h-[40px] sm:min-h-0">
                  <input type="checkbox" className="accent-blue-600" checked={params.exchanges.includes(ex)}
                    onChange={e => set('exchanges', e.target.checked ? [...params.exchanges, ex] : params.exchanges.filter(x => x !== ex))} />
                  {ex}
                </label>
              ))}
              <span className="text-[11px] text-gray-400">{params.exchanges.length ? '' : '(none ticked = all)'}</span>
            </fieldset>
            <label className="flex items-center gap-1 text-xs text-gray-700 min-h-[40px] sm:min-h-0">
              <input type="checkbox" className="accent-blue-600" checked={params.excludeAdr} onChange={e => set('excludeAdr', e.target.checked)} />
              Exclude ADRs
            </label>
            <span className="text-[11px] text-gray-400">Sector, industry and market cap apply to stocks; warrants, units and preferreds are never included.</span>
          </div>
        </div>

        {/* Results */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">
              {info.label}
              {result && <span className="font-normal text-gray-600"> - {result.meta.matched.toLocaleString('en-US')} matches of {result.meta.scanned.toLocaleString('en-US')} scanned - showing {result.meta.returned.toLocaleString('en-US')}</span>}
            </h2>
            {result && <StatusPill meta={result.meta} />}
            {result?.meta.partialToday && <span className="text-[11px] text-gray-500">(today&apos;s volume is partial)</span>}
            {result?.meta.volumeScanSettledOnly && <span className="text-[11px] text-amber-700">Today&apos;s full volume isn&apos;t in yet: volume scans use the last settled sessions.</span>}
            {loading && result && <Spinner label="Updating…" />}
          </div>
          {error && !result ? (
            <div className="p-8 text-center text-sm text-red-700">Could not run the scan. Try again in a moment.</div>
          ) : !result ? (
            <LoadingSpinner message="Running the scan…" />
          ) : (
            <>
              {error && <div className="px-4 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">Could not run the scan. Try again in a moment. Showing the previous results.</div>}
              {result.rows.some(r => r.flag) && (
                <div className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
                  Check corporate action: some matches moved more than 30% in one session. That is often a split or similar event; hover the badge for details.
                </div>
              )}
              <DataTable<Row>
                rows={result.rows}
                columns={columns}
                rowKey={r => r.symbol}
                tableId="usScanner"
                stickyFirst
                csvName={`us-scanner-${params.scan}`}
                emptyText="No stocks match these filters right now."
                searchPlaceholder="Search symbols, names, sectors…"
                maxHeight="70vh"
              />
            </>
          )}
        </div>

        <p className="text-[11px] text-gray-500 mt-4">
          Educational tool, not investment advice. Daily history is end-of-day data; today&apos;s candle is built from live prices while the market is open.
        </p>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- inputs
function NumberInput({ value, onChange, min, step, placeholder, ariaLabel, id }: {
  value: number | null; onChange: (v: number | null) => void; min?: number; step?: number; placeholder?: string; ariaLabel?: string; id?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => { setText(value == null ? '' : String(value)); }, [value]);
  return (
    <input id={id} type="number" inputMode="decimal" aria-label={ariaLabel} className={`${inputClass} w-full`} value={text} min={min} step={step} placeholder={placeholder}
      onChange={e => {
        setText(e.target.value);
        const n = e.target.value === '' ? null : Number(e.target.value);
        if (n === null || Number.isFinite(n)) onChange(n);
      }} />
  );
}

function NumberField(props: { id: string; label: string; value: number | null; onChange: (v: number | null) => void; min?: number; step?: number }) {
  return (
    <div>
      <label htmlFor={props.id} className={labelClass}>{props.label}</label>
      <NumberInput id={props.id} value={props.value} onChange={props.onChange} min={props.min} step={props.step} />
    </div>
  );
}
