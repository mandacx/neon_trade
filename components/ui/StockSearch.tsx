'use client';

import { useState, useEffect, useCallback, useRef, useId } from 'react';
import { debounce } from '@/lib/utils';
import { useRouter } from 'next/navigation';

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

export default function StockSearch({ compact }: { compact?: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  // -1 = nothing highlighted; Enter and the go arrow both fall back to the
  // first result, matching components/watchlists/AddSymbolInput.tsx.
  const [activeIndex, setActiveIndex] = useState(-1);
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);
  // Header renders this component twice (desktop bar + mobile menu), so the
  // ids that aria-controls/aria-activedescendant point at must be unique per
  // instance or both instances would claim the same listbox.
  const listboxId = useId();

  // Keep the keyboard-highlighted row in view when arrowing past the visible
  // slice of a long result list.
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search function
  const performSearch = useCallback(
    debounce(async (searchQuery: string) => {
      if (searchQuery.length < 1) {
        setResults([]);
        setActiveIndex(-1);
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/stocks/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await response.json();

        if (data.success && data.data.results) {
          setResults(data.data.results);
        } else {
          setResults([]);
        }
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        // A new result set invalidates whatever row was highlighted against
        // the previous one.
        setActiveIndex(-1);
        setIsLoading(false);
      }
    }, 300),
    []
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setIsLoading(true);
    setIsOpen(true);
    performSearch(value);
  };

  const handleSelectStock = (symbol: string) => {
    setQuery(symbol);
    setIsOpen(false);
    setActiveIndex(-1);
    router.push(`/stock/${symbol}`);
  };

  // Shared by Enter and the go arrow so both always resolve to the same row.
  const goToBestMatch = () => {
    if (results.length === 0) return;
    handleSelectStock(results[activeIndex >= 0 ? activeIndex : 0].symbol);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (results.length === 0) return;
    // Arrowing down after the dropdown was dismissed should bring it back
    // rather than silently moving a highlight nobody can see.
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      goToBestMatch();
    }
  };

  const iconSize = compact ? 'h-3.5 w-3.5' : 'h-5 w-5';

  return (
    <div ref={wrapperRef} className={`relative ${compact ? 'w-full' : 'w-full max-w-md'}`}>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => query && setIsOpen(true)}
          role="combobox"
          aria-expanded={isOpen && results.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          placeholder={compact ? 'Search stocks...' : 'Search stocks (e.g., AAPL, TSLA...)'}
          className={`w-full border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
            compact ? 'px-3 py-1.5 pr-9 text-sm' : 'px-4 py-3 pr-11 text-base border-gray-300'
          }`}
        />
        {/* One slot on the right edge, three states: spinner while a search is
            in flight, the go arrow once something has been typed, and the
            (decorative) magnifier when the field is empty. */}
        <div className={`absolute inset-y-0 right-0 flex items-center ${compact ? 'pr-1.5' : 'pr-2'}`}>
          {isLoading ? (
            <div className={`m-1 animate-spin border-2 border-blue-600 border-t-transparent rounded-full ${iconSize}`} />
          ) : query ? (
            <button
              type="button"
              onClick={goToBestMatch}
              disabled={results.length === 0}
              aria-label={
                results.length > 0
                  ? `Go to ${results[activeIndex >= 0 ? activeIndex : 0].symbol}`
                  : 'No matching stock to open'
              }
              title="Go to stock"
              className="p-1 rounded-md text-blue-600 transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:text-gray-300 disabled:hover:bg-transparent disabled:cursor-not-allowed"
            >
              <svg className={iconSize} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </button>
          ) : (
            <svg
              className={`m-1 text-gray-400 ${iconSize}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          )}
        </div>
      </div>

      {isOpen && results.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto"
        >
          {results.map((result, i) => (
            <button
              key={result.symbol}
              id={`${listboxId}-option-${i}`}
              ref={i === activeIndex ? activeItemRef : undefined}
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => handleSelectStock(result.symbol)}
              className={`w-full px-4 py-2.5 text-left border-b border-gray-100 last:border-b-0 transition-colors ${
                i === activeIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
              }`}
            >
              {/* Symbol and exchange share the top line and the company name
                  gets the full width below it. Side-by-side (name left,
                  exchange right) squeezed the exchange off the edge, since
                  this dropdown is only as wide as the header's search box. */}
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 truncate font-semibold text-gray-900">{result.symbol}</span>
                <span className="ml-auto shrink-0 text-xs text-gray-500">{result.exchange}</span>
              </div>
              <div className="text-sm text-gray-600 truncate">{result.name}</div>
            </button>
          ))}
        </div>
      )}

      {isOpen && query && !isLoading && results.length === 0 && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-gray-600">
          No stocks found for &quot;{query}&quot;
        </div>
      )}
    </div>
  );
}
