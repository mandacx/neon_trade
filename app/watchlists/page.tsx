'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import AddSymbolInput from '@/components/watchlists/AddSymbolInput';
import AlertsWidget from '@/components/watchlists/AlertsWidget';
import { formatCurrency, getLevelColor, getLevelDisplayName } from '@/lib/utils';

interface WatchlistSummary { id: string; name: string; isSystem: boolean; symbolCount: number }
interface QuoteRow {
  symbol: string;
  name: string;
  lastPrice: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
}
interface LevelRow {
  symbol: string;
  expiryDate: string;
  tradeDate: string;
  closestLevel: 'put_low' | 'put_int' | 'put_call_int' | 'call_int' | 'call_high' | null;
  closestPrice: number | null;
  distance: number | null;
  distancePercent: number | null;
  levelAccess: 'latest' | 'delayed';
  requiredFeature: string | null;
}

type DirectionFilter = 'all' | 'up' | 'down';
type LevelKey = 'put_low' | 'put_int' | 'put_call_int' | 'call_int' | 'call_high';
const LEVEL_FILTER_OPTIONS: LevelKey[] = ['call_high', 'call_int', 'put_call_int', 'put_int', 'put_low'];

type SortKey = 'symbol' | 'lastPrice' | 'change' | 'open' | 'dayLow' | 'dayHigh' | 'volume' | 'level';

function fmtExpiry(dateStr: string): string {
  try {
    return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

type ColumnKey = 'open' | 'dayLow' | 'dayHigh' | 'volume' | 'level';
const OPTIONAL_COLUMNS: Array<{ key: ColumnKey; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'dayLow', label: 'Day Low' },
  { key: 'dayHigh', label: 'Day High' },
  { key: 'volume', label: 'Volume' },
  { key: 'level', label: 'Nearest Level' },
];

const inputClass = "px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white";

function fmtPrice(v: number | null): string {
  return v == null ? '—' : formatCurrency(v);
}
function fmtVolume(v: number | null): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

function ChangeCell({ change, changePercent }: { change: number | null; changePercent: number | null }) {
  if (change == null) return <span className="text-xs text-gray-300">—</span>;
  const positive = change > 0;
  const negative = change < 0;
  const tone = positive ? 'bg-green-50 text-green-700' : negative ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums whitespace-nowrap ${tone}`}>
      {positive && '▲'}{negative && '▼'} {positive ? '+' : ''}{formatCurrency(change)}
      {changePercent != null && (
        <span className="opacity-70">({positive ? '+' : ''}{changePercent.toFixed(2)}%)</span>
      )}
    </span>
  );
}

function ChangeDot({ change }: { change: number | null }) {
  const color = change == null ? 'bg-gray-300' : change > 0 ? 'bg-green-500' : change < 0 ? 'bg-red-500' : 'bg-gray-300';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />;
}

function Spinner() {
  return <div className="inline-block animate-spin h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent rounded-full" />;
}

function SortHeader({ label, active, dir, align = 'left', onClick }: { label: string; active: boolean; dir: 'asc' | 'desc'; align?: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 hover:text-gray-700 transition-colors ${align === 'right' ? 'justify-end w-full' : ''}`}
    >
      {label}
      <span className={active ? 'text-blue-600' : 'text-gray-300'}>{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </button>
  );
}

function LevelCell({ level }: { level: LevelRow | undefined }) {
  if (!level) return <span className="text-xs text-gray-300">—</span>;
  if (!level.closestLevel) {
    return level.levelAccess === 'delayed' ? (
      <Link
        href={`/upgrade${level.requiredFeature ? `?feature=${level.requiredFeature}` : ''}`}
        className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 hover:bg-amber-100"
      >
        Delayed
      </Link>
    ) : (
      <span className="text-xs text-gray-300">—</span>
    );
  }
  const color = getLevelColor(level.closestLevel);
  return (
    <div className="text-right">
      <span
        className="inline-block text-xs font-bold px-1.5 py-0.5 rounded"
        style={{ backgroundColor: `${color}1A`, color }}
      >
        {getLevelDisplayName(level.closestLevel)}
      </span>
      <div className="text-[11px] text-gray-500 tabular-nums mt-0.5">
        {formatCurrency(level.closestPrice ?? 0)} · {level.distance?.toFixed(2)} · {level.distancePercent?.toFixed(2)}%
      </div>
      <div className="text-[10px] text-gray-400 mt-0.5">
        Exp {level.expiryDate} · Report {level.tradeDate}
      </div>
    </div>
  );
}

export default function WatchlistsPage() {
  const [lists, setLists] = useState<WatchlistSummary[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [rows, setRows] = useState<QuoteRow[] | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [levelRows, setLevelRows] = useState<LevelRow[] | null>(null);
  // Monthly (3rd-Friday) expiries available across the data, and the one
  // currently selected — null while still loading, [] if none are available
  // (in which case selectedExpiry stays '' and the levels/alerts routes fall
  // back to their own per-symbol "nearest future expiry" behavior).
  const [monthlyExpiries, setMonthlyExpiries] = useState<string[] | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [search, setSearch] = useState('');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [levelFilter, setLevelFilter] = useState<LevelKey | ''>('');
  const [proximityEnabled, setProximityEnabled] = useState(false);
  const [proximityThreshold, setProximityThreshold] = useState(5);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [condensed, setCondensed] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(new Set(OPTIONAL_COLUMNS.map(c => c.key)));
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [newListName, setNewListName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = lists.find(l => l.id === selectedId) ?? null;
  const custom = lists.filter(l => !l.isSystem);
  const system = lists.filter(l => l.isSystem);
  const cellPad = condensed ? 'px-3 py-1' : 'px-4 py-2.5';
  const canEdit = !!selected && !selected.isSystem;
  const levelBySymbol = new Map((levelRows ?? []).map(l => [l.symbol, l]));

  const visibleRows = (rows ?? []).filter(r => {
    const q = search.trim().toUpperCase();
    if (q && !r.symbol.includes(q) && !r.name.toUpperCase().includes(q)) return false;
    if (directionFilter === 'up' && !((r.change ?? 0) > 0)) return false;
    if (directionFilter === 'down' && !((r.change ?? 0) < 0)) return false;
    if (levelFilter && levelBySymbol.get(r.symbol)?.closestLevel !== levelFilter) return false;
    if (proximityEnabled) {
      const distancePercent = levelBySymbol.get(r.symbol)?.distancePercent;
      if (distancePercent == null || Math.abs(distancePercent) > proximityThreshold) return false;
    }
    return true;
  });

  function sortValue(r: QuoteRow, key: SortKey): number | string | null {
    switch (key) {
      case 'symbol': return r.symbol;
      case 'lastPrice': return r.lastPrice;
      case 'change': return r.change;
      case 'open': return r.open;
      case 'dayLow': return r.dayLow;
      case 'dayHigh': return r.dayHigh;
      case 'volume': return r.volume;
      case 'level': {
        const pct = levelBySymbol.get(r.symbol)?.distancePercent;
        return pct == null ? null : Math.abs(pct);
      }
    }
  }

  const sortedRows = sortKey ? [...visibleRows].sort((a, b) => {
    const av = sortValue(a, sortKey);
    const bv = sortValue(b, sortKey);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // missing values always sort to the end, regardless of direction
    if (bv == null) return -1;
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDir === 'asc' ? cmp : -cmp;
  }) : visibleRows;

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  async function refreshLists(keepSelection: boolean) {
    const res = await fetch('/api/watchlists');
    const json = await res.json();
    setListsLoading(false);
    if (!json.success) return;
    const fresh: WatchlistSummary[] = json.data.watchlists;
    setLists(fresh);
    if (!keepSelection || !fresh.some(l => l.id === selectedId)) {
      setSelectedId(fresh[0]?.id ?? '');
    }
  }

  useEffect(() => { refreshLists(false); }, []);

  // Monthly expiries are global (independent of which watchlist is
  // selected), so this fetches once and defaults the toggle to the earliest
  // upcoming one rather than re-resolving per watchlist switch.
  useEffect(() => {
    fetch('/api/watchlists/expiry-dates')
      .then(res => res.json())
      .then(json => {
        const list: string[] = json.success ? json.data.monthlyExpiries : [];
        setMonthlyExpiries(list);
        if (list.length > 0) setSelectedExpiry(list[0]);
      })
      .catch(() => setMonthlyExpiries([]));
  }, []);

  async function loadRows(id: string) {
    setRowsLoading(true);
    const res = await fetch(`/api/watchlists/${id}/quotes`);
    const json = await res.json();
    setRowsLoading(false);
    setRows(json.success ? json.data.rows : []);
  }

  async function loadLevels(id: string, expiry: string) {
    const url = `/api/watchlists/${id}/levels${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ''}`;
    const res = await fetch(url);
    const json = await res.json();
    setLevelRows(json.success ? json.data.rows : []);
  }

  useEffect(() => {
    if (selectedId) loadRows(selectedId);
  }, [selectedId]);

  // Gated on monthlyExpiries !== null (not just selectedExpiry) so this
  // doesn't deadlock waiting for a selection that may never come (e.g. no
  // monthly expiries currently in the data) — an empty selectedExpiry just
  // means "no expiry param", falling back to each symbol's own nearest.
  useEffect(() => {
    if (selectedId && monthlyExpiries !== null) loadLevels(selectedId, selectedExpiry);
  }, [selectedId, selectedExpiry, monthlyExpiries]);

  useEffect(() => {
    setNameInput(selected?.name ?? '');
    setRenaming(false);
  }, [selected?.id]);

  function toggleCol(key: ColumnKey) {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newListName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/watchlists', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.success) { setError(json.error); return; }
    setNewListName('');
    await refreshLists(false);
    setSelectedId(String(json.data.watchlist.id));
  }

  async function handleRename() {
    const name = nameInput.trim();
    if (!selected || !name || name === selected.name) { setRenaming(false); return; }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/watchlists/${selected.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.success) { setError(json.error); return; }
    setRenaming(false);
    await refreshLists(true);
  }

  async function handleDelete() {
    if (!selected || !confirm(`Delete "${selected.name}"? This can't be undone.`)) return;
    await fetch(`/api/watchlists/${selected.id}`, { method: 'DELETE' });
    await refreshLists(false);
  }

  async function handleAddSymbol(symbol: string) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/watchlists/${selected.id}/items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.success) { setError(json.error ?? 'Could not add symbol.'); return; }
    await Promise.all([loadRows(selected.id), loadLevels(selected.id, selectedExpiry), refreshLists(true)]);
  }

  async function handleRemoveSymbol(symbol: string) {
    if (!selected) return;
    await fetch(`/api/watchlists/${selected.id}/items?symbol=${encodeURIComponent(symbol)}`, { method: 'DELETE' });
    await Promise.all([loadRows(selected.id), loadLevels(selected.id, selectedExpiry), refreshLists(true)]);
  }

  const colSpan = 3 + visibleCols.size + (canEdit ? 1 : 0);

  if (listsLoading) {
    return (
      <>
        <Header />
        <div className="min-h-screen bg-gray-50 flex items-center justify-center gap-2 text-sm text-gray-400">
          <Spinner /> Loading watchlists…
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="container mx-auto px-4 py-6">
          <div className="mb-5">
            <h1 className="text-xl font-bold text-gray-900">Watchlists</h1>
            <p className="text-xs text-gray-400 mt-0.5">Live prices for your own lists, plus curated sector and index lists.</p>
          </div>

          {/* Toolbar — one merged row of controls (wraps naturally on narrow screens) */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">View</label>
                  <select
                    value={selectedId}
                    onChange={e => setSelectedId(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white min-w-[220px]"
                  >
                    {custom.length > 0 && (
                      <optgroup label="My Watchlists">
                        {custom.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </optgroup>
                    )}
                    <optgroup label="Sectors & Indices">
                      {system.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </optgroup>
                  </select>
                </div>

                {monthlyExpiries !== null && monthlyExpiries.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Expiry</label>
                    <select
                      value={selectedExpiry}
                      onChange={e => setSelectedExpiry(e.target.value)}
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    >
                      {monthlyExpiries.map(d => <option key={d} value={d}>{fmtExpiry(d)}</option>)}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Search</label>
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Symbol or name…"
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white w-44"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Level</label>
                  <select
                    value={levelFilter}
                    onChange={e => setLevelFilter(e.target.value as LevelKey | '')}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  >
                    <option value="">All levels</option>
                    {LEVEL_FILTER_OPTIONS.map(l => <option key={l} value={l}>{getLevelDisplayName(l)}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Direction</label>
                  <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                    {(['all', 'up', 'down'] as DirectionFilter[]).map(d => (
                      <button
                        key={d}
                        onClick={() => setDirectionFilter(d)}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${directionFilter === d ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                      >
                        {d === 'all' ? 'All' : d === 'up' ? '▲ Gainers' : '▼ Losers'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1 cursor-pointer select-none">
                    <input type="checkbox" checked={proximityEnabled} onChange={e => setProximityEnabled(e.target.checked)} className="accent-blue-600" />
                    Near a level: {proximityThreshold}%
                  </label>
                  <input
                    type="range" min="1" max="20" step="0.5"
                    value={proximityThreshold}
                    disabled={!proximityEnabled}
                    onChange={e => setProximityThreshold(parseFloat(e.target.value))}
                    className="w-32 accent-blue-500 disabled:opacity-40 mb-2"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" checked={condensed} onChange={e => setCondensed(e.target.checked)} className="accent-blue-600" />
                  Condensed Table View
                </label>
                <div className="relative">
                  <button
                    onClick={() => setCustomizeOpen(v => !v)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                      <path fillRule="evenodd" d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.213 1.06a4.5 4.5 0 011.226.706l1.012-.464a1 1 0 011.226.464l.68 1.178a1 1 0 01-.226 1.263l-.842.706a4.5 4.5 0 010 1.416l.842.706a1 1 0 01.226 1.263l-.68 1.178a1 1 0 01-1.226.464l-1.012-.464a4.5 4.5 0 01-1.226.706l-.213 1.06a1 1 0 01-.98.804H9.32a1 1 0 01-.98-.804l-.213-1.06a4.5 4.5 0 01-1.226-.706l-1.012.464a1 1 0 01-1.226-.464l-.68-1.178a1 1 0 01.226-1.263l.842-.706a4.5 4.5 0 010-1.416l-.842-.706a1 1 0 01-.226-1.263l.68-1.178a1 1 0 011.226-.464l1.012.464c.376-.29.79-.53 1.226-.706l.213-1.06zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                    </svg>
                    Customize
                  </button>
                  {customizeOpen && (
                    <div className="absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg p-2 z-50">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase px-1 pb-1">Columns</p>
                      {OPTIONAL_COLUMNS.map(c => (
                        <label key={c.key} className="flex items-center gap-2 text-xs text-gray-700 px-1 py-1 hover:bg-gray-50 rounded cursor-pointer select-none">
                          <input type="checkbox" checked={visibleCols.has(c.key)} onChange={() => toggleCol(c.key)} className="accent-blue-600" />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 min-w-0">
          {/* Selected list management */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              {renaming ? (
                <>
                  <input className={inputClass} value={nameInput} onChange={e => setNameInput(e.target.value)} autoFocus />
                  <button onClick={handleRename} disabled={busy} className="text-xs font-semibold text-blue-600">Save</button>
                  <button onClick={() => setRenaming(false)} className="text-xs text-gray-400">Cancel</button>
                </>
              ) : (
                <>
                  <span className="font-semibold text-sm text-gray-900">{selected?.name}</span>
                  <span className="text-[11px] text-gray-400">
                    {rows && visibleRows.length !== rows.length
                      ? `${visibleRows.length} of ${rows.length} symbols`
                      : `${rows?.length ?? selected?.symbolCount ?? 0} symbols`}
                  </span>
                  <button
                    onClick={() => selectedId && (loadRows(selectedId), loadLevels(selectedId, selectedExpiry))}
                    disabled={rowsLoading}
                    title="Refresh quotes"
                    className="text-gray-400 hover:text-blue-600 disabled:opacity-40 transition-colors"
                  >
                    {rowsLoading ? <Spinner /> : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                        <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.311h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                  {canEdit && (
                    <>
                      <button onClick={() => setRenaming(true)} className="px-2 py-1 text-[11px] font-medium text-gray-600 border border-gray-200 rounded hover:bg-gray-50">Rename</button>
                      <button onClick={handleDelete} className="px-2 py-1 text-[11px] font-medium text-red-600 border border-gray-200 rounded hover:bg-red-50">Delete</button>
                    </>
                  )}
                  {selected?.isSystem && (
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Read-only</span>
                  )}
                </>
              )}
            </div>

            <form onSubmit={handleCreate} className="flex gap-1.5">
              <input
                value={newListName}
                onChange={e => setNewListName(e.target.value)}
                placeholder="New watchlist name…"
                className={inputClass}
              />
              <button type="submit" disabled={busy} className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors">
                + New
              </button>
            </form>
          </div>

          {error && <p className="text-[11px] text-red-600 mb-2">{error}</p>}

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                  <th className={cellPad}><SortHeader label="Symbol" active={sortKey === 'symbol'} dir={sortDir} onClick={() => toggleSort('symbol')} /></th>
                  <th className={`${cellPad} text-right`}><SortHeader label="Last Price" align="right" active={sortKey === 'lastPrice'} dir={sortDir} onClick={() => toggleSort('lastPrice')} /></th>
                  <th className={`${cellPad} text-right`}><SortHeader label="Change" align="right" active={sortKey === 'change'} dir={sortDir} onClick={() => toggleSort('change')} /></th>
                  {visibleCols.has('open') && <th className={`${cellPad} text-right`}><SortHeader label="Open" align="right" active={sortKey === 'open'} dir={sortDir} onClick={() => toggleSort('open')} /></th>}
                  {visibleCols.has('dayLow') && <th className={`${cellPad} text-right`}><SortHeader label="Day Low" align="right" active={sortKey === 'dayLow'} dir={sortDir} onClick={() => toggleSort('dayLow')} /></th>}
                  {visibleCols.has('dayHigh') && <th className={`${cellPad} text-right`}><SortHeader label="Day High" align="right" active={sortKey === 'dayHigh'} dir={sortDir} onClick={() => toggleSort('dayHigh')} /></th>}
                  {visibleCols.has('volume') && <th className={`${cellPad} text-right`}><SortHeader label="Volume" align="right" active={sortKey === 'volume'} dir={sortDir} onClick={() => toggleSort('volume')} /></th>}
                  {visibleCols.has('level') && <th className={`${cellPad} text-right`}><SortHeader label="Nearest Level" align="right" active={sortKey === 'level'} dir={sortDir} onClick={() => toggleSort('level')} /></th>}
                  {canEdit && <th className={cellPad}></th>}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(r => (
                  <tr key={r.symbol} className="border-b border-gray-50 hover:bg-blue-50/40 transition-colors">
                    <td className={cellPad}>
                      <Link href={`/stock/${encodeURIComponent(r.symbol)}`} className="flex items-center gap-1.5 hover:underline">
                        <ChangeDot change={r.change} />
                        <span className="font-semibold text-gray-900">{r.symbol}</span>
                      </Link>
                      <div className="text-[11px] text-gray-400 truncate max-w-[220px] pl-3">{r.name}</div>
                    </td>
                    <td className={`${cellPad} text-right font-semibold text-gray-800 tabular-nums`}>{fmtPrice(r.lastPrice)}</td>
                    <td className={`${cellPad} text-right`}><ChangeCell change={r.change} changePercent={r.changePercent} /></td>
                    {visibleCols.has('open') && <td className={`${cellPad} text-right text-gray-600 tabular-nums`}>{fmtPrice(r.open)}</td>}
                    {visibleCols.has('dayLow') && <td className={`${cellPad} text-right text-gray-600 tabular-nums`}>{fmtPrice(r.dayLow)}</td>}
                    {visibleCols.has('dayHigh') && <td className={`${cellPad} text-right text-gray-600 tabular-nums`}>{fmtPrice(r.dayHigh)}</td>}
                    {visibleCols.has('volume') && <td className={`${cellPad} text-right text-gray-600 tabular-nums`}>{fmtVolume(r.volume)}</td>}
                    {visibleCols.has('level') && <td className={cellPad}><LevelCell level={levelBySymbol.get(r.symbol)} /></td>}
                    {canEdit && (
                      <td className={`${cellPad} text-right`}>
                        <button
                          onClick={() => handleRemoveSymbol(r.symbol)}
                          title={`Remove ${r.symbol}`}
                          className="text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-full p-1 transition-colors leading-none"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 10-1.06-1.06L10 8.94 6.28 5.22z" />
                          </svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {rowsLoading && (
                  <tr><td colSpan={colSpan} className="text-center text-gray-400 py-8 text-xs"><Spinner /> <span className="ml-2">Loading quotes…</span></td></tr>
                )}
                {!rowsLoading && rows?.length === 0 && (
                  <tr><td colSpan={colSpan} className="text-center text-gray-400 py-8 text-xs">No symbols in this watchlist yet.</td></tr>
                )}
                {!rowsLoading && rows && rows.length > 0 && visibleRows.length === 0 && (
                  <tr><td colSpan={colSpan} className="text-center text-gray-400 py-8 text-xs">No symbols match your filters.</td></tr>
                )}
              </tbody>
            </table>

            {canEdit && (
              <div className="p-3 border-t border-gray-100 bg-gray-50/50">
                <AddSymbolInput onSelect={handleAddSymbol} disabled={busy} placeholder="+ add symbol (e.g. AAPL)" />
              </div>
            )}
          </div>
          </div>

          <div className="w-full lg:w-80 shrink-0">
            {selectedId && <AlertsWidget watchlistId={selectedId} expiry={selectedExpiry || undefined} />}
          </div>
          </div>
        </div>
      </div>
    </>
  );
}
