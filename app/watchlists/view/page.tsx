'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from '@/components/layout/Header';
import StockAnalysis from '@/components/stock/StockAnalysis';
import AddSymbolInput from '@/components/watchlists/AddSymbolInput';
import { getLevelDisplayName, isUsMarketHours } from '@/lib/utils';
import {
  type WatchlistSummary, type QuoteRow, type LevelRow, type LevelKey, LEVEL_FILTER_OPTIONS,
  rebaseToLtp, fmtExpiry, fmtPrice, ChangeCell, ChangePercentCell, ChangeDot, LevelCell,
} from '@/components/watchlists/watchlistShared';

type SortKey = 'symbol' | 'lastPrice' | 'change' | 'changePercent' | 'level';

// Starting widths (px) sized so all five columns fit the 460px panel with no
// horizontal scrollbar; the user can drag any header edge to rebalance them.
const DEFAULT_COL_WIDTHS: Record<SortKey, number> = { symbol: 66, lastPrice: 78, change: 82, changePercent: 70, level: 140 };
const REMOVE_COL_WIDTH = 28;
const MIN_COL_WIDTH = 44;
const COL_WIDTHS_STORAGE_KEY = 'watchlistWChart.colWidths';

function loadColWidths(): Record<SortKey, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(COL_WIDTHS_STORAGE_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      const merged = { ...DEFAULT_COL_WIDTHS };
      (Object.keys(merged) as SortKey[]).forEach(k => {
        if (typeof saved[k] === 'number' && saved[k] >= MIN_COL_WIDTH) merged[k] = saved[k];
      });
      return merged;
    }
  } catch { /* storage unavailable or corrupt — fall back to defaults */ }
  return { ...DEFAULT_COL_WIDTHS };
}

const labelClass = 'block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1';
const controlClass = 'w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white';

function Spinner() {
  return <div className="inline-block animate-spin h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent rounded-full" />;
}

/** How long arrow-key browsing must pause before the chart loads the highlighted symbol. */
const KEY_NAV_CHART_DELAY_MS = 300;

function SortHeader({ label, active, dir, align = 'left', onClick }: {
  label: string; active: boolean; dir: 'asc' | 'desc'; align?: 'left' | 'right'; onClick: () => void;
}) {
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

// Split view: the stock chart for whichever symbol is picked on the left, a
// compact watchlist table to drive it on the right. Same data routes as the
// full /watchlists page — this is a different arrangement, not new data.
export default function WatchlistViewPage() {
  const [lists, setLists] = useState<WatchlistSummary[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [rows, setRows] = useState<QuoteRow[] | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [levelRows, setLevelRows] = useState<LevelRow[] | null>(null);
  const [monthlyExpiries, setMonthlyExpiries] = useState<string[] | null>(null);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<LevelKey | ''>('');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [symbol, setSymbol] = useState<string | null>(null);
  const [newListName, setNewListName] = useState('');
  const [busy, setBusy] = useState(false);
  const [colWidths, setColWidths] = useState<Record<SortKey, number>>(DEFAULT_COL_WIDTHS);
  const dragRef = useRef<{ key: SortKey; startX: number; startWidth: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = lists.find(l => l.id === selectedId) ?? null;
  const custom = lists.filter(l => !l.isSystem);
  const system = lists.filter(l => l.isSystem);
  const canEdit = !!selected && !selected.isSystem;

  const levelBySymbol = useMemo(() => {
    const price = new Map((rows ?? []).map(r => [r.symbol, r.lastPrice]));
    return new Map((levelRows ?? []).map(l => [l.symbol, rebaseToLtp(l, price.get(l.symbol))]));
  }, [rows, levelRows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toUpperCase();
    const filtered = (rows ?? []).filter(r => {
      if (q && !r.symbol.includes(q) && !r.name.toUpperCase().includes(q)) return false;
      if (levelFilter && levelBySymbol.get(r.symbol)?.closestLevel !== levelFilter) return false;
      return true;
    });
    if (!sortKey) return filtered;

    const value = (r: QuoteRow): number | string | null => {
      switch (sortKey) {
        case 'symbol': return r.symbol;
        case 'lastPrice': return r.lastPrice;
        case 'change': return r.change;
        case 'changePercent': return r.changePercent;
        case 'level': {
          const pct = levelBySymbol.get(r.symbol)?.distancePercent;
          return pct == null ? null : Math.abs(pct);
        }
      }
    };
    return [...filtered].sort((a, b) => {
      const av = value(a), bv = value(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // missing values always sort last, either direction
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, search, levelFilter, levelBySymbol, sortKey, sortDir]);

  // Read saved widths after mount (not in the initial state) so server and
  // client render the same markup.
  useEffect(() => { setColWidths(loadColWidths()); }, []);

  function persistColWidths(widths: Record<SortKey, number>) {
    try { localStorage.setItem(COL_WIDTHS_STORAGE_KEY, JSON.stringify(widths)); } catch { /* ignore */ }
  }

  function startResize(e: React.PointerEvent<HTMLDivElement>, key: SortKey) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { key, startX: e.clientX, startWidth: colWidths[key] };
  }
  function moveResize(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const width = Math.max(MIN_COL_WIDTH, Math.round(drag.startWidth + e.clientX - drag.startX));
    setColWidths(prev => ({ ...prev, [drag.key]: width }));
  }
  function endResize(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setColWidths(prev => { persistColWidths(prev); return prev; });
  }
  function resetColWidth(key: SortKey) {
    setColWidths(prev => {
      const next = { ...prev, [key]: DEFAULT_COL_WIDTHS[key] };
      persistColWidths(next);
      return next;
    });
  }

  // Drag handle on a header cell's right edge. Double-click resets the column.
  function resizeHandle(key: SortKey) {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${key} column`}
        title="Drag to resize · double-click to reset"
        onPointerDown={e => startResize(e, key)}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDoubleClick={() => resetColWidth(key)}
        onClick={e => e.stopPropagation()}
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none select-none after:absolute after:right-0.5 after:top-1/4 after:h-1/2 after:w-px after:bg-gray-300 hover:after:bg-blue-500 hover:after:w-0.5"
      />
    );
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  const refreshLists = useCallback(async (keepSelection: boolean) => {
    const res = await fetch('/api/watchlists');
    const json = await res.json();
    setListsLoading(false);
    if (!json.success) return;
    const fresh: WatchlistSummary[] = json.data.watchlists;
    setLists(fresh);
    setSelectedId(prev => (keepSelection && fresh.some(l => l.id === prev) ? prev : fresh[0]?.id ?? ''));
  }, []);

  useEffect(() => { refreshLists(false); }, [refreshLists]);

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

  // `silent` = background poll: no spinner, and a failed poll leaves the last
  // good rows on screen instead of blanking the table.
  const loadRows = useCallback(async (id: string, silent = false) => {
    if (!silent) setRowsLoading(true);
    try {
      const res = await fetch(`/api/watchlists/${id}/quotes`);
      const json = await res.json();
      if (json.success) setRows(json.data.rows);
      else if (!silent) setRows([]);
    } catch {
      if (!silent) setRows([]);
    } finally {
      if (!silent) setRowsLoading(false);
    }
  }, []);

  const loadLevels = useCallback(async (id: string, expiry: string) => {
    const res = await fetch(`/api/watchlists/${id}/levels${expiry ? `?expiry=${encodeURIComponent(expiry)}` : ''}`);
    const json = await res.json();
    setLevelRows(json.success ? json.data.rows : []);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setRows(null);
    loadRows(selectedId);
  }, [selectedId, loadRows]);

  // Gated on monthlyExpiries !== null so it doesn't wait forever on a
  // selection that may never come — see the same note on /watchlists.
  useEffect(() => {
    if (selectedId && monthlyExpiries !== null) loadLevels(selectedId, selectedExpiry);
  }, [selectedId, selectedExpiry, monthlyExpiries, loadLevels]);

  // Keep prices live: fast while the market is open, slow otherwise.
  useEffect(() => {
    if (!selectedId) return;
    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;
    function schedule() {
      timeoutId = setTimeout(async () => {
        await loadRows(selectedId, true);
        if (!cancelled) schedule();
      }, isUsMarketHours(new Date()) ? 30_000 : 5 * 60_000);
    }
    schedule();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [selectedId, loadRows]);

  // Chart follows the table: default to the first row, and fall back to it if
  // the shown symbol is no longer in the list (list switched / symbol removed).
  useEffect(() => {
    if (!rows) return;
    if (rows.length === 0) { setSymbol(null); return; }
    setSymbol(prev => (prev && rows.some(r => r.symbol === prev) ? prev : rows[0].symbol));
  }, [rows]);

  // The chart trails the highlighted row. Clicks load it straight away;
  // arrow-key moves wait until the keys settle, so holding ↓ through ten rows
  // mounts one chart instead of ten (each mount fetches levels history, which
  // is rate limited to LEVEL_RANGE_RATE per user).
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const keyNavRef = useRef(false);
  useEffect(() => {
    if (!keyNavRef.current) { setChartSymbol(symbol); return; }
    keyNavRef.current = false;
    const t = setTimeout(() => setChartSymbol(symbol), KEY_NAV_CHART_DELAY_MS);
    return () => clearTimeout(t);
  }, [symbol]);

  // ↑/↓ step through the table in its current filtered + sorted order.
  // Ignored while typing (search, add-symbol, list name, selects) or with a
  // modifier held, so it never steals keys from a form control.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (visibleRows.length === 0) return;
      e.preventDefault();
      const i = visibleRows.findIndex(r => r.symbol === symbol);
      const next = i === -1
        ? (e.key === 'ArrowDown' ? 0 : visibleRows.length - 1)
        : Math.min(visibleRows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (next === i) return;
      keyNavRef.current = true;
      setSymbol(visibleRows[next].symbol);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visibleRows, symbol]);

  // Keep the highlighted row visible inside the table's own scroll box (not
  // the page), clear of the sticky header. A no-op for clicked rows.
  const tableScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = tableScrollRef.current;
    if (!box || !symbol) return;
    const row = box.querySelector<HTMLElement>(`tr[data-symbol="${CSS.escape(symbol)}"]`);
    if (!row) return;
    const headerHeight = box.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    const boxRect = box.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < boxRect.top + headerHeight) box.scrollTop -= boxRect.top + headerHeight - rowRect.top;
    else if (rowRect.bottom > boxRect.bottom) box.scrollTop += rowRect.bottom - boxRect.bottom;
  }, [symbol]);

  // Same POST the /watchlists page uses, so a list created here shows up
  // there (and vice versa) — both read the one watchlists table.
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
    if (!json.success) { setError(json.error ?? 'Could not create watchlist.'); return; }
    setNewListName('');
    await refreshLists(false);
    setSelectedId(String(json.data.watchlist.id));
  }

  async function handleAddSymbol(sym: string) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/watchlists/${selected.id}/items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.success) { setError(json.error ?? 'Could not add symbol.'); return; }
    await Promise.all([loadRows(selected.id), loadLevels(selected.id, selectedExpiry), refreshLists(true)]);
  }

  async function handleRemoveSymbol(sym: string) {
    if (!selected) return;
    await fetch(`/api/watchlists/${selected.id}/items?symbol=${encodeURIComponent(sym)}`, { method: 'DELETE' });
    await Promise.all([loadRows(selected.id), loadLevels(selected.id, selectedExpiry), refreshLists(true)]);
  }

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

  const colSpan = 5 + (canEdit ? 1 : 0);
  const th = 'px-2 py-1.5';
  const COLUMN_ORDER: SortKey[] = ['symbol', 'lastPrice', 'change', 'changePercent', 'level'];
  const tableWidth = COLUMN_ORDER.reduce((sum, k) => sum + colWidths[k], 0) + (canEdit ? REMOVE_COL_WIDTH : 0);

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-[1800px] px-4 pt-3 pb-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_460px] items-stretch">
          {/* Left — chart for the picked symbol */}
          <div className="min-w-0">
            {chartSymbol ? (
              <StockAnalysis key={chartSymbol} symbol={chartSymbol} embedded />
            ) : (
              <div className="bg-white rounded-lg shadow-md p-10 text-center text-sm text-gray-400">
                {rows === null ? <><Spinner /> <span className="ml-2">Loading…</span></> : 'Add a symbol to this watchlist to see its chart.'}
              </div>
            )}
          </div>

          {/* Right — watchlist table */}
          {/* On lg the panel's content is absolutely positioned inside the
              aside, so it adds nothing to the row's height: the chart column
              (fixed chart height) alone sets it, the panel stretches to match,
              and the table scrolls inside however many symbols the list has. */}
          <aside className="relative bg-white rounded-lg shadow-md min-w-0">
            <div className="flex flex-col lg:absolute lg:inset-0">
            <div className="px-3 pt-3 pb-2 border-b border-gray-100 shrink-0">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="text-lg font-bold text-gray-900">Watchlists</h2>
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  {rows && `${visibleRows.length !== rows.length ? `${visibleRows.length} of ${rows.length}` : rows.length} symbols`}
                  {visibleRows.length > 1 && (
                    <span className="hidden lg:inline" title="Use the ↑ and ↓ arrow keys to move through the list">· ↑↓ to browse</span>
                  )}
                  <button
                    onClick={() => selectedId && (loadRows(selectedId), loadLevels(selectedId, selectedExpiry))}
                    disabled={rowsLoading}
                    title="Refresh quotes"
                    aria-label="Refresh quotes"
                    className="text-gray-400 hover:text-blue-600 disabled:opacity-40 transition-colors"
                  >
                    {rowsLoading ? <Spinner /> : '↻'}
                  </button>
                </div>
              </div>

              <select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                aria-label="Watchlist"
                className={`${controlClass} font-semibold mb-2`}
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

              <form onSubmit={handleCreate} className="flex gap-1.5 mb-2">
                <input
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                  placeholder="New watchlist name…"
                  aria-label="New watchlist name"
                  className={controlClass}
                />
                <button
                  type="submit"
                  disabled={busy || !newListName.trim()}
                  className="shrink-0 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
                >
                  + New
                </button>
              </form>

              <div className="grid grid-cols-3 gap-2">
                {monthlyExpiries !== null && monthlyExpiries.length > 0 ? (
                  <div>
                    <label className={labelClass}>Expiry</label>
                    <select value={selectedExpiry} onChange={e => setSelectedExpiry(e.target.value)} className={controlClass}>
                      {monthlyExpiries.map(d => <option key={d} value={d}>{fmtExpiry(d)}</option>)}
                    </select>
                  </div>
                ) : <div />}
                <div>
                  <label className={labelClass}>Search</label>
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Symbol or name…" className={controlClass} />
                </div>
                <div>
                  <label className={labelClass}>Level</label>
                  <select value={levelFilter} onChange={e => setLevelFilter(e.target.value as LevelKey | '')} className={controlClass}>
                    <option value="">All levels</option>
                    {LEVEL_FILTER_OPTIONS.map(l => <option key={l} value={l}>{getLevelDisplayName(l)}</option>)}
                  </select>
                </div>
              </div>
              {error && <p className="text-[11px] text-red-600 mt-2">{error}</p>}
            </div>

            {/* Scrolls inside the panel; header row sticks to the top. */}
            <div ref={tableScrollRef} className="overflow-auto flex-1 min-h-0 max-h-[60vh] lg:max-h-none">
              <table className="text-xs" style={{ tableLayout: 'fixed', width: tableWidth }}>
                <colgroup>
                  {COLUMN_ORDER.map(k => <col key={k} style={{ width: colWidths[k] }} />)}
                  {canEdit && <col style={{ width: REMOVE_COL_WIDTH }} />}
                </colgroup>
                <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-gray-50 [&_th]:shadow-[inset_0_-1px_0_0_#f3f4f6]">
                  <tr className="text-left text-[10px] font-semibold text-gray-500 uppercase">
                    <th className={`${th} relative`}><SortHeader label="Symbol" active={sortKey === 'symbol'} dir={sortDir} onClick={() => toggleSort('symbol')} />{resizeHandle('symbol')}</th>
                    <th className={`${th} text-right relative`}><SortHeader label="Last Price" align="right" active={sortKey === 'lastPrice'} dir={sortDir} onClick={() => toggleSort('lastPrice')} />{resizeHandle('lastPrice')}</th>
                    <th className={`${th} text-right relative`}><SortHeader label="Change" align="right" active={sortKey === 'change'} dir={sortDir} onClick={() => toggleSort('change')} />{resizeHandle('change')}</th>
                    <th className={`${th} text-right relative`}><SortHeader label="Chg %" align="right" active={sortKey === 'changePercent'} dir={sortDir} onClick={() => toggleSort('changePercent')} />{resizeHandle('changePercent')}</th>
                    <th className={`${th} text-right relative`}><SortHeader label="Nearest Level" align="right" active={sortKey === 'level'} dir={sortDir} onClick={() => toggleSort('level')} />{resizeHandle('level')}</th>
                    {canEdit && <th className={th}></th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(r => {
                    const isSelected = symbol === r.symbol;
                    return (
                      <tr
                        key={r.symbol}
                        data-symbol={r.symbol}
                        onClick={() => setSymbol(r.symbol)}
                        aria-selected={isSelected}
                        className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-blue-50/40'}`}
                      >
                        <td className={`${th} overflow-hidden`} title={r.name}>
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <ChangeDot change={r.change} />
                            <span className="font-semibold text-gray-900">{r.symbol}</span>
                          </div>
                        </td>
                        <td className={`${th} text-right font-semibold text-gray-800 tabular-nums overflow-hidden`}>{fmtPrice(r.lastPrice)}</td>
                        <td className={`${th} text-right overflow-hidden`}><ChangeCell change={r.change} /></td>
                        <td className={`${th} text-right overflow-hidden`}><ChangePercentCell changePercent={r.changePercent} /></td>
                        <td className={`${th} overflow-hidden`}><LevelCell level={levelBySymbol.get(r.symbol)} compact /></td>
                        {canEdit && (
                          <td className={`${th} text-right`}>
                            <button
                              onClick={e => { e.stopPropagation(); handleRemoveSymbol(r.symbol); }}
                              title={`Remove ${r.symbol}`}
                              aria-label={`Remove ${r.symbol}`}
                              className="text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-full w-5 h-5 leading-none transition-colors"
                            >
                              ×
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {rowsLoading && !rows && (
                    <tr><td colSpan={colSpan} className="text-center text-gray-400 py-8"><Spinner /> <span className="ml-2">Loading quotes…</span></td></tr>
                  )}
                  {rows?.length === 0 && (
                    <tr><td colSpan={colSpan} className="text-center text-gray-400 py-8">No symbols in this watchlist yet.</td></tr>
                  )}
                  {rows && rows.length > 0 && visibleRows.length === 0 && (
                    <tr><td colSpan={colSpan} className="text-center text-gray-400 py-8">No symbols match your filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {canEdit && (
              <div className="p-3 border-t border-gray-100 bg-gray-50/50 shrink-0">
                <AddSymbolInput onSelect={handleAddSymbol} disabled={busy} placeholder="+ add symbol (e.g. AAPL)" />
              </div>
            )}
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
