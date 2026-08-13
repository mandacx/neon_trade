'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import TVChart from '@/components/charts/TVChart';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import Header from '@/components/layout/Header';
import ScanAlertsTicker from '@/components/ui/ScanAlertsTicker';
import { LevelCalculation, ScanAlert } from '@/types/stock';
import { getLevelColor, getLevelDisplayName, formatCurrency, formatPercentage, isUsMarketHours } from '@/lib/utils';
import { isIntradayInterval } from '@/lib/alpaca';
import { format, subDays } from 'date-fns';

type SelectableInterval = '1min' | '5min' | '15min' | '30min' | '1hour' | 'daily';

// initialDays = default lookback on first load / interval switch; chunkDays = how
// much more to pull per scroll-back "load more". Finer intervals use smaller
// windows so a single fetch/pagination round stays a reasonable size.
const INTERVAL_CONFIG: Record<SelectableInterval, { initialDays: number; chunkDays: number; label: string }> = {
  '1min': { initialDays: 2, chunkDays: 1, label: '1m' },
  '5min': { initialDays: 5, chunkDays: 3, label: '5m' },
  '15min': { initialDays: 10, chunkDays: 5, label: '15m' },
  '30min': { initialDays: 20, chunkDays: 10, label: '30m' },
  '1hour': { initialDays: 30, chunkDays: 15, label: '1H' },
  daily: { initialDays: 60, chunkDays: 60, label: '1D' },
};
const INTERVAL_ORDER: SelectableInterval[] = ['1min', '5min', '15min', '30min', '1hour', 'daily'];

// One row of the 7-level historical table: the DB's full level set (superset of
// the 5 "official" levels used for closest-level business logic elsewhere).
type SevenLevel = { name: string; price: number; value: number };
type LevelHistoryEntry = {
  levels: LevelCalculation[];
  closestLevel: string;
  close: number;
  sevenLevels: SevenLevel[];
  oi?: { callOi: number; putOi: number; oiDiff: number };
  ratios?: { upc: number; ucpr: number };
};
const SEVEN_LEVEL_ORDER = ['put_low', 'put_int', 'put_call_int', 'call_int', 'call_high', 'call_low', 'put_high'];

export default function StockPage() {
  const params = useParams();
  const symbol = params?.symbol as string;

  const [stockData, setStockData] = useState<any>(null);
  const [ohlcData, setOhlcData] = useState<any[]>([]);
  const [oiData, setOiData] = useState<any[]>([]);
  const [scanAlerts, setScanAlerts] = useState<ScanAlert[]>([]);
  const [levels, setLevels] = useState<LevelCalculation[]>([]);
  const [closestLevel, setClosestLevel] = useState<string>('');
  const [historicalLevels, setHistoricalLevels] = useState<Map<string, LevelHistoryEntry>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiryDates, setExpiryDates] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [chartInterval, setChartInterval] = useState<SelectableInterval>('daily');
  const [livePrice, setLivePrice] = useState<number | undefined>(undefined);

  // Track loaded date ranges to avoid duplicate fetches
  const loadedRangesRef = useRef<{ from: string; to: string }[]>([]);

  // Stable refs so handleLoadMore never changes reference (prevents chart recreation)
  const ohlcDataRef = useRef<any[]>([]);
  const isLoadingMoreRef = useRef(false);
  const selectedExpiryRef = useRef('');
  const chartIntervalRef = useRef<SelectableInterval>('daily');
  useEffect(() => { ohlcDataRef.current = ohlcData; }, [ohlcData]);
  useEffect(() => { isLoadingMoreRef.current = isLoadingMore; }, [isLoadingMore]);
  useEffect(() => { selectedExpiryRef.current = selectedExpiry; }, [selectedExpiry]);
  useEffect(() => { chartIntervalRef.current = chartInterval; }, [chartInterval]);

  useEffect(() => {
    if (!symbol) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { initialDays } = INTERVAL_CONFIG[chartInterval];
        const to = format(new Date(), 'yyyy-MM-dd');
        const from = format(subDays(new Date(), initialDays), 'yyyy-MM-dd');

        // Track initial loaded range
        loadedRangesRef.current = [{ from, to }];

        // Fetch stock details, levels, expiry dates, and scan alerts
        const [detailsRes, ohlcRes, levelsRes, expiryRes, scanAlertsRes] = await Promise.all([
          fetch(`/api/stocks/${symbol}`),
          fetch(`/api/stocks/${symbol}/ohlc?from=${from}&to=${to}&interval=${chartInterval}`),
          fetch(`/api/stocks/${symbol}/levels`),
          fetch(`/api/stocks/${symbol}/expiry-dates`),
          fetch(`/api/stocks/${symbol}/scan-alerts?from=${from}&to=${to}`),
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

        if (scanAlertsRes.ok) {
          const scanAlertsData = await scanAlertsRes.json();
          if (scanAlertsData.success) setScanAlerts(scanAlertsData.data.alerts || []);
        }

        // Set stock details and levels only if available from database
        if (details.success && details.data) {
          setStockData(details.data);
        }
        if (levelsData.success && levelsData.data) {
          setLevels(levelsData.data.calculated || []);
          setClosestLevel(levelsData.data.closestLevel);
        }

        // Set expiry dates if available. Keep the user's existing selection across
        // interval switches — only default to the nearest expiry on true first load.
        if (expiryData.success && expiryData.data.expiryDates.length > 0) {
          const firstExpiry = expiryData.data.expiryDates[0];
          const expiryToUse = selectedExpiryRef.current || firstExpiry;
          setExpiryDates(expiryData.data.expiryDates);
          setSelectedExpiry(expiryToUse);

          const dates = (ohlc.data.data || []).map((d: any) => d.date).sort();
          if (dates.length > 0) {
            const levelsFrom = dates[0];
            const levelsTo = dates[dates.length - 1];

            try {
              const histResponse = await fetch(`/api/stocks/${symbol}/levels?expiry=${expiryToUse}&range=true&from=${levelsFrom}&to=${levelsTo}`);

              if (histResponse.ok) {
                const histLevelsData = await histResponse.json();

                if (histLevelsData.success && histLevelsData.data && histLevelsData.data.history) {
                  const levelsMap = new Map();
                  let latestDate = '';
                  let latestLevels: any = null;

                  histLevelsData.data.history.forEach((item: any) => {
                    levelsMap.set(item.date, {
                      levels: item.calculated,
                      closestLevel: item.closestLevel,
                      close: item.close,
                      sevenLevels: item.sevenLevels || [],
                      oi: item.oi,
                      ratios: item.ratios,
                    });
                    if (!latestDate || item.date > latestDate) {
                      latestDate = item.date;
                      latestLevels = item;
                    }
                  });

                  setHistoricalLevels(levelsMap);

                  const oiDataFromLevels = histLevelsData.data.history
                    .filter((item: any) => item.oi != null)
                    .map((item: any) => ({
                      time: item.date || item.tradeDate || item.TRADE_DATE,
                      callOi: Number(item.oi.callOi) || 0,
                      putOi: Number(item.oi.putOi) || 0,
                      oiDiff: Number(item.oi.oiDiff) || 0,
                    }));

                  setOiData(oiDataFromLevels);

                  if (latestLevels) {
                    setLevels(latestLevels.calculated || []);
                    setClosestLevel(latestLevels.closestLevel);
                  }
                }
              }
            } catch (histErr) {
              console.error('Error fetching initial historical levels:', histErr);
            }
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
  }, [symbol, chartInterval]);

  // Fetch historical levels data when expiry date changes (skip initial load)
  useEffect(() => {
    if (!symbol || !selectedExpiry || isInitialLoad || ohlcData.length === 0) return;

    const fetchHistoricalLevels = async () => {
      try {
        const dates = ohlcData.map(d => d.date).sort();
        const from = dates[0];
        const to = dates[dates.length - 1];

        const response = await fetch(`/api/stocks/${symbol}/levels?expiry=${selectedExpiry}&range=true&from=${from}&to=${to}`);

        if (response.ok) {
          const levelsData = await response.json();

          if (levelsData.success && levelsData.data && levelsData.data.history) {
            const levelsMap = new Map();
            let latestDate = '';
            let latestLevels: any = null;

            levelsData.data.history.forEach((item: any) => {
              levelsMap.set(item.date, {
                levels: item.calculated,
                closestLevel: item.closestLevel,
                close: item.close,
                sevenLevels: item.sevenLevels || [],
                oi: item.oi,
                ratios: item.ratios,
              });
              if (!latestDate || item.date > latestDate) {
                latestDate = item.date;
                latestLevels = item;
              }
            });

            setHistoricalLevels(levelsMap);

            const oiDataFromLevels = levelsData.data.history
              .filter((item: any) => item.oi != null)
              .map((item: any) => ({
                time: item.date || item.tradeDate || item.TRADE_DATE,
                callOi: Number(item.oi.callOi) || 0,
                putOi: Number(item.oi.putOi) || 0,
                oiDiff: Number(item.oi.oiDiff) || 0,
              }));

            setOiData(oiDataFromLevels);

            if (latestLevels) {
              setLevels(latestLevels.calculated || []);
              setClosestLevel(latestLevels.closestLevel);
            }
          } else {
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

  // Live price — polls Alpaca's latest trade. Fast during market hours for a
  // genuinely "live" feel, much slower off-hours since the price can't move.
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    function poll() {
      fetch(`/api/stocks/${symbol}/quote`)
        .then(r => r.json())
        .then(res => {
          if (cancelled || !res.success || !res.data) return;
          setLivePrice(res.data.price);
        })
        .catch(() => {})
        .finally(() => {
          if (cancelled) return;
          timeoutId = setTimeout(poll, isUsMarketHours(new Date()) ? 10_000 : 5 * 60_000);
        });
    }

    poll();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [symbol]);

  // Handle loading more historical data
  const handleLoadMore = useCallback(async (
    direction: 'past' | 'future',
    firstVisibleTime: string,
    lastVisibleTime: string
  ) => {
    if (isLoadingMoreRef.current || !symbol) return;

    try {
      setIsLoadingMore(true);

      let from: string;
      let to: string;
      const { chunkDays } = INTERVAL_CONFIG[chartIntervalRef.current];

      const currentOhlcData = ohlcDataRef.current;
      if (direction === 'past') {
        const earliestDate = new Date(currentOhlcData[0]?.date || firstVisibleTime);
        to = format(subDays(earliestDate, 1), 'yyyy-MM-dd');
        from = format(subDays(earliestDate, chunkDays), 'yyyy-MM-dd');
      } else {
        const latestDate = new Date(currentOhlcData[currentOhlcData.length - 1]?.date || lastVisibleTime);
        from = format(new Date(latestDate.getTime() + 86400000), 'yyyy-MM-dd');
        to = format(new Date(), 'yyyy-MM-dd');
      }

      // Check if this range is already loaded
      const isAlreadyLoaded = loadedRangesRef.current.some(range => {
        return from >= range.from && to <= range.to;
      });

      if (isAlreadyLoaded) {
        setIsLoadingMore(false);
        return;
      }

      const ohlcResponse = await fetch(`/api/stocks/${symbol}/ohlc?from=${from}&to=${to}&interval=${chartIntervalRef.current}`);

      if (!ohlcResponse.ok) {
        throw new Error('Failed to load more data');
      }

      const result = await ohlcResponse.json();

      // Always mark range as loaded to prevent re-fetching empty ranges
      loadedRangesRef.current.push({ from, to });

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

        const scanAlertsResponse = await fetch(`/api/stocks/${symbol}/scan-alerts?from=${from}&to=${to}`);
        if (scanAlertsResponse.ok) {
          const scanAlertsResult = await scanAlertsResponse.json();
          if (scanAlertsResult.success && scanAlertsResult.data.alerts.length > 0) {
            const newAlerts: ScanAlert[] = scanAlertsResult.data.alerts;
            setScanAlerts(prevAlerts => {
              const seen = new Set(prevAlerts.map(a => `${a.symbol}|${a.expiryDate}|${a.loadDateTime}`));
              const deduped = newAlerts.filter(a => !seen.has(`${a.symbol}|${a.expiryDate}|${a.loadDateTime}`));
              return direction === 'past' ? [...deduped, ...prevAlerts] : [...prevAlerts, ...deduped];
            });
          }
        }

        if (selectedExpiryRef.current) {
          const levelsResponse = await fetch(
            `/api/stocks/${symbol}/levels?expiry=${selectedExpiryRef.current}&range=true&from=${from}&to=${to}`
          );

          if (levelsResponse.ok) {
            const levelsResult = await levelsResponse.json();

            if (levelsResult.success && levelsResult.data?.history) {
              const historyData = levelsResult.data.history;

              setHistoricalLevels(prevMap => {
                const newMap = new Map(prevMap);
                historyData.forEach((item: any) => {
                  newMap.set(item.date, {
                    levels: item.calculated || [],
                    closestLevel: item.closestLevel || '',
                    close: item.close,
                    sevenLevels: item.sevenLevels || [],
                    oi: item.oi,
                    ratios: item.ratios,
                  });
                });
                return newMap;
              });

              const newOiData = historyData
                .filter((item: any) => item.oi != null)
                .map((item: any) => ({
                  time: item.date,
                  callOi: Number(item.oi.callOi) || 0,
                  putOi: Number(item.oi.putOi) || 0,
                  oiDiff: Number(item.oi.oiDiff) || 0,
                }));

              setOiData(prevData => direction === 'past'
                ? [...newOiData, ...prevData]
                : [...prevData, ...newOiData]
              );
            }
          }
        }
      }
    } catch (err) {
      console.error('Error loading more data:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [symbol]);


  // Always derive closest level from the current levels array (avoids stale/mismatched string state)
  const closestLevelName = useMemo(() => {
    if (levels.length > 0) {
      return levels.reduce((c, l) => Math.abs(l.value) < Math.abs(c.value) ? l : c).name;
    }
    return stockData?.closestLevel?.name || closestLevel || '';
  }, [levels, stockData, closestLevel]);

  const candleData = useMemo(() => ohlcData.map(d => ({
    time: d.timestamp,
    dayKey: d.date,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  })), [ohlcData]);

  const volumeData = useMemo(() => ohlcData.map(d => ({
    time: d.timestamp,
    dayKey: d.date,
    value: d.volume,
  })), [ohlcData]);

  const chartOiData = useMemo(() => oiData.map(d => ({
    time: d.time,
    callOi: d.callOi,
    putOi: d.putOi,
    oiDiff: d.oiDiff,
  })), [oiData]);

  // Most-recent-first rows for the historical 7-level table below the main chart
  const levelHistoryRows = useMemo(() => {
    return Array.from(historicalLevels.entries())
      .map(([date, entry]) => ({ date, ...entry }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [historicalLevels]);

  const intervalSelector = (
    <div className="flex items-center gap-1">
      {INTERVAL_ORDER.map((iv) => (
        <button
          key={iv}
          onClick={() => setChartInterval(iv)}
          className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
            chartInterval === iv
              ? 'bg-green-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {INTERVAL_CONFIG[iv].label}
        </button>
      ))}
    </div>
  );

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
          <div className="mb-6">
            <ScanAlertsTicker />
          </div>

          {/* Expiry Selector — drives both the price level lines and the scan alert markers on the chart */}
          {!isLoading && expiryDates.length > 0 && (
            <div className="mb-6 flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-gray-500 mr-1">Expiry Date:</span>
              {expiryDates.map((date) => {
                const isActive = date === selectedExpiry;
                const alertCount = scanAlerts.filter(a => a.expiryDate === date).length;
                return (
                  <button
                    key={date}
                    onClick={() => setSelectedExpiry(date)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      isActive
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {date}
                    {alertCount > 0 && (
                      <span className={`ml-1.5 ${isActive ? 'opacity-90' : 'text-purple-600'}`}>
                        🔔{alertCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Main Chart */}
          <div className="mb-8">
            <TVChart
              symbol={symbol.toUpperCase()}
              candleData={candleData}
              volumeData={volumeData}
              oiData={chartOiData}
              levels={levels}
              closestLevel={closestLevelName}
              historicalLevels={historicalLevels}
              scanAlerts={scanAlerts}
              selectedExpiry={selectedExpiry}
              isIntraday={isIntradayInterval(chartInterval)}
              livePrice={livePrice}
              currentPrice={stockData?.close}
              headerExtra={intervalSelector}
              height={600}
              onLoadMore={handleLoadMore}
              isLoadingMore={isLoadingMore}
            />
          </div>

          {/* Stock Details */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Level Details Table */}
            <div className="bg-white rounded-lg shadow-md p-4">
              <h3 className="text-base font-bold mb-2">
                Price Levels
                <Link href="/guide" className="ml-2 text-xs font-medium text-blue-600 hover:underline">What do these mean?</Link>
              </h3>
              {levels.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-sm">
                  <p className="mb-1">Level data not available in database</p>
                  <p className="text-xs">Displaying broker OHLC data only</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {levels.map((level: any) => {
                  const isClosest = level.name === closestLevelName;
                  const color = isClosest ? '#3B82F6' : getLevelColor(level.name);

                  return (
                    <div
                      key={level.name}
                      className={`px-2.5 py-1.5 rounded-md border ${
                        isClosest
                          ? 'bg-blue-50 border-blue-500'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-sm font-semibold">
                            {getLevelDisplayName(level.name)}
                          </span>
                          {isClosest && (
                            <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded">
                              Closest
                            </span>
                          )}
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="font-bold text-sm">{formatCurrency(level.price)}</span>
                          <span className="text-xs font-mono text-gray-500">{level.percentage}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
            </div>

            {/* Stock Info */}
            <div className="bg-white rounded-lg shadow-md p-4">
              <h3 className="text-base font-bold mb-2">Stock Information</h3>
              <div className="space-y-1.5">
                <div className="flex justify-between pb-1.5 border-b border-gray-200">
                  <span className="text-sm text-gray-600">Symbol:</span>
                  <span className="font-semibold">{symbol.toUpperCase()}</span>
                </div>
                {stockData && (
                  <>
                    <div className="flex justify-between pb-1.5 border-b border-gray-200">
                      <span className="text-sm text-gray-600">Close Price:</span>
                      <span className="font-semibold">
                        {formatCurrency(stockData?.close)}
                      </span>
                    </div>
                    <div className="flex justify-between pb-1.5 border-b border-gray-200">
                      <span className="text-sm text-gray-600">Trade Date:</span>
                      <span className="text-sm font-medium">{stockData?.tradeDate}</span>
                    </div>
                    <div className="flex justify-between pb-1.5 border-b border-gray-200">
                      <span className="text-sm text-gray-600">Expiry Date:</span>
                      <span className="text-sm font-medium">{selectedExpiry || stockData?.expiryDate || 'N/A'}</span>
                    </div>
                  </>
                )}
                {!stockData && ohlcData.length > 0 && (
                  <div className="flex justify-between pb-1.5 border-b border-gray-200">
                    <span className="text-sm text-gray-600">Latest Close:</span>
                    <span className="font-semibold">
                      {formatCurrency(ohlcData[ohlcData.length - 1]?.close)}
                    </span>
                  </div>
                )}

                {closestLevelName && (() => {
                  const closestLvl = levels.find(l => l.name === closestLevelName)
                    || stockData?.levels?.find((l: any) => l.name === closestLevelName);
                  return closestLvl ? (
                    <div className="mt-3 p-3 bg-gradient-to-r from-blue-50 to-green-50 rounded-lg">
                      <p className="text-xs text-gray-700 mb-1"><strong>Analysis:</strong></p>
                      <p className="text-xs">
                        The current price is closest to the{' '}
                        <strong className="text-blue-700">{getLevelDisplayName(closestLevelName)}</strong>{' '}
                        level at {formatCurrency(closestLvl.price)}, with a distance
                        of {formatPercentage(closestLvl.value)}.
                      </p>
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
          </div>

          {/* 7-Level Historical Table — close price, all 7 raw DB levels, OI, and the UPC/UCPR ratio columns */}
          <div className="mt-6 bg-white rounded-lg shadow-md p-4">
            <h3 className="text-base font-bold mb-2">Historical Levels &amp; OI</h3>
            {levelHistoryRows.length === 0 ? (
              <div className="text-center py-4 text-gray-500 text-sm">
                No historical level data available{selectedExpiry ? ` for expiry ${selectedExpiry}` : ''}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500">
                      <th className="text-left py-1.5 pr-3 font-medium">Date</th>
                      <th className="text-right py-1.5 px-2 font-medium">Close</th>
                      {SEVEN_LEVEL_ORDER.map((name) => (
                        <th key={name} className="text-right py-1.5 px-2 font-medium">
                          {getLevelDisplayName(name)}
                        </th>
                      ))}
                      <th className="text-right py-1.5 px-2 font-medium">Call OI</th>
                      <th className="text-right py-1.5 px-2 font-medium">Put OI</th>
                      <th className="text-right py-1.5 px-2 font-medium">OI Diff</th>
                      <th className="text-right py-1.5 pl-2 font-medium">UPC</th>
                      <th className="text-right py-1.5 pl-2 font-medium">UCPR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levelHistoryRows.map((row) => {
                      const closest = row.sevenLevels.length > 0
                        ? row.sevenLevels.reduce((c, l) => Math.abs(l.value) < Math.abs(c.value) ? l : c)
                        : null;
                      const levelsByName = new Map(row.sevenLevels.map(l => [l.name, l]));

                      return (
                        <tr key={row.date} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                          <td className="py-1.5 pr-3 text-gray-600">{row.date}</td>
                          <td className="text-right py-1.5 px-2 font-semibold">{formatCurrency(row.close)}</td>
                          {SEVEN_LEVEL_ORDER.map((name) => {
                            const lvl = levelsByName.get(name);
                            const isClosest = !!closest && lvl && closest.name === lvl.name;
                            return (
                              <td
                                key={name}
                                className={`text-right py-1.5 px-2 font-mono ${
                                  isClosest ? 'bg-blue-50 text-blue-700 font-bold rounded' : ''
                                }`}
                              >
                                {lvl ? formatCurrency(lvl.price) : '—'}
                                {lvl && (
                                  <span className={`ml-1 ${isClosest ? 'text-blue-500' : 'text-gray-400'}`}>
                                    ({formatPercentage(lvl.value)})
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td className="text-right py-1.5 px-2 text-gray-600">{row.oi?.callOi?.toLocaleString() ?? '—'}</td>
                          <td className="text-right py-1.5 px-2 text-gray-600">{row.oi?.putOi?.toLocaleString() ?? '—'}</td>
                          <td className="text-right py-1.5 px-2 text-gray-600">{row.oi?.oiDiff?.toLocaleString() ?? '—'}</td>
                          <td className="text-right py-1.5 pl-2 text-gray-600">{row.ratios?.upc ?? '—'}</td>
                          <td className="text-right py-1.5 pl-2 text-gray-600">{row.ratios?.ucpr ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
