'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthContext } from '@/components/providers/AuthContextProvider';
import {
  columnsPrefKey, defaultHidden, MAX_COL_WIDTH, MIN_COL_WIDTH, normalizeColumnPrefs, resolveOrder,
  type ColumnMeta, type ColumnPrefs,
} from '@/lib/tableColumns';
import type { ColLayout } from '@/components/ui/ColRow';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const LOCAL_PREFIX = 'colprefs.';
const SAVE_DELAY_MS = 500;

/**
 * Which columns of a table the user has switched off, in what order they sit and how
 * wide they were dragged, loaded with the page and saved on every change.
 *
 *  - Signed in: stored on the account (GET/PUT/DELETE /api/prefs/cols.<tableId>), so
 *    it follows the user across devices.
 *  - Signed out (public pages such as the stock page): kept in this browser's
 *    localStorage instead, with no request at all.
 *
 * Tables put `data-col="<id>"` on every registry column's <th>/<td> and render their rows
 * with <ColRow layout={cols.layout}>, which applies the order and widths; visibility stays
 * with the table (`isShown`).
 *
 * `ready` turns true once the saved choice is known; tables hide until then so the
 * default columns don't flash before the saved ones. `metas` may change between
 * renders (conditional columns); it is read through a ref.
 */
export function useColumnPrefs(tableId: string | null, metas: ColumnMeta[]) {
  const { loggedIn } = useAuthContext();
  const metasRef = useRef(metas);
  metasRef.current = metas;
  const required = useCallback(() => new Set(metasRef.current.filter(c => c.required).map(c => c.id)), []);

  const [prefs, setPrefsState] = useState<ColumnPrefs>(() => ({ hidden: defaultHidden(metas), order: [], widths: {} }));
  const prefsRef = useRef(prefs);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetPending = useRef(false);
  const key = columnsPrefKey(tableId ?? '');

  const apply = useCallback((next: ColumnPrefs) => { prefsRef.current = next; setPrefsState(next); }, []);

  useEffect(() => {
    const ctl = new AbortController();
    if (!tableId) { setReady(true); return; } // table without saved preferences
    const finish = (saved: ColumnPrefs | null) => {
      if (ctl.signal.aborted) return;
      const req = required();
      if (saved) apply({ ...saved, hidden: saved.hidden.filter(id => !req.has(id)) });
      setReady(true);
    };
    if (!loggedIn) {
      let saved: ColumnPrefs | null = null;
      try { saved = normalizeColumnPrefs(JSON.parse(localStorage.getItem(LOCAL_PREFIX + tableId) ?? 'null')); } catch { /* storage blocked */ }
      finish(saved);
    } else {
      fetch(`/api/prefs/${key}`, { signal: ctl.signal })
        .then(res => res.json())
        .then(json => finish(json.success ? normalizeColumnPrefs(json.data?.value) : null))
        .catch(() => finish(null));
    }
    return () => ctl.abort();
  }, [tableId, key, loggedIn, required, apply]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** Save the latest prefs (debounced), or forget the saved ones after a reset. */
  const schedule = useCallback(() => {
    if (!tableId) return;
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const reset = resetPending.current;
      resetPending.current = false;
      const value = prefsRef.current;
      if (!loggedIn) {
        try {
          if (reset) localStorage.removeItem(LOCAL_PREFIX + tableId);
          else localStorage.setItem(LOCAL_PREFIX + tableId, JSON.stringify(value));
          setSaveState('saved');
        } catch { setSaveState('error'); }
        return;
      }
      const request = reset
        ? fetch(`/api/prefs/${key}`, { method: 'DELETE' })
        : fetch(`/api/prefs/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });
      request.then(res => res.json()).then(j => setSaveState(j.success ? 'saved' : 'error')).catch(() => setSaveState('error'));
    }, SAVE_DELAY_MS);
  }, [loggedIn, tableId, key]);

  const update = useCallback((patch: Partial<ColumnPrefs>, save = true) => {
    resetPending.current = false;
    apply({ ...prefsRef.current, ...patch });
    if (save) schedule();
  }, [apply, schedule]);

  /** Replace the hidden list. */
  const setHidden = useCallback((next: string[]) => {
    const req = required();
    update({ hidden: next.filter(id => !req.has(id)) });
  }, [update, required]);

  /** Back to the table's defaults: columns, order and widths. */
  const reset = useCallback(() => {
    apply({ hidden: defaultHidden(metasRef.current), order: [], widths: {} });
    resetPending.current = true;
    schedule();
  }, [apply, schedule]);

  const idsNow = () => metasRef.current.map(c => c.id);

  /** Put `ids` (a subset of the columns, e.g. what the menu lists) in this sequence, in the slots they already occupy. */
  const setOrder = useCallback((ids: string[]) => {
    const full = resolveOrder(idsNow(), prefsRef.current.order);
    const set = new Set(ids);
    const queue = ids.slice();
    update({ order: full.map(id => (set.has(id) ? queue.shift()! : id)) });
  }, [update]);

  /** Drag-and-drop: `from` takes the position `to` has now. */
  const moveTo = useCallback((from: string, to: string) => {
    if (from === to) return;
    const full = resolveOrder(idsNow(), prefsRef.current.order);
    if (!full.includes(from) || !full.includes(to)) return;
    const next = full.filter(id => id !== from);
    next.splice(next.indexOf(to) + (full.indexOf(from) < full.indexOf(to) ? 1 : 0), 0, from);
    update({ order: next });
  }, [update]);

  /** Live resize while dragging (`commit` false) and the final width (`commit` true); `null` clears the column's width. */
  const setWidth = useCallback((id: string, width: number | null, commit: boolean) => {
    const widths = { ...prefsRef.current.widths };
    if (width === null) delete widths[id];
    else widths[id] = Math.round(Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, width)));
    update({ widths }, commit);
  }, [update]);

  const hiddenSet = new Set(prefs.hidden);
  const isShown = (id: string) => !hiddenSet.has(id);
  const order = resolveOrder(metas.map(c => c.id), prefs.order);

  const layout: ColLayout = { tableId: tableId ?? '', order, widths: prefs.widths, setWidth, moveTo };

  return {
    /** Is column `id` switched on? (Columns that don't exist in this render are simply never asked about.) */
    isShown,
    ready,
    /** Class for the table wrapper: invisible until the saved choice is known (no flash of the defaults). */
    hideUntilReady: ready ? '' : 'invisible',
    /** The column ids in the user's order. */
    order,
    /** `ids` sorted by the user's order (for tables that build their columns from a list). */
    ordered: <T extends string>(ids: T[]): T[] => [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    /** Pass to <ColRow layout={…}>: applies the order and widths to a row's cells. */
    layout,
    /** Spread onto <ColumnsMenu />. */
    menu: {
      hidden: prefs.hidden, onChange: setHidden, order, onOrder: setOrder, onReset: reset, saveState,
      stored: loggedIn ? 'account' as const : 'browser' as const,
    },
  };
}
