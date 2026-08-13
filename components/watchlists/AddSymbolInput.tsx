'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { debounce } from '@/lib/utils';

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

/**
 * Search-to-pick input for adding a symbol to a watchlist — distinct from
 * components/ui/StockSearch.tsx, which navigates straight to the stock page
 * on select rather than calling back with the chosen symbol.
 */
export default function AddSymbolInput({ onSelect, disabled, placeholder }: { onSelect: (symbol: string) => void; disabled?: boolean; placeholder?: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const performSearch = useCallback(
    debounce(async (searchQuery: string) => {
      if (searchQuery.length < 1) {
        setResults([]);
        setIsLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/stocks/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await response.json();
        setResults(data.success && data.data.results ? data.data.results : []);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300),
    []
  );

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setQuery(value);
    setIsLoading(true);
    setIsOpen(true);
    performSearch(value);
  }

  function handleSelect(symbol: string) {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    onSelect(symbol);
  }

  return (
    <div ref={wrapperRef} className="relative w-full max-w-sm">
      <input
        type="text"
        value={query}
        disabled={disabled}
        onChange={handleInputChange}
        onFocus={() => query && setIsOpen(true)}
        onKeyDown={e => { if (e.key === 'Enter' && results.length > 0) handleSelect(results[0].symbol); }}
        placeholder={placeholder ?? 'Add symbol (e.g. AAPL)…'}
        className="w-full px-3 py-1.5 pr-8 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white disabled:opacity-50"
      />
      {isLoading && (
        <div className="absolute right-2.5 top-2 animate-spin h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent rounded-full" />
      )}
      {isOpen && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
          {results.map(r => (
            <button
              key={r.symbol}
              onClick={() => handleSelect(r.symbol)}
              className="w-full px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 text-xs"
            >
              <span className="font-semibold text-gray-900">{r.symbol}</span>{' '}
              <span className="text-gray-500">{r.name}</span>
            </button>
          ))}
        </div>
      )}
      {isOpen && query && !isLoading && results.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-center text-xs text-gray-500">
          No stocks found for &quot;{query}&quot;
        </div>
      )}
    </div>
  );
}
