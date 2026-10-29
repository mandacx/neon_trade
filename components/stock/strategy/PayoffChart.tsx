'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChartEx,
  type ChartOptionsImpl,
  type HorzScaleItemConverterToInternalObj,
  type IChartApiBase,
  type IHorzScaleBehavior,
  type InternalHorzScaleItem,
  type InternalHorzScaleItemKey,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesMarker,
  type TickMark,
  type TickMarkWeightValue,
  type TimeMark,
  type TimeScalePoint,
} from 'lightweight-charts';
import type { Point } from '@/lib/payoff/evaluate';

/**
 * Horizontal scale whose items are underlying prices (plain numbers) instead of
 * times, so lightweight-charts can draw a payoff diagram. Points are spaced by
 * index, so callers pass a uniform price grid. Tick labels prefer round prices.
 */
class PriceHorzScale implements IHorzScaleBehavior<number> {
  private opts!: ChartOptionsImpl<number>;
  constructor(private step: number) {}
  options(): ChartOptionsImpl<number> { return this.opts; }
  setOptions(options: ChartOptionsImpl<number>): void { this.opts = options; }
  preprocessData(): void {}
  updateFormatter(): void {}
  createConverterToInternalObj(): HorzScaleItemConverterToInternalObj<number> {
    return (price: number) => price as unknown as InternalHorzScaleItem;
  }
  key(item: InternalHorzScaleItem | number): InternalHorzScaleItemKey { return item as unknown as InternalHorzScaleItemKey; }
  cacheKey(item: InternalHorzScaleItem): number { return item as unknown as number; }
  convertHorzItemToInternal(item: number): InternalHorzScaleItem { return item as unknown as InternalHorzScaleItem; }
  formatHorzItem(item: InternalHorzScaleItem): string { return fmtPrice(item as unknown as number); }
  formatTickmark(item: TickMark): string { return fmtPrice(item.time as unknown as number); }
  maxTickMarkWeight(marks: TimeMark[]): TickMarkWeightValue {
    return marks.reduce((m, t) => (t.weight > m ? t.weight : m), marks[0]?.weight ?? (0 as TickMarkWeightValue));
  }
  fillWeightsForPoints(points: readonly TimeScalePoint[], startIndex: number): void {
    for (let i = startIndex; i < points.length; i++) {
      const v = points[i].time as unknown as number;
      const n = Math.round(v / this.step);
      const w = n % 100 === 0 ? 50 : n % 50 === 0 ? 40 : n % 20 === 0 ? 30 : n % 10 === 0 ? 20 : n % 5 === 0 ? 10 : 1;
      (points[i] as { timeWeight: TickMarkWeightValue }).timeWeight = w as TickMarkWeightValue;
    }
  }
}

const fmtPrice = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2).replace(/\.00$/, ''));
const fmtUsd = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export interface PayoffSeries {
  expiry: Point[];
  today: Point[];
  /** Curve at the slider date (omitted when the slider is at today or expiry). */
  date?: Point[];
  dateLabel?: string;
}

export default function PayoffChart({ series, step, spot, breakevens, height = 380 }: {
  series: PayoffSeries;
  /** Grid step of the price axis (all curves share the grid). */
  step: number;
  spot: number;
  breakevens: number[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApiBase<number> | null>(null);
  const refs = useRef<{ expiry: ISeriesApi<'Baseline', number>; today: ISeriesApi<'Line', number>; date: ISeriesApi<'Line', number> } | null>(null);
  const [hover, setHover] = useState<{ s: number; expiry?: number; today?: number; date?: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChartEx<number, PriceHorzScale>(containerRef.current, new PriceHorzScale(step), {
      width: containerRef.current.clientWidth,
      height,
      layout: { background: { color: '#ffffff' }, textColor: '#333' },
      grid: { vertLines: { color: '#f3f4f6' }, horzLines: { color: '#f3f4f6' } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#d1d4dc' },
      timeScale: { borderColor: '#d1d4dc', fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
    });
    const priceFormat = { type: 'custom' as const, formatter: (v: number) => fmtUsd(v), minMove: 1 };
    const expiry = chart.addBaselineSeries({
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#16a34a', topFillColor1: 'rgba(34,197,94,0.28)', topFillColor2: 'rgba(34,197,94,0.05)',
      bottomLineColor: '#dc2626', bottomFillColor1: 'rgba(239,68,68,0.05)', bottomFillColor2: 'rgba(239,68,68,0.28)',
      lineWidth: 2, priceFormat, priceLineVisible: false, lastValueVisible: false, title: 'Expiry',
    });
    const today = chart.addLineSeries({ color: '#2563eb', lineWidth: 2, lineStyle: 2, priceFormat, priceLineVisible: false, lastValueVisible: false, title: 'T+0' });
    const date = chart.addLineSeries({ color: '#f59e0b', lineWidth: 2, priceFormat, priceLineVisible: false, lastValueVisible: false });
    expiry.createPriceLine({ price: 0, color: '#9ca3af', lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
    chartRef.current = chart;
    refs.current = { expiry, today, date };

    const onMove = (p: MouseEventParams<number>) => {
      if (p.time === undefined || !refs.current) { setHover(null); return; }
      const val = (s: ISeriesApi<'Baseline' | 'Line', number>) => {
        const d = p.seriesData.get(s) as { value?: number } | undefined;
        return d?.value;
      };
      setHover({ s: p.time as number, expiry: val(refs.current.expiry), today: val(refs.current.today), date: val(refs.current.date) });
    };
    chart.subscribeCrosshairMove(onMove);
    const onResize = () => { if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth }); };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      refs.current = null;
    };
  }, [height, step]);

  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    const toData = (pts: Point[]) => pts.map(p => ({ time: p.s, value: Math.round(p.pnl * 100) / 100 }));
    r.expiry.setData(toData(series.expiry));
    r.today.setData(toData(series.today));
    r.date.setData(series.date ? toData(series.date) : []);
    r.date.applyOptions({ title: series.dateLabel ?? '' });

    // Markers snap to the nearest grid point: spot (arrow) and breakevens (circles).
    const grid = series.expiry.map(p => p.s);
    const snap = (x: number) => grid.reduce((b, s) => (Math.abs(s - x) < Math.abs(b - x) ? s : b), grid[0]);
    if (grid.length) {
      const spotMarker: SeriesMarker<number> = { time: snap(spot), position: 'belowBar', shape: 'arrowUp', color: '#111827', text: `Spot ${fmtPrice(spot)}` };
      const markers: SeriesMarker<number>[] = [
        spotMarker,
        ...breakevens.filter(b => b >= grid[0] && b <= grid[grid.length - 1]).map((b): SeriesMarker<number> => ({
          time: snap(b), position: 'inBar', shape: 'circle', color: '#2563eb', text: `B/E ${fmtPrice(b)}`,
        })),
      ].sort((a, b) => a.time - b.time);
      r.expiry.setMarkers(markers);
    }
    chartRef.current?.timeScale().fitContent();
  }, [series, spot, breakevens]);

  const legendVal = (v: number | undefined) =>
    v === undefined ? '—' : <span className={v >= 0 ? 'text-green-700' : 'text-red-700'}>{fmtUsd(v)}</span>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 mb-1 min-h-[1.25rem]">
        <span title="Profit/loss at the nearest expiry"><span className="inline-block w-3 h-0.5 bg-green-600 align-middle mr-1" />Expiry {hover && legendVal(hover.expiry)}</span>
        <span title="Profit/loss today if the stock moved instantly to each price (Black-76 model)"><span className="inline-block w-3 border-t-2 border-dashed border-blue-600 align-middle mr-1" />T+0 {hover && legendVal(hover.today)}</span>
        {series.date && <span title="Profit/loss on the date chosen with the slider"><span className="inline-block w-3 h-0.5 bg-amber-500 align-middle mr-1" />{series.dateLabel} {hover && legendVal(hover.date)}</span>}
        {hover && <span className="ml-auto font-semibold text-gray-800">Stock at {fmtPrice(hover.s)} ({spot > 0 ? `${hover.s >= spot ? '+' : ''}${(((hover.s - spot) / spot) * 100).toFixed(1)}%` : ''})</span>}
      </div>
      <div ref={containerRef} style={{ height }} />
    </div>
  );
}
