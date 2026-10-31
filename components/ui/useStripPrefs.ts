'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthContext } from '@/components/providers/AuthContextProvider';
import { DEFAULT_STRIP_PREFS, normalizeStripPrefs, type StripPrefKey } from '@/lib/stripPrefs';

const SAVE_DELAY_MS = 600;
export type StripSaveState = 'idle' | 'saving' | 'saved' | 'error';

// Per page life and per key, so every Header remount (each navigation) paints the saved choice at once.
const cache = new Map<string, string[]>();

/**
 * Hidden tickers of one strip (`strip.indices`, `strip.crypto`). Signed in: saved on the account
 * (GET once, debounced PUT); signed out: this browser's localStorage. `toggle(symbol)` flips one ticker.
 */
export function useStripPrefs(key: StripPrefKey) {
  const { loggedIn } = useAuthContext();
  const cacheKey = `${loggedIn ? 'a' : 'b'}:${key}`;
  const [hidden, setHidden] = useState<string[]>(cache.get(cacheKey) ?? DEFAULT_STRIP_PREFS.hidden);
  const [saveState, setSaveState] = useState<StripSaveState>('idle');
  const ref = useRef(hidden);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const apply = useCallback((next: string[]) => { ref.current = next; cache.set(cacheKey, next); setHidden(next); }, [cacheKey]);

  useEffect(() => {
    if (cache.has(cacheKey)) { apply(cache.get(cacheKey)!); return; }
    const ctl = new AbortController();
    const finish = (v: unknown) => { if (!ctl.signal.aborted && !dirty.current) apply(normalizeStripPrefs(v)?.hidden ?? []); };
    if (!loggedIn) {
      let saved: unknown = null;
      try { saved = JSON.parse(localStorage.getItem(`nt.${key}`) ?? 'null'); } catch { /* storage blocked */ }
      finish(saved);
    } else {
      fetch(`/api/prefs/${key}`, { signal: ctl.signal }).then(r => r.json()).then(j => finish(j.success ? j.data?.value : null)).catch(() => finish(null));
    }
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const flush = useCallback((reset: boolean) => {
    const value = { hidden: ref.current };
    if (!loggedIn) {
      try { if (reset) localStorage.removeItem(`nt.${key}`); else localStorage.setItem(`nt.${key}`, JSON.stringify(value)); setSaveState('saved'); }
      catch { setSaveState('error'); }
      return;
    }
    (reset ? fetch(`/api/prefs/${key}`, { method: 'DELETE' })
      : fetch(`/api/prefs/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) }))
      .then(r => setSaveState(r.ok ? 'saved' : 'error')).catch(() => setSaveState('error'));
  }, [loggedIn, key]);

  const change = useCallback((next: string[], reset = false) => {
    dirty.current = true;
    apply(next);
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; flush(reset); }, SAVE_DELAY_MS);
  }, [apply, flush]);

  // Don't lose a change made just before navigating away.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); flush(false); } }, [flush]);

  const toggle = useCallback((symbol: string) => {
    const s = new Set(ref.current);
    if (s.has(symbol)) s.delete(symbol); else s.add(symbol);
    change([...s]);
  }, [change]);

  return {
    hidden, toggle, saveState, stored: loggedIn ? ('account' as const) : ('browser' as const),
    showAll: () => change([], true),
    setAll: (symbols: string[]) => change(symbols),
  };
}
