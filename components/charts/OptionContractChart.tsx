'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  LineData,
  SeriesMarker,
  Time,
  MouseEventParams,
} from 'lightweight-charts';

// Gap between the crosshair and the tooltip, and the minimum breathing room
// kept between the tooltip and the container's edges. Same values as TVChart's
// crosshair tooltip so the two charts feel identical to read.
const TOOLTIP_GAP = 14;
const TOOLTIP_EDGE = 8;

export type OptionBarPoint = {
  time: number; // epoch seconds — canonical time axis
  dayKey: string; // US trading day ('YYYY-MM-DD'), used to place OI markers
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type UnderlyingPoint = {
  time: number;
  close: number;
};

// One snapshot per day from public.us_opt_chg_rpt for this exact strike+type —
// "mark all the data points from the beginning" means every one of these,
// not just whatever window the option-bars chart itself is showing.
// `tradeDate` is the session that produced the OI change: the report loaded on
// day D reflects D-1's trading, so the marker belongs on D-1's bar, not D's.
export type OiHistoryPoint = {
  tradeDate: string;
  ltp: number;
  oi: number;
  oiChg: number;
};

interface OptionContractChartProps {
  optionBars: OptionBarPoint[];
  underlyingBars?: UnderlyingPoint[];
  underlyingSymbol?: string;
  historyPoints?: OiHistoryPoint[];
  isIntraday?: boolean;
  height?: number;
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

export default function OptionContractChart({
  optionBars,
  underlyingBars = [],
  underlyingSymbol,
  historyPoints = [],
  isIntraday = false,
  height = 420,
}: OptionContractChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const underlyingSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const oiChgSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  // `x` is already corrected for the left price scale — see handleMove.
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Create chart once.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: { background: { color: '#ffffff' }, textColor: '#333' },
      grid: { vertLines: { color: '#f0f0f0' }, horzLines: { color: '#f0f0f0' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#d1d4dc' },
      leftPriceScale: { visible: true, borderColor: '#d1d4dc' },
      timeScale: { borderColor: '#d1d4dc', timeVisible: isIntraday, secondsVisible: false },
    });

    // The bottom 38% of both price scales is reserved for the OI-change and volume bands, so the scales
    // run below the data's minimum and would label impossible negative prices; leave those ticks blank.
    const priceOnly = { type: 'custom' as const, minMove: 0.01, formatter: (v: number) => (v < 0 ? '' : v.toFixed(2)) };
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      priceScaleId: 'right',
      priceFormat: priceOnly,
    });

    const underlyingSeries = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 2,
      priceScaleId: 'left',
      priceFormat: priceOnly,
      priceLineVisible: false,
      lastValueVisible: true,
    });

    // Bands below the price: OI change (session of the change, green up / red down)
    // above volume. Overlay scales, since lightweight-charts v4 has no separate panes.
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.38 } });
    chart.priceScale('left').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.38 } });
    const oiChgSeries = chart.addHistogramSeries({
      priceScaleId: 'oichg', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false,
    });
    chart.priceScale('oichg').applyOptions({ scaleMargins: { top: 0.64, bottom: 0.19 } });
    const volumeSeries = chart.addHistogramSeries({
      priceScaleId: 'vol', color: '#94a3b8', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    underlyingSeriesRef.current = underlyingSeries;
    volumeSeriesRef.current = volumeSeries;
    oiChgSeriesRef.current = oiChgSeries;

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      underlyingSeriesRef.current = null;
      volumeSeriesRef.current = null;
      oiChgSeriesRef.current = null;
    };
  }, [height, isIntraday]);

  // Option candles.
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const data: CandlestickData[] = optionBars.map(b => ({
      time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close,
    }));
    candleSeriesRef.current.setData(data);
    volumeSeriesRef.current?.setData(optionBars.map((b): HistogramData => ({
      time: b.time as Time, value: b.volume, color: b.close >= b.open ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)',
    })));
    chartRef.current?.timeScale().fitContent();
  }, [optionBars]);

  // OI change per session, on the first bar of its trade date (same placement as the markers below).
  useEffect(() => {
    if (!oiChgSeriesRef.current) return;
    const firstBarTimeByDay = new Map<string, number>();
    optionBars.forEach(b => { if (!firstBarTimeByDay.has(b.dayKey)) firstBarTimeByDay.set(b.dayKey, b.time); });
    const byTime = new Map<number, number>();
    for (const p of historyPoints) {
      const t = firstBarTimeByDay.get(p.tradeDate);
      if (t !== undefined) byTime.set(t, p.oiChg);
    }
    oiChgSeriesRef.current.setData([...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]): HistogramData => ({
      time: t as Time, value: v, color: v >= 0 ? '#16a34a' : '#dc2626',
    })));
  }, [optionBars, historyPoints]);

  // Underlying comparison line.
  useEffect(() => {
    if (!underlyingSeriesRef.current) return;
    const data: LineData[] = underlyingBars.map(b => ({ time: b.time as Time, value: b.close }));
    underlyingSeriesRef.current.setData(data);
  }, [underlyingBars]);

  // OI/LTP history markers — one per us_opt_chg_rpt snapshot, placed on the
  // option bar of the session that produced it (its trade date, one trading day before the load). Snapshots with no corresponding bar
  // (e.g. the feed's current-trading-day cap) are skipped rather than guessed.
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    if (optionBars.length === 0 || historyPoints.length === 0) {
      candleSeriesRef.current.setMarkers([]);
      return;
    }
    const firstBarTimeByDay = new Map<string, number>();
    optionBars.forEach(b => {
      if (!firstBarTimeByDay.has(b.dayKey)) firstBarTimeByDay.set(b.dayKey, b.time);
    });

    const markers: SeriesMarker<Time>[] = historyPoints
      .map((p): SeriesMarker<Time> | null => {
        const barTime = firstBarTimeByDay.get(p.tradeDate);
        if (barTime === undefined) return null;
        const rising = p.oiChg > 0;
        const falling = p.oiChg < 0;
        return {
          time: barTime as Time,
          position: 'belowBar',
          shape: 'circle',
          color: rising ? '#22c55e' : falling ? '#ef4444' : '#9ca3af',
          text: 'OI',
        };
      })
      .filter((m): m is SeriesMarker<Time> => m !== null)
      .sort((a, b) => (a.time as number) - (b.time as number));

    try {
      candleSeriesRef.current.setMarkers(markers);
    } catch (err) {
      console.error('Error setting OI history markers:', err);
    }
  }, [optionBars, historyPoints]);

  // Crosshair tooltip — option OHLC + underlying close + that day's OI snapshot, if any.
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;

    const byDayKey = new Map<string, OptionBarPoint>();
    optionBars.forEach(b => byDayKey.set(b.dayKey, b));
    const historyByDay = new Map<string, OiHistoryPoint>();
    historyPoints.forEach(p => historyByDay.set(p.tradeDate, p));
    const underlyingByTime = new Map<number, number>();
    underlyingBars.forEach(b => underlyingByTime.set(b.time, b.close));

    function handleMove(param: MouseEventParams) {
      if (!param.time || !param.point || !containerRef.current) {
        setTooltip(null);
        return;
      }
      const bar = optionBars.find(b => b.time === (param.time as unknown as number));
      if (!bar) {
        setTooltip(null);
        return;
      }
      const lines = [
        formatBarTime(bar.time, isIntraday),
        `O ${bar.open.toFixed(2)}  H ${bar.high.toFixed(2)}  L ${bar.low.toFixed(2)}  C ${bar.close.toFixed(2)}`,
        `Vol ${bar.volume.toLocaleString()}`,
      ];
      const underlyingClose = underlyingByTime.get(bar.time);
      if (underlyingClose !== undefined) {
        lines.push(`${underlyingSymbol ?? 'Underlying'} ${underlyingClose.toFixed(2)}`);
      }
      const oiPoint = historyByDay.get(bar.dayKey);
      if (oiPoint) {
        lines.push(`OI ${oiPoint.oi.toLocaleString()} (${oiPoint.oiChg > 0 ? '+' : ''}${oiPoint.oiChg.toLocaleString()})  LTP ${oiPoint.ltp}`);
      }
      // `param.point` is relative to the chart PANE, which starts after the
      // left price scale, but the tooltip is absolutely positioned against the
      // whole container — so add the scale's width back or the box sits well
      // to the left of the crosshair it's describing.
      setTooltip({ x: param.point.x + chart.priceScale('left').width(), y: param.point.y, lines });
    }

    chart.subscribeCrosshairMove(handleMove);
    return () => chart.unsubscribeCrosshairMove(handleMove);
  }, [optionBars, underlyingBars, historyPoints, isIntraday, underlyingSymbol]);

  // Track the crosshair, matching TVChart's tooltip placement: offset to its
  // right, flipped to the left near the edge, clamped vertically. It used to be
  // pinned to the top-left corner, which meant it never read as a crosshair tip
  // at all.
  //
  // Done here rather than inline because placement needs the box's rendered
  // size, and the content is whitespace-nowrap — its width swings with whether
  // the underlying/OI lines are present, so the old hardcoded 180px guess both
  // overflowed and left gaps. useLayoutEffect so the corrected position lands
  // before paint instead of jittering on every mouse move.
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    const container = containerRef.current;
    if (!tooltip || !el || !container) return;

    // Right of the crosshair by default; flip to its left only when the box
    // would overflow, so it stays clear of the bar either way.
    let left = tooltip.x + TOOLTIP_GAP;
    if (left + el.offsetWidth > container.clientWidth - TOOLTIP_EDGE) {
      left = tooltip.x - TOOLTIP_GAP - el.offsetWidth;
    }
    // Too wide to clear the crosshair on either side — keep it on-screen and
    // accept the overlap.
    el.style.left = `${Math.max(TOOLTIP_EDGE, left)}px`;

    const maxTop = Math.max(TOOLTIP_EDGE, container.clientHeight - el.offsetHeight - TOOLTIP_EDGE);
    el.style.top = `${Math.min(Math.max(TOOLTIP_EDGE, tooltip.y + TOOLTIP_GAP), maxTop)}px`;
  }, [tooltip]);

  return (
    <div className="relative">
      <div ref={containerRef} style={{ height }} />
      {tooltip && (
        <div
          ref={tooltipRef}
          // Same chrome as TVChart's crosshair tooltip.
          className="absolute z-10 bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-xs text-gray-700 pointer-events-none whitespace-nowrap"
          // Provisional position; the layout effect above corrects both axes
          // against the box's measured size before this paints.
          style={{ left: tooltip.x + TOOLTIP_GAP, top: tooltip.y + TOOLTIP_GAP }}
        >
          {tooltip.lines.map((line, i) => (
            <div key={i} className={i === 0 ? 'font-bold text-gray-900 mb-2' : ''}>{line}</div>
          ))}
        </div>
      )}
      {optionBars.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
          No option bar data available for this range.
        </div>
      )}
    </div>
  );
}
