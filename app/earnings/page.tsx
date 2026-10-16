'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Header from '@/components/layout/Header';
import { getLevelDisplayName } from '@/lib/utils';
import { addDaysET } from '@/lib/earningsFilter';
import { fmtMoneyCompact } from '@/lib/format';
import { EARNINGS_COLUMNS } from '@/lib/earningsColumns';
import ColumnsMenu from '@/components/ui/ColumnsMenu';
import { useColumnPrefs } from '@/components/ui/useColumnPrefs';
import type { EarningsOutcome, EarningsRangeRow } from '@/types/earnings';
import type { ExtendedQuote } from '@/lib/quote';
import ExtendedMove from '@/components/ui/ExtendedMove';
import {
  type LevelRow, type LevelKey, LEVEL_FILTER_OPTIONS, rebaseToLtp, easternToday, fmtExpiry, fmtPrice, fmtEps, fmtSales,
  fmtNextDate, earningsTimeShort, ChangeCell, ChangePercentCell, LevelCell,
} from '@/components/watchlists/watchlistShared';

type Mode = 'upcoming' | 'reported' | 'custom';
type SortKey = 'symbol' | 'date' | 'marketCap' | 'epsSurprise' | 'salesSurprise' | 'ltp' | 'change' | 'changePercent' | 'ext' | 'reaction' | 'since' | 'level';

interface Row extends EarningsRangeRow {
  name: string | null;
  sector: string | null;
  industry: string | null;
  marketCapTier: string | null;
  marketCap: number | null;
  lastPrice: number | null;
  change: number | null;
  changePercent: number | null;
  /** Pre-market / after-hours move from the regular close; null when none. */
  ext: ExtendedQuote | null;
  /** Close-to-close move around the report (reports already out). */
  reactionPct: number | null;
  /** Move from the pre-report close to the live price. */
  sincePct: number | null;
  refClose: number | null;
}

const PERIODS = [1, 3, 5, 7, 10, 15, 30, 60, 90];
const inputClass = 'px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white';
const labelClass = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1';

const OUTCOME_TONE: Record<EarningsOutcome, string> = {
  beat: 'bg-green-50 text-green-700',
  miss: 'bg-red-50 text-red-700',
  inline: 'bg-gray-100 text-gray-600',
};

function SurpriseCell({ pct, outcome }: { pct: number | null; outcome: EarningsOutcome | null }) {
  if (pct == null && !outcome) return <span className="text-xs text-gray-300">—</span>;
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums whitespace-nowrap ${OUTCOME_TONE[outcome ?? 'inline']}`}>
      {outcome === 'inline' ? 'In-line' : `${pct != null && pct > 0 ? '+' : ''}${pct?.toFixed(1) ?? '—'}%`}
    </span>
  );
}

function whenLabel(r: Row): string {
  if (r.daysUntil === 0) return 'Today';
  return r.daysUntil > 0 ? `in ${r.daysUntil}d` : `${-r.daysUntil}d ago`;
}

function SortHeader({ label, k, sortKey, dir, onSort, right = true }: { label: string; k: SortKey; sortKey: SortKey | null; dir: 'asc' | 'desc'; onSort: (k: SortKey) => void; right?: boolean }) {
  const active = sortKey === k;
  return (
    <button onClick={() => onSort(k)} className={`flex items-center gap-1 hover:text-gray-700 whitespace-nowrap ${right ? 'justify-end w-full' : ''}`}>
      {label}
      <span className={active ? 'text-blue-600' : 'text-gray-300'}>{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </button>
  );
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmtPct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const tone = (v: number | null) => (v == null ? 'text-gray-800' : v > 0 ? 'text-green-700' : v < 0 ? 'text-red-700' : 'text-gray-800');

export default function EarningsPage() {
  const [mode, setMode] = useState<Mode>('upcoming');
  const [days, setDays] = useState(7);
  const [from, setFrom] = useState(() => addDaysET(easternToday(), -7));
  const [to, setTo] = useState(() => addDaysET(easternToday(), 7));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levelRows, setLevelRows] = useState<LevelRow[] | null>(null);
  const [expiries, setExpiries] = useState<string[]>([]);
  const [expiryChoice, setExpiryChoice] = useState('');
  const [expiry, setExpiry] = useState('');

  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('');
  const [capTier, setCapTier] = useState('');
  const [epsFilter, setEpsFilter] = useState<'' | EarningsOutcome | 'pending'>('');
  const [salesFilter, setSalesFilter] = useState<'' | EarningsOutcome>('');
  const [session, setSession] = useState('');
  const [dateKind, setDateKind] = useState<'' | 'confirmed' | 'estimated'>('');
  const [direction, setDirection] = useState<'' | 'up' | 'down'>('');
  const [reaction, setReaction] = useState<'' | 'up' | 'down'>('');
  const [levelFilter, setLevelFilter] = useState<LevelKey | ''>('');
  const [proximityEnabled, setProximityEnabled] = useState(false);
  const [proximityThreshold, setProximityThreshold] = useState(5);
  const [beforeExpiryOnly, setBeforeExpiryOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Which columns the user has switched off: loaded with the page, saved to their account.
  const cols = useColumnPrefs('earnings', EARNINGS_COLUMNS);

  // Deep links from the home cards (?mode=reported). Read after mount so the server render matches.
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('mode');
    if (m === 'upcoming' || m === 'reported' || m === 'custom') setMode(m);
  }, []);

  // Earnings rows (quotes + price reaction included) for the chosen window.
  const customReady = mode !== 'custom' || (!!from && !!to && from <= to);
  useEffect(() => {
    if (!customReady) return;
    const ctl = new AbortController();
    const qs = mode === 'custom' ? `mode=custom&from=${from}&to=${to}` : `mode=${mode}&days=${days}`;
    setLoading(true);
    setError(null);
    fetch(`/api/earnings/list?${qs}`, { signal: ctl.signal })
      .then(res => res.json())
      .then(json => {
        if (json.success) setRows(json.data.rows);
        else { setRows([]); setError(json.error ?? 'Could not load earnings.'); }
        setLoading(false);
      })
      .catch(e => { if (e.name !== 'AbortError') { setRows([]); setError('Could not load earnings.'); setLoading(false); } });
    return () => ctl.abort();
  }, [mode, days, from, to, customReady]);

  // Levels at one monthly expiry for the whole levels universe (rebased onto each row's LTP below).
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/earnings/levels${expiryChoice ? `?expiry=${encodeURIComponent(expiryChoice)}` : ''}`, { signal: ctl.signal })
      .then(res => res.json())
      .then(json => {
        if (!json.success) return;
        setLevelRows(json.data.rows);
        setExpiries(json.data.expiries);
        setExpiry(json.data.expiry);
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [expiryChoice]);

  const ltpBySymbol = useMemo(() => new Map((rows ?? []).map(r => [r.symbol, r.lastPrice])), [rows]);
  const levelBySymbol = useMemo(
    () => new Map((levelRows ?? []).map(l => [l.symbol, rebaseToLtp(l, ltpBySymbol.get(l.symbol))])),
    [levelRows, ltpBySymbol],
  );

  const sectors = useMemo(() => Array.from(new Set((rows ?? []).map(r => r.sector).filter((s): s is string => !!s))).sort(), [rows]);
  const capTiers = useMemo(() => Array.from(new Set((rows ?? []).map(r => r.marketCapTier).filter((s): s is string => !!s))).sort(), [rows]);

  const visible = useMemo(() => (rows ?? []).filter(r => {
    const q = search.trim().toUpperCase();
    if (q && !r.symbol.includes(q) && !(r.name ?? '').toUpperCase().includes(q)) return false;
    if (sector && r.sector !== sector) return false;
    if (capTier && r.marketCapTier !== capTier) return false;
    if (epsFilter === 'pending' ? r.kind !== 'pending' : epsFilter && r.epsOutcome !== epsFilter) return false;
    if (salesFilter && r.salesOutcome !== salesFilter) return false;
    if (session && (session === 'unknown' ? r.time !== null : r.time !== session)) return false;
    if (dateKind && (r.kind !== 'upcoming' || r.estimated !== (dateKind === 'estimated'))) return false;
    if (direction === 'up' && !((r.change ?? 0) > 0)) return false;
    if (direction === 'down' && !((r.change ?? 0) < 0)) return false;
    if (reaction === 'up' && !((r.reactionPct ?? 0) > 0)) return false;
    if (reaction === 'down' && !((r.reactionPct ?? 0) < 0)) return false;
    const lvl = levelBySymbol.get(r.symbol);
    if (levelFilter && lvl?.closestLevel !== levelFilter) return false;
    if (proximityEnabled && (lvl?.distancePercent == null || Math.abs(lvl.distancePercent) > proximityThreshold)) return false;
    if (beforeExpiryOnly && !(r.kind === 'upcoming' && expiry && r.date <= expiry)) return false;
    return true;
  }), [rows, search, sector, capTier, epsFilter, salesFilter, session, dateKind, direction, reaction, levelFilter, proximityEnabled, proximityThreshold, beforeExpiryOnly, expiry, levelBySymbol]);

  const sorted = useMemo(() => {
    const byCap = (a: Row, b: Row) => (b.marketCap ?? 0) - (a.marketCap ?? 0);
    if (!sortKey) {
      // Default: soonest first for what's ahead, newest first for what's out, biggest companies first within a day.
      const newestFirst = mode === 'reported';
      return [...visible].sort((a, b) => (newestFirst ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || byCap(a, b));
    }
    const value = (r: Row): number | string | null => {
      switch (sortKey) {
        case 'symbol': return r.symbol;
        case 'date': return r.date;
        case 'marketCap': return r.marketCap;
        case 'epsSurprise': return r.epsSurprisePct;
        case 'salesSurprise': return r.salesSurprisePct;
        case 'ltp': return r.lastPrice;
        case 'change': return r.change;
        case 'changePercent': return r.changePercent;
        case 'ext': return r.ext?.changePercent ?? null;
        case 'reaction': return r.reactionPct;
        case 'since': return r.sincePct;
        case 'level': { const p = levelBySymbol.get(r.symbol)?.distancePercent; return p == null ? null : Math.abs(p); }
      }
    };
    return [...visible].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // missing values always last
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [visible, sortKey, sortDir, mode, levelBySymbol]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  }

  const stats = useMemo(() => {
    const out = visible.filter(r => r.kind === 'reported');
    const decided = out.filter(r => r.epsOutcome);
    const reactions = out.map(r => r.reactionPct).filter((v): v is number => v != null);
    const since = out.map(r => r.sincePct).filter((v): v is number => v != null);
    return {
      total: visible.length,
      upcoming: visible.filter(r => r.kind === 'upcoming').length,
      reported: out.length,
      beatRate: decided.length ? (decided.filter(r => r.epsOutcome === 'beat').length / decided.length) * 100 : null,
      avgReaction: avg(reactions),
      upShare: reactions.length ? (reactions.filter(v => v > 0).length / reactions.length) * 100 : null,
      avgSince: avg(since),
    };
  }, [visible]);

  // Only while some row has a pre-market / after-hours print (between the close and the next open).
  const showExt = sorted.some(r => r.ext);
  const openChart = (symbol: string) => window.open(`/stock/${encodeURIComponent(symbol)}`, '_blank', 'noopener,noreferrer');
  const periodLabel = mode === 'custom' ? `${from} to ${to}` : `${mode === 'upcoming' ? 'Next' : 'Past'} ${days} day${days === 1 ? '' : 's'}`;
  const th = 'px-3 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap';
  const td = 'px-3 py-1 whitespace-nowrap';

  const sortHead = (label: string, k: SortKey, right = true) => <SortHeader label={label} k={k} sortKey={sortKey} dir={sortDir} onSort={toggleSort} right={right} />;
  interface ColDef { head: ReactNode; right?: boolean; cell: (r: Row) => ReactNode; cellClass?: string; title?: (r: Row) => string | undefined }
  const colDefs: Record<string, ColDef> = {
    symbol: {
      head: sortHead('Symbol', 'symbol', false),
      cell: r => (
        <a href={`/stock/${encodeURIComponent(r.symbol)}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
          className="font-bold text-gray-900 hover:text-blue-600">{r.symbol}</a>
      ),
    },
    company: { head: 'Company', cell: r => r.name ?? '—', cellClass: 'max-w-[200px] truncate text-xs text-gray-500', title: r => r.name ?? '' },
    sector: { head: 'Sector', cell: r => r.sector ?? '—', cellClass: 'text-xs text-gray-500', title: r => r.industry ?? '' },
    marketCap: {
      head: sortHead('Market cap', 'marketCap'), right: true,
      cell: r => fmtMoneyCompact(r.marketCap, 1),
      cellClass: 'text-xs tabular-nums text-gray-700',
      title: r => (r.marketCap != null ? `${r.marketCap.toLocaleString('en-US')}${r.marketCapTier ? ` · ${r.marketCapTier} cap` : ''}` : undefined),
    },
    date: {
      head: sortHead('Report', 'date', false),
      cell: r => {
        const beforeExp = r.kind === 'upcoming' && !!expiry && r.date <= expiry;
        return (
          <>
            <span className="text-xs font-semibold text-gray-800 tabular-nums">{fmtNextDate(r.date, r.kind === 'upcoming' && r.estimated)}</span>
            {earningsTimeShort(r.time) && <span className="ml-1 text-[10px] text-gray-500">{earningsTimeShort(r.time)}</span>}
            <span className={`ml-1.5 text-[10px] tabular-nums ${r.daysUntil >= 0 && r.daysUntil <= 1 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{whenLabel(r)}</span>
            {beforeExp && <span className="ml-1 text-[10px] font-semibold text-amber-700" title={`Reports before the ${fmtExpiry(expiry)} expiry`}>⚠</span>}
          </>
        );
      },
      title: r => (r.kind === 'upcoming' && r.estimated ? 'Estimated date, not yet confirmed by the company' : undefined),
    },
    epsEst: { head: 'EPS est', right: true, cell: r => fmtEps(r.epsEstimate), cellClass: 'text-xs tabular-nums text-gray-600' },
    epsAct: {
      head: 'EPS act', right: true, cellClass: 'text-xs tabular-nums font-semibold text-gray-800',
      cell: r => (r.kind === 'pending' ? <span className="text-[11px] font-semibold text-gray-400">Pending</span> : fmtEps(r.epsActual)),
    },
    epsSurprise: { head: sortHead('EPS surprise', 'epsSurprise'), right: true, cell: r => <SurpriseCell pct={r.epsSurprisePct} outcome={r.epsOutcome} /> },
    salesEst: { head: 'Sales est', right: true, cell: r => fmtSales(r.salesEstimate), cellClass: 'text-xs tabular-nums text-gray-600' },
    salesAct: { head: 'Sales act', right: true, cell: r => fmtSales(r.salesActual), cellClass: 'text-xs tabular-nums font-semibold text-gray-800' },
    salesSurprise: { head: sortHead('Sales surprise', 'salesSurprise'), right: true, cell: r => <SurpriseCell pct={r.salesSurprisePct} outcome={r.salesOutcome} /> },
    ltp: { head: sortHead('LTP', 'ltp'), right: true, cell: r => fmtPrice(r.lastPrice), cellClass: 'text-xs tabular-nums font-semibold text-gray-800' },
    change: { head: sortHead('Chg $', 'change'), right: true, cell: r => <ChangeCell change={r.change} /> },
    changePercent: { head: sortHead('Chg %', 'changePercent'), right: true, cell: r => <ChangePercentCell changePercent={r.changePercent} /> },
    ext: {
      head: sortHead('Ext. hrs', 'ext'), right: true,
      cell: r => (r.ext ? <ExtendedMove ext={r.ext} /> : <span className="text-xs text-gray-300">—</span>),
    },
    reaction: {
      head: sortHead('Reaction', 'reaction'), right: true, cell: r => <ChangePercentCell changePercent={r.reactionPct} />,
      title: () => 'Close-to-close move around the report: before the open = prior close to report-day close; after the close = report-day close to next close',
    },
    since: {
      head: sortHead('Since report', 'since'), right: true, cell: r => <ChangePercentCell changePercent={r.sincePct} />,
      title: r => (r.refClose != null ? `From the pre-report close of ${fmtPrice(r.refClose)} to the live price` : undefined),
    },
    level: {
      head: sortHead(expiry ? `Level ${fmtExpiry(expiry)}` : 'Nearest level', 'level'), right: true,
      cell: r => <LevelCell level={levelBySymbol.get(r.symbol)} compact />,
      title: r => { const lvl = levelBySymbol.get(r.symbol); return lvl?.levels.length ? lvl.levels.map(l => `${getLevelDisplayName(l.name)} ${fmtPrice(l.price)}`).join(' | ') : undefined; },
    },
  };
  // Registry order, filtered to the saved choice; Ext. hrs also needs a row with a print.
  const shownCols = EARNINGS_COLUMNS.map(c => c.id).filter(id => cols.isShown(id) && (id !== 'ext' || showExt));

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="container mx-auto px-4 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">Earnings Tracker</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Every stock with price levels, one line each. Click a row to open its chart in a new tab. Levels are for the selected monthly expiry, measured from the live price.
          </p>
        </div>

        {/* Period */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-3">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className={labelClass}>Show</label>
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                {([['upcoming', 'Upcoming'], ['reported', 'Reported'], ['custom', 'Custom dates']] as [Mode, string][]).map(([m, label]) => (
                  <button key={m} onClick={() => { setMode(m); setSortKey(null); }}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${mode === m ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {mode !== 'custom' ? (
              <div>
                <label className={labelClass}>{mode === 'upcoming' ? 'Next' : 'Past'}</label>
                <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-lg">
                  {PERIODS.map(d => (
                    <button key={d} onClick={() => setDays(d)}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${days === d ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                      {d}D
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <label className={labelClass}>From / To (reports in range, past and upcoming)</label>
                <div className="flex items-center gap-1.5">
                  <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className={inputClass} aria-label="From date" />
                  <span className="text-xs text-gray-400">to</span>
                  <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className={inputClass} aria-label="To date" />
                </div>
              </div>
            )}
            {expiries.length > 0 && (
              <div>
                <label className={labelClass}>Levels expiry</label>
                <select value={expiryChoice || expiry} onChange={e => setExpiryChoice(e.target.value)} className={inputClass}>
                  {expiries.map(d => <option key={d} value={d}>{fmtExpiry(d)}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-3">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className={labelClass}>Search</label>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Symbol or name…" className={`${inputClass} w-44`} />
            </div>
            <div>
              <label className={labelClass}>Sector</label>
              <select value={sector} onChange={e => setSector(e.target.value)} className={inputClass}>
                <option value="">All sectors</option>
                {sectors.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Market cap</label>
              <select value={capTier} onChange={e => setCapTier(e.target.value)} className={inputClass}>
                <option value="">All</option>
                {capTiers.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>EPS result</label>
              <select value={epsFilter} onChange={e => setEpsFilter(e.target.value as typeof epsFilter)} className={inputClass}>
                <option value="">Any</option>
                <option value="beat">Beat</option>
                <option value="miss">Miss</option>
                <option value="inline">In-line</option>
                <option value="pending">Results pending</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Sales result</label>
              <select value={salesFilter} onChange={e => setSalesFilter(e.target.value as typeof salesFilter)} className={inputClass}>
                <option value="">Any</option>
                <option value="beat">Beat</option>
                <option value="miss">Miss</option>
                <option value="inline">In-line</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Session</label>
              <select value={session} onChange={e => setSession(e.target.value)} className={inputClass}>
                <option value="">Any</option>
                <option value="pre-market">Before open (BMO)</option>
                <option value="post-market">After close (AMC)</option>
                <option value="during-market">Intraday</option>
                <option value="unknown">Not announced</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Date</label>
              <select value={dateKind} onChange={e => setDateKind(e.target.value as typeof dateKind)} className={inputClass}>
                <option value="">Any</option>
                <option value="confirmed">Confirmed</option>
                <option value="estimated">Estimated</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Today</label>
              <select value={direction} onChange={e => setDirection(e.target.value as typeof direction)} className={inputClass}>
                <option value="">All</option>
                <option value="up">▲ Gainers</option>
                <option value="down">▼ Losers</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Reaction</label>
              <select value={reaction} onChange={e => setReaction(e.target.value as typeof reaction)} className={inputClass}>
                <option value="">All</option>
                <option value="up">Rose on the report</option>
                <option value="down">Fell on the report</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Level</label>
              <select value={levelFilter} onChange={e => setLevelFilter(e.target.value as LevelKey | '')} className={inputClass}>
                <option value="">All levels</option>
                {LEVEL_FILTER_OPTIONS.map(l => <option key={l} value={l}>{getLevelDisplayName(l)}</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1 cursor-pointer select-none">
                <input type="checkbox" checked={proximityEnabled} onChange={e => setProximityEnabled(e.target.checked)} className="accent-blue-600" />
                Near a level: {proximityThreshold}%
              </label>
              <input type="range" min="1" max="20" step="0.5" value={proximityThreshold} disabled={!proximityEnabled}
                onChange={e => setProximityThreshold(parseFloat(e.target.value))} className="w-32 accent-blue-500 disabled:opacity-40 mb-2" />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-3 cursor-pointer select-none">
                <input type="checkbox" checked={beforeExpiryOnly} onChange={e => setBeforeExpiryOnly(e.target.checked)} className="accent-amber-600" />
                Reports before {expiry ? fmtExpiry(expiry) : 'expiry'}
              </label>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
          {[
            { label: periodLabel, value: `${stats.total} reports`, sub: `${stats.upcoming} upcoming · ${stats.reported} reported`, cls: 'text-gray-900' },
            { label: 'EPS beat rate', value: stats.beatRate == null ? '—' : `${stats.beatRate.toFixed(0)}%`, sub: 'of reports with a result', cls: 'text-gray-900' },
            { label: 'Avg reaction', value: fmtPct(stats.avgReaction), sub: 'close-to-close around the report', cls: tone(stats.avgReaction) },
            { label: 'Rose on report', value: stats.upShare == null ? '—' : `${stats.upShare.toFixed(0)}%`, sub: 'share with a positive reaction', cls: 'text-gray-900' },
            { label: 'Avg since report', value: fmtPct(stats.avgSince), sub: 'pre-report close to live price', cls: tone(stats.avgSince) },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{c.label}</div>
              <div className={`text-lg font-bold tabular-nums ${c.cls}`}>{c.value}</div>
              <div className="text-[10px] text-gray-400">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="flex justify-end mb-2">
          <ColumnsMenu metas={EARNINGS_COLUMNS} {...cols.menu} notes={showExt ? undefined : { ext: 'no after-hours prints right now' }} />
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          {loading || !cols.ready ? (
            <div className="p-10 text-center text-sm text-gray-400">
              <div className="inline-block animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full mr-2 align-middle" />
              Loading earnings, quotes and price reactions…
            </div>
          ) : error ? (
            <div className="p-10 text-center text-sm text-red-600">{error}</div>
          ) : sorted.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-400">No reports match these dates and filters.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left">
                  {shownCols.map(id => <th key={id} className={`${th}${colDefs[id].right ? ' text-right' : ''}`}>{colDefs[id].head}</th>)}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={`${r.symbol}-${r.date}-${r.kind}`} onClick={() => openChart(r.symbol)}
                    className="border-b border-gray-50 last:border-0 hover:bg-blue-50/40 cursor-pointer">
                    {shownCols.map(id => {
                      const c = colDefs[id];
                      return <td key={id} className={`${td}${c.right ? ' text-right' : ''}${c.cellClass ? ` ${c.cellClass}` : ''}`} title={c.title?.(r)}>{c.cell(r)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">
          Reaction and since-report moves use split-adjusted daily closes (Alpaca IEX); today&apos;s bar is still in progress during market hours.
          A ~ before a date means it is estimated, not yet confirmed by the company. ⚠ means the report lands before the selected expiry.
        </p>
      </main>
    </div>
  );
}
