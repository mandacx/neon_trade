'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthContext } from '@/components/providers/AuthContextProvider';
import { CHART_PREF_KEY, DEFAULT_CHART_PREFS, normalizeChartPrefs, type ChartPrefs } from '@/lib/chartPrefs';

const LOCAL_KEY = 'chartprefs';
const SAVE_DELAY_MS = 600;

// Held for the life of the page so symbol changes (the watchlist chart remounts per symbol) and
// navigating between stocks don't fetch the saved settings again.
let cache: { loggedIn: boolean; prefs: ChartPrefs } | null = null;

/**
 * The stock chart's saved settings: toggles, interval, expiry, period and height.
 *
 *  - Signed in: stored on the account (GET/PUT/DELETE /api/prefs/chart.settings), so it follows the
 *    user across devices. One GET per page load (module cache), one debounced PUT per burst of changes.
 *  - Signed out: kept in this browser's localStorage, with no request at all.
 *
 * `ready` turns true once the saved choice is known. The stock page waits for it before loading data,
 * so the first request already uses the saved interval and expiry (no default load followed by a reload).
 * `save` merges a patch; `reset` returns to the defaults and forgets the saved copy.
 */
export function useChartPrefs() {
  const { loggedIn } = useAuthContext();
  const hit = cache && cache.loggedIn === loggedIn ? cache.prefs : null;
  const [prefs, setPrefs] = useState<ChartPrefs>(hit ?? DEFAULT_CHART_PREFS);
  const [ready, setReady] = useState(hit !== null);
  const prefsRef = useRef(prefs);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetPending = useRef(false);

  const apply = useCallback((next: ChartPrefs) => {
    prefsRef.current = next;
    cache = { loggedIn, prefs: next };
    setPrefs(next);
  }, [loggedIn]);

  useEffect(() => {
    if (hit) return;
    const ctl = new AbortController();
    const finish = (saved: ChartPrefs | null) => {
      if (ctl.signal.aborted) return;
      apply(saved ?? DEFAULT_CHART_PREFS);
      setReady(true);
    };
    if (!loggedIn) {
      let saved: ChartPrefs | null = null;
      try { saved = normalizeChartPrefs(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null')); } catch { /* storage blocked */ }
      finish(saved);
    } else {
      fetch(`/api/prefs/${CHART_PREF_KEY}`, { signal: ctl.signal })
        .then(res => res.json())
        .then(json => finish(json.success ? normalizeChartPrefs(json.data?.value) : null))
        .catch(() => finish(null));
    }
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn]);

  const flush = useCallback(() => {
    const reset = resetPending.current;
    resetPending.current = false;
    const value = prefsRef.current;
    if (!loggedIn) {
      try {
        if (reset) localStorage.removeItem(LOCAL_KEY);
        else localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
      } catch { /* storage blocked: the setting still applies for this page */ }
      return;
    }
    (reset
      ? fetch(`/api/prefs/${CHART_PREF_KEY}`, { method: 'DELETE' })
      : fetch(`/api/prefs/${CHART_PREF_KEY}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) })
    ).catch(() => { /* not saved; the next change tries again */ });
  }, [loggedIn]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; flush(); }, SAVE_DELAY_MS);
  }, [flush]);

  // Don't lose a change made just before leaving the page or switching stock.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); flush(); }
  }, [flush]);

  const save = useCallback((patch: Partial<ChartPrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    // Nothing changed (e.g. the interval effect echoing the saved value): no state change, no request.
    if ((Object.keys(patch) as (keyof ChartPrefs)[]).every(k => prefsRef.current[k] === next[k])) return;
    resetPending.current = false;
    apply(next);
    schedule();
  }, [apply, schedule]);

  const reset = useCallback(() => {
    apply(DEFAULT_CHART_PREFS);
    resetPending.current = true;
    schedule();
  }, [apply, schedule]);

  return { prefs, ready, save, reset, stored: loggedIn ? ('account' as const) : ('browser' as const) };
}
