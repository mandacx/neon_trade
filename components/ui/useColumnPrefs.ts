'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthContext } from '@/components/providers/AuthContextProvider';
import { COLUMN_ID_RE, columnsPrefKey, defaultHidden, type ColumnMeta } from '@/lib/tableColumns';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const LOCAL_PREFIX = 'colprefs.';
const SAVE_DELAY_MS = 500;

const clean = (v: unknown): string[] | null =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && COLUMN_ID_RE.test(x)))] : null;

/**
 * Which columns of a table the user has switched off, loaded with the page and
 * saved on every change.
 *
 *  - Signed in: stored on the account (GET/PUT/DELETE /api/prefs/cols.<tableId>), so
 *    it follows the user across devices.
 *  - Signed out (public pages such as the stock page): kept in this browser's
 *    localStorage instead, with no request at all.
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

  const [hidden, setHiddenState] = useState<string[]>(() => defaultHidden(metas));
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = columnsPrefKey(tableId ?? '');

  useEffect(() => {
    const ctl = new AbortController();
    if (!tableId) { setReady(true); return; } // table without saved preferences
    const finish = (saved: string[] | null) => {
      if (ctl.signal.aborted) return;
      const req = required();
      if (saved) setHiddenState(saved.filter(id => !req.has(id)));
      setReady(true);
    };
    if (!loggedIn) {
      let saved: string[] | null = null;
      try { saved = clean(JSON.parse(localStorage.getItem(LOCAL_PREFIX + tableId) ?? 'null')); } catch { /* storage blocked */ }
      finish(saved);
    } else {
      fetch(`/api/prefs/${key}`, { signal: ctl.signal })
        .then(res => res.json())
        .then(json => finish(json.success ? clean(json.data?.value) : null))
        .catch(() => finish(null));
    }
    return () => ctl.abort();
  }, [tableId, key, loggedIn, required]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** Apply a new hidden list and save it (debounced). `null` resets to the table's defaults. */
  const setHidden = useCallback((next: string[] | null) => {
    if (!tableId) return;
    const req = required();
    const value = next === null ? defaultHidden(metasRef.current) : next.filter(id => !req.has(id));
    setHiddenState(value);
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!loggedIn) {
        try {
          if (next === null) localStorage.removeItem(LOCAL_PREFIX + tableId);
          else localStorage.setItem(LOCAL_PREFIX + tableId, JSON.stringify(value));
          setSaveState('saved');
        } catch { setSaveState('error'); }
        return;
      }
      const request = next === null
        ? fetch(`/api/prefs/${key}`, { method: 'DELETE' })
        : fetch(`/api/prefs/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });
      request.then(res => res.json()).then(j => setSaveState(j.success ? 'saved' : 'error')).catch(() => setSaveState('error'));
    }, SAVE_DELAY_MS);
  }, [loggedIn, tableId, key, required]);

  const hiddenSet = new Set(hidden);
  const isShown = (id: string) => !hiddenSet.has(id);

  return {
    /** Is column `id` switched on? (Columns that don't exist in this render are simply never asked about.) */
    isShown,
    ready,
    /** Class for the table wrapper: invisible until the saved choice is known (no flash of the defaults). */
    hideUntilReady: ready ? '' : 'invisible',
    /** Spread onto <ColumnsMenu />. */
    menu: { hidden, onChange: setHidden, onReset: () => setHidden(null), saveState, stored: loggedIn ? 'account' as const : 'browser' as const },
  };
}
