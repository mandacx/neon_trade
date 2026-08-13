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
        className="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded"
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

  async function loadRows(id: string) {
    setRowsLoading(true);
    const res = await fetch(`/api/watchlists/${id}/quotes`);
    const json = await res.json();
    setRowsLoading(false);
    setRows(json.success ? json.data.rows : []);
  }

  async function loadLevels(id: string) {
    const res = await fetch(`/api/watchlists/${id}/levels`);
    const json = await res.json();
    setLevelRows(json.success ? json.data.rows : []);
  }

  useEffect(() => {
    if (selectedId) {
      loadRows(selectedId);
      loadLevels(selectedId);
    }
  }, [selectedId]);

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
    await Promise.all([loadRows(selected.id), loadLevels(selected.id), refreshLists(true)]);
  }

  async function handleRemoveSymbol(symbol: string) {
    if (!selected) return;
    await fetch(`/api/watchlists/${selected.id}/items?symbol=${encodeURIComponent(symbol)}`, { method: 'DELETE' });
    await Promise.all([loadRows(selected.id), loadLevels(selected.id), refreshLists(true)]);
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

          {/* Toolbar */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">View</label>
                <select
                  value={selectedId}
                  onChange={e => setSelectedId(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white min-w-[240px]"
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
                  <span className="text-[11px] text-gray-400">{rows?.length ?? selected?.symbolCount ?? 0} symbols</span>
                  <button
                    onClick={() => selectedId && (loadRows(selectedId), loadLevels(selectedId))}
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
                  <th className={cellPad}>Symbol</th>
                  <th className={`${cellPad} text-right`}>Last Price</th>
                  <th className={`${cellPad} text-right`}>Change</th>
                  {visibleCols.has('open') && <th className={`${cellPad} text-right`}>Open</th>}
                  {visibleCols.has('dayLow') && <th className={`${cellPad} text-right`}>Day Low</th>}
                  {visibleCols.has('dayHigh') && <th className={`${cellPad} text-right`}>Day High</th>}
                  {visibleCols.has('volume') && <th className={`${cellPad} text-right`}>Volume</th>}
                  {visibleCols.has('level') && <th className={`${cellPad} text-right`}>Nearest Level</th>}
                  {canEdit && <th className={cellPad}></th>}
                </tr>
              </thead>
              <tbody>
                {rows?.map(r => (
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
            {selectedId && <AlertsWidget watchlistId={selectedId} />}
          </div>
          </div>
        </div>
      </div>
    </>
  );
}
