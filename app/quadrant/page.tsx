'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import QuadrantChart from '@/components/charts/QuadrantChart';
import Header from '@/components/layout/Header';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import { QuadrantStock } from '@/types/stock';

interface FilterOptions {
  sectors?: string[];
  industries?: string[];
  marketCapTiers?: string[];
  indices?: { code: string; name: string }[];
}

interface WatchlistOption {
  id: string;
  name: string;
  isSystem: boolean;
  symbolCount: number;
}

const LEVEL_COLORS: Record<string, string> = {
  put_low: '#dc2626', put_int: '#ea580c', put_call_int: '#16a34a',
  call_int: '#2563eb', call_high: '#9333ea',
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function QuadrantPageInner() {
  const searchParams = useSearchParams();
  const [stocks, setStocks] = useState<QuadrantStock[]>([]);
  const [filteredStocks, setFilteredStocks] = useState<QuadrantStock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tradeDate, setTradeDate] = useState<string>('');
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [tradeDates, setTradeDates] = useState<string[]>([]);
  const [expiryDates, setExpiryDates] = useState<string[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({});
  const [watchlists, setWatchlists] = useState<WatchlistOption[]>([]);

  // Collapsible state
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [stockListOpen, setStockListOpen] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [threshold, setThreshold] = useState<number>(0.5);
  const [sector, setSector] = useState(searchParams.get('sector') || '');
  const [industry, setIndustry] = useState(searchParams.get('industry') || '');
  const [marketCapTier, setMarketCapTier] = useState(searchParams.get('marketCapTier') || '');
  const [indexCode, setIndexCode] = useState(searchParams.get('index') || '');
  const [watchlistId, setWatchlistId] = useState(searchParams.get('watchlist') || '');

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const response = await fetch('/api/quadrant/data?metadata=true');
        if (!response.ok) throw new Error('Failed to fetch metadata');
        const result = await response.json();
        if (result.success) {
          setTradeDates(result.data.tradeDates);
          setExpiryDates(result.data.expiryDates);
          setFilterOptions(result.data.filterOptions || {});
          setWatchlists(result.data.watchlists || []);
          if (result.data.tradeDates.length > 0) setTradeDate(result.data.tradeDates[0]);
          if (result.data.expiryDates.length > 0) setExpiryDate(result.data.expiryDates[0]);
        }
      } catch (err) {
        console.error('Error fetching metadata:', err);
      }
    };
    fetchMetadata();
  }, []);

  useEffect(() => {
    if (!tradeDate || !expiryDate) return;
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ date: tradeDate, expiry: expiryDate });
        if (sector) params.set('sector', sector);
        if (industry) params.set('industry', industry);
        if (marketCapTier) params.set('marketCapTier', marketCapTier);
        if (indexCode) params.set('index', indexCode);
        if (watchlistId) params.set('watchlist', watchlistId);
        const response = await fetch(`/api/quadrant/data?${params}`);
        if (!response.ok) throw new Error('Failed to fetch quadrant data');
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Unknown error');
        setStocks(result.data.stocks);
        setFilteredStocks(result.data.stocks);
        // §4 — adopt filter options derived from the items actually present.
        if (result.data.filterOptions) setFilterOptions(result.data.filterOptions);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load quadrant data');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [tradeDate, expiryDate, sector, industry, marketCapTier, indexCode, watchlistId]);

  useEffect(() => {
    let filtered = stocks;
    if (searchQuery) {
      const q = searchQuery.toUpperCase();
      filtered = filtered.filter(s => s.symbol.includes(q));
    }
    filtered = filtered.filter(s => Math.abs(s.closestValue) <= threshold);
    setFilteredStocks(filtered);
  }, [searchQuery, threshold, stocks]);

  if (isLoading) return <><Header /><LoadingSpinner message="Loading quadrant analysis..." /></>;
  if (error) return <><Header /><ErrorDisplay error={error} onRetry={() => window.location.reload()} /></>;

  const hasSecurityFilters = (filterOptions.sectors?.length ?? 0) > 0
    || (filterOptions.industries?.length ?? 0) > 0
    || (filterOptions.marketCapTiers?.length ?? 0) > 0
    || (filterOptions.indices?.length ?? 0) > 0;

  const hasActiveFilters = !!(sector || industry || marketCapTier || indexCode || watchlistId);

  const selectClass = "px-2 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white max-w-[180px]";
  const labelClass = "block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5";

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-4 space-y-3">

          {/* Collapsible Filters */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <button
              onClick={() => setFiltersOpen(v => !v)}
              className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="font-semibold text-gray-800 text-sm">Filters</span>
                <span className="text-xs text-gray-400">
                  Showing <strong className="text-gray-700">{filteredStocks.length}</strong> of <strong className="text-gray-700">{stocks.length}</strong> stocks
                </span>
                {hasActiveFilters && (
                  <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Active</span>
                )}
              </div>
              <ChevronIcon open={filtersOpen} />
            </button>

            {filtersOpen && (
              <div className="px-4 pb-3 border-t border-gray-100">
                <div className="flex flex-wrap items-end gap-3 pt-3">
                  <div>
                    <label className={labelClass}>Trade Date</label>
                    <select value={tradeDate} onChange={e => setTradeDate(e.target.value)} className={selectClass}>
                      {tradeDates.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Expiry Date</label>
                    <select value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className={selectClass}>
                      {expiryDates.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Symbol</label>
                    <input
                      type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                      placeholder="e.g., AAPL"
                      className="w-24 px-2 py-1.5 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                    />
                  </div>
                  <div className="w-40">
                    <label className={labelClass}>Proximity: {(threshold * 100).toFixed(0)}%</label>
                    <input
                      type="range" min="0" max="1" step="0.02" value={threshold}
                      onChange={e => setThreshold(parseFloat(e.target.value))}
                      className="w-full mt-1 accent-blue-500"
                    />
                    <div className="flex justify-between text-[10px] text-gray-300">
                      <span>0%</span><span>50%</span><span>100%</span>
                    </div>
                  </div>
                  {hasSecurityFilters && (filterOptions.sectors?.length ?? 0) > 0 && (
                    <div>
                      <label className={labelClass}>Sector</label>
                      <select value={sector} onChange={e => setSector(e.target.value)} className={selectClass}>
                        <option value="">All Sectors</option>
                        {filterOptions.sectors!.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )}
                  {hasSecurityFilters && (filterOptions.industries?.length ?? 0) > 0 && (
                    <div>
                      <label className={labelClass}>Industry</label>
                      <select value={industry} onChange={e => setIndustry(e.target.value)} className={selectClass}>
                        <option value="">All Industries</option>
                        {filterOptions.industries!.map(i => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </div>
                  )}
                  {hasSecurityFilters && (filterOptions.marketCapTiers?.length ?? 0) > 0 && (
                    <div>
                      <label className={labelClass}>Cap Tier</label>
                      <select value={marketCapTier} onChange={e => setMarketCapTier(e.target.value)} className={selectClass}>
                        <option value="">All</option>
                        {filterOptions.marketCapTiers!.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                  {hasSecurityFilters && (filterOptions.indices?.length ?? 0) > 0 && (
                    <div>
                      <label className={labelClass}>Index</label>
                      <select value={indexCode} onChange={e => setIndexCode(e.target.value)} className={selectClass}>
                        <option value="">All Indices</option>
                        {filterOptions.indices!.map(i => <option key={i.code} value={i.code}>{i.name}</option>)}
                      </select>
                    </div>
                  )}
                  {watchlists.length > 0 && (
                    <div>
                      <label className={labelClass}>Watchlist</label>
                      <select value={watchlistId} onChange={e => setWatchlistId(e.target.value)} className={selectClass}>
                        <option value="">All Stocks</option>
                        {watchlists.map(w => (
                          <option key={w.id} value={w.id}>
                            {w.name} ({w.symbolCount})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {hasActiveFilters && (
                    <div className="flex items-end pb-0.5">
                      <button
                        onClick={() => { setSector(''); setIndustry(''); setMarketCapTier(''); setIndexCode(''); setWatchlistId(''); }}
                        className="px-2.5 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Chart */}
          <QuadrantChart
            data={filteredStocks}
            onStockClick={(symbol) => window.open(`/stock/${symbol}`, '_blank')}
            height={560}
          />

          {/* Collapsible Stock List */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <button
              onClick={() => setStockListOpen(v => !v)}
              className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <span className="font-semibold text-gray-800 text-sm">
                Stock List <span className="font-normal text-gray-400 text-xs ml-1">({filteredStocks.length})</span>
              </span>
              <ChevronIcon open={stockListOpen} />
            </button>

            {stockListOpen && (
              <div className="border-t border-gray-100">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Symbol</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Name</th>
                        <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">LTP</th>
                        <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Close</th>
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Closest Level</th>
                        <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Distance</th>
                        {hasSecurityFilters && (
                          <>
                            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Sector</th>
                            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Cap Tier</th>
                          </>
                        )}
                        <th className="px-4 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredStocks.slice(0, 50).map((stock) => (
                        <tr key={stock.symbol} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm font-bold">{stock.symbol}</td>
                          <td className="px-4 py-2 text-xs text-gray-600 max-w-[160px] truncate" title={(stock as any).name || ''}>
                            {(stock as any).name || '—'}
                          </td>
                          <td className="px-4 py-2 text-xs text-right font-mono">
                            {stock.livePrice != null ? `$${stock.livePrice.toFixed(2)}` : '—'}
                          </td>
                          <td className="px-4 py-2 text-xs text-right font-mono text-gray-500">${stock.close.toFixed(2)}</td>
                          <td className="px-4 py-2 text-xs">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold text-white"
                              style={{ backgroundColor: LEVEL_COLORS[stock.closestLevel] || '#6b7280' }}>
                              {stock.closestLevel.replace(/_/g, ' ').toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-xs text-right font-mono">
                            {stock.closestValue > 0 ? '+' : ''}{(stock.closestValue * 100).toFixed(2)}%
                          </td>
                          {hasSecurityFilters && (
                            <>
                              <td className="px-4 py-2 text-xs text-gray-500">{(stock as any).sector || '—'}</td>
                              <td className="px-4 py-2 text-xs text-gray-500">{(stock as any).marketCapTier || '—'}</td>
                            </>
                          )}
                          <td className="px-4 py-2 text-center">
                            <button
                              onClick={() => window.open(`/stock/${stock.symbol}`, '_blank')}
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                            >
                              View →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filteredStocks.length > 50 && (
                  <p className="px-4 py-2 text-xs text-gray-400 text-center border-t border-gray-100">
                    Showing first 50 of {filteredStocks.length} stocks. Use filters to narrow results.
                  </p>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}

export default function QuadrantPage() {
  return (
    <Suspense fallback={null}>
      <QuadrantPageInner />
    </Suspense>
  );
}
