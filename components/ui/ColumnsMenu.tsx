'use client';

import { useEffect, useRef, useState } from 'react';
import type { ColumnMeta } from '@/lib/tableColumns';
import type { SaveState } from '@/components/ui/useColumnPrefs';

/**
 * "Columns" popover: tick the columns a table should show. Pair it with
 * useColumnPrefs(), which saves the choice:
 *
 *   const cols = useColumnPrefs('earnings', METAS);
 *   <ColumnsMenu metas={METAS} {...cols.menu} />
 *   {cols.isShown('ltp') && <th>…</th>}
 *
 * `notes` adds a per-column remark (e.g. "no after-hours prints right now").
 */
export default function ColumnsMenu({ metas, hidden, onChange, onReset, saveState, stored, notes, align = 'right' }: {
  metas: ColumnMeta[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  onReset: () => void;
  saveState: SaveState;
  stored: 'account' | 'browser';
  notes?: Record<string, string>;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  const hiddenSet = new Set(hidden);
  const shownCount = metas.filter(c => !hiddenSet.has(c.id)).length;
  const toggle = (id: string) => {
    const next = new Set(hiddenSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...next]);
  };
  const status = saveState === 'saving' ? 'Saving…'
    : saveState === 'saved' ? (stored === 'account' ? 'Saved to your account' : 'Saved in this browser')
    : saveState === 'error' ? 'Not saved (kept for this visit)' : '';

  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={() => setOpen(o => !o)} aria-haspopup="true" aria-expanded={open}
        className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 bg-white rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-sm whitespace-nowrap">
        ⚙ Columns <span className="text-gray-400 font-medium">{shownCount}/{metas.length}</span>
      </button>
      {open && (
        <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-40 p-2 text-left normal-case tracking-normal font-normal`}>
          <div className="flex items-center justify-between px-1 pb-1.5 border-b border-gray-100 mb-1">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Show columns</span>
            <span className="text-[10px] text-gray-400">{status}</span>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {metas.map(c => (
              <label key={c.id} className={`flex items-start gap-2 px-1.5 py-1 rounded text-xs ${c.required ? 'text-gray-400' : 'text-gray-800 cursor-pointer hover:bg-gray-50'}`}>
                <input type="checkbox" className="mt-0.5 accent-blue-600" checked={!hiddenSet.has(c.id)} disabled={c.required} onChange={() => toggle(c.id)} />
                <span>
                  <span className="font-medium">{c.label}</span>
                  {c.required && <span className="text-[10px] text-gray-400"> (always shown)</span>}
                  {notes?.[c.id] && !hiddenSet.has(c.id) && <span className="text-[10px] text-gray-400"> ({notes[c.id]})</span>}
                  {c.hint && <span className="block text-[10px] text-gray-400">{c.hint}</span>}
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-between pt-1.5 mt-1 border-t border-gray-100 text-[11px] font-semibold">
            <button onClick={() => onChange([])} className="text-blue-600 hover:text-blue-800">Show all</button>
            <button onClick={onReset} className="text-gray-500 hover:text-gray-800">Reset to default</button>
          </div>
        </div>
      )}
    </div>
  );
}
