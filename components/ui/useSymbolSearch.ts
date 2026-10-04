'use client';

import { useEffect, useRef, useState } from 'react';

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string;
  /** We have option levels for this symbol. */
  hasLevels: boolean;
}

const DEBOUNCE_MS = 200;
const MAX_RESULTS = 20;

/**
 * Ticker-or-name search shared by the header search box and the watchlist
 * "add symbol" input. Two requests per query (see app/api/stocks/search):
 * our own symbols first (in-memory, near-instant — `isLoading` covers only
 * this), then Tradier's matches appended when they arrive (`isLoadingMore`),
 * so a slow Tradier call never delays the dropdown. Responses for an older
 * query are dropped.
 */
export function useSymbolSearch(query: string) {
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const id = ++latest.current;
    if (!q) {
      setResults([]);
      setIsLoading(false);
      setIsLoadingMore(false);
      return;
    }
    setIsLoading(true);
    setIsLoadingMore(true);

    const timer = setTimeout(() => {
      const url = (scope: 'local' | 'remote') => `/api/stocks/search?q=${encodeURIComponent(q)}&scope=${scope}`;
      const get = (scope: 'local' | 'remote') =>
        fetch(url(scope))
          .then(res => res.json())
          .then(json => (json.success ? (json.data.results as SymbolSearchResult[]) : []))
          .catch(() => [] as SymbolSearchResult[]);

      const localPromise = get('local').then(local => {
        if (id !== latest.current) return local;
        setResults(local);
        setIsLoading(false);
        return local;
      });

      Promise.all([localPromise, get('remote')]).then(([local, remote]) => {
        if (id !== latest.current) return;
        const seen = new Set(local.map(r => r.symbol));
        setResults([...local, ...remote.filter(r => !seen.has(r.symbol))].slice(0, MAX_RESULTS));
        setIsLoadingMore(false);
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  return { results, isLoading, isLoadingMore };
}
