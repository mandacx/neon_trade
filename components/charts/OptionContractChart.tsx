'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  SeriesMarker,
  Time,
  MouseEventParams,
} from 'lightweight-charts';

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
export type OiHistoryPoint = {
  loadDate: string;
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
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);

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

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      priceScaleId: 'right',
    });

    const underlyingSeries = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 2,
      priceScaleId: 'left',
      priceLineVisible: false,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    underlyingSeriesRef.current = underlyingSeries;

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Underlying comparison line.
  useEffect(() => {
    if (!underlyingSeriesRef.current) return;
    const data: LineData[] = underlyingBars.map(b => ({ time: b.time as Time, value: b.close }));
    underlyingSeriesRef.current.setData(data);
  }, [underlyingBars]);

  // OI/LTP history markers — one per day.us_opt_chg_rpt snapshot, placed on the
  // nearest loaded option bar for that day. Snapshots with no corresponding bar
  // (e.g. Alpaca's current-trading-day cap) are skipped rather than guessed.
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
        const barTime = firstBarTimeByDay.get(p.loadDate);
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
    historyPoints.forEach(p => historyByDay.set(p.loadDate, p));
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
      setTooltip({ x: param.point.x, y: param.point.y, lines });
    }

    chart.subscribeCrosshairMove(handleMove);
    return () => chart.unsubscribeCrosshairMove(handleMove);
  }, [optionBars, underlyingBars, historyPoints, isIntraday, underlyingSymbol]);

  return (
    <div className="relative">
      <div ref={containerRef} style={{ height }} />
      {tooltip && (
        <div
          className="absolute z-10 bg-white/95 border border-gray-200 rounded-md shadow-md px-2.5 py-1.5 text-[11px] text-gray-700 pointer-events-none whitespace-nowrap"
          style={{
            left: Math.min(tooltip.x + 12, (containerRef.current?.clientWidth ?? 0) - 180),
            top: 8,
          }}
        >
          {tooltip.lines.map((line, i) => (
            <div key={i} className={i === 0 ? 'font-semibold text-gray-900' : ''}>{line}</div>
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
