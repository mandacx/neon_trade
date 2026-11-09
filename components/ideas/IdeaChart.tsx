'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineStyle, type IChartApi, type Time } from 'lightweight-charts';

export interface ChartPlan {
  symbol: string;
  entryLow: number;
  entryHigh: number;
  targets: Array<{ price: number; label?: string }>;
  stop: number;
  /** Start the daily chart a little before this date (YYYY-MM-DD). */
  from: string;
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Daily candles with the published plan drawn on them: entry zone (blue), targets (green) and stop (red).
 * It is the charting library, not a streaming widget, so what you see is the plan as published (docs/trade-ideas.md).
 * Candles come from the app's own stock OHLC route (stored daily bars).
 */
export default function IdeaChart({ plan, height = 360 }: { plan: ChartPlan; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const chart = createChart(el, {
      height,
      width: el.clientWidth,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#374151', fontSize: 11 },
      grid: { vertLines: { color: '#f3f4f6' }, horzLines: { color: '#f3f4f6' } },
      rightPriceScale: { borderColor: '#e5e7eb' },
      timeScale: { borderColor: '#e5e7eb', rightOffset: 4 },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;
    const candles = chart.addCandlestickSeries({ upColor: '#16a34a', downColor: '#dc2626', borderVisible: false, wickUpColor: '#16a34a', wickDownColor: '#dc2626' });

    const line = (price: number, color: string, title: string, style: LineStyle = LineStyle.Dashed) =>
      candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
    line(plan.entryHigh, '#2563eb', 'Entry high');
    if (plan.entryLow !== plan.entryHigh) line(plan.entryLow, '#2563eb', 'Entry low');
    plan.targets.forEach((t, i) => line(t.price, '#16a34a', t.label || `T${i + 1}`, LineStyle.Solid));
    line(plan.stop, '#dc2626', 'Stop', LineStyle.Solid);

    const today = new Date().toISOString().slice(0, 10);
    const from = addDays(plan.from, -60);
    fetch(`/api/stocks/${encodeURIComponent(plan.symbol)}/ohlc?interval=daily&from=${from}&to=${today}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        const rows: any[] = Array.isArray(json?.data?.data) ? json.data.data : [];
        const seen = new Set<string>();
        const data = rows
          .map(b => ({ time: (b.date ?? new Date(b.timestamp * 1000).toISOString().slice(0, 10)) as Time, open: b.open, high: b.high, low: b.low, close: b.close }))
          .filter(b => typeof b.open === 'number' && !seen.has(String(b.time)) && seen.add(String(b.time)))
          .sort((a, b) => (String(a.time) < String(b.time) ? -1 : 1));
        if (!json?.success || data.length === 0) { setState(json?.success ? 'empty' : 'error'); return; }
        candles.setData(data);
        chart.timeScale().fitContent();
        setState('ready');
      })
      .catch(() => !cancelled && setState('error'));

    const onResize = () => chart.applyOptions({ width: el.clientWidth });
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      chart.remove();
      chartRef.current = null;
    };
    // The plan is immutable once published, so the chart is built once per idea.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.symbol, plan.from, plan.entryLow, plan.entryHigh, plan.stop, plan.targets.length, height]);

  return (
    <div className="relative">
      <div ref={ref} style={{ height }} />
      {state !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 bg-white/70">
          {state === 'loading' ? 'Loading chart…' : state === 'empty' ? 'No price bars for this symbol.' : 'Could not load the chart.'}
        </div>
      )}
    </div>
  );
}
