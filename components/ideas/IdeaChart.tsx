'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChart, ColorType, LineStyle, TickMarkType,
  type CandlestickData, type HistogramData, type IChartApi, type ISeriesApi, type MouseEventParams, type Time,
} from 'lightweight-charts';
import { CHART_INTERVALS, type ChartInterval } from '@/lib/chartPrefs';
import { useChartPrefs } from '@/components/charts/useChartPrefs';
import { axisCrosshairLabel, axisTickLabel } from '@/lib/chartTime';
import { fmtDay } from '@/components/ideas/ideaUi';

export interface ChartPlan {
  symbol: string;
  entryLow: number;
  entryHigh: number;
  targets: Array<{ price: number; label?: string }>;
  stop: number;
  /** Start the daily chart a little before this date (YYYY-MM-DD). */
  from: string;
}

const TZ = 'America/New_York'; // exchange time, like the stock chart
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Same buttons and labels as the stock chart's interval selector (INTERVAL_CONFIG in StockAnalysis.tsx). */
const INTERVAL_LABEL: Record<ChartInterval, string> = { '1min': '1m', '5min': '5m', '15min': '15m', '30min': '30m', '1hour': '1H', daily: '1D' };
/** Calendar days of history requested per interval (enough to span a weekend or a holiday). Daily uses the plan's own date range. */
const INTRADAY_DAYS: Record<Exclude<ChartInterval, 'daily'>, number> = { '1min': 4, '5min': 8, '15min': 15, '30min': 30, '1hour': 45 };

interface Bar { time: Time; label: string; open: number; high: number; low: number; close: number; volume: number }

const px = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/**
 * Candles with the published plan drawn on them: entry zone (blue), targets (green) and stop (red), a crosshair
 * readout (date/time, O H L C, change, volume) and the stock chart's interval selector. The interval is the stock
 * chart's saved setting (`chart.settings`, lib/chartPrefs.ts): changing it here changes it there, per account.
 * It is the charting library on the app's own OHLC route, not a streaming widget, so what you see is the plan as
 * published (docs/trade-ideas.md). Intraday history is the recent window only (no scroll-back loading here).
 */
export default function IdeaChart({ plan, height = 360 }: { plan: ChartPlan; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const barsRef = useRef<Map<string, Bar>>(new Map());
  const lastBarRef = useRef<Bar | null>(null);
  const { prefs, ready, save, stored } = useChartPrefs();
  const interval = prefs.interval;
  const intraday = interval !== 'daily';
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [shown, setShown] = useState<Bar | null>(null);

  // The chart and the plan's price lines: built once per idea.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      height,
      width: el.clientWidth,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#374151', fontSize: 11 },
      grid: { vertLines: { color: '#f3f4f6' }, horzLines: { color: '#f3f4f6' } },
      rightPriceScale: { borderColor: '#e5e7eb', scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: '#e5e7eb', rightOffset: 4 },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;
    const candles = chart.addCandlestickSeries({ upColor: '#16a34a', downColor: '#dc2626', borderVisible: false, wickUpColor: '#16a34a', wickDownColor: '#dc2626' });
    candleRef.current = candles;
    const volume = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeRef.current = volume;

    const line = (price: number, color: string, title: string, style: LineStyle = LineStyle.Dashed) =>
      candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
    line(plan.entryHigh, '#2563eb', 'Entry high');
    if (plan.entryLow !== plan.entryHigh) line(plan.entryLow, '#2563eb', 'Entry low');
    plan.targets.forEach((t, i) => line(t.price, '#16a34a', t.label || `T${i + 1}`, LineStyle.Solid));
    line(plan.stop, '#dc2626', 'Stop', LineStyle.Solid);

    const onMove = (param: MouseEventParams) => {
      const bar = param.time ? barsRef.current.get(String(param.time)) : undefined;
      setShown(bar ?? lastBarRef.current); // off the data: back to the latest bar
    };
    chart.subscribeCrosshairMove(onMove);

    const onResize = () => chart.applyOptions({ width: el.clientWidth });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = candleRef.current = volumeRef.current = null;
    };
    // The plan is immutable once published, so the chart is built once per idea.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.symbol, plan.from, plan.entryLow, plan.entryHigh, plan.stop, plan.targets.length, height]);

  // The bars: reloaded when the interval changes. Waits for the saved interval so the first request already uses it.
  useEffect(() => {
    const chart = chartRef.current;
    const candles = candleRef.current;
    const volume = volumeRef.current;
    if (!ready || !chart || !candles || !volume) return;
    let cancelled = false;
    setState('loading');

    chart.applyOptions({
      timeScale: {
        timeVisible: intraday,
        secondsVisible: false,
        tickMarkFormatter: intraday ? (t: Time, type: TickMarkType) => axisTickLabel(Number(t), type, true, TZ) : undefined,
      },
      localization: { timeFormatter: intraday ? (t: Time) => axisCrosshairLabel(Number(t), true, TZ) : undefined },
    });

    const today = new Date().toISOString().slice(0, 10);
    const from = intraday ? addDays(today, -INTRADAY_DAYS[interval as Exclude<ChartInterval, 'daily'>]) : addDays(plan.from, -60);
    fetch(`/api/stocks/${encodeURIComponent(plan.symbol)}/ohlc?interval=${interval}&from=${from}&to=${today}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        const rows: any[] = Array.isArray(json?.data?.data) ? json.data.data : [];
        const seen = new Set<string>();
        const bars: Bar[] = [];
        for (const b of rows) {
          if (typeof b.open !== 'number' || typeof b.close !== 'number') continue;
          const day: string = b.date ?? new Date(b.timestamp * 1000).toISOString().slice(0, 10);
          const time = (intraday ? b.timestamp : day) as Time;
          const key = String(time);
          if (seen.has(key)) continue;
          seen.add(key);
          bars.push({
            time, label: intraday ? axisCrosshairLabel(b.timestamp, true, TZ) : fmtDay(day),
            open: b.open, high: b.high, low: b.low, close: b.close, volume: typeof b.volume === 'number' ? b.volume : 0,
          });
        }
        bars.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
        barsRef.current = new Map(bars.map(b => [String(b.time), b]));
        lastBarRef.current = bars[bars.length - 1] ?? null;
        setShown(lastBarRef.current);
        if (!json?.success || bars.length === 0) {
          candles.setData([]);
          volume.setData([]);
          setState(json?.success ? 'empty' : 'error');
          return;
        }
        candles.setData(bars.map<CandlestickData>(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
        volume.setData(bars.map<HistogramData>(b => ({ time: b.time, value: b.volume, color: b.close >= b.open ? 'rgba(22,163,74,0.35)' : 'rgba(220,38,38,0.35)' })));
        chart.timeScale().fitContent();
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, interval, plan.symbol, plan.from, plan.entryLow, plan.entryHigh, plan.stop, plan.targets.length, height]);

  const change = shown ? shown.close - shown.open : 0;
  const up = change >= 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1.5">
        <div className="flex gap-1" role="group" aria-label="Chart interval">
          {CHART_INTERVALS.map(i => (
            <button
              key={i}
              type="button"
              onClick={() => save({ interval: i })}
              aria-pressed={interval === i}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold ${interval === i ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {INTERVAL_LABEL[i]}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-gray-400" title={stored === 'account' ? 'Saved on your account, shared with the stock chart' : 'Saved in this browser, shared with the stock chart'}>
          Interval saved ({stored === 'account' ? 'your account' : 'this browser'})
        </span>
        <div className="ml-auto text-[11px] text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-0.5 min-h-[18px]" aria-live="off">
          {shown && (
            <>
              <span className="text-gray-400">{shown.label}</span>
              <span>O <b className="text-gray-900">{px(shown.open)}</b></span>
              <span>H <b className="text-green-600">{px(shown.high)}</b></span>
              <span>L <b className="text-red-600">{px(shown.low)}</b></span>
              <span>C <b className={up ? 'text-green-600' : 'text-red-600'}>{px(shown.close)}</b></span>
              <span className={up ? 'text-green-600' : 'text-red-600'}>{up ? '+' : ''}{change.toFixed(2)} ({up ? '+' : ''}{shown.open ? ((change / shown.open) * 100).toFixed(2) : '0.00'}%)</span>
              <span>Vol <b className="text-gray-900">{shown.volume.toLocaleString('en-US')}</b></span>
            </>
          )}
        </div>
      </div>
      <div className="relative">
        <div ref={ref} style={{ height }} />
        {state !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 bg-white/70">
            {state === 'loading' ? 'Loading chart…' : state === 'empty' ? 'No price bars for this symbol and interval.' : 'Could not load the chart.'}
          </div>
        )}
      </div>
    </div>
  );
}
