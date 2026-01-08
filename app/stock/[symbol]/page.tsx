'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import TVChart from '@/components/charts/TVChart';
import StockSearch from '@/components/ui/StockSearch';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import Header from '@/components/layout/Header';
import { LevelCalculation } from '@/types/stock';
import { getLevelColor, getLevelDisplayName, formatCurrency, formatPercentage } from '@/lib/utils';
import { format, subDays } from 'date-fns';

export default function StockPage() {
  const params = useParams();
  const symbol = params?.symbol as string;
  
  const [stockData, setStockData] = useState<any>(null);
  const [ohlcData, setOhlcData] = useState<any[]>([]);
  const [oiData, setOiData] = useState<any[]>([]);
  const [levels, setLevels] = useState<LevelCalculation[]>([]);
  const [closestLevel, setClosestLevel] = useState<string>('');
  const [historicalLevels, setHistoricalLevels] = useState<Map<string, { levels: LevelCalculation[], closestLevel: string }>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiryDates, setExpiryDates] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  
  // Track loaded date ranges to avoid duplicate fetches
  const loadedRangesRef = useRef<{ from: string; to: string }[]>([]);

  useEffect(() => {
    if (!symbol) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const to = format(new Date(), 'yyyy-MM-dd');
        const from = format(subDays(new Date(), 60), 'yyyy-MM-dd');
        
        // Track initial loaded range
        loadedRangesRef.current = [{ from, to }];

        // Fetch stock details, levels, and expiry dates
        const [detailsRes, ohlcRes, levelsRes, expiryRes] = await Promise.all([
          fetch(`/api/stocks/${symbol}`),
          fetch(`/api/stocks/${symbol}/ohlc?from=${from}&to=${to}`),
          fetch(`/api/stocks/${symbol}/levels`),
          fetch(`/api/stocks/${symbol}/expiry-dates`),
        ]);

        // Check OHLC response (required)
        if (!ohlcRes.ok) {
          const errorData = await ohlcRes.json();
          throw new Error(`OHLC data failed: ${errorData.error || ohlcRes.statusText}`);
        }

        const ohlc = await ohlcRes.json();
        if (!ohlc.success) {
          throw new Error(ohlc.error || 'Failed to fetch OHLC data');
        }

        // Details and levels are optional (may not exist in DB)
        const details = detailsRes.ok ? await detailsRes.json() : { success: true, data: null };
        const levelsData = levelsRes.ok ? await levelsRes.json() : { success: true, data: null };
        const expiryData = expiryRes.ok ? await expiryRes.json() : { success: true, data: { expiryDates: [] } };

        // Set OHLC data (always required)
        setOhlcData(ohlc.data.data || []);
        
        // Set stock details and levels only if available from database
        if (details.success && details.data) {
          setStockData(details.data);
        }
        if (levelsData.success && levelsData.data) {
          setLevels(levelsData.data.calculated || []);
          setClosestLevel(levelsData.data.closestLevel);
        }
        
        // Set expiry dates if available
        if (expiryData.success && expiryData.data.expiryDates.length > 0) {
          setExpiryDates(expiryData.data.expiryDates);
          const firstExpiry = expiryData.data.expiryDates[0];
          setSelectedExpiry(firstExpiry);
          
          // Fetch historical levels for the first expiry immediately
          const dates = (ohlc.data.data || []).map((d: any) => d.date).sort();
          if (dates.length > 0) {
            const from = dates[0];
            const to = dates[dates.length - 1];
            
            console.log(`Fetching initial historical levels for ${symbol} with expiry: ${firstExpiry}, from ${from} to ${to}`);
            try {
              const histResponse = await fetch(`/api/stocks/${symbol}/levels?expiry=${firstExpiry}&range=true&from=${from}&to=${to}`);
              
              console.log('Historical API response status:', histResponse.status);
              
              if (histResponse.ok) {
                const histLevelsData = await histResponse.json();
                console.log('Initial historical levels data received:', histLevelsData);
                
                if (histLevelsData.success && histLevelsData.data && histLevelsData.data.history) {
                  const levelsMap = new Map();
                  console.log('Processing initial historical data, count:', histLevelsData.data.history.length);
                  
                  // Find the latest date with data
                  let latestDate = '';
                  let latestLevels: any = null;
                  
                  histLevelsData.data.history.forEach((item: any) => {
                    console.log(`Adding to map - Date: ${item.date}, Levels:`, item.calculated);
                    levelsMap.set(item.date, {
                      levels: item.calculated,
                      closestLevel: item.closestLevel
                    });
                    
                    // Track the latest date
                    if (!latestDate || item.date > latestDate) {
                      latestDate = item.date;
                      latestLevels = item;
                    }
                  });
                  
                  console.log('Initial historical levels map size:', levelsMap.size);
                  console.log('Map keys:', Array.from(levelsMap.keys()));
                  console.log('Latest date with data:', latestDate);
                  console.log('Latest levels data:', latestLevels);
                  
                  setHistoricalLevels(levelsMap);
                  
                  // Extract OI data from the levels response
                  console.log('Sample history item:', JSON.stringify(histLevelsData.data.history[0], null, 2));
                  const oiDataFromLevels = histLevelsData.data.history
                    .filter((item: any) => {
                      const hasOi = item.oi && (item.oi.callOi || item.oi.putOi || item.oi.oiDiff);
                      if (!hasOi) console.log('Item missing OI:', item.date || item.tradeDate, item);
                      return hasOi;
                    })
                    .map((item: any) => {
                      // Try multiple possible date field names
                      const dateValue = item.date || item.tradeDate || item.TRADE_DATE;
                      if (!dateValue) {
                        console.warn('No date field found in item:', Object.keys(item));
                      }
                      return {
                        time: dateValue,
                        callOi: item.oi.callOi || 0,
                        putOi: item.oi.putOi || 0,
                        oiDiff: item.oi.oiDiff || 0,
                      };
                    });
                  
                  console.log(`Extracted ${oiDataFromLevels.length} OI data points from initial levels response`);
                  console.log('Sample extracted OI data:', oiDataFromLevels.slice(0, 3));
                  setOiData(oiDataFromLevels);
                  
                  // Set the latest levels for display (price lines) - use the latest available date
                  if (latestLevels) {
                    console.log('Setting levels from latest date:', latestDate, 'Levels:', latestLevels.calculated);
                    setLevels(latestLevels.calculated || []);
                    setClosestLevel(latestLevels.closestLevel);
                  }
                } else {
                  console.error('Historical levels data structure invalid:', histLevelsData);
                }
              } else {
                console.error('Historical API failed with status:', histResponse.status);
              }
            } catch (histErr) {
              console.error('Error fetching initial historical levels:', histErr);
            }
          } else {
            console.warn('No OHLC dates available for historical levels fetch');
          }
        }
      } catch (err) {
        console.error('Error fetching stock data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load stock data');
      } finally {
        setIsLoading(false);
        setIsInitialLoad(false);
      }
    };

    fetchData();
  }, [symbol]);

  // Fetch historical levels data when expiry date changes (skip initial load)
  useEffect(() => {
    if (!symbol || !selectedExpiry || isInitialLoad || ohlcData.length === 0) return;

    const fetchHistoricalLevels = async () => {
      try {
        // Get date range from OHLC data
        const dates = ohlcData.map(d => d.date).sort();
        const from = dates[0];
        const to = dates[dates.length - 1];
        
        console.log(`Fetching historical levels for ${symbol} with expiry: ${selectedExpiry}, from ${from} to ${to}`);
        const response = await fetch(`/api/stocks/${symbol}/levels?expiry=${selectedExpiry}&range=true&from=${from}&to=${to}`);
        
        if (response.ok) {
          const levelsData = await response.json();
          console.log('Historical levels data received:', levelsData);
          
          if (levelsData.success && levelsData.data && levelsData.data.history) {
            // Build a map of date -> levels
            const levelsMap = new Map();
            console.log('Processing historical data, count:', levelsData.data.history.length);
            
            // Find the latest date with data
            let latestDate = '';
            let latestLevels: any = null;
            
            levelsData.data.history.forEach((item: any) => {
              console.log(`Adding to map - Date: ${item.date}, Levels:`, item.calculated);
              levelsMap.set(item.date, {
                levels: item.calculated,
                closestLevel: item.closestLevel
              });
              
              // Track the latest date
              if (!latestDate || item.date > latestDate) {
                latestDate = item.date;
                latestLevels = item;
              }
            });
            
            console.log('Historical levels map size:', levelsMap.size);
            console.log('Map keys:', Array.from(levelsMap.keys()));
            console.log('Latest date with data:', latestDate);
            console.log('Latest levels data:', latestLevels);
            
            setHistoricalLevels(levelsMap);
            
            // Extract OI data from the levels response
            const oiDataFromLevels = levelsData.data.history
              .filter((item: any) => {
                const hasOi = item.oi && (item.oi.callOi || item.oi.putOi || item.oi.oiDiff);
                if (!hasOi) console.log('Item missing OI:', item.date || item.tradeDate, item);
                return hasOi;
              })
              .map((item: any) => {
                const dateValue = item.date || item.tradeDate || item.TRADE_DATE;
                if (!dateValue) {
                  console.warn('No date field found in item:', Object.keys(item));
                }
                return {
                  time: dateValue,
                  callOi: item.oi.callOi || 0,
                  putOi: item.oi.putOi || 0,
                  oiDiff: item.oi.oiDiff || 0,
                };
              });
            
            console.log(`Extracted ${oiDataFromLevels.length} OI data points from expiry change`);
            console.log('Sample extracted OI data:', oiDataFromLevels.slice(0, 3));
            setOiData(oiDataFromLevels);
            
            // Set the latest levels for display (price lines) - use the latest available date
            if (latestLevels) {
              console.log('Setting levels from latest date:', latestDate, 'Levels:', latestLevels.calculated);
              setLevels(latestLevels.calculated || []);
              setClosestLevel(latestLevels.closestLevel);
            }
          } else {
            console.log('No historical levels data available');
            setHistoricalLevels(new Map());
            setLevels([]);
            setClosestLevel('');
            setOiData([]);
          }
        }
      } catch (err) {
        console.error('Error fetching historical levels:', err);
      }
    };

    fetchHistoricalLevels();
  }, [selectedExpiry, symbol, isInitialLoad, ohlcData]);

  // Handle loading more historical data
  const handleLoadMore = useCallback(async (
    direction: 'past' | 'future',
    firstVisibleTime: string,
    lastVisibleTime: string
  ) => {
    console.log('===== handleLoadMore called =====');
    console.log('Direction:', direction);
    console.log('First visible time:', firstVisibleTime);
    console.log('Last visible time:', lastVisibleTime);
    console.log('isLoadingMore:', isLoadingMore);
    console.log('symbol:', symbol);
    
    if (isLoadingMore || !symbol) {
      console.log('Skipping load - already loading or no symbol');
      return;
    }

    try {
      setIsLoadingMore(true);
      console.log('Set isLoadingMore to true');

      let from: string;
      let to: string;

      if (direction === 'past') {
        // Load 60 more days before the earliest data
        const earliestDate = new Date(ohlcData[0]?.date || firstVisibleTime);
        to = format(subDays(earliestDate, 1), 'yyyy-MM-dd');
        from = format(subDays(earliestDate, 60), 'yyyy-MM-dd');
        console.log('Loading PAST data from', from, 'to', to);
      } else {
        // Load more recent data (if needed in future)
        const latestDate = new Date(ohlcData[ohlcData.length - 1]?.date || lastVisibleTime);
        from = format(new Date(latestDate.getTime() + 86400000), 'yyyy-MM-dd');
        to = format(new Date(), 'yyyy-MM-dd');
        console.log('Loading FUTURE data from', from, 'to', to);
      }

      // Check if this range is already loaded
      const isAlreadyLoaded = loadedRangesRef.current.some(range => {
        return from >= range.from && to <= range.to;
      });

      if (isAlreadyLoaded) {
        setIsLoadingMore(false);
        return;
      }

      console.log(`Loading more ${direction} data from ${from} to ${to}`);

      const ohlcResponse = await fetch(`/api/stocks/${symbol}/ohlc?from=${from}&to=${to}`);
      
      if (!ohlcResponse.ok) {
        throw new Error('Failed to load more data');
      }

      const result = await ohlcResponse.json();
      
      if (result.success && result.data.data.length > 0) {
        const newData = result.data.data;
        
        // Merge new data with existing data
        setOhlcData(prevData => {
          if (direction === 'past') {
            // Prepend older data
            return [...newData, ...prevData];
          } else {
            // Append newer data
            return [...prevData, ...newData];
          }
        });

        // Track the newly loaded range
        loadedRangesRef.current.push({ from, to });

        // Fetch historical levels for the newly loaded date range if we have a selected expiry
        if (selectedExpiry) {
          console.log(`Fetching historical levels for newly loaded data (${from} to ${to})`);
          
          const levelsResponse = await fetch(
            `/api/stocks/${symbol}/levels?expiry=${selectedExpiry}&range=true&from=${from}&to=${to}`
          );
          
          if (levelsResponse.ok) {
            const levelsResult = await levelsResponse.json();
            
            if (levelsResult.success && levelsResult.data?.history) {
              const historyData = levelsResult.data.history;
              console.log(`Received ${historyData.length} level records for date range ${from} to ${to}`);

              // Update the historical levels map with new dates
              setHistoricalLevels(prevMap => {
                const newMap = new Map(prevMap);
                
                historyData.forEach((item: any) => {
                  const calculatedLevels = item.calculated || [];
                  newMap.set(item.date, {
                    levels: calculatedLevels,
                    closestLevel: item.closestLevel || ''
                  });
                });

                console.log(`Historical levels map updated, now has ${newMap.size} entries`);
                return newMap;
              });

              // Extract and merge OI data
              const newOiData = historyData
                .filter((item: any) => item.oi)
                .map((item: any) => ({
                  time: item.date,
                  callOi: item.oi.callOi,
                  putOi: item.oi.putOi,
                  oiDiff: item.oi.oiDiff,
                }));

              setOiData(prevData => {
                if (direction === 'past') {
                  return [...newOiData, ...prevData];
                } else {
                  return [...prevData, ...newOiData];
                }
              });
              console.log(`Added ${newOiData.length} OI data points from levels`);
            } else {
              console.log('No historical data in response or unexpected format:', levelsResult);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error loading more data:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [symbol, ohlcData, isLoadingMore]);


  if (isLoading) {
    return (
      <>
        <Header />
        <LoadingSpinner message={`Loading ${symbol} data...`} />
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
          {/* Search Bar */}
          <div className="mb-8 flex justify-center">
            <StockSearch />
          </div>

          {/* Expiry Date Selector */}
          {!isLoading && expiryDates.length > 0 && (
            <div className="mb-6 flex items-center justify-end gap-3">
              <label htmlFor="expiry-select" className="text-sm font-medium text-gray-700">
                Expiry Date:
              </label>
              <select
                id="expiry-select"
                value={selectedExpiry}
                onChange={(e) => setSelectedExpiry(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                {expiryDates.map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Main Chart */}
          <div className="mb-8">
            <TVChart
              symbol={symbol.toUpperCase()}
              candleData={ohlcData.map(d => ({
                time: d.date,
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
              }))}
              volumeData={ohlcData.map(d => ({
                time: d.date,
                value: d.volume,
              }))}
              oiData={oiData.map(d => ({
                time: d.time,  // OI data already has 'time' field from extraction
                callOi: d.callOi,
                putOi: d.putOi,
                oiDiff: d.oiDiff,
              }))}
              levels={levels}
              closestLevel={closestLevel}
              historicalLevels={historicalLevels}
              currentPrice={stockData?.close}
              height={600}
              onLoadMore={handleLoadMore}
              isLoadingMore={isLoadingMore}
            />
          </div>

          {/* Stock Details */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Level Details Table */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-xl font-bold mb-4">Price Levels</h3>
              {!stockData ? (
                <div className="text-center py-8 text-gray-500">
                  <p className="mb-2">Level data not available for this symbol</p>
                  <p className="text-sm">Displaying OHLC data only</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {stockData?.levels?.map((level: any) => {
                  const isClosest = level.name === closestLevel;
                  const color = isClosest ? '#3B82F6' : getLevelColor(level.name);

                  return (
                    <div
                      key={level.name}
                      className={`p-3 rounded-lg border-2 ${
                        isClosest
                          ? 'bg-blue-50 border-blue-500'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span className="font-semibold">
                            {getLevelDisplayName(level.name)}
                          </span>
                          {isClosest && (
                            <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded">
                              Closest
                            </span>
                          )}
                        </div>
                        <span className="font-bold">{formatCurrency(level.price)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Distance:</span>
                        <span className="font-mono">
                          {formatCurrency(level.distance)} ({level.percentage})
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
            </div>

            {/* Stock Info */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-xl font-bold mb-4">Stock Information</h3>
              <div className="space-y-3">
                <div className="flex justify-between pb-2 border-b border-gray-200">
                  <span className="text-gray-600">Symbol:</span>
                  <span className="font-semibold text-xl">{symbol.toUpperCase()}</span>
                </div>
                {stockData && (
                  <>
                    <div className="flex justify-between pb-2 border-b border-gray-200">
                      <span className="text-gray-600">Close Price:</span>
                      <span className="font-semibold text-xl">
                        {formatCurrency(stockData?.close)}
                      </span>
                    </div>
                    <div className="flex justify-between pb-2 border-b border-gray-200">
                      <span className="text-gray-600">Trade Date:</span>
                      <span className="font-medium">{stockData?.tradeDate}</span>
                    </div>
                    <div className="flex justify-between pb-2 border-b border-gray-200">
                      <span className="text-gray-600">Expiry Date:</span>
                      <span className="font-medium">{stockData?.expiryDate || 'N/A'}</span>
                    </div>
                  </>
                )}
                {!stockData && ohlcData.length > 0 && (
                  <div className="flex justify-between pb-2 border-b border-gray-200">
                    <span className="text-gray-600">Latest Close:</span>
                    <span className="font-semibold text-xl">
                      {formatCurrency(ohlcData[ohlcData.length - 1]?.close)}
                    </span>
                  </div>
                )}

                {stockData?.closestLevel && (
                  <div className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-lg">
                    <p className="text-sm text-gray-700 mb-2">
                      <strong>Analysis:</strong>
                    </p>
                    <p className="text-sm">
                      The current price is closest to the{' '}
                      <strong className="text-blue-700">
                        {getLevelDisplayName(stockData.closestLevel.name)}
                      </strong>{' '}
                      level at {formatCurrency(stockData.closestLevel.price)}, with a distance
                      of {stockData.closestLevel.percentage}.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
