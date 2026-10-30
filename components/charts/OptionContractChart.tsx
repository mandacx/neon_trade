'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  SeriesMarker,
  Time,
  MouseEventParams,
  CustomData,
  CustomSeriesOptions,
  ICustomSeriesPaneView,
  ICustomSeriesPaneRenderer,
  PaneRendererCustomData,
  customSeriesDefaultOptions,
} from 'lightweight-charts';

// Volume (grey) and OI change (green up / red down) for one session, drawn side by side on one scale.
// lightweight-charts v4 histograms cannot be offset within a bar slot, hence a custom series.
interface VolOiData extends CustomData<Time> { volume: number; oiChg: number | null }

class VolOiPaneView implements ICustomSeriesPaneView<Time, VolOiData, CustomSeriesOptions> {
  private data: PaneRendererCustomData<Time, VolOiData> | null = null;
  private rend: ICustomSeriesPaneRenderer = {
    draw: (target, priceConverter) => {
      target.useMediaCoordinateSpace(({ context }) => {
        const d = this.data;
        if (!d || !d.visibleRange) return;
        const zero = priceConverter(0);
        if (zero === null) return;
        const half = Math.max(1, Math.floor(d.barSpacing * 0.8) / 2);
        const bar = (x: number, value: number, color: string) => {
          const y = priceConverter(value);
          if (y === null) return;
          context.fillStyle = color;
          const h = Math.max(1, Math.abs(zero - y));
          context.fillRect(x, value >= 0 ? zero - h : zero, half, h);
        };
        for (let i = d.visibleRange.from; i <= d.visibleRange.to; i++) {
          const b = d.bars[i];
          if (!b) continue;
          const { volume, oiChg } = b.originalData;
          bar(b.x - half, volume, 'rgba(59,130,246,0.75)');
          if (oiChg) bar(b.x, oiChg, oiChg >= 0 ? '#16a34a' : '#dc2626');
        }
      });
    },
  };
  renderer() { return this.rend; }
  update(data: PaneRendererCustomData<Time, VolOiData>) { this.data = data; }
  priceValueBuilder(d: VolOiData) { return [Math.min(0, d.oiChg ?? 0), Math.max(d.volume, d.oiChg ?? 0), d.volume]; }
  isWhitespace(d: VolOiData | { time: Time }): d is { time: Time } { return (d as VolOiData).volume === undefined; }
  defaultOptions() { return { ...customSeriesDefaultOptions, priceLineVisible: false, lastValueVisible: false }; }
}

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
  const bandSeriesRef = useRef<ISeriesApi<'Custom'> | null>(null);
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

    // The bottom 34% of both price scales is reserved for the volume / OI-change band, so the scales
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

    // One band below the price: volume and OI change side by side on the same scale. Overlay scale,
    // since lightweight-charts v4 has no separate panes.
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.34 } });
    chart.priceScale('left').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.34 } });
    const bandSeries = chart.addCustomSeries(new VolOiPaneView(), { priceScaleId: 'band', priceFormat: { type: 'volume' } });
    chart.priceScale('band').applyOptions({ scaleMargins: { top: 0.68, bottom: 0.02 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    underlyingSeriesRef.current = underlyingSeries;
    bandSeriesRef.current = bandSeries;

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
      bandSeriesRef.current = null;
    };
  }, [height, isIntraday]);

  // Option candles.
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const data: CandlestickData[] = optionBars.map(b => ({
      time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close,
    }));
    candleSeriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [optionBars]);

  // Volume per bar, with the session's OI change on the first bar of its trade date (same placement as the markers below).
  useEffect(() => {
    if (!bandSeriesRef.current) return;
    const firstBarTimeByDay = new Map<string, number>();
    optionBars.forEach(b => { if (!firstBarTimeByDay.has(b.dayKey)) firstBarTimeByDay.set(b.dayKey, b.time); });
    const oiByTime = new Map<number, number>();
    for (const p of historyPoints) {
      const t = firstBarTimeByDay.get(p.tradeDate);
      if (t !== undefined) oiByTime.set(t, p.oiChg);
    }
    bandSeriesRef.current.setData(optionBars.map((b): VolOiData => ({ time: b.time as Time, volume: b.volume, oiChg: oiByTime.get(b.time) ?? null })));
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
