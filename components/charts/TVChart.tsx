'use client';

import { useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { createChart, IChartApi, ISeriesApi, IPriceLine, CandlestickData, HistogramData, MouseEventParams, SeriesMarker, Time } from 'lightweight-charts';
import { LevelCalculation, ScanAlert } from '@/types/stock';
import { getLevelColor, getLevelDisplayName, formatCurrency, formatPercentage, SCAN_CODE_TO_LEVEL } from '@/lib/utils';

interface TVChartProps {
  symbol: string;
  // `time` is epoch seconds — the chart's canonical time axis, at whatever
  // interval was fetched. `dayKey` is the US trading day it belongs to
  // ('YYYY-MM-DD'), used to join day-level data (levels/OI/alerts) onto it.
  candleData: Array<{
    time: number;
    dayKey: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  volumeData: Array<{
    time: number;
    dayKey: string;
    value: number;
  }>;
  // Day-level data — keyed by trading day regardless of chart interval.
  oiData?: Array<{
    time: string;
    callOi: number;
    putOi: number;
    oiDiff: number;
  }>;
  levels?: LevelCalculation[];
  closestLevel?: string;
  // `sevenLevels` is the DB's full level set (the 5 "official" levels plus
  // put_high/call_low) — optional because callers that only need the 5-level
  // proximity ladder don't populate it.
  historicalLevels?: Map<string, { levels: LevelCalculation[], closestLevel: string, sevenLevels?: { name: string; price: number; value: number }[] }>;
  scanAlerts?: ScanAlert[];
  selectedExpiry?: string;
  isIntraday?: boolean;
  livePrice?: number;
  currentPrice?: number;
  // Rendered in the chart's own top-left toolbar, next to the symbol/price —
  // e.g. an interval selector — so it reads as part of the chart, not the page.
  headerExtra?: ReactNode;
  // Rendered as a column beside the chart's bordered frame, INSIDE this
  // component rather than next to it on the page. The header above and the
  // level chips below both have content-dependent heights, so a panel placed
  // as a page-level sibling can't line its top and bottom up with the chart's
  // own border — sharing the chart's flex row is what makes that exact.
  sidePanel?: ReactNode;
  height?: number;
  onLoadMore?: (direction: 'past' | 'future', firstVisibleTime: string, lastVisibleTime: string) => void;
  isLoadingMore?: boolean;
}

function formatBarTime(epochSeconds: number, intraday: boolean): string {
  const d = new Date(epochSeconds * 1000);
  if (intraday) {
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric' });
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
  isIntraday = false,
  livePrice,
  currentPrice,
  headerExtra,
  sidePanel,
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
  const dayKeyByTimeRef = useRef<Map<number, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('ALL');
  const [showPrice, setShowPrice] = useState(true);
  const [showOI, setShowOI] = useState(true);
  const [activeLevelFilter, setActiveLevelFilter] = useState<string | null>(null);
  const [isEnlarged, setIsEnlarged] = useState(false);
  const loadingMoreRef = useRef(false);

  // Esc closes the enlarged view, same as the app's Modal component.
  useEffect(() => {
    if (!isEnlarged) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsEnlarged(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isEnlarged]);

  // Scan alert markers/tooltip are scoped to whichever expiry is selected for the
  // price levels — one control drives both, so they always describe the same contract.
  const visibleScanAlerts = useMemo(
    () => (selectedExpiry ? scanAlerts.filter(a => a.expiryDate === selectedExpiry) : scanAlerts),
    [scanAlerts, selectedExpiry]
  );

  // Single canonical, deduped/sorted view of the candle bars — every other
  // effect (volume, OI, levels, markers, tooltip) derives from this instead of
  // re-deduping independently.
  const processedBars = useMemo(() => {
    const map = new Map<number, typeof candleData[0]>();
    candleData.forEach(d => {
      if (Number.isFinite(d.time) && Number.isFinite(d.open) && Number.isFinite(d.high) && Number.isFinite(d.low) && Number.isFinite(d.close)) {
        map.set(d.time, d);
      }
    });
    return [...map.values()].sort((a, b) => a.time - b.time);
  }, [candleData]);

  const volumeByTime = useMemo(() => {
    const map = new Map<number, number>();
    volumeData.forEach(d => { if (Number.isFinite(d.time) && Number.isFinite(d.value)) map.set(d.time, d.value); });
    return map;
  }, [volumeData]);

  useEffect(() => { historicalLevelsRef.current = historicalLevels; }, [historicalLevels]);
  useEffect(() => { levelsRef.current = levels; }, [levels]);
  useEffect(() => { closestLevelRef.current = closestLevel; }, [closestLevel]);
  useEffect(() => { oiDataRef.current = oiData; }, [oiData]);
  useEffect(() => { loadingMoreRef.current = isLoadingMore; }, [isLoadingMore]);
  useEffect(() => {
    const map = new Map<number, string>();
    processedBars.forEach(bar => map.set(bar.time, bar.dayKey));
    dayKeyByTimeRef.current = map;
  }, [processedBars]);

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
        if (!logicalRange) return;

        const seriesData = candleSeriesRef.current.data();
        if (!seriesData || seriesData.length === 0) return;

        const firstDataTime = seriesData[0].time as number;
        const lastDataTime = seriesData[seriesData.length - 1].time as number;

        // logicalRange.from < 0 means the user scrolled left past the first
        // loaded bar (bar index negative); logicalRange.to beyond the last
        // bar's index means they scrolled right past the last loaded bar —
        // both trigger loading further data in that direction.
        let direction: 'past' | 'future' | null = null;
        if (logicalRange.from < 0) direction = 'past';
        else if (logicalRange.to > seriesData.length - 1) direction = 'future';
        if (!direction) return;

        loadingMoreRef.current = true;
        onLoadMore(direction, String(firstDataTime), String(lastDataTime));
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
      const barTime = param.time as number;
      const dayKey = dayKeyByTimeRef.current.get(barTime) ?? '';
      const barLabel = formatBarTime(barTime, isIntraday);

      const volumeData = param.seriesData.get(volumeSeriesRef.current!);
      const volume = volumeData ? (volumeData as any).value : 0;

      const currentOiData = oiDataRef.current.find(d => d.time === dayKey);

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
      let dateExtendedLevels: { name: string; price: number; value: number }[] = [];
      let hasHistoricalData = false;

      const hLevels = historicalLevelsRef.current;
      if (hLevels && hLevels.size > 0) {
        const historicalData = hLevels.get(dayKey);
        if (historicalData && historicalData.levels && historicalData.levels.length > 0) {
          dateLevels = historicalData.levels;
          dateClosestLevel = historicalData.closestLevel;
          dateExtendedLevels = (historicalData.sevenLevels ?? []).filter(l => l.name === 'put_high' || l.name === 'call_low');
          hasHistoricalData = true;
        }
      }

      // Shown here but positioned at the end of this handler — placement
      // measures the tooltip's own size, which isn't known until its content
      // for THIS bar has been written below.
      tooltipRef.current.style.display = 'block';

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

      // Extended levels (put_high/call_low) — shown separately from the 5-level
      // proximity ladder above; never considered for isProximity/closest-level.
      const EXTENDED_LEVEL_ORDER = ['call_low', 'put_high'];
      const extendedLevelsWithDisplay = dateExtendedLevels
        .map(level => ({ ...level, displayName: getLevelDisplayName(level.name) }))
        .sort((a, b) => EXTENDED_LEVEL_ORDER.indexOf(a.name) - EXTENDED_LEVEL_ORDER.indexOf(b.name));

      // Build scan alerts section for tooltip
      const dateAlerts = scanAlertsByDateRef.current.get(dayKey) || [];
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
          <div class="font-bold mb-2">${barLabel}</div>
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
          ${extendedLevelsWithDisplay.length > 0 ? `
            <div class="mt-2 pt-2 border-t border-gray-200">
              <div class="font-semibold mb-1 text-gray-500 text-[10px]">Extended Levels:</div>
              ${extendedLevelsWithDisplay.map(level => `
                <div class="flex justify-between gap-4 text-gray-600">
                  <span>${level.displayName}:</span>
                  <span>${formatCurrency(level.price)} (${formatPercentage(level.value)})</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;

      // Keep the box clear of the crosshair so the bar and the time-axis date
      // under it stay readable.
      //
      // `param.point` is relative to the chart PANE, which starts after the
      // left price scale, while the tooltip is absolutely positioned against
      // the whole container — so the scale's width has to be added back or the
      // box lands ~50px left of the crosshair, sitting right on the candles.
      const container = chartContainerRef.current;
      if (container) {
        const GAP = 14;
        const EDGE = 8;
        const tip = tooltipRef.current;
        const crosshairX = (param.point?.x ?? 0) + chart.priceScale('left').width();
        const pointerY = param.point?.y ?? 0;

        // Right of the crosshair by default; flip to the left only when the
        // box would overflow the container, so it stays clear either way.
        let left = crosshairX + GAP;
        if (left + tip.offsetWidth > container.clientWidth - EDGE) {
          left = crosshairX - GAP - tip.offsetWidth;
        }
        // Too wide to clear the crosshair on either side (a very narrow
        // container) — keep it on-screen and accept the overlap.
        left = Math.max(EDGE, left);

        const maxTop = Math.max(EDGE, container.clientHeight - tip.offsetHeight - EDGE);
        const top = Math.min(Math.max(EDGE, pointerY + GAP), maxTop);

        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      }
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    // Track the container's actual rendered size rather than just the
    // window's — a ResizeObserver (unlike a window 'resize' listener) also
    // fires when the container itself changes size without the window
    // resizing, e.g. a sidebar collapsing/expanding next to the chart, or
    // the enlarge toggle switching this container between a fixed pixel
    // height and a flex-filled fullscreen one.
    const resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height: observedHeight } = entry.contentRect;
      if (width > 0 && observedHeight > 0) {
        chart.applyOptions({ width, height: Math.round(observedHeight) });
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (visibleRangeUnsubscribe) {
        visibleRangeUnsubscribe();
      }
      levelSeriesRefs.current = {};
      chart.remove();
    };
  }, [height, onLoadMore, isIntraday, symbol]);

  // Update candle + volume data
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || isLoading) return;

    const formattedCandles: CandlestickData[] = processedBars.map(d => ({
      time: d.time as any,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    const formattedVolume: HistogramData[] = processedBars
      .filter(d => volumeByTime.has(d.time))
      .map(d => ({
        time: d.time as any,
        value: volumeByTime.get(d.time)!,
        color: d.close >= d.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
      }));

    // Use setData to replace all data (handles both initial load and updates)
    candleSeriesRef.current.setData(formattedCandles);
    volumeSeriesRef.current.setData(formattedVolume);

    // Reapply visibility state for price series after data update
    candleSeriesRef.current.applyOptions({ visible: showPrice });
    volumeSeriesRef.current.applyOptions({ visible: showPrice });

    // Only fit content on initial load, not when loading more data. The
    // `isLoadingMore` PROP is unreliable for this: the parent's
    // setOhlcData(...) and setIsLoadingMore(false) both happen in the same
    // async continuation, so React batches them into one render — by the
    // time this effect runs, the prop already reads `false` even for a
    // just-appended load-more update, defeating this guard entirely (it
    // was refitting/snapping the viewport on every load-more, silently,
    // since the day this guard was written). `loadingMoreRef` is a ref set
    // synchronously the moment a load-more is triggered (see
    // handleVisibleTimeRangeChange below) and isn't subject to that batching
    // race, so check it too.
    if (!isLoadingMore && !loadingMoreRef.current && chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [processedBars, volumeByTime, isLoading, isLoadingMore, showPrice]);

  // OI histogram/lines — day-level data, broadcast flat across every bar within
  // that trading day so it renders sensibly at any chart interval (daily or intraday).
  useEffect(() => {
    if (!oiDiffSeriesRef.current || !callOiLineRef.current || !putOiLineRef.current || !oiDiffLineRef.current) return;

    if (oiData.length === 0 || processedBars.length === 0) {
      oiDiffSeriesRef.current.setData([]);
      callOiLineRef.current.setData([]);
      putOiLineRef.current.setData([]);
      oiDiffLineRef.current.setData([]);
      return;
    }

    try {
      const oiByDay = new Map<string, typeof oiData[0]>();
      oiData.forEach(d => { if (d.time) oiByDay.set(String(d.time), d); });

      const oiDiffPoints: HistogramData[] = [];
      const callOiPoints: { time: any; value: number }[] = [];
      const putOiPoints: { time: any; value: number }[] = [];
      const oiDiffLinePoints: { time: any; value: number }[] = [];

      processedBars.forEach(bar => {
        const dayOi = oiByDay.get(bar.dayKey);
        if (!dayOi) return;
        if (Number.isFinite(dayOi.oiDiff)) {
          oiDiffPoints.push({
            time: bar.time as any,
            value: Math.abs(dayOi.oiDiff),
            color: dayOi.oiDiff > 0 ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)',
          });
          oiDiffLinePoints.push({ time: bar.time as any, value: dayOi.oiDiff });
        }
        if (Number.isFinite(dayOi.callOi)) callOiPoints.push({ time: bar.time as any, value: dayOi.callOi });
        if (Number.isFinite(dayOi.putOi)) putOiPoints.push({ time: bar.time as any, value: dayOi.putOi });
      });

      oiDiffSeriesRef.current.setData(oiDiffPoints);
      callOiLineRef.current.setData(callOiPoints as any);
      putOiLineRef.current.setData(putOiPoints as any);
      oiDiffLineRef.current.setData(oiDiffLinePoints as any);

      oiDiffSeriesRef.current.applyOptions({ visible: showOI });
      callOiLineRef.current.applyOptions({ visible: showOI });
      putOiLineRef.current.applyOptions({ visible: showOI });
      oiDiffLineRef.current.applyOptions({ visible: showOI });
    } catch (error) {
      console.error('Error setting OI data:', error);
    }
  }, [oiData, processedBars, showOI]);

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

  // Populate historical level line series — day-level data, broadcast flat
  // across every bar within that trading day (same reasoning as OI above).
  useEffect(() => {
    const refs = levelSeriesRefs.current;
    if (Object.keys(refs).length === 0) return;

    if (!historicalLevels || historicalLevels.size === 0 || processedBars.length === 0) {
      Object.values(refs).forEach(s => s.setData([]));
      return;
    }

    const buckets: Record<string, { time: any; value: number }[]> = {
      call_high: [], call_int: [], put_call_int: [], put_int: [], put_low: [],
    };

    processedBars.forEach(bar => {
      const dayData = historicalLevels.get(bar.dayKey);
      if (!dayData) return;
      dayData.levels.forEach(level => {
        const price = typeof level.price === 'string' ? parseFloat(level.price) : level.price;
        if (buckets[level.name] && Number.isFinite(price) && price > 0) {
          buckets[level.name].push({ time: bar.time as any, value: price });
        }
      });
    });

    Object.entries(buckets).forEach(([name, data]) => {
      const s = refs[name];
      if (!s) return;
      s.setData(data as any);
    });
  }, [historicalLevels, processedBars]);

  // Scan alert markers — one dot per trading day with alerts, colored by the
  // triggered level, placed at that day's first loaded bar (works at any
  // interval). Grouped so multiple same-day alerts (e.g. different expiries)
  // render as one marker with a count badge instead of stacking illegibly.
  useEffect(() => {
    const byDate = new Map<string, ScanAlert[]>();
    visibleScanAlerts.forEach(a => {
      const list = byDate.get(a.tradeDate) ?? [];
      list.push(a);
      byDate.set(a.tradeDate, list);
    });
    scanAlertsByDateRef.current = byDate;

    if (!candleSeriesRef.current || isLoading) return;

    const firstBarTimeByDay = new Map<string, number>();
    processedBars.forEach(bar => {
      if (!firstBarTimeByDay.has(bar.dayKey)) firstBarTimeByDay.set(bar.dayKey, bar.time);
    });

    const rawMarkers: (SeriesMarker<Time> | null)[] = [...byDate.entries()]
      .map(([date, alertsOnDate]): SeriesMarker<Time> | null => {
        const barTime = firstBarTimeByDay.get(date);
        if (barTime === undefined) return null; // no loaded bar for that day — skip rather than guess a position
        const primary = alertsOnDate[alertsOnDate.length - 1];
        const level = SCAN_CODE_TO_LEVEL[primary.scanCode] ?? primary.closestLevel;
        return {
          time: barTime as Time,
          position: 'aboveBar',
          shape: 'circle',
          color: getLevelColor(level),
          text: alertsOnDate.length > 1 ? String(alertsOnDate.length) : undefined,
        };
      });
    const markers: SeriesMarker<Time>[] = rawMarkers
      .filter((m): m is SeriesMarker<Time> => m !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));

    try {
      candleSeriesRef.current.setMarkers(markers);
    } catch (err) {
      console.error('Error setting scan alert markers:', err);
    }
  }, [visibleScanAlerts, isLoading, processedBars]);

  // Live price — nudges the most recent bar's OHLC in place rather than trying
  // to roll over into a new bar client-side (which would need to duplicate the
  // server's bucket-boundary logic). The next fetch/interval change reconciles
  // it with a real bar.
  useEffect(() => {
    if (livePrice === undefined || !Number.isFinite(livePrice) || !candleSeriesRef.current || isLoading) return;
    const seriesData = candleSeriesRef.current.data();
    if (!seriesData || seriesData.length === 0) return;
    const last = seriesData[seriesData.length - 1] as CandlestickData;
    try {
      candleSeriesRef.current.update({
        time: last.time,
        open: last.open,
        high: Math.max(last.high, livePrice),
        low: Math.min(last.low, livePrice),
        close: livePrice,
      });
    } catch (err) {
      console.error('Error live-updating candle:', err);
    }
  }, [livePrice, isLoading]);

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

    const lastTime = seriesData[seriesData.length - 1].time as number;
    const DAY = 86400;

    let fromTime: number;

    switch (period) {
      case '1D':
        fromTime = lastTime - 1 * DAY;
        break;
      case '1W':
        fromTime = lastTime - 7 * DAY;
        break;
      case '1M':
        fromTime = lastTime - 30 * DAY;
        break;
      case '3M':
        fromTime = lastTime - 90 * DAY;
        break;
      case '6M':
        fromTime = lastTime - 180 * DAY;
        break;
      case '1Y':
        fromTime = lastTime - 365 * DAY;
        break;
      case 'YTD': {
        const lastDate = new Date(lastTime * 1000);
        fromTime = Math.floor(new Date(Date.UTC(lastDate.getUTCFullYear(), 0, 1)).getTime() / 1000);
        break;
      }
      case 'ALL':
      default:
        chartRef.current.timeScale().fitContent();
        return;
    }

    chartRef.current.timeScale().setVisibleRange({
      from: fromTime as any,
      to: lastTime as any,
    });
  };

  const displayPrice = livePrice ?? currentPrice;

  return (
    <div
      className={isEnlarged ? 'fixed inset-0 z-[100] bg-black/60 flex p-4' : 'w-full'}
      onClick={isEnlarged ? () => setIsEnlarged(false) : undefined}
    >
    <div
      className={isEnlarged ? 'w-full bg-white rounded-lg shadow-xl p-4 flex flex-col overflow-hidden' : 'w-full'}
      onClick={isEnlarged ? e => e.stopPropagation() : undefined}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-2xl font-bold">{symbol}</h2>
            {displayPrice !== undefined && (
              <p className="text-lg text-gray-600 flex items-center gap-2">
                <span>{formatCurrency(displayPrice)}</span>
                {livePrice !== undefined && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-600 uppercase tracking-wide">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    Live
                  </span>
                )}
              </p>
            )}
          </div>
          {headerExtra && (
            <div className="flex items-center border-l border-gray-300 pl-3">
              {headerExtra}
            </div>
          )}
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

          <button
            onClick={() => setIsEnlarged(v => !v)}
            title={isEnlarged ? 'Shrink chart' : 'Enlarge chart'}
            aria-label={isEnlarged ? 'Shrink chart' : 'Enlarge chart'}
            className="flex items-center justify-center w-8 h-8 rounded text-gray-500 bg-gray-100 hover:bg-gray-200 hover:text-gray-700 transition-colors border-l border-gray-300 ml-1 pl-2"
          >
            {isEnlarged ? '⤡' : '⤢'}
          </button>
        </div>
      </div>

      {/* Chart frame and side panel share one row, so items-stretch gives the
          panel exactly the chart border's top and bottom edges. `lg:flex-1`
          rather than plain `flex-1` because on mobile this row is a column,
          where flex-1's 0% basis would collapse the chart's fixed height. */}
      <div className={`flex flex-col lg:flex-row gap-4 items-stretch ${isEnlarged ? 'flex-1 min-h-0' : ''}`}>
      <div
        ref={chartContainerRef}
        className={`relative w-full lg:flex-1 lg:min-w-0 bg-white rounded-lg border border-gray-200 shadow-sm ${isEnlarged ? 'min-h-0' : ''}`}
        style={isEnlarged ? undefined : { height: `${height}px` }}
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

        {sidePanel}
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
    </div>
  );
}
