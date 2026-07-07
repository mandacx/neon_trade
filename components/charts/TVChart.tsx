'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, IPriceLine, CandlestickData, HistogramData, MouseEventParams, SeriesMarker, Time } from 'lightweight-charts';
import { LevelCalculation, ScanAlert } from '@/types/stock';
import { getLevelColor, getLevelDisplayName, formatCurrency, formatPercentage, SCAN_CODE_TO_LEVEL } from '@/lib/utils';

interface TVChartProps {
  symbol: string;
  candleData: Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  volumeData: Array<{
    time: string;
    value: number;
  }>;
  oiData?: Array<{
    time: string;
    callOi: number;
    putOi: number;
    oiDiff: number;
  }>;
  levels?: LevelCalculation[];
  closestLevel?: string;
  historicalLevels?: Map<string, { levels: LevelCalculation[], closestLevel: string }>;
  scanAlerts?: ScanAlert[];
  selectedExpiry?: string;
  currentPrice?: number;
  height?: number;
  onLoadMore?: (direction: 'past' | 'future', firstVisibleTime: string, lastVisibleTime: string) => void;
  isLoadingMore?: boolean;
}

export default function TVChart({
  symbol,
  candleData,
  volumeData,
  oiData = [],
  levels = [],
  closestLevel,
  historicalLevels,
  scanAlerts = [],
  selectedExpiry,
  currentPrice,
  height = 500,
  onLoadMore,
  isLoadingMore = false,
}: TVChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const ohlcDisplayRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const oiDiffSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const callOiLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const putOiLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const oiDiffLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLineRefs = useRef<IPriceLine[]>([]);
  const levelSeriesRefs = useRef<Record<string, ISeriesApi<'Line'>>>({});
  const historicalLevelsRef = useRef(historicalLevels);
  const levelsRef = useRef(levels);
  const closestLevelRef = useRef(closestLevel);
  const oiDataRef = useRef(oiData);
  const scanAlertsByDateRef = useRef<Map<string, ScanAlert[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('ALL');
  const [showPrice, setShowPrice] = useState(true);
  const [showOI, setShowOI] = useState(true);
  const [activeLevelFilter, setActiveLevelFilter] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);

  // Scan alert markers/tooltip are scoped to whichever expiry is selected for the
  // price levels — one control drives both, so they always describe the same contract.
  const visibleScanAlerts = useMemo(
    () => (selectedExpiry ? scanAlerts.filter(a => a.expiryDate === selectedExpiry) : scanAlerts),
    [scanAlerts, selectedExpiry]
  );

  useEffect(() => { historicalLevelsRef.current = historicalLevels; }, [historicalLevels]);
  useEffect(() => { levelsRef.current = levels; }, [levels]);
  useEffect(() => { closestLevelRef.current = closestLevel; }, [closestLevel]);
  useEffect(() => { oiDataRef.current = oiData; }, [oiData]);
  useEffect(() => { loadingMoreRef.current = isLoadingMore; }, [isLoadingMore]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: height,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#333',
      },
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#d1d4dc',
      },
      leftPriceScale: {
        visible: true,
        borderColor: '#d1d4dc',
      },
      timeScale: {
        borderColor: '#d1d4dc',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Add candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    candleSeriesRef.current = candleSeries;

    // Add volume series with dynamic coloring
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });

    volumeSeriesRef.current = volumeSeries;

    // Set volume scale
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    // Add OI Diff series
    const oiDiffSeries = chart.addHistogramSeries({
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
      visible: true,
    });

    oiDiffSeriesRef.current = oiDiffSeries;

    // Set OI scale to be at the very bottom
    oiDiffSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.95,
        bottom: 0,
      },
    });

    // Add Call OI line series
    const callOiLine = chart.addLineSeries({
      color: '#ef4444',
      lineWidth: 2,
      lineType: 2,
      title: 'Call OI',
      priceScaleId: 'left',
      priceFormat: { type: 'volume' },
    });

    callOiLineRef.current = callOiLine;

    // Add Put OI line series
    const putOiLine = chart.addLineSeries({
      color: '#22c55e',
      lineWidth: 2,
      lineType: 2,
      title: 'Put OI',
      priceScaleId: 'left',
      priceFormat: { type: 'volume' },
    });

    putOiLineRef.current = putOiLine;

    // Add OI Diff line series
    const oiDiffLine = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 2,
      lineType: 2,
      title: 'OI Diff',
      priceScaleId: 'left',
      priceFormat: { type: 'volume' },
    });

    oiDiffLineRef.current = oiDiffLine;

    // Add historical level line series (one per level type, on right price scale)
    const LEVEL_CONFIGS: Array<{ name: string; color: string; title: string }> = [
      { name: 'call_high', color: '#22C55E', title: 'Call High' },
      { name: 'call_int',  color: '#84CC16', title: 'Call Int'  },
      { name: 'put_call_int', color: '#EAB308', title: 'Put/Call Int' },
      { name: 'put_int',  color: '#F97316', title: 'Put Int'   },
      { name: 'put_low',  color: '#EF4444', title: 'Put Low'   },
    ];
    const newLevelSeries: Record<string, ISeriesApi<'Line'>> = {};
    LEVEL_CONFIGS.forEach(cfg => {
      const s = chart.addLineSeries({
        color: cfg.color,
        lineWidth: 1,
        lineType: 2,
        title: cfg.title,
        priceScaleId: 'right',
        lastValueVisible: true,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      newLevelSeries[cfg.name] = s;
    });
    levelSeriesRefs.current = newLevelSeries;

    setIsLoading(false);

    // Subscribe to visible range changes to detect when to load more data
    let visibleRangeUnsubscribe: (() => void) | null = null;
    
    if (onLoadMore) {
      const chartTimeScale = chart.timeScale();
      
      const handleVisibleTimeRangeChange = () => {
        if (!chartRef.current || loadingMoreRef.current) return;
        if (!candleSeriesRef.current) return;

        const timeScale = chartRef.current.timeScale();
        const logicalRange = timeScale.getVisibleLogicalRange();

        // logicalRange.from < 0 means user scrolled left past the first bar (bar index negative)
        if (!logicalRange || logicalRange.from >= 0) return;

        const seriesData = candleSeriesRef.current.data();
        if (!seriesData || seriesData.length === 0) return;

        const firstDataTime = seriesData[0].time as string;
        const lastDataTime = seriesData[seriesData.length - 1].time as string;

        loadingMoreRef.current = true;
        onLoadMore('past', firstDataTime, lastDataTime);
        setTimeout(() => {
          loadingMoreRef.current = false;
        }, 3000);
      };

      chartTimeScale.subscribeVisibleTimeRangeChange(handleVisibleTimeRangeChange);
      visibleRangeUnsubscribe = () => chartTimeScale.unsubscribeVisibleTimeRangeChange(handleVisibleTimeRangeChange);
    }

    // Add crosshair move handler for tooltip and OHLC display
    const handleCrosshairMove = (param: MouseEventParams) => {
      if (!param.time) {
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'none';
        }
        if (ohlcDisplayRef.current) {
          ohlcDisplayRef.current.innerHTML = `<div class="text-xs text-gray-500">${symbol}</div>`;
        }
        return;
      }

      const data = param.seriesData.get(candleSeriesRef.current!);
      if (!data) {
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'none';
        }
        return;
      }

      const candleData = data as CandlestickData;
      const open = candleData.open;
      const high = candleData.high;
      const low = candleData.low;
      const close = candleData.close;
      const dateStr = param.time as string;

      const volumeData = param.seriesData.get(volumeSeriesRef.current!);
      const volume = volumeData ? (volumeData as any).value : 0;

      const currentOiData = oiDataRef.current.find(d => d.time === dateStr);

      // Update OHLC display in top-left corner
      if (ohlcDisplayRef.current) {
        const isGreen = close >= open;
        const priceColor = isGreen ? 'text-green-600' : 'text-red-600';
        const change = close - open;
        const changePercent = (change / open) * 100;
        
        const oiDisplayHtml = currentOiData ? `
          <div class="text-[10px] text-gray-600 border-t border-gray-200 pt-1 mt-1">
            <div class="flex justify-between gap-2">
              <span>Call OI: <span class="font-semibold text-red-600">${currentOiData.callOi.toLocaleString()}</span></span>
              <span>Put OI: <span class="font-semibold text-green-600">${currentOiData.putOi.toLocaleString()}</span></span>
            </div>
            <div class="mt-0.5">OI Diff: <span class="font-semibold ${currentOiData.oiDiff >= 0 ? 'text-green-600' : 'text-red-600'}">${currentOiData.oiDiff >= 0 ? '+' : ''}${currentOiData.oiDiff.toLocaleString()}</span></div>
          </div>
        ` : '';
        
        ohlcDisplayRef.current.innerHTML = `
          <div class="text-xs space-y-1">
            <div class="font-semibold text-gray-700">${symbol} <span class="${priceColor} text-[11px]">${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)</span></div>
            <div class="flex gap-3 text-[10px]">
              <span class="text-gray-600">O <span class="font-semibold text-gray-900">${formatCurrency(open)}</span></span>
              <span class="text-gray-600">H <span class="font-semibold text-green-600">${formatCurrency(high)}</span></span>
              <span class="text-gray-600">L <span class="font-semibold text-red-600">${formatCurrency(low)}</span></span>
              <span class="text-gray-600">C <span class="font-semibold ${priceColor}">${formatCurrency(close)}</span></span>
            </div>
            <div class="text-[10px] text-gray-600">Vol <span class="font-semibold text-gray-900">${volume.toLocaleString()}</span></div>
            ${oiDisplayHtml}
          </div>
        `;
      }

      if (!tooltipRef.current) return;

      let dateLevels: LevelCalculation[] = [];
      let dateClosestLevel: string | undefined = undefined;
      let hasHistoricalData = false;

      const hLevels = historicalLevelsRef.current;
      if (hLevels && hLevels.size > 0) {
        const historicalData = hLevels.get(dateStr);
        if (historicalData && historicalData.levels && historicalData.levels.length > 0) {
          dateLevels = historicalData.levels;
          dateClosestLevel = historicalData.closestLevel;
          hasHistoricalData = true;
        }
      }

      tooltipRef.current.style.display = 'block';
      tooltipRef.current.style.left = ((param.point?.x ?? 0) + 10) + 'px';
      tooltipRef.current.style.top = ((param.point?.y ?? 0) + 10) + 'px';

      // Build tooltip content with closest level highlighted (only if historical data available)
      const levelsWithProximity = hasHistoricalData ? dateLevels.map(level => {
        const isProximity = level.name === dateClosestLevel;
        const displayName = getLevelDisplayName(level.name);
        // Convert price and value to numbers if they're strings
        const priceValue = typeof level.price === 'string' ? parseFloat(level.price) : level.price;
        const valueNum = typeof level.value === 'string' ? parseFloat(level.value) : level.value;
        
        return {
          name: level.name,
          price: priceValue,
          value: valueNum,
          displayName,
          isProximity
        };
      }).reverse() : []; // Reverse the order: Call High -> Call Int -> Put/Call Int -> Put Int -> Put Low

      // Build scan alerts section for tooltip
      const dateAlerts = scanAlertsByDateRef.current.get(dateStr) || [];
      const alertsTooltipHtml = dateAlerts.length > 0 ? `
        <div class="mt-3 pt-2 border-t border-gray-300">
          <div class="font-semibold mb-1 text-gray-700">🔔 Scan Alerts (${dateAlerts.length}):</div>
          ${dateAlerts.map(a => {
            const level = SCAN_CODE_TO_LEVEL[a.scanCode] ?? a.closestLevel;
            const color = getLevelColor(level);
            return `
              <div class="flex justify-between gap-4 items-center py-0.5">
                <span class="px-1.5 py-0.5 rounded text-white text-[10px] font-semibold" style="background-color:${color}">${a.scanCode}</span>
                <span class="text-gray-500 text-[10px]">exp ${a.expiryDate}</span>
              </div>
            `;
          }).join('')}
        </div>
      ` : '';

      // Build OI section for tooltip
      const oiTooltipHtml = currentOiData ? `
        <div class="mt-3 pt-2 border-t border-gray-300">
          <div class="font-semibold mb-1 text-gray-700">Open Interest:</div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1">
            <div class="flex justify-between">
              <span class="text-gray-600">Call OI:</span>
              <span class="font-semibold text-red-600">${currentOiData.callOi.toLocaleString()}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600">Put OI:</span>
              <span class="font-semibold text-green-600">${currentOiData.putOi.toLocaleString()}</span>
            </div>
          </div>
          <div class="flex justify-between mt-1">
            <span class="text-gray-600">OI Diff:</span>
            <span class="font-semibold ${currentOiData.oiDiff >= 0 ? 'text-green-600' : 'text-red-600'}">${currentOiData.oiDiff >= 0 ? '+' : ''}${currentOiData.oiDiff.toLocaleString()}</span>
          </div>
        </div>
      ` : '';

      tooltipRef.current.innerHTML = `
        <div class="text-xs">
          <div class="font-bold mb-2">${dateStr}</div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 mb-3 pb-2 border-b border-gray-300">
            <div class="flex justify-between">
              <span class="text-gray-600">Open:</span>
              <span class="font-semibold">${formatCurrency(open)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600">High:</span>
              <span class="font-semibold text-green-600">${formatCurrency(high)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600">Low:</span>
              <span class="font-semibold text-red-600">${formatCurrency(low)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600">Close:</span>
              <span class="font-semibold">${formatCurrency(close)}</span>
            </div>
          </div>
          ${alertsTooltipHtml}
          ${oiTooltipHtml}
          ${levelsWithProximity.length > 0 ? `
            <div class="mt-3 pt-2 border-t border-gray-300">
              <div class="font-semibold mb-1 text-gray-700">Algo Levels:</div>
              ${levelsWithProximity.map(level => `
                <div class="flex justify-between gap-4 ${level.isProximity ? 'font-bold text-blue-600' : ''}">
                  <span>${level.displayName}:</span>
                  <span>${formatCurrency(level.price)} (${formatPercentage(level.value)})</span>
                </div>
              `).join('')}
            </div>
          ` : hasHistoricalData ? '' : `
            <div class="text-gray-500 text-center py-2 mt-2 border-t border-gray-300">
              <span class="text-xs">Level data not available for this date</span>
            </div>
          `}
        </div>
      `;
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (visibleRangeUnsubscribe) {
        visibleRangeUnsubscribe();
      }
      levelSeriesRefs.current = {};
      chart.remove();
    };
  }, [height, onLoadMore]);

  // Update data
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || isLoading) return;

    console.log('Updating chart data, candle count:', candleData.length);
    console.log('Date range:', candleData[0]?.time, 'to', candleData[candleData.length - 1]?.time);

    // Deduplicate by time (keep last) and sort ascending — duplicates crash lightweight-charts
    const candleByTimeMap = new Map<string, typeof candleData[0]>();
    for (const d of candleData) { if (d.time) candleByTimeMap.set(d.time, d); }
    const candleDeduped = Array.from(candleByTimeMap.values()).sort((a, b) =>
      a.time < b.time ? -1 : a.time > b.time ? 1 : 0
    );

    // Filter bars where any OHLC value is not a finite number
    const formattedCandles: CandlestickData[] = candleDeduped
      .filter(d => Number.isFinite(d.open) && Number.isFinite(d.high) && Number.isFinite(d.low) && Number.isFinite(d.close))
      .map(d => ({
        time: d.time as any,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));

    // Deduplicate volume data
    const volByTimeMap = new Map<string, typeof volumeData[0]>();
    for (const d of volumeData) { if (d.time) volByTimeMap.set(d.time, d); }
    const volumeDeduped = Array.from(volByTimeMap.values()).sort((a, b) =>
      a.time < b.time ? -1 : a.time > b.time ? 1 : 0
    );

    const formattedVolume: HistogramData[] = volumeDeduped
      .filter(d => Number.isFinite(d.value))
      .map(d => {
        const candle = candleByTimeMap.get(d.time);
        const isGreen = candle ? candle.close >= candle.open : true;
        return {
          time: d.time as any,
          value: d.value,
          color: isGreen ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
        };
      });

    // Use setData to replace all data (handles both initial load and updates)
    candleSeriesRef.current.setData(formattedCandles);
    volumeSeriesRef.current.setData(formattedVolume);
    
    // Reapply visibility state for price series after data update
    candleSeriesRef.current.applyOptions({ visible: showPrice });
    volumeSeriesRef.current.applyOptions({ visible: showPrice });

    // Format and set OI Diff data if available
    if (oiDiffSeriesRef.current && callOiLineRef.current && putOiLineRef.current && oiDiffLineRef.current && oiData.length > 0) {
      try {
        // Deduplicate OI data by time, sort ascending
        const oiByTime = new Map<string, typeof oiData[0]>();
        for (const d of oiData) {
          if (d.time) oiByTime.set(typeof d.time === 'string' ? d.time : String(d.time), d);
        }
        const oiDeduped = Array.from(oiByTime.values()).sort((a, b) =>
          String(a.time) < String(b.time) ? -1 : String(a.time) > String(b.time) ? 1 : 0
        );

        const formattedOiDiff: HistogramData[] = oiDeduped
          .filter(d => Number.isFinite(d.oiDiff))
          .map(d => ({
            time: (typeof d.time === 'string' ? d.time : String(d.time)) as any,
            value: Math.abs(d.oiDiff),
            color: d.oiDiff > 0 ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)',
          }));

        const callOiLineData = oiDeduped
          .filter(d => Number.isFinite(d.callOi))
          .map(d => ({
            time: (typeof d.time === 'string' ? d.time : String(d.time)) as any,
            value: d.callOi,
          }));

        const putOiLineData = oiDeduped
          .filter(d => Number.isFinite(d.putOi))
          .map(d => ({
            time: (typeof d.time === 'string' ? d.time : String(d.time)) as any,
            value: d.putOi,
          }));

        const oiDiffLineData = oiDeduped
          .filter(d => Number.isFinite(d.oiDiff))
          .map(d => ({
            time: (typeof d.time === 'string' ? d.time : String(d.time)) as any,
            value: d.oiDiff,
          }));

        oiDiffSeriesRef.current.setData(formattedOiDiff);
        callOiLineRef.current.setData(callOiLineData);
        putOiLineRef.current.setData(putOiLineData);
        oiDiffLineRef.current.setData(oiDiffLineData);

        oiDiffSeriesRef.current.applyOptions({ visible: showOI });
        callOiLineRef.current.applyOptions({ visible: showOI });
        putOiLineRef.current.applyOptions({ visible: showOI });
        oiDiffLineRef.current.applyOptions({ visible: showOI });
      } catch (error) {
        console.error('Error setting OI data:', error);
      }
    }

    // Only fit content on initial load, not when loading more data
    if (!isLoadingMore && chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candleData, volumeData, oiData, isLoading, isLoadingMore, showPrice, showOI]);

  // Add level lines
  useEffect(() => {
    if (!candleSeriesRef.current || !levels.length) {
      priceLineRefs.current.forEach(line => {
        if (line && candleSeriesRef.current) {
          candleSeriesRef.current.removePriceLine(line);
        }
      });
      priceLineRefs.current = [];
      return;
    }

    priceLineRefs.current.forEach(line => {
      if (line && candleSeriesRef.current) {
        candleSeriesRef.current.removePriceLine(line);
      }
    });
    priceLineRefs.current = [];

    levels.forEach(level => {
      const priceValue = typeof level.price === 'string' ? parseFloat(level.price) : level.price;

      if (!priceValue || isNaN(priceValue) || priceValue === 0) return;

      const isClosest = level.name === closestLevel;
      const color = isClosest ? '#3B82F6' : getLevelColor(level.name);
      const lineWidth = isClosest ? 2 : 1;
      const displayName = getLevelDisplayName(level.name);

      try {
        const priceLine = candleSeriesRef.current?.createPriceLine({
          price: priceValue,
          color: color,
          lineWidth: lineWidth,
          lineStyle: isClosest ? 0 : 2,
          axisLabelVisible: false,
          title: displayName,
        });

        if (priceLine) {
          priceLineRefs.current.push(priceLine);
        }
      } catch (err) {
        console.error(`Error creating price line for ${displayName}:`, err);
      }
    });

    // Cleanup function to remove price lines when component unmounts or levels change
    return () => {
      priceLineRefs.current.forEach(line => {
        if (line && candleSeriesRef.current) {
          candleSeriesRef.current.removePriceLine(line);
        }
      });
      priceLineRefs.current = [];
    };
  }, [levels, closestLevel]);

  // Populate historical level line series from historicalLevels map
  useEffect(() => {
    const refs = levelSeriesRefs.current;
    if (!historicalLevels || historicalLevels.size === 0 || Object.keys(refs).length === 0) return;

    const buckets: Record<string, { time: string; value: number }[]> = {
      call_high: [], call_int: [], put_call_int: [], put_int: [], put_low: [],
    };

    historicalLevels.forEach((dateData, date) => {
      dateData.levels.forEach(level => {
        const price = typeof level.price === 'string' ? parseFloat(level.price) : level.price;
        if (buckets[level.name] && Number.isFinite(price) && price > 0) {
          buckets[level.name].push({ time: date, value: price });
        }
      });
    });

    Object.entries(buckets).forEach(([name, data]) => {
      const s = refs[name];
      if (!s || data.length === 0) return;
      data.sort((a, b) => (a.time < b.time ? -1 : 1));
      s.setData(data as any);
    });
  }, [historicalLevels]);

  // Scan alert markers — one dot per date with alerts, colored by the triggered level.
  // Grouped so multiple same-day alerts (e.g. different expiries) render as one marker
  // with a count badge instead of stacking illegibly.
  useEffect(() => {
    const byDate = new Map<string, ScanAlert[]>();
    visibleScanAlerts.forEach(a => {
      const list = byDate.get(a.tradeDate) ?? [];
      list.push(a);
      byDate.set(a.tradeDate, list);
    });
    scanAlertsByDateRef.current = byDate;

    if (!candleSeriesRef.current || isLoading) return;

    const markers: SeriesMarker<Time>[] = [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, alertsOnDate]) => {
        const primary = alertsOnDate[alertsOnDate.length - 1];
        const level = SCAN_CODE_TO_LEVEL[primary.scanCode] ?? primary.closestLevel;
        return {
          time: date as Time,
          position: 'aboveBar',
          shape: 'circle',
          color: getLevelColor(level),
          text: alertsOnDate.length > 1 ? String(alertsOnDate.length) : undefined,
        };
      });

    try {
      candleSeriesRef.current.setMarkers(markers);
    } catch (err) {
      console.error('Error setting scan alert markers:', err);
    }
  }, [visibleScanAlerts, isLoading]);

  // Level filter toggle: show only selected level, or all if none selected
  useEffect(() => {
    const refs = levelSeriesRefs.current;
    Object.entries(refs).forEach(([name, s]) => {
      s.applyOptions({ visible: activeLevelFilter === null || activeLevelFilter === name });
    });
  }, [activeLevelFilter]);

  // Handle visibility toggles
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    candleSeriesRef.current.applyOptions({ visible: showPrice });
    volumeSeriesRef.current.applyOptions({ visible: showPrice });
  }, [showPrice]);

  useEffect(() => {
    if (!oiDiffSeriesRef.current || !callOiLineRef.current || !putOiLineRef.current || !oiDiffLineRef.current) return;
    
    oiDiffSeriesRef.current.applyOptions({ visible: showOI });
    callOiLineRef.current.applyOptions({ visible: showOI });
    putOiLineRef.current.applyOptions({ visible: showOI });
    oiDiffLineRef.current.applyOptions({ visible: showOI });
  }, [showOI]);

  // Handle time period selection
  const handlePeriodChange = (period: string) => {
    if (!chartRef.current || !candleSeriesRef.current) return;
    
    setSelectedPeriod(period);
    
    const seriesData = candleSeriesRef.current.data();
    if (!seriesData || seriesData.length === 0) return;
    
    const lastDataTime = seriesData[seriesData.length - 1].time as string;
    const lastDate = new Date(lastDataTime);
    
    let fromDate: Date;
    
    switch (period) {
      case '1D':
        fromDate = new Date(lastDate);
        fromDate.setDate(lastDate.getDate() - 1);
        break;
      case '1W':
        fromDate = new Date(lastDate);
        fromDate.setDate(lastDate.getDate() - 7);
        break;
      case '1M':
        fromDate = new Date(lastDate);
        fromDate.setMonth(lastDate.getMonth() - 1);
        break;
      case '3M':
        fromDate = new Date(lastDate);
        fromDate.setMonth(lastDate.getMonth() - 3);
        break;
      case '6M':
        fromDate = new Date(lastDate);
        fromDate.setMonth(lastDate.getMonth() - 6);
        break;
      case '1Y':
        fromDate = new Date(lastDate);
        fromDate.setFullYear(lastDate.getFullYear() - 1);
        break;
      case 'YTD':
        fromDate = new Date(lastDate.getFullYear(), 0, 1);
        break;
      case 'ALL':
      default:
        chartRef.current.timeScale().fitContent();
        return;
    }
    
    const fromTimeStr = fromDate.toISOString().split('T')[0];
    chartRef.current.timeScale().setVisibleRange({
      from: fromTimeStr as any,
      to: lastDataTime as any,
    });
  };

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-2xl font-bold">{symbol}</h2>
            {currentPrice && (
              <p className="text-lg text-gray-600">
                {formatCurrency(currentPrice)}
              </p>
            )}
          </div>
          {isLoadingMore && (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
              <span>Loading more data...</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          {/* Visibility Toggles */}
          <div className="flex items-center gap-2 border-r border-gray-300 pr-3">
            <button
              onClick={() => setShowPrice(!showPrice)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                showPrice
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              Price
            </button>
            <button
              onClick={() => setShowOI(!showOI)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                showOI
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              OI
            </button>
          </div>
          
          {/* Time Period Selector */}
          <div className="flex items-center gap-1">
            {['1D', '1W', '1M', '3M', '6M', '1Y', 'YTD', 'ALL'].map((period) => (
              <button
                key={period}
                onClick={() => handlePeriodChange(period)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  selectedPeriod === period
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {period}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        ref={chartContainerRef}
        className="relative bg-white rounded-lg border border-gray-200 shadow-sm"
        style={{ height: `${height}px` }}
      >
        {/* OHLC Display - Top Left */}
        <div 
          ref={ohlcDisplayRef}
          className="absolute top-2 left-2 bg-white/95 backdrop-blur-sm px-3 py-2 rounded shadow-md z-10 pointer-events-none border border-gray-200"
        >
          <div className="text-xs text-gray-500">{symbol}</div>
        </div>
        
        {/* Tooltip */}
        <div
          ref={tooltipRef}
          className="absolute z-10 bg-white border border-gray-300 rounded-lg shadow-lg p-3 pointer-events-none"
          style={{ display: 'none' }}
        />
        
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-2" />
              <p className="text-gray-600">Loading chart...</p>
            </div>
          </div>
        )}
      </div>

      {levels.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {['call_high', 'call_int', 'put_call_int', 'put_int', 'put_low'].map(name => {
            const level = levels.find(l => l.name === name);
            if (!level) return null;
            const color = getLevelColor(name);
            const isActive = activeLevelFilter === name;
            const isFiltered = activeLevelFilter !== null && !isActive;
            return (
              <button
                key={name}
                onClick={() => setActiveLevelFilter(isActive ? null : name)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  isFiltered
                    ? 'opacity-30 border-gray-200 bg-gray-50 text-gray-400'
                    : 'border-transparent text-white'
                }`}
                style={!isFiltered ? { backgroundColor: color } : undefined}
                title={`Click to isolate ${getLevelDisplayName(name)}`}
              >
                <span>{getLevelDisplayName(name)}</span>
                <span className={isFiltered ? 'text-gray-400' : 'opacity-80'}>
                  {formatCurrency(typeof level.price === 'string' ? parseFloat(level.price) : level.price)}
                </span>
                {name === closestLevel && !isFiltered && (
                  <span className="ml-0.5 text-[10px] opacity-75">★</span>
                )}
              </button>
            );
          })}
          {activeLevelFilter && (
            <button
              onClick={() => setActiveLevelFilter(null)}
              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Show all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
