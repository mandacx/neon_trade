'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type MouseEventParams, type Time } from 'lightweight-charts';

export interface OiTrendPoint { date: string; callOi: number; putOi: number }

/**
 * Total call vs put open interest per day for one expiry (lightweight-charts),
 * with the put/call ratio on the left scale. Days with no data (both 0) are
 * dropped by the caller.
 */
export default function OiTrendChart({ points, height = 300 }: { points: OiTrendPoint[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{ call: ISeriesApi<'Line'>; put: ISeriesApi<'Line'>; pcr: ISeriesApi<'Line'> } | null>(null);
  const [hover, setHover] = useState<{ date: string; callOi: number; putOi: number; pcr: number | null } | null>(null);

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
      timeScale: { borderColor: '#d1d4dc' },
    });
    const call = chart.addLineSeries({ color: '#16a34a', lineWidth: 2, priceScaleId: 'right', priceFormat: { type: 'volume' }, title: 'Call OI' });
    const put = chart.addLineSeries({ color: '#dc2626', lineWidth: 2, priceScaleId: 'right', priceFormat: { type: 'volume' }, title: 'Put OI' });
    const pcr = chart.addLineSeries({ color: '#7c3aed', lineWidth: 1, lineStyle: 2, priceScaleId: 'left', title: 'PCR', priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
    chartRef.current = chart;
    seriesRef.current = { call, put, pcr };
    const onResize = () => { if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth }); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, [height]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
    s.call.setData(sorted.map(p => ({ time: p.date as Time, value: p.callOi })));
    s.put.setData(sorted.map(p => ({ time: p.date as Time, value: p.putOi })));
    s.pcr.setData(sorted.filter(p => p.callOi > 0).map(p => ({ time: p.date as Time, value: Math.round((p.putOi / p.callOi) * 100) / 100 })));
    chartRef.current?.timeScale().fitContent();

    const byDate = new Map(sorted.map(p => [p.date, p]));
    const chart = chartRef.current;
    const onMove = (param: MouseEventParams) => {
      const t = param.time as unknown;
      const key = typeof t === 'string' ? t
        : t && typeof t === 'object' && 'year' in (t as object)
          ? `${(t as { year: number }).year}-${String((t as { month: number }).month).padStart(2, '0')}-${String((t as { day: number }).day).padStart(2, '0')}`
          : null;
      const p = key ? byDate.get(key) : undefined;
      setHover(p ? { ...p, pcr: p.callOi > 0 ? p.putOi / p.callOi : null } : null);
    };
    chart?.subscribeCrosshairMove(onMove);
    return () => chart?.unsubscribeCrosshairMove(onMove);
  }, [points]);

  const last = hover ?? (points.length ? (() => { const p = [...points].sort((a, b) => b.date.localeCompare(a.date))[0]; return { ...p, pcr: p.callOi > 0 ? p.putOi / p.callOi : null }; })() : null);

  return (
    <div className="relative">
      {last && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 mb-1.5">
          <span className="font-semibold text-gray-800">{last.date}</span>
          <span><span className="text-green-700 font-semibold">Call OI</span> {last.callOi.toLocaleString()}</span>
          <span><span className="text-red-700 font-semibold">Put OI</span> {last.putOi.toLocaleString()}</span>
          <span title="Put/call ratio: put OI ÷ call OI. Above 1 = more puts open than calls."><span className="text-violet-700 font-semibold">PCR</span> {last.pcr != null ? last.pcr.toFixed(2) : '—'}</span>
        </div>
      )}
      <div ref={containerRef} style={{ height }} />
      {points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">No open interest data for this expiry in the chart&apos;s range.</div>
      )}
    </div>
  );
}
