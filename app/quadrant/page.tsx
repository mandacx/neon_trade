'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QuadrantChart from '@/components/charts/QuadrantChart';
import Header from '@/components/layout/Header';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import { QuadrantStock } from '@/types/stock';

export default function QuadrantPage() {
  const router = useRouter();
  const [stocks, setStocks] = useState<QuadrantStock[]>([]);
  const [filteredStocks, setFilteredStocks] = useState<QuadrantStock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tradeDate, setTradeDate] = useState<string>('');
  const [expiryDate, setExpiryDate] = useState<string>('');
  
  // Available dates from API
  const [tradeDates, setTradeDates] = useState<string[]>([]);
  const [expiryDates, setExpiryDates] = useState<string[]>([]);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [threshold, setThreshold] = useState<number>(0.5); // 50% default

  // Fetch metadata (available dates)
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const response = await fetch('/api/quadrant/data?metadata=true');
        if (!response.ok) throw new Error('Failed to fetch metadata');
        
        const result = await response.json();
        if (result.success) {
          setTradeDates(result.data.tradeDates);
          setExpiryDates(result.data.expiryDates);
          
          // Set defaults
          if (result.data.tradeDates.length > 0) {
            setTradeDate(result.data.tradeDates[0]); // Latest trade date
          }
          if (result.data.expiryDates.length > 0) {
            setExpiryDate(result.data.expiryDates[0]); // Nearest future expiry
          }
        }
      } catch (err) {
        console.error('Error fetching metadata:', err);
      }
    };

    fetchMetadata();
  }, []);

  // Fetch stock data when trade date or expiry date changes
  useEffect(() => {
    if (!tradeDate || !expiryDate) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/quadrant/data?date=${tradeDate}&expiry=${expiryDate}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch quadrant data');
        }

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || 'Unknown error');
        }

        setStocks(result.data.stocks);
        setFilteredStocks(result.data.stocks);
      } catch (err) {
        console.error('Error fetching quadrant data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load quadrant data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [tradeDate, expiryDate]);

  // Apply filters
  useEffect(() => {
    let filtered = stocks;

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toUpperCase();
      filtered = filtered.filter(stock => stock.symbol.includes(query));
    }

    // Filter by threshold
    filtered = filtered.filter(stock => Math.abs(stock.closestValue) <= threshold);

    setFilteredStocks(filtered);
  }, [searchQuery, threshold, stocks]);

  const handleStockClick = (symbol: string) => {
    window.open(`/stock/${symbol}`, '_blank');
  };

  if (isLoading) {
    return (
      <>
        <Header />
        <LoadingSpinner message="Loading quadrant analysis..." />
      </>
    );
  }

  if (error) {
    return (
      <>
        <Header />
        <ErrorDisplay error={error} onRetry={() => window.location.reload()} />
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8">
          {/* Filters */}
          <div className="mb-8 bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold mb-4">Filters</h2>
            <div className="grid md:grid-cols-4 gap-6">
              {/* Trade Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Trade Date
                </label>
                <select
                  value={tradeDate}
                  onChange={(e) => setTradeDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {tradeDates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </div>

              {/* Expiry Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Expiry Date
                </label>
                <select
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {expiryDates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Search Symbol
                </label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="e.g., AAPL"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Threshold */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Proximity Threshold: {(threshold * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={threshold}
                  onChange={(e) => setThreshold(parseFloat(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="mt-4 text-sm text-gray-600">
              <div>Showing: <span className="font-semibold">{filteredStocks.length}</span> of <span className="font-semibold">{stocks.length}</span> stocks</div>
            </div>
          </div>

          {/* Quadrant Chart */}
          <div className="mb-8">
            <QuadrantChart
              data={filteredStocks}
              onStockClick={handleStockClick}
              height={600}
            />
          </div>

          {/* Stock List */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold mb-4">Stock List</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b-2 border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                      Symbol
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                      Close
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                      Closest Level
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                      Distance
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredStocks.slice(0, 50).map((stock) => (
                    <tr key={stock.symbol} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-semibold">
                        {stock.symbol}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono">
                        ${stock.close.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                          {stock.closestLevel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono">
                        {(stock.closestValue * 100).toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleStockClick(stock.symbol)}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          View Chart →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredStocks.length > 50 && (
              <p className="mt-4 text-sm text-gray-500 text-center">
                Showing first 50 stocks. Use filters to narrow down results.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
