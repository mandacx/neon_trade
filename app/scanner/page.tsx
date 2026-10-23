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
const FILTERS_OPEN_KEY = 'usScanner.filtersOpen';
const selectCls = `${inputClass} w-full min-h-[40px] sm:min-h-[34px]`;
const ICON_REFRESH = 'M4 4v6h6M20 20v-6h-6M5.6 15A7 7 0 0018.4 9M18.4 9H14M5.6 15H10';
const ICON_LINK = 'M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1';
const ICON_RESET = 'M4 4v6h6M4.5 15a8 8 0 101.6-8.6L4 10';

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

  const [pickerOpen, setPickerOpen] = useState(false);
  const [filtersOpen, setFiltersOpenState] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  // The panel's open/closed state is a per-browser convenience; storage may be unavailable.
  useEffect(() => {
    try { if (window.innerWidth >= 640 && localStorage.getItem(FILTERS_OPEN_KEY) === '1') setFiltersOpenState(true); } catch { /* ignore */ }
  }, []);
  const setFiltersOpen = (v: boolean | ((o: boolean) => boolean)) => setFiltersOpenState(o => {
    const next = typeof v === 'function' ? v(o) : v;
    try { localStorage.setItem(FILTERS_OPEN_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  // Close the scan picker on an outside click or Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [pickerOpen]);

  /** Filters that differ from the defaults (scan settings, universe and type are visible in the toolbar). */
  const chips = useMemo(() => {
    const d = DEFAULT_PARAMS;
    const out: Array<{ key: string; label: string; clear: () => void }> = [];
    const add = (key: string, label: string, patch: Partial<ScanParams>) => out.push({ key, label, clear: () => setParams(p => ({ ...p, ...patch })) });
    if (params.sector) add('sector', params.sector, { sector: null, industry: null });
    if (params.industry) add('industry', params.industry, { industry: null });
    if (params.minPrice !== d.minPrice) add('minPrice', `Price ≥ $${params.minPrice}`, { minPrice: d.minPrice });
    if (params.maxPrice !== null) add('maxPrice', `Price ≤ $${params.maxPrice}`, { maxPrice: null });
    if (params.minDollarVolM !== d.minDollarVolM) add('dv', `Avg $ vol ≥ $${params.minDollarVolM}M`, { minDollarVolM: d.minDollarVolM });
    if (params.minAvgVol) add('av', `Avg vol ≥ ${compact(params.minAvgVol)}`, { minAvgVol: 0 });
    if (params.capTier !== 'any') add('cap', CAP_TIER_LABELS[params.capTier], { capTier: 'any' });
    if (params.minMktCapB) add('mcap', `Cap ≥ $${params.minMktCapB}B`, { minMktCapB: 0 });
    if (params.minChgPct !== null) add('minChg', `Chg ≥ ${params.minChgPct}%`, { minChgPct: null });
    if (params.maxChgPct !== null) add('maxChg', `Chg ≤ ${params.maxChgPct}%`, { maxChgPct: null });
    if (params.nearHighPct !== null) add('near', `Within ${params.nearHighPct}% of 52W high`, { nearHighPct: null });
    if (params.exchanges.length) add('ex', params.exchanges.join(', '), { exchanges: [] });
    if (params.excludeAdr) add('adr', 'No ADRs', { excludeAdr: false });
    if (params.limit !== d.limit) add('limit', `Top ${params.limit}`, { limit: d.limit });
    return out;
  }, [params]);

  const settingsSummary = [
    info.nLabel && ALLOWED_N[params.scan].length > 1 ? `${info.nLabel} ${params.n}` : null,
    info.dirLabels ? info.dirLabels[params.dir === 'up' ? 0 : 1] : null,
    info.usesPeriod ? params.period : null,
    info.usesSma ? `SMA ${params.sma}` : null,
    UNIVERSE_LABELS[params.universe],
    TYPE_LABELS[params.type],
  ].filter(Boolean).join(' · ');
  const showN = !!info.nLabel && ALLOWED_N[params.scan].length > 1;
  /** The selected scan's own settings plus universe and type. Rendered in the toolbar (tablet and up) and in the phone sheet. */
  const settingsFields = (sfx: string, wide: boolean) => (
    <>
    {/* The selected scan's own settings */}
    {showN && (
      <Field wide={wide} id={'f-n' + sfx} label={info.nLabel!}>
        <select id={'f-n' + sfx} className={selectCls} value={params.n} onChange={e => set('n', Number(e.target.value))}>
          {ALLOWED_N[params.scan].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </Field>
    )}
    {info.dirLabels && (
      <Field wide={wide} id={'f-dir' + sfx} label="Direction">
        <select id={'f-dir' + sfx} className={selectCls} value={params.dir} onChange={e => set('dir', e.target.value as ScanParams['dir'])}>
          <option value="up">{info.dirLabels[0]}</option>
          <option value="down">{info.dirLabels[1]}</option>
        </select>
      </Field>
    )}
    {info.usesPeriod && (
      <Field wide={wide} id={'f-period' + sfx} label="Period">
        <select id={'f-period' + sfx} className={selectCls} value={params.period} onChange={e => set('period', e.target.value as ScanParams['period'])}>
          {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
    )}
    {info.usesSma && (
      <Field wide={wide} id={'f-sma' + sfx} label="Moving average">
        <select id={'f-sma' + sfx} className={selectCls} value={params.sma} onChange={e => set('sma', Number(e.target.value) as ScanParams['sma'])}>
          {SMA_LENGTHS.map(n => <option key={n} value={n}>SMA {n}</option>)}
        </select>
      </Field>
    )}
    {info.usesCombo && (
      <Field wide={wide} id={'f-combo' + sfx} label="Combination">
        <select id={'f-combo' + sfx} className={selectCls} value={params.combo} onChange={e => set('combo', e.target.value as ScanParams['combo'])}>
          {PV_COMBOS.map(c => <option key={c} value={c}>{PV_COMBO_LABELS[c]}</option>)}
        </select>
      </Field>
    )}
    {info.usesVolX && (
      <Field wide={wide} id={'f-volx' + sfx} label="Volume surge >= (x)" narrow>
        <NumberInput id={'f-volx' + sfx} value={params.volX} step={0.1} min={1} onChange={v => set('volX', v ?? 1)} />
      </Field>
    )}
    {info.usesGap && (
      <Field wide={wide} id={'f-gap' + sfx} label="Min gap (%)" narrow>
        <NumberInput id={'f-gap' + sfx} value={params.minGapPct} step={0.5} min={0} onChange={v => set('minGapPct', v ?? 0)} />
      </Field>
    )}
    {info.usesTol && (
      <Field wide={wide} id={'f-tol' + sfx} label="Tolerance (% of open)" narrow>
        <NumberInput id={'f-tol' + sfx} value={params.tolPct} step={0.05} min={0} onChange={v => set('tolPct', v ?? 0)} />
      </Field>
    )}
    {info.usesAtr && (
      <>
        <Field wide={wide} id={'f-atrmin' + sfx} label="ATR % min" narrow>
          <NumberInput id={'f-atrmin' + sfx} value={params.atrMin} step={0.5} min={0} onChange={v => set('atrMin', v ?? 0)} />
        </Field>
        <Field wide={wide} id={'f-atrmax' + sfx} label="ATR % max" narrow>
          <NumberInput id={'f-atrmax' + sfx} value={params.atrMax} step={0.5} min={0} onChange={v => set('atrMax', v)} />
        </Field>
      </>
    )}

    <Field wide={wide} id={'f-universe' + sfx} label="Universe">
      <select id={'f-universe' + sfx} className={selectCls} value={params.universe} onChange={e => set('universe', e.target.value as ScanParams['universe'])}
        title={params.universe === 'TOP1000' ? 'Approximation: the 1000 largest US-listed common stocks by market cap (the official Russell 1000 list is not available).' : undefined}>
        {UNIVERSES.map(u => <option key={u} value={u}>{UNIVERSE_LABELS[u]}</option>)}
      </select>
    </Field>
    <Field wide={wide} id={'f-type' + sfx} label="Type">
      <select id={'f-type' + sfx} className={selectCls} value={params.type} onChange={e => set('type', e.target.value as ScanParams['type'])}>
        {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
      </select>
    </Field>
    </>
  );

  const resetFilters = () => setParams({ ...DEFAULT_PARAMS, scan: params.scan, n: ALLOWED_N[params.scan].includes(params.n) ? params.n : ALLOWED_N[params.scan][0] });

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="container mx-auto px-4 py-3 sm:py-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-2">
          <h1 className="text-lg font-bold text-gray-900">US Market Scanner</h1>
          <p className="text-xs text-gray-500">Liquid US stocks and ETFs · live during market hours (09:30–16:00 ET)</p>
        </div>

        {/* Controls: one compact toolbar; everything else lives in the Filters panel. */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-2">
          <div className="flex flex-wrap items-end gap-2 p-2.5">
            {/* Scan picker */}
            <div className="relative flex-1 min-w-0 sm:flex-none" ref={pickerRef}>
              <span className={`${labelClass} hidden sm:block`}>Scan</span>
              <button onClick={() => setPickerOpen(o => !o)} aria-haspopup="dialog" aria-expanded={pickerOpen} aria-label={`Scan: ${info.label}. Change scan`}
                className="w-full sm:w-auto min-h-[40px] sm:min-h-[34px] flex items-center justify-between gap-2 px-3 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                <span className="truncate"><span className="font-normal opacity-80 hidden sm:inline">{info.group}: </span>{info.label}</span>
                <svg className={`w-3.5 h-3.5 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {pickerOpen && (
                <div role="dialog" aria-label="Choose a scan"
                  className="absolute left-0 top-full mt-1 z-40 w-[calc(100vw-2rem)] sm:w-[640px] lg:w-[820px] max-h-[70vh] overflow-y-auto bg-white rounded-xl border border-gray-200 shadow-xl p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3">
                  {SCAN_GROUPS.map(g => (
                    <div key={g}>
                      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{g}</div>
                      <div className="flex flex-col">
                        {SCANS.filter(s => s.group === g).map(s => {
                          const active = s.key === params.scan;
                          return (
                            <button key={s.key} onClick={() => { chooseScan(s.key); setPickerOpen(false); }} aria-pressed={active} title={s.help}
                              className={`text-left text-xs px-2 py-1.5 sm:py-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                                active ? 'bg-blue-600 text-white font-semibold' : 'text-gray-700 hover:bg-blue-50'}`}>
                              {s.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Scan settings, universe, type: in the toolbar from the tablet width up, in the sheet on a phone */}
            <div className="hidden sm:contents">{settingsFields('', false)}</div>

            <button onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen} aria-controls="scanner-filters"
              className={`min-h-[40px] sm:min-h-[34px] px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                filtersOpen || chips.length ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
              </svg>
              <span className="sm:hidden">Settings</span><span className="hidden sm:inline">Filters</span>{chips.length ? ` (${chips.length})` : ''}
            </button>
            <select aria-label="Presets" className={`${selectCls} !w-auto max-w-[150px] hidden sm:block`} value="" onChange={e => {
              const pr = PRESETS.find(x => x.key === e.target.value);
              if (pr) setParams({ ...DEFAULT_PARAMS, ...pr.params });
            }}>
              <option value="">Presets…</option>
              {PRESETS.map(pr => <option key={pr.key} value={pr.key}>{pr.label}</option>)}
            </select>

            <div className="sm:hidden">
              <IconButton label="Refresh" onClick={() => run()} d={ICON_REFRESH} />
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 px-3 pb-2 -mt-0.5">
            <p className="flex-1 min-w-0 text-[11px] text-gray-500 truncate" title={info.help}>{info.help}</p>
            <div className="flex items-center gap-1">
              <IconButton label="Refresh" onClick={() => run()} d={ICON_REFRESH} />
              <IconButton label={copied ? 'Link copied' : 'Copy link'} onClick={copyLink} active={copied} d={ICON_LINK} />
              <IconButton label="Reset filters" onClick={resetFilters} d={ICON_RESET} />
            </div>
          </div>
          <p className="sm:hidden px-3 pb-2 -mt-1 text-[11px] text-gray-500 truncate">{settingsSummary}</p>

          {/* Active filters, each removable */}
          {chips.length > 0 && (
            <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 px-3 pb-2.5 overflow-x-auto">
              {chips.map(c => (
                <button key={c.key} onClick={c.clear} title="Remove this filter"
                  className="shrink-0 min-h-[32px] sm:min-h-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                  {c.label} <span aria-hidden className="text-gray-400">✕</span><span className="sr-only">, remove</span>
                </button>
              ))}
              <button onClick={resetFilters} className="shrink-0 text-[11px] font-semibold text-blue-700 hover:text-blue-900 px-1">Clear all</button>
            </div>
          )}

          {/* Filters panel: inline on tablet and up, a bottom sheet on a phone */}
          {filtersOpen && (
            <>
              <div className="fixed inset-0 z-40 bg-black/30 sm:hidden" onClick={() => setFiltersOpen(false)} aria-hidden />
              <div id="scanner-filters" role="region" aria-label="Filters"
                className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:static sm:z-auto sm:max-h-none sm:overflow-visible sm:rounded-none sm:shadow-none sm:p-3 sm:border-t sm:border-gray-100">
                <div className="flex items-center justify-between mb-2 sm:hidden">
                  <span className="text-sm font-semibold text-gray-900">Scan settings and filters</span>
                  <button onClick={() => setFiltersOpen(false)} className="min-h-[40px] px-3 text-sm font-semibold text-blue-700">Done</button>
                </div>
                <p className="sm:hidden text-[11px] text-gray-500 mb-2">{info.help}</p>
                <div className="sm:hidden grid grid-cols-2 gap-x-3 gap-y-2.5 mb-3 pb-3 border-b border-gray-100">
                  {settingsFields('-m', true)}
                  <Field id="f-preset-m" label="Presets" wide>
                    <select id="f-preset-m" className={selectCls} value="" onChange={e => {
                      const pr = PRESETS.find(x => x.key === e.target.value);
                      if (pr) setParams({ ...DEFAULT_PARAMS, ...pr.params });
                    }}>
                      <option value="">Choose…</option>
                      {PRESETS.map(pr => <option key={pr.key} value={pr.key}>{pr.label}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-x-3 gap-y-2.5">
                  <Field id="f-sector" label="Sector" wide>
                    <select id="f-sector" className={`${selectCls} w-full`} value={params.sector ?? ''} onChange={e => setParams(p => ({ ...p, sector: e.target.value || null, industry: null }))}>
                      <option value="">All sectors</option>
                      {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field id="f-industry" label="Industry" wide>
                    <select id="f-industry" className={`${selectCls} w-full`} value={params.industry ?? ''} disabled={!params.sector} onChange={e => set('industry', e.target.value || null)}>
                      <option value="">{params.sector ? 'All industries' : 'Pick a sector first'}</option>
                      {industries.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field id="l-price" label="Price ($)" wide group>
                    <div className="flex gap-1" role="group" aria-labelledby="l-price">
                      <NumberInput ariaLabel="Minimum price" value={params.minPrice} min={0} step={1} onChange={v => set('minPrice', v ?? 0)} placeholder="min" />
                      <NumberInput ariaLabel="Maximum price" value={params.maxPrice} min={0} step={1} onChange={v => set('maxPrice', v)} placeholder="max" />
                    </div>
                  </Field>
                  <Field id="l-chg" label="Change today (%)" wide group>
                    <div className="flex gap-1" role="group" aria-labelledby="l-chg">
                      <NumberInput ariaLabel="Minimum change today %" value={params.minChgPct} step={0.5} onChange={v => set('minChgPct', v)} placeholder="min" />
                      <NumberInput ariaLabel="Maximum change today %" value={params.maxChgPct} step={0.5} onChange={v => set('maxChgPct', v)} placeholder="max" />
                    </div>
                  </Field>
                  <Field id="f-dv" label="Min avg dollar volume ($M/day)" wide>
                    <NumberInput id="f-dv" value={params.minDollarVolM} step={5} min={0} onChange={v => set('minDollarVolM', v ?? 0)} />
                  </Field>
                  <Field id="f-av" label="Min avg volume (shares)" wide>
                    <NumberInput id="f-av" value={params.minAvgVol || null} step={100000} min={0} onChange={v => set('minAvgVol', v ?? 0)} />
                  </Field>
                  <Field id="f-cap" label="Market cap" wide>
                    <select id="f-cap" className={`${selectCls} w-full`} value={params.capTier} onChange={e => set('capTier', e.target.value as ScanParams['capTier'])}>
                      {CAP_TIERS.map(c => <option key={c} value={c}>{CAP_TIER_LABELS[c]}</option>)}
                    </select>
                  </Field>
                  <Field id="f-mcap" label="Min market cap ($B)" wide>
                    <NumberInput id="f-mcap" value={params.minMktCapB || null} step={1} min={0} onChange={v => set('minMktCapB', v ?? 0)} />
                  </Field>
                  <Field id="f-near" label={`Near 52W high: ${params.nearHighPct === null ? 'off' : `within ${params.nearHighPct}%`}`} wide>
                    <input id="f-near" type="range" min={0} max={30} step={1} value={params.nearHighPct ?? 30} className="w-full accent-blue-600 h-[34px]"
                      onChange={e => set('nearHighPct', Number(e.target.value) >= 30 ? null : Number(e.target.value))} aria-valuetext={params.nearHighPct === null ? 'off' : `${params.nearHighPct}%`} />
                  </Field>
                  <Field id="f-limit" label="Result limit" wide>
                    <select id="f-limit" className={`${selectCls} w-full`} value={params.limit} onChange={e => set('limit', Number(e.target.value))}>
                      {LIMITS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </Field>
                  <fieldset className="col-span-2 sm:col-span-4 lg:col-span-6 flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                    <legend className={`${labelClass} mb-1 w-full`}>Exchange <span className="normal-case font-normal text-gray-400">(none ticked = all)</span></legend>
                    {EXCHANGES.map(ex => (
                      <label key={ex} className="flex items-center gap-1 text-xs text-gray-700 min-h-[36px] sm:min-h-0">
                        <input type="checkbox" className="accent-blue-600" checked={params.exchanges.includes(ex)}
                          onChange={e => set('exchanges', e.target.checked ? [...params.exchanges, ex] : params.exchanges.filter(x => x !== ex))} />
                        {ex}
                      </label>
                    ))}
                    <label className="flex items-center gap-1 text-xs text-gray-700 min-h-[36px] sm:min-h-0 sm:ml-3">
                      <input type="checkbox" className="accent-blue-600" checked={params.excludeAdr} onChange={e => set('excludeAdr', e.target.checked)} />
                      Exclude ADRs
                    </label>
                  </fieldset>
                </div>
                <p className="text-[11px] text-gray-400 mt-2">Sector, industry and market cap apply to stocks; warrants, units and preferreds are never included.</p>
                <div className="sm:hidden flex gap-2 mt-3">
                  <button onClick={copyLink} className="flex-1 min-h-[40px] rounded-lg border border-gray-200 text-sm font-semibold text-gray-700">{copied ? 'Link copied ✓' : 'Copy link'}</button>
                  <button onClick={resetFilters} className="flex-1 min-h-[40px] rounded-lg border border-gray-200 text-sm font-semibold text-gray-700">Reset filters</button>
                  <button onClick={() => setFiltersOpen(false)} className="flex-1 min-h-[40px] rounded-lg bg-blue-600 text-sm font-semibold text-white">Show results</button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Results */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 sm:px-4 py-2 border-b border-gray-100">
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
                <div className="px-4 py-1.5 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-100">
                  ⚠ Some matches moved more than 30% in one session (often a split). Hover the amber badge for details.
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


/** A labelled control. In the toolbar it sizes to its content; `wide` fills a grid cell. `group` labels a group of inputs. */
function Field({ id, label, children, narrow, wide, group }: { id: string; label: string; children: React.ReactNode; narrow?: boolean; wide?: boolean; group?: boolean }) {
  return (
    <div className={wide ? 'min-w-0' : narrow ? 'w-[calc(50%-0.25rem)] sm:w-24' : 'w-[calc(50%-0.25rem)] sm:w-auto sm:max-w-[180px] min-w-0'}>
      {group ? <span id={id} className={`${labelClass} truncate`}>{label}</span> : <label htmlFor={id} className={`${labelClass} truncate`} title={label}>{label}</label>}
      {children}
    </div>
  );
}

function IconButton({ label, onClick, d, active }: { label: string; onClick: () => void; d: string; active?: boolean }) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className={`w-10 h-10 sm:w-[34px] sm:h-[34px] grid place-items-center rounded-lg border focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
        active ? 'border-green-300 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------- inputs
function NumberInput({ value, onChange, min, step, placeholder, ariaLabel, id }: {
  value: number | null; onChange: (v: number | null) => void; min?: number; step?: number; placeholder?: string; ariaLabel?: string; id?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => { setText(value == null ? '' : String(value)); }, [value]);
  return (
    <input id={id} type="number" inputMode="decimal" aria-label={ariaLabel} className={`${inputClass} w-full min-h-[40px] sm:min-h-[34px]`} value={text} min={min} step={step} placeholder={placeholder}
      onChange={e => {
        setText(e.target.value);
        const n = e.target.value === '' ? null : Number(e.target.value);
        if (n === null || Number.isFinite(n)) onChange(n);
      }} />
  );
}
