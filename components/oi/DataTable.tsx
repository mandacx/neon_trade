'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseHumanNumber } from '@/lib/format';
import ColumnsMenu from '@/components/ui/ColumnsMenu';
import { useColumnPrefs } from '@/components/ui/useColumnPrefs';
import ColRow from '@/components/ui/ColRow';

/**
 * Generic client-side table for the OI tracker: click-to-sort headers, a
 * filter popover per column (text "contains", numeric min/max that accepts
 * 1.5m / 2b, date from/to), a global search box, sticky header, "show more"
 * paging to keep the DOM small, and CSV export of the filtered rows.
 *
 * With `tableId` (lib/tableColumns.ts) it also gets a Columns menu whose choice is
 * saved per user. A column with an empty label (a row-action column) is always shown.
 */
export interface Column<T> {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date';
  value: (row: T) => string | number | null;
  render?: (row: T) => React.ReactNode;
  title?: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  filterable?: boolean;
  className?: string;
}

type Filter = { text?: string; min?: string; max?: string; from?: string; to?: string };

function isActive(f: Filter | undefined): boolean {
  return !!f && Object.values(f).some(v => v != null && v !== '');
}

function matches<T>(col: Column<T>, row: T, f: Filter): boolean {
  const v = col.value(row);
  if (col.type === 'text') {
    if (!f.text) return true;
    const terms = f.text.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
    return terms.length === 0 || terms.some(t => String(v ?? '').toLowerCase().includes(t));
  }
  if (col.type === 'date') {
    const s = v == null ? '' : String(v);
    if (f.from && (!s || s < f.from)) return false;
    if (f.to && (!s || s > f.to)) return false;
    return true;
  }
  const min = f.min ? parseHumanNumber(f.min) : null;
  const max = f.max ? parseHumanNumber(f.max) : null;
  if (min == null && max == null) return true;
  if (v == null || !Number.isFinite(Number(v))) return false;
  if (min != null && Number(v) < min) return false;
  if (max != null && Number(v) > max) return false;
  return true;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const inputCls = 'w-full px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400';

function FilterPopover<T>({ col, filter, onChange, onClose }: { col: Column<T>; filter: Filter; onChange: (f: Filter) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [onClose]);
  return (
    <div ref={ref} onClick={e => e.stopPropagation()}
      className="absolute z-30 top-full mt-1 left-0 w-48 bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-left normal-case tracking-normal font-normal">
      <div className="text-[11px] font-semibold text-gray-600 mb-1.5">Filter: {col.label}</div>
      {col.type === 'text' && (
        <input autoFocus value={filter.text ?? ''} onChange={e => onChange({ text: e.target.value })} placeholder="contains… (a, b = either)" className={inputCls} />
      )}
      {col.type === 'number' && (
        <div className="flex gap-1">
          <input autoFocus value={filter.min ?? ''} onChange={e => onChange({ ...filter, min: e.target.value })} placeholder="min (1.5m)" className={inputCls} />
          <input value={filter.max ?? ''} onChange={e => onChange({ ...filter, max: e.target.value })} placeholder="max" className={inputCls} />
        </div>
      )}
      {col.type === 'date' && (
        <div className="flex flex-col gap-1">
          <input type="date" value={filter.from ?? ''} onChange={e => onChange({ ...filter, from: e.target.value })} className={inputCls} aria-label="From" />
          <input type="date" value={filter.to ?? ''} onChange={e => onChange({ ...filter, to: e.target.value })} className={inputCls} aria-label="To" />
        </div>
      )}
      <div className="flex justify-between mt-2">
        <button onClick={() => onChange({})} className="text-[11px] text-gray-500 hover:text-gray-800">Clear</button>
        <button onClick={onClose} className="text-[11px] font-semibold text-blue-600 hover:text-blue-800">Done</button>
      </div>
    </div>
  );
}

export default function DataTable<T>({
  rows, columns: allColumns, rowKey, initialSort, onRowClick, rowClassName, toolbar, emptyText = 'No rows match.', csvName, tableId,
  maxHeight = '70vh', pageSize = 200, searchPlaceholder = 'Search all columns…', dense = true, stickyFirst = false,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  toolbar?: React.ReactNode;
  emptyText?: string;
  csvName?: string;
  maxHeight?: string;
  pageSize?: number;
  searchPlaceholder?: string;
  dense?: boolean;
  /** Enables the Columns menu and saves the user's choice under this table id. */
  tableId?: string;
  /** Keep the first column (e.g. the symbol) visible while the table scrolls sideways. */
  stickyFirst?: boolean;
}) {
  const metas = allColumns.filter(c => c.label).map(c => ({ id: c.key, label: c.label, hint: c.title }));
  const prefs = useColumnPrefs(tableId ?? null, metas);
  const columns = useMemo(() => {
    if (!tableId) return allColumns;
    const shown = allColumns.filter(c => !c.label || prefs.isShown(c.key));
    // Labelled columns follow the user's order; unlabelled ones keep their place.
    const labelled = shown.filter(c => c.label).sort((a, b) => prefs.order.indexOf(a.key) - prefs.order.indexOf(b.key));
    return shown.map(c => (c.label ? labelled.shift()! : c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, allColumns, prefs.menu.hidden, prefs.order]);
  const layout = tableId ? prefs.layout : undefined;

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, Filter>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);
  const [shown, setShown] = useState(pageSize);

  useEffect(() => { setShown(pageSize); }, [rows, search, filters, sort, pageSize]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const active = columns.filter(c => isActive(filters[c.key]));
    return rows.filter(r => {
      if (q && !columns.some(c => String(c.value(r) ?? '').toLowerCase().includes(q))) return false;
      return active.every(c => matches(c, r, filters[c.key]));
    });
  }, [rows, columns, search, filters]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = allColumns.find(c => c.key === sort.key);
    if (!col) return filtered;
    const mul = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // nulls last either way
      if (vb == null) return -1;
      if (col.type === 'number') return (Number(va) - Number(vb)) * mul;
      return String(va).localeCompare(String(vb)) * mul;
    });
  }, [filtered, sort, columns]);

  const activeCount = Object.values(filters).filter(isActive).length;

  function toggleSort(key: string, type: Column<T>['type']) {
    setSort(s => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: type === 'number' ? 'desc' : 'asc' }));
  }

  function exportCsv() {
    const lines = [columns.map(c => csvCell(c.label)).join(',')];
    for (const r of sorted) lines.push(columns.map(c => csvCell(c.value(r))).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${csvName ?? 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const th = 'px-2.5 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap bg-gray-50';
  const td = dense ? 'px-2.5 py-1 whitespace-nowrap' : 'px-3 py-2 whitespace-nowrap';

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-100">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={searchPlaceholder} aria-label="Search the table"
          className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs w-52 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        {activeCount > 0 && (
          <button onClick={() => setFilters({})} className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded">
            {activeCount} column filter{activeCount > 1 ? 's' : ''} ✕
          </button>
        )}
        {toolbar}
        <span className="ml-auto text-[11px] text-gray-400 tabular-nums">
          {sorted.length.toLocaleString()} of {rows.length.toLocaleString()} rows
        </span>
        {tableId && <ColumnsMenu metas={metas} {...prefs.menu} />}
        <button onClick={exportCsv} disabled={sorted.length === 0}
          className="text-[11px] font-semibold text-gray-600 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-40">CSV</button>
      </div>
      <div className={`overflow-auto ${prefs.hideUntilReady}`} style={{ maxHeight }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-20">
            <ColRow layout={layout} header className="border-b border-gray-200">
              {columns.map((c, ci) => {
                const active = sort?.key === c.key;
                const fActive = isActive(filters[c.key]);
                const right = (c.align ?? (c.type === 'number' ? 'right' : 'left')) === 'right';
                const ariaSort = c.sortable === false ? undefined : active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none';
                const stick = stickyFirst && ci === 0 ? 'sticky left-0 z-30 shadow-[1px_0_0_#e5e7eb]' : '';
                return (
                  <th key={c.key} data-col={c.label ? c.key : undefined} aria-sort={ariaSort} className={`${th} ${right ? 'text-right' : 'text-left'} ${stick}`} title={c.title}>
                    <div className={`relative flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
                      {c.sortable === false ? <span>{c.label}</span> : (
                        <button onClick={() => toggleSort(c.key, c.type)} className="flex items-center gap-1 hover:text-gray-800 min-h-[40px] sm:min-h-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded">
                          {c.label}
                          <span className={active ? 'text-blue-600' : 'text-gray-300'}>{active ? (sort!.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                        </button>
                      )}
                      {c.filterable !== false && (
                        <button onClick={e => { e.stopPropagation(); setOpenFilter(o => (o === c.key ? null : c.key)); }}
                          className={`px-0.5 ${fActive ? 'text-blue-600' : 'text-gray-300 hover:text-gray-600'}`} aria-label={`Filter ${c.label}`}>
                          ⏷
                        </button>
                      )}
                      {openFilter === c.key && (
                        <FilterPopover col={c} filter={filters[c.key] ?? {}} onClose={() => setOpenFilter(null)}
                          onChange={f => setFilters(prev => ({ ...prev, [c.key]: f }))} />
                      )}
                    </div>
                  </th>
                );
              })}
            </ColRow>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={columns.length} className="p-8 text-center text-sm text-gray-400">{emptyText}</td></tr>
            ) : sorted.slice(0, shown).map(r => (
              <ColRow layout={layout} key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`border-b border-gray-50 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-blue-50/40' : ''} ${rowClassName?.(r) ?? ''}`}>
                {columns.map((c, ci) => {
                  const right = (c.align ?? (c.type === 'number' ? 'right' : 'left')) === 'right';
                  const stick = stickyFirst && ci === 0 ? 'sticky left-0 z-10 bg-white shadow-[1px_0_0_#f3f4f6]' : '';
                  return (
                    <td key={c.key} data-col={c.label ? c.key : undefined} className={`${td} ${right ? 'text-right tabular-nums' : ''} ${c.align === 'center' ? 'text-center' : ''} ${c.className ?? 'text-xs'} ${stick}`}>
                      {c.render ? c.render(r) : (c.value(r) ?? '—')}
                    </td>
                  );
                })}
              </ColRow>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > shown && (
        <div className="px-3 py-2 border-t border-gray-100 text-center">
          <button onClick={() => setShown(s => s + pageSize * 2)} className="text-xs font-semibold text-blue-600 hover:text-blue-800">
            Show more ({(sorted.length - shown).toLocaleString()} hidden)
          </button>
        </div>
      )}
    </div>
  );
}
