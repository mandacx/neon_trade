'use client';

import { useEffect, useState } from 'react';
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

export default function QuadrantPage() {
  const [stocks, setStocks] = useState<QuadrantStock[]>([]);
  const [filteredStocks, setFilteredStocks] = useState<QuadrantStock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tradeDate, setTradeDate] = useState<string>('');
  const [expiryDate, setExpiryDate] = useState<string>('');

  const [tradeDates, setTradeDates] = useState<string[]>([]);
  const [expiryDates, setExpiryDates] = useState<string[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({});

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [threshold, setThreshold] = useState<number>(0.5);
  const [sector, setSector] = useState('');
  const [industry, setIndustry] = useState('');
  const [marketCapTier, setMarketCapTier] = useState('');
  const [indexCode, setIndexCode] = useState('');

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

        const response = await fetch(`/api/quadrant/data?${params}`);
        if (!response.ok) throw new Error('Failed to fetch quadrant data');
        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Unknown error');
        setStocks(result.data.stocks);
        setFilteredStocks(result.data.stocks);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load quadrant data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [tradeDate, expiryDate, sector, industry, marketCapTier, indexCode]);

  // Client-side filters (search + threshold)
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

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8">
          {/* Filters */}
          <div className="mb-8 bg-white rounded-xl shadow-md p-6">
            <h2 className="text-lg font-bold mb-4 text-gray-800">Filters</h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {/* Trade Date */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Trade Date</label>
                <select
                  value={tradeDate}
                  onChange={(e) => setTradeDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {tradeDates.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* Expiry Date */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Expiry Date</label>
                <select
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {expiryDates.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* Search */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Symbol Search</label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="e.g., AAPL"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Threshold */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Proximity: {(threshold * 100).toFixed(0)}%
                </label>
                <input
                  type="range" min="0" max="1" step="0.05" value={threshold}
                  onChange={(e) => setThreshold(parseFloat(e.target.value))}
                  className="w-full mt-2"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0%</span><span>50%</span><span>100%</span>
                </div>
              </div>
            </div>

            {/* Securities filters (only shown if data available) */}
            {hasSecurityFilters && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100">
                {(filterOptions.sectors?.length ?? 0) > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Sector</label>
                    <select
                      value={sector}
                      onChange={(e) => setSector(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">All Sectors</option>
                      {filterOptions.sectors!.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )}

                {(filterOptions.industries?.length ?? 0) > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Industry</label>
                    <select
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">All Industries</option>
                      {filterOptions.industries!.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                )}

                {(filterOptions.marketCapTiers?.length ?? 0) > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Market Cap Tier</label>
                    <select
                      value={marketCapTier}
                      onChange={(e) => setMarketCapTier(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">All</option>
                      {filterOptions.marketCapTiers!.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                )}

                {(filterOptions.indices?.length ?? 0) > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Index</label>
                    <select
                      value={indexCode}
                      onChange={(e) => setIndexCode(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">All Indices</option>
                      {filterOptions.indices!.map(i => (
                        <option key={i.code} value={i.code}>{i.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Clear securities filters */}
                {(sector || industry || marketCapTier || indexCode) && (
                  <div className="flex items-end">
                    <button
                      onClick={() => { setSector(''); setIndustry(''); setMarketCapTier(''); setIndexCode(''); }}
                      className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      Clear Filters
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 text-sm text-gray-500">
              Showing <span className="font-semibold text-gray-800">{filteredStocks.length}</span> of{' '}
              <span className="font-semibold text-gray-800">{stocks.length}</span> stocks
              {!hasSecurityFilters && (
                <span className="ml-2 text-xs text-gray-400">(sector/industry filters require public.securities table)</span>
              )}
            </div>
          </div>

          {/* Chart */}
          <div className="mb-8">
            <QuadrantChart
              data={filteredStocks}
              onStockClick={(symbol) => window.open(`/stock/${symbol}`, '_blank')}
              height={580}
            />
          </div>

          {/* Stock table */}
          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-lg font-bold mb-4 text-gray-800">Stock List</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b-2 border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Symbol</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Close</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Closest Level</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Distance</th>
                    {hasSecurityFilters && (
                      <>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Sector</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Cap Tier</th>
                      </>
                    )}
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredStocks.slice(0, 50).map((stock) => (
                    <tr key={stock.symbol} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-bold">{stock.symbol}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">${stock.close.toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className="px-2 py-0.5 rounded text-xs font-medium text-white"
                          style={{ backgroundColor: (() => {
                            const colors: Record<string, string> = {
                              put_low: '#dc2626', put_int: '#ea580c',
                              put_call_int: '#16a34a', call_int: '#2563eb', call_high: '#9333ea',
                            };
                            return colors[stock.closestLevel] || '#6b7280';
                          })() }}>
                          {stock.closestLevel.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono">
                        {stock.closestValue > 0 ? '+' : ''}{(stock.closestValue * 100).toFixed(2)}%
                      </td>
                      {hasSecurityFilters && (
                        <>
                          <td className="px-4 py-3 text-xs text-gray-500">{(stock as any).sector || '—'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{(stock as any).marketCapTier || '—'}</td>
                        </>
                      )}
                      <td className="px-4 py-3 text-center">
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
              <p className="mt-3 text-xs text-gray-400 text-center">
                Showing first 50 of {filteredStocks.length} stocks. Use filters to narrow results.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
