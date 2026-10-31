'use client';

import { useEffect, useRef, useState } from 'react';
import type { StripSaveState } from '@/components/ui/useStripPrefs';

/** "⚙" popover for a ticker strip: tick the tickers to show. Pair with useStripPrefs(). */
export default function StripPicker({ items, hidden, onToggle, onShowAll, onHideAll, saveState, stored, title }: {
  items: Array<{ id: string; label: string }>;
  hidden: string[];
  onToggle: (id: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  saveState: StripSaveState;
  stored: 'account' | 'browser';
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const hiddenSet = new Set(hidden);
  const shown = items.filter(i => !hiddenSet.has(i.id)).length;
  const status = saveState === 'saving' ? 'Saving…'
    : saveState === 'saved' ? (stored === 'account' ? 'Saved to your account' : 'Saved in this browser')
    : saveState === 'error' ? 'Not saved (kept for this visit)' : '';

  return (
    <div className="relative shrink-0" ref={ref}>
      <button onClick={() => setOpen(o => !o)} aria-haspopup="true" aria-expanded={open} title={title}
        className="flex items-center gap-1 px-2 py-1 border border-gray-200 bg-white rounded text-xs font-semibold text-gray-600 hover:bg-gray-50 whitespace-nowrap">
        ⚙ <span className="text-gray-400 font-medium">{shown}/{items.length}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2 text-left normal-case font-normal">
          <div className="flex items-center justify-between px-1 pb-1.5 border-b border-gray-100 mb-1">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{title}</span>
            <span className="text-[10px] text-gray-400">{status}</span>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {items.map(i => (
              <label key={i.id} className="flex items-center gap-2 px-1 py-1 rounded text-xs text-gray-800 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" className="accent-blue-600" checked={!hiddenSet.has(i.id)} onChange={() => onToggle(i.id)} />
                <span className="font-medium">{i.id}</span>
                {i.label !== i.id && <span className="text-[10px] text-gray-400 truncate">{i.label}</span>}
              </label>
            ))}
          </div>
          <div className="flex justify-between pt-1.5 mt-1 border-t border-gray-100 text-[11px] font-semibold">
            <button onClick={onShowAll} className="text-blue-600 hover:text-blue-800">Show all</button>
            <button onClick={onHideAll} className="text-gray-500 hover:text-gray-800">Hide all</button>
          </div>
        </div>
      )}
    </div>
  );
}
