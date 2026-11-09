'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { IDEA_HORIZONS, horizonMeta, outcomeMeta } from '@/lib/ideaTypes';
import type { Stats } from '@/lib/ideaStats';
import {
  DirectionPill, HorizonPill, OutcomePill, Spinner, api, fmtDay, fmtPct, fmtR, inputClass, rTone,
} from '@/components/ideas/ideaUi';
import type { IdeaView } from '@/lib/ideas';

interface Group { key: string; stats: Stats }
interface PerfData {
  stats: Stats;
  byHorizon: Group[];
  byDirection: Group[];
  bySymbol: Group[];
  byOptions: Group[];
  results: IdeaView[];
  meta: { definitions: Array<{ key: string; label: string; definition: string }>; basis: string };
}

const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);
const num2 = (v: number | null) => (v == null ? '—' : v.toFixed(2));

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5" title={hint}>
      <div className="text-[10px] uppercase font-semibold text-gray-400">{label}</div>
      <div className={`text-lg font-bold ${tone ?? 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

/** Equity curve in R (cumulative R by exit date). Plain SVG: no chart library needed for one line. */
function Curve({ points }: { points: Array<{ date: string; cumR: number }> }) {
  if (points.length < 2) return <div className="text-xs text-gray-500 py-8 text-center">The equity curve appears once at least two ideas have finished.</div>;
  const W = 640, H = 180, P = 28;
  const ys = [0, ...points.map(p => p.cumR)];
  const min = Math.min(...ys), max = Math.max(...ys);
  const span = max - min || 1;
  const x = (i: number) => P + (i / (points.length - 1)) * (W - P * 2);
  const y = (v: number) => H - P - ((v - min) / span) * (H - P * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.cumR).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Equity curve in R, ending at ${last.cumR} R after ${points.length} ideas`}>
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="#d1d5db" strokeDasharray="4 3" />
      <text x={4} y={y(0) + 3} fontSize="10" fill="#9ca3af">0R</text>
      <text x={4} y={y(max) + 3} fontSize="10" fill="#9ca3af">{max.toFixed(1)}</text>
      <text x={4} y={y(min) + 3} fontSize="10" fill="#9ca3af">{min.toFixed(1)}</text>
      <path d={d} fill="none" stroke={last.cumR >= 0 ? '#16a34a' : '#dc2626'} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last.cumR)} r="3.5" fill={last.cumR >= 0 ? '#16a34a' : '#dc2626'} />
      <text x={P} y={H - 6} fontSize="10" fill="#9ca3af">{fmtDay(points[0].date)}</text>
      <text x={W - P} y={H - 6} fontSize="10" fill="#9ca3af" textAnchor="end">{fmtDay(last.date)}</text>
    </svg>
  );
}

function BreakdownTable({ title, rows, label }: { title: string; rows: Group[]; label: (k: string) => React.ReactNode }) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 overflow-x-auto">
      <h3 className="text-sm font-bold text-gray-900 mb-2">{title}</h3>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-[10px] uppercase text-gray-400"><th className="py-1 pr-2">Group</th><th className="pr-2 text-right">Counted</th><th className="pr-2 text-right">Hit rate</th><th className="pr-2 text-right">Avg R</th><th className="text-right">Total R</th></tr></thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(g => (
            <tr key={g.key}>
              <td className="py-1.5 pr-2 font-semibold text-gray-800">{label(g.key)}</td>
              <td className="pr-2 text-right">{g.stats.n}</td>
              <td className="pr-2 text-right">{pct(g.stats.hitRate)}</td>
              <td className={`pr-2 text-right font-semibold ${rTone(g.stats.avgR)}`}>{fmtR(g.stats.avgR)}</td>
              <td className={`text-right font-semibold ${rTone(g.stats.totalR)}`}>{fmtR(g.stats.totalR)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PerformancePage() {
  const [horizon, setHorizon] = useState('');
  const [direction, setDirection] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<PerfData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams();
    if (horizon) qs.set('horizon', horizon);
    if (direction) qs.set('direction', direction);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    api<PerfData>(`/api/ideas/performance?${qs}`)
      .then(d => { if (alive) { setData(d); setError(null); } })
      .catch(e => alive && setError(e instanceof Error ? e.message : 'Could not load performance'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [horizon, direction, from, to]);

  const s = data?.stats;
  const excludedList = useMemo(() => (s ? Object.entries(s.coverage.excluded).sort((a, b) => b[1] - a[1]) : []), [s]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-gray-900 mr-2">Desk performance</h2>
        <select aria-label="Horizon" className={inputClass} value={horizon} onChange={e => setHorizon(e.target.value)}>
          <option value="">All horizons</option>
          {IDEA_HORIZONS.map(h => <option key={h.key} value={h.key}>{h.label}</option>)}
        </select>
        <select aria-label="Direction" className={inputClass} value={direction} onChange={e => setDirection(e.target.value)}>
          <option value="">Long & short</option><option value="long">Long</option><option value="short">Short</option>
        </select>
        <label className="text-[11px] text-gray-500 flex items-center gap-1">Published from <input type="date" className={inputClass} value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-[11px] text-gray-500 flex items-center gap-1">to <input type="date" className={inputClass} value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      {loading && !data ? <Spinner label="Loading performance…" /> : s && (
        <div className={loading ? 'opacity-60 space-y-4' : 'space-y-4'}>
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            <b>Coverage:</b> {s.coverage.counted} of {s.coverage.total} ideas counted
            {s.coverage.from && s.coverage.to ? ` (exits ${fmtDay(s.coverage.from)} to ${fmtDay(s.coverage.to)})` : ''}.
            {excludedList.length > 0 && <> Not counted: {excludedList.map(([k, v]) => `${v} ${outcomeMeta(k).label.toLowerCase()}`).join(', ')}. Open ideas are not counted until they finish; ideas that never entered their zone are neither wins nor losses.</>}
            {' '}Results use daily bars; when one bar touches both the stop and a target the stop is assumed first. Returns are in R (profit divided by risk to the stop), never a dollar P&L.
          </div>

          {s.n === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">No finished ideas yet for these filters, so there is nothing honest to show. Check back once ideas have been entered and closed.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                <Tile label="Ideas counted" value={String(s.n)} hint={data!.meta.definitions.find(d => d.key === 'n')?.definition} />
                <Tile label="Hit rate" value={pct(s.hitRate)} hint={data!.meta.definitions.find(d => d.key === 'hitRate')?.definition} />
                <Tile label="Average R" value={fmtR(s.avgR)} tone={rTone(s.avgR)} hint={data!.meta.definitions.find(d => d.key === 'avgR')?.definition} />
                <Tile label="Expectancy" value={fmtR(s.expectancyR)} tone={rTone(s.expectancyR)} hint={data!.meta.definitions.find(d => d.key === 'expectancyR')?.definition} />
                <Tile label="Profit factor" value={num2(s.profitFactor)} hint={data!.meta.definitions.find(d => d.key === 'profitFactor')?.definition} />
                <Tile label="Total R" value={fmtR(s.totalR)} tone={rTone(s.totalR)} hint={data!.meta.definitions.find(d => d.key === 'totalR')?.definition} />
                <Tile label="Streaks (W / L)" value={`${s.maxWinStreak} / ${s.maxLossStreak}`} hint={data!.meta.definitions.find(d => d.key === 'streaks')?.definition} />
                <Tile label="Reached target 1" value={pct(s.t1Rate)} hint={data!.meta.definitions.find(d => d.key === 't1Rate')?.definition} />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-3">
                <h3 className="text-sm font-bold text-gray-900 mb-1">Equity curve (cumulative R)</h3>
                <Curve points={s.curve} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <BreakdownTable title="By horizon" rows={data!.byHorizon} label={k => <HorizonPill horizon={k} />} />
                <BreakdownTable title="By direction" rows={data!.byDirection} label={k => <DirectionPill direction={k} />} />
                <BreakdownTable title="By symbol (top 15)" rows={data!.bySymbol} label={k => k} />
                <BreakdownTable title="With / without an option strategy" rows={data!.byOptions} label={k => (k === 'true' ? 'With option strategy' : 'Stock only')} />
              </div>
            </>
          )}

          <div className="bg-white border border-gray-200 rounded-xl p-3 overflow-x-auto">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Closed ideas</h3>
            {data!.results.length === 0 ? <p className="text-xs text-gray-500">None yet.</p> : (
              <table className="w-full text-xs">
                <thead><tr className="text-left text-[10px] uppercase text-gray-400"><th className="py-1 pr-2">Idea</th><th className="pr-2">Horizon</th><th className="pr-2">Outcome</th><th className="pr-2">Entered</th><th className="pr-2">Exit</th><th className="pr-2 text-right">Targets</th><th className="pr-2 text-right">R</th><th className="text-right">Return</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {data!.results.map(i => (
                    <tr key={i.id} className="hover:bg-gray-50">
                      <td className="py-1.5 pr-2"><Link href={`/ideas/${i.id}`} className="font-semibold text-indigo-700 hover:underline">{i.symbol}</Link> <DirectionPill direction={i.direction} /></td>
                      <td className="pr-2">{horizonMeta(i.horizon).label}</td>
                      <td className="pr-2">{i.outcome && <OutcomePill outcome={i.outcome.outcome} />}</td>
                      <td className="pr-2">{fmtDay(i.outcome?.enteredOn)}</td>
                      <td className="pr-2">{fmtDay(i.outcome?.exitOn)}</td>
                      <td className="pr-2 text-right">{i.outcome ? `${i.outcome.targetsHit}/${i.outcome.targetsTotal}` : '—'}</td>
                      <td className={`pr-2 text-right font-semibold ${rTone(i.outcome?.r)}`}>{fmtR(i.outcome?.r)}</td>
                      <td className={`text-right ${rTone(i.outcome?.pctReturn)}`}>{fmtPct(i.outcome?.pctReturn, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <details className="bg-white border border-gray-200 rounded-xl p-3 text-xs text-gray-600">
            <summary className="cursor-pointer font-semibold text-gray-800">How these numbers are defined</summary>
            <p className="mt-2">{data!.meta.basis}</p>
            <dl className="mt-2 space-y-1.5">{data!.meta.definitions.map(d => <div key={d.key}><dt className="font-semibold inline">{d.label}: </dt><dd className="inline">{d.definition}</dd></div>)}</dl>
          </details>
        </div>
      )}
    </div>
  );
}
