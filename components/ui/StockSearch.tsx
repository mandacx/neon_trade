'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { debounce } from '@/lib/utils';
import { useRouter } from 'next/navigation';

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

export default function StockSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement>(null);

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
    router.push(`/stock/${symbol}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && results.length > 0) {
      handleSelectStock(results[0].symbol);
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full max-w-md">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => query && setIsOpen(true)}
          placeholder="Search stocks (e.g., AAPL, TSLA...)"
          className="w-full px-4 py-3 pr-10 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <div className="absolute right-3 top-3.5">
          {isLoading ? (
            <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
          ) : (
            <svg
              className="h-5 w-5 text-gray-400"
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
        <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto">
          {results.map((result) => (
            <button
              key={result.symbol}
              onClick={() => handleSelectStock(result.symbol)}
              className="w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900">{result.symbol}</div>
                  <div className="text-sm text-gray-600 truncate">{result.name}</div>
                </div>
                <div className="text-xs text-gray-500">{result.exchange}</div>
              </div>
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
