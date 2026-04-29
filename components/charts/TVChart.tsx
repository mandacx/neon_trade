'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, IPriceLine, CandlestickData, HistogramData, MouseEventParams } from 'lightweight-charts';
import { LevelCalculation } from '@/types/stock';
import { getLevelColor, getLevelDisplayName, formatCurrency, formatPercentage } from '@/lib/utils';

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
  const historicalLevelsRef = useRef(historicalLevels);
  const levelsRef = useRef(levels);
  const closestLevelRef = useRef(closestLevel);
  const oiDataRef = useRef(oiData);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('ALL');
  const [showPrice, setShowPrice] = useState(true);
  const [showOI, setShowOI] = useState(true);
  const loadingMoreRef = useRef(false);
  const initialFitDoneRef = useRef(false);
  // Unsubscribe fn stored in ref so the data-update effect can temporarily
  // pause the visible-range handler during programmatic setData/fitContent calls.
  const pauseScrollTriggerRef = useRef<(() => void) | null>(null);
  const resumeScrollTriggerRef = useRef<(() => void) | null>(null);

  useEffect(() => { historicalLevelsRef.current = historicalLevels; }, [historicalLevels]);
  useEffect(() => { levelsRef.current = levels; }, [levels]);
  useEffect(() => { closestLevelRef.current = closestLevel; }, [closestLevel]);
  useEffect(() => { oiDataRef.current = oiData; }, [oiData]);

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
      title: 'Call OI',
      priceScaleId: 'left',
      priceFormat: {
        type: 'volume',
      },
    });

    callOiLineRef.current = callOiLine;

    // Add Put OI line series
    const putOiLine = chart.addLineSeries({
      color: '#22c55e',
      lineWidth: 2,
      title: 'Put OI',
      priceScaleId: 'left',
      priceFormat: {
        type: 'volume',
      },
    });

    putOiLineRef.current = putOiLine;

    // Add OI Diff line series
    const oiDiffLine = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 2,
      title: 'OI Diff',
      priceScaleId: 'left',
      priceFormat: {
        type: 'volume',
      },
    });

    oiDiffLineRef.current = oiDiffLine;

    setIsLoading(false);

    // Subscribe to visible range changes to detect when to load more data
    let visibleRangeUnsubscribe: (() => void) | null = null;
    
    if (onLoadMore) {
      const chartTimeScale = chart.timeScale();
      
      const handleVisibleTimeRangeChange = () => {
        if (!chartRef.current || loadingMoreRef.current) return;

        const timeScale = chartRef.current.timeScale();
        const logicalRange = timeScale.getVisibleLogicalRange();
        const visibleRange = timeScale.getVisibleRange();
        console.log('[TVChart] range change — logical:', JSON.stringify(logicalRange), 'time:', JSON.stringify(visibleRange), 'loadingMore:', loadingMoreRef.current);
        if (!logicalRange || logicalRange.from >= 0) return;

        if (!candleSeriesRef.current) return;
        const seriesData = candleSeriesRef.current.data();
        if (!seriesData || seriesData.length === 0) return;

        const firstDataTime = seriesData[0].time as string;
        const lastDataTime = seriesData[seriesData.length - 1].time as string;

        console.log('[TVChart] firing onLoadMore — firstDataTime:', firstDataTime, 'logical.from:', logicalRange.from);
        loadingMoreRef.current = true;
        onLoadMore('past', firstDataTime, lastDataTime);
        setTimeout(() => { loadingMoreRef.current = false; }, 3000);
      };

      chartTimeScale.subscribeVisibleTimeRangeChange(handleVisibleTimeRangeChange);
      visibleRangeUnsubscribe = () => chartTimeScale.unsubscribeVisibleTimeRangeChange(handleVisibleTimeRangeChange);
      pauseScrollTriggerRef.current = () => chartTimeScale.unsubscribeVisibleTimeRangeChange(handleVisibleTimeRangeChange);
      resumeScrollTriggerRef.current = () => chartTimeScale.subscribeVisibleTimeRangeChange(handleVisibleTimeRangeChange);
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
      const containerWidth = chartContainerRef.current?.clientWidth || 800;
      const tooltipWidth = tooltipRef.current.offsetWidth || 220;
      const tooltipHeight = tooltipRef.current.offsetHeight || 200;
      const px = param.point?.x ?? 0;
      const py = param.point?.y ?? 0;
      const left = px + tooltipWidth + 10 > containerWidth ? px - tooltipWidth - 10 : px + 10;
      const top = py + tooltipHeight + 10 > height ? py - tooltipHeight - 10 : py + 10;
      tooltipRef.current.style.left = `${Math.max(0, left)}px`;
      tooltipRef.current.style.top = `${Math.max(0, top)}px`;

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
      initialFitDoneRef.current = false;
      loadingMoreRef.current = false;
      pauseScrollTriggerRef.current = null;
      resumeScrollTriggerRef.current = null;
      // Null series refs BEFORE chart.remove() so levels/data cleanup effects
      // see null and skip removePriceLine/setData on the disposed series
      priceLineRefs.current = [];
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      oiDiffSeriesRef.current = null;
      callOiLineRef.current = null;
      putOiLineRef.current = null;
      oiDiffLineRef.current = null;
      chart.remove();
    };
  }, [height, onLoadMore]);

  // Update data
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || isLoading) return;

    pauseScrollTriggerRef.current?.();

    // Filter bars where any OHLC value is not a finite number (null/undefined/NaN all crash the chart)
    const formattedCandles: CandlestickData[] = candleData
      .filter(d => Number.isFinite(d.open) && Number.isFinite(d.high) && Number.isFinite(d.low) && Number.isFinite(d.close))
      .map(d => ({
        time: d.time as any,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));

    const candleByTime = new Map(candleData.map(d => [d.time, d]));
    const formattedVolume: HistogramData[] = volumeData
      .filter(d => Number.isFinite(d.value))
      .map(d => {
        const candle = candleByTime.get(d.time);
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
        const formattedOiDiff: HistogramData[] = oiData
          .filter(d => !!d.time)
          .map(d => ({
            time: (typeof d.time === 'string' ? d.time : String(d.time)) as any,
            value: Math.abs(d.oiDiff || 0),
            color: (d.oiDiff || 0) > 0 ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)',
          }));

        // Format Call OI, Put OI, and OI Diff line data
        const callOiLineData = oiData
          .filter(d => d.time)
          .map(d => ({
            time: (typeof d.time === 'string' ? d.time : String(d.time)) as any,
            value: d.callOi || 0,
          }));

        const putOiLineData = oiData
          .filter(d => d.time)
          .map(d => ({
            time: (typeof d.time === 'string' ? d.time : String(d.time)) as any,
            value: d.putOi || 0,
          }));

        const oiDiffLineData = oiData
          .filter(d => d.time)
          .map(d => ({
            time: (typeof d.time === 'string' ? d.time : String(d.time)) as any,
            value: d.oiDiff || 0,
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

    // Only fit content once on first data load
    if (!initialFitDoneRef.current && candleData.length > 0 && chartRef.current) {
      chartRef.current.timeScale().fitContent();
      initialFitDoneRef.current = true;
    }

    // Resume scroll-trigger handler now that all programmatic updates are done
    resumeScrollTriggerRef.current?.();
  }, [candleData, volumeData, oiData, isLoading, showPrice, showOI]);

  const clearPriceLines = () => {
    priceLineRefs.current.forEach(line => {
      try {
        if (line && candleSeriesRef.current) {
          candleSeriesRef.current.removePriceLine(line);
        }
      } catch {
        // series may be disposed after chart recreation
      }
    });
    priceLineRefs.current = [];
  };

  // Add level lines
  useEffect(() => {
    if (!candleSeriesRef.current || !levels.length) {
      clearPriceLines();
      return;
    }

    clearPriceLines();

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
          axisLabelVisible: true,
          title: displayName,
        });

        if (priceLine) {
          priceLineRefs.current.push(priceLine);
        }
      } catch (err) {
        console.error(`Error creating price line for ${displayName}:`, err);
      }
    });

    return () => { clearPriceLines(); };
  }, [levels, closestLevel]);

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

      {levels.length > 0 && closestLevel && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="font-semibold text-blue-900 mb-2">Proximity Analysis</h3>
          {levels.find(l => l.name === closestLevel) && (
            <div className="text-sm">
              <p className="text-blue-800">
                <span className="font-semibold">Proximity ({getLevelDisplayName(closestLevel)})</span> is the nearest level at{' '}
                <span className="font-semibold">
                  {formatCurrency(levels.find(l => l.name === closestLevel)!.price)}
                </span>
                {' '}({formatPercentage(levels.find(l => l.name === closestLevel)!.value)})
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
