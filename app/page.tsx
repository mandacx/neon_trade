'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';
import ScanAlertsTicker from '@/components/ui/ScanAlertsTicker';
import EarningsBadgeCell from '@/components/ui/EarningsBadgeCell';
import { useAuthContext } from '@/components/providers/AuthContextProvider';
import { FEATURE_EARNINGS, hasFeature } from '@/lib/features';
import { fmtShortDate, earningsTimeShort, daysUntilLabel } from '@/components/watchlists/watchlistShared';
import type { EarningsBadge, EarningsEvent } from '@/types/earnings';

type HomeEarningsEvent = EarningsEvent & { name: string | null };
interface HomeEarnings {
  upcoming: HomeEarningsEvent[];
  upcomingTotal: number;
  reported: HomeEarningsEvent[];
  reportedTotal: number;
  badges: Record<string, EarningsBadge | null>;
}

const LEVEL_COLORS: Record<string, string> = {
  put_low: '#dc2626', put_int: '#ea580c', put_call_int: '#16a34a',
  call_int: '#2563eb', call_high: '#9333ea',
};
const LEVEL_LABELS: Record<string, string> = {
  put_low: 'Put Low', put_int: 'Put Int', put_call_int: 'P/C Int',
  call_int: 'Call Int', call_high: 'Call High',
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
function pct(n: number | null): string {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

const MOVER_TABS = [
  { key: 'gainers', label: '▲ Gainers', color: 'text-green-600' },
  { key: 'losers',  label: '▼ Losers',  color: 'text-red-600'   },
  { key: 'volume',  label: '📊 Volume',  color: 'text-blue-600'  },
  { key: 'hot',     label: '🔥 Hot',     color: 'text-orange-500'},
];

type SortDir = 'asc' | 'desc';
type OISortKey = 'totalOi' | 'symbol' | 'callRatio';
type MoverSortKey = 'changePercent' | 'change' | 'price' | 'volume' | 'symbol';

function sortOI(list: any[], key: OISortKey, dir: SortDir) {
  return [...list].sort((a, b) => {
    let av: number | string, bv: number | string;
    if (key === 'symbol') { av = a.symbol; bv = b.symbol; }
    else if (key === 'callRatio') { av = a.totalOi > 0 ? a.callOi / a.totalOi : 0; bv = b.totalOi > 0 ? b.callOi / b.totalOi : 0; }
    else { av = a.totalOi; bv = b.totalOi; }
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });
}

function sortMovers(list: any[], key: MoverSortKey, dir: SortDir) {
  return [...list].sort((a, b) => {
    let av: number | string, bv: number | string;
    if (key === 'symbol') { av = a.symbol; bv = b.symbol; }
    else if (key === 'change') { av = a.change ?? 0; bv = b.change ?? 0; }
    else if (key === 'price') { av = a.price ?? 0; bv = b.price ?? 0; }
    else if (key === 'volume') { av = a.volume ?? 0; bv = b.volume ?? 0; }
    else { av = a.changePercent ?? 0; bv = b.changePercent ?? 0; }
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });
}

function SortHeader({ label, sortKey, current, dir, onSort, className }: {
  label: string; sortKey: string; current: string; dir: SortDir;
  onSort: (k: any) => void; className?: string;
}) {
  const active = current === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={`text-[10px] font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-0.5 hover:text-gray-600 transition-colors ${className ?? ''}`}
    >
      {label}
      <span className="text-[9px]">{active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </button>
  );
}

function OIRow({ s, i, onClick, badge }: { s: any; i: number; onClick: () => void; badge?: EarningsBadge | null }) {
  const [tooltip, setTooltip] = useState(false);
  const putRatio = s.totalOi > 0 ? s.putOi / s.totalOi : 0;
  const sentiment = putRatio > 0.6 ? 'bearish' : putRatio < 0.4 ? 'bullish' : 'neutral';
  const sc = sentiment === 'bullish' ? 'text-green-600' : sentiment === 'bearish' ? 'text-red-600' : 'text-yellow-600';
  return (
    <div className="relative">
      <button
        onClick={onClick}
        onMouseEnter={() => setTooltip(true)}
        onMouseLeave={() => setTooltip(false)}
        className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0"
      >
        <span className="text-xs text-gray-300 w-4 shrink-0">{i + 1}</span>
        <div className="shrink-0 w-[72px]">
          <div className="font-bold text-gray-800 text-sm">{s.symbol}</div>
          {s.name && (
            <div className="text-[10px] text-gray-400 leading-tight truncate max-w-[72px]" title={s.name}>
              {s.name}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden flex">
            <div className="h-full bg-green-400" style={{ width: `${(1 - putRatio) * 100}%` }} />
            <div className="h-full bg-red-400" style={{ width: `${putRatio * 100}%` }} />
          </div>
          {s.expiryDate && (
            <div className="flex items-center gap-1.5 text-[10px] text-gray-500 mt-0.5">
              exp {s.expiryDate}
              {badge?.nextDate && <EarningsBadgeCell badge={badge} showDate={false} />}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold text-gray-700">{fmt(s.totalOi)}</div>
          <div className={`text-[10px] ${sc}`}>{sentiment}</div>
        </div>
      </button>
      {tooltip && (
        <div className="absolute right-2 top-full z-20 bg-gray-900 text-white text-[11px] rounded-lg px-3 py-2 shadow-lg pointer-events-none whitespace-nowrap">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
            <span>Call OI: <strong>{fmt(s.callOi)}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
            <span>Put OI: <strong>{fmt(s.putOi)}</strong></span>
          </div>
          <div className="border-t border-gray-600 pt-1 mt-1 text-gray-300">
            Total: <strong className="text-white">{fmt(s.totalOi)}</strong>
            &nbsp;·&nbsp;P/C {(putRatio * 100).toFixed(0)}%/{((1 - putRatio) * 100).toFixed(0)}%
          </div>
        </div>
      )}
    </div>
  );
}

function MoverRow({ s, onClick }: { s: any; onClick: () => void }) {
  const up = s.changePercent >= 0;
  const color = up ? 'text-green-600' : 'text-red-600';
  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0"
    >
      <div className="shrink-0 w-[60px]">
        <div className="font-bold text-gray-800 text-sm">{s.symbol}</div>
        {s.name && (
          <div className="text-[10px] text-gray-400 leading-tight truncate max-w-[60px]" title={s.name}>
            {s.name}
          </div>
        )}
      </div>
      <div className="w-[68px] shrink-0 text-right">
        <div className="text-xs text-gray-700 font-medium">
          {s.price != null ? `$${s.price.toFixed(2)}` : '—'}
        </div>
      </div>
      <div className="w-[44px] shrink-0 text-right">
        <div className="text-xs text-gray-400">{s.volume ? fmt(s.volume) : '—'}</div>
      </div>
      <div className="w-[58px] shrink-0 text-right">
        <div className={`text-xs font-semibold ${color}`}>{pct(s.changePercent)}</div>
      </div>
      <div className="w-[58px] shrink-0 text-right">
        <div className={`text-xs font-semibold ${color}`}>
          {s.change != null ? `${s.change >= 0 ? '+' : ''}$${s.change.toFixed(2)}` : '—'}
        </div>
      </div>
    </button>
  );
}

function EarningsEventRow({ e, onClick }: { e: HomeEarningsEvent; onClick: () => void }) {
  const outcomeTone = e.epsOutcome === 'beat' ? 'bg-green-50 text-green-700' : e.epsOutcome === 'miss' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600';
  return (
    <button onClick={onClick} className="w-full px-4 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="font-bold text-gray-800 text-sm">{e.symbol}</div>
        {e.name && <div className="text-[10px] text-gray-400 truncate" title={e.name}>{e.name}</div>}
      </div>
      {e.kind === 'upcoming' ? (
        <div className="text-right shrink-0">
          <div className="text-xs text-gray-700">{fmtShortDate(e.date)}{earningsTimeShort(e.time) && ` · ${earningsTimeShort(e.time)}`}</div>
          <div className={`text-[10px] font-semibold ${e.daysUntil <= 1 ? 'text-red-600' : 'text-amber-700'}`}>{e.daysUntil <= 1 ? daysUntilLabel(e.daysUntil) : `in ${e.daysUntil}d`}</div>
        </div>
      ) : (
        <div className="text-right shrink-0">
          {e.epsOutcome ? (
            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${outcomeTone}`}>
              {e.epsOutcome === 'beat' ? 'Beat' : e.epsOutcome === 'miss' ? 'Miss' : 'In-line'}
              {e.epsOutcome !== 'inline' && e.epsSurprisePct != null && ` ${e.epsSurprisePct > 0 ? '+' : ''}${e.epsSurprisePct.toFixed(1)}%`}
            </span>
          ) : (
            <span className="text-[11px] text-gray-500">Reported</span>
          )}
          <div className="text-[10px] text-gray-400 mt-0.5">{fmtShortDate(e.date)}</div>
        </div>
      )}
    </button>
  );
}

export default function Home() {
  const router = useRouter();
  const authCtx = useAuthContext();
  const earningsEnabled = hasFeature(authCtx.features, FEATURE_EARNINGS);
  const [homeEarnings, setHomeEarnings] = useState<HomeEarnings | null>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [moverTab, setMoverTab] = useState('gainers');

  // Sort state
  const [stockSort, setStockSort] = useState<{ key: OISortKey; dir: SortDir }>({ key: 'totalOi', dir: 'desc' });
  const [etfSort, setEtfSort] = useState<{ key: OISortKey; dir: SortDir }>({ key: 'totalOi', dir: 'desc' });
  const [moverSort, setMoverSort] = useState<{ key: MoverSortKey; dir: SortDir }>({ key: 'changePercent', dir: 'desc' });

  function toggleOISort(list: 'stocks' | 'etfs', key: OISortKey) {
    const setter = list === 'stocks' ? setStockSort : setEtfSort;
    const current = list === 'stocks' ? stockSort : etfSort;
    setter(current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'symbol' ? 'asc' : 'desc' });
  }

  function toggleMoverSort(key: MoverSortKey) {
    setMoverSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'symbol' ? 'asc' : 'desc' });
  }

  // Main data load
  useEffect(() => {
    fetch('/api/home/data')
      .then(r => r.json())
      .then(res => { if (res.success) setData(res.data); })
      .finally(() => setLoading(false));
  }, []);

  // Earnings card + Top OI flags (Pro) — a separate, gated request, since
  // /api/home/data is public and CDN-cached for every visitor.
  useEffect(() => {
    if (!earningsEnabled || !data) return;
    const rows: any[] = [...(data.topStocks || []), ...(data.topETFs || [])];
    const pairs = rows.filter(r => r.expiryDate).map(r => `${r.symbol}:${r.expiryDate}`).join(',');
    fetch(`/api/home/earnings${pairs ? `?pairs=${encodeURIComponent(pairs)}` : ''}`)
      .then(r => r.json())
      .then(res => { if (res.success) setHomeEarnings(res.data); })
      .catch(() => {});
  }, [earningsEnabled, data]);

  const topStocks: any[] = data?.topStocks || [];
  const topETFs: any[] = data?.topETFs || [];
  const sectors: any[] = data?.sectorBreakdown || [];
  const topMovers: any = data?.topMovers;
  const rawMoverList: any[] = topMovers?.[moverTab] || [];

  const sortedStocks = sortOI(topStocks, stockSort.key, stockSort.dir);
  const sortedETFs = sortOI(topETFs, etfSort.key, etfSort.dir);
  const sortedMovers = sortMovers(rawMoverList, moverSort.key, moverSort.dir);

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 pt-3 pb-5 space-y-3">

          {/* Scan Alerts Ticker */}
          <ScanAlertsTicker />

          {/* OI Tables + Top Movers */}
          <div className="grid lg:grid-cols-3 gap-5">

            {/* Top Stocks OI */}
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h2 className="font-bold text-gray-800 text-sm">Top Stocks by OI</h2>
                    {data?.topStocksDate && (
                      <div className="text-[10px] text-gray-400">As of {data.topStocksDate}</div>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-300 text-right">
                    <div className="text-green-500">█ Call</div>
                    <div className="text-red-400">█ Put</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 px-1">
                  <span className="text-[10px] text-gray-300 w-4 shrink-0">#</span>
                  <SortHeader label="Symbol" sortKey="symbol" current={stockSort.key} dir={stockSort.dir} onSort={k => toggleOISort('stocks', k)} className="w-[72px] shrink-0" />
                  <SortHeader label="Call/Put" sortKey="callRatio" current={stockSort.key} dir={stockSort.dir} onSort={k => toggleOISort('stocks', k)} className="flex-1" />
                  <SortHeader label="Total OI" sortKey="totalOi" current={stockSort.key} dir={stockSort.dir} onSort={k => toggleOISort('stocks', k)} className="shrink-0" />
                </div>
              </div>
              {loading
                ? Array(8).fill(0).map((_, i) => <div key={i} className="px-4 py-2.5 animate-pulse h-10 border-b border-gray-50"><div className="h-3 bg-gray-200 rounded w-3/4" /></div>)
                : sortedStocks.map((s: any, i: number) => (
                    <OIRow key={s.symbol} s={s} i={i} badge={homeEarnings?.badges[s.symbol]} onClick={() => router.push(`/stock/${s.symbol}`)} />
                  ))}
            </section>

            {/* Top ETFs OI */}
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h2 className="font-bold text-gray-800 text-sm">Top ETFs by OI</h2>
                    {data?.topETFsDate && (
                      <div className="text-[10px] text-gray-400">As of {data.topETFsDate}</div>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-300 text-right">
                    <div className="text-green-500">█ Call</div>
                    <div className="text-red-400">█ Put</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 px-1">
                  <span className="text-[10px] text-gray-300 w-4 shrink-0">#</span>
                  <SortHeader label="Symbol" sortKey="symbol" current={etfSort.key} dir={etfSort.dir} onSort={k => toggleOISort('etfs', k)} className="w-[72px] shrink-0" />
                  <SortHeader label="Call/Put" sortKey="callRatio" current={etfSort.key} dir={etfSort.dir} onSort={k => toggleOISort('etfs', k)} className="flex-1" />
                  <SortHeader label="Total OI" sortKey="totalOi" current={etfSort.key} dir={etfSort.dir} onSort={k => toggleOISort('etfs', k)} className="shrink-0" />
                </div>
              </div>
              {loading
                ? Array(8).fill(0).map((_, i) => <div key={i} className="px-4 py-2.5 animate-pulse h-10 border-b border-gray-50"><div className="h-3 bg-gray-200 rounded w-3/4" /></div>)
                : sortedETFs.length > 0
                  ? sortedETFs.map((s: any, i: number) => (
                      <OIRow key={s.symbol} s={s} i={i} badge={homeEarnings?.badges[s.symbol]} onClick={() => router.push(`/stock/${s.symbol}`)} />
                    ))
                  : <div className="px-4 py-8 text-center text-sm text-gray-400">No ETF data</div>}
            </section>

            {/* Top Movers */}
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-bold text-gray-800 text-sm mb-2">S&amp;P 500 Movers</h2>
                <div className="flex gap-1 flex-wrap mb-2">
                  {MOVER_TABS.map(t => (
                    <button key={t.key} onClick={() => setMoverTab(t.key)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        moverTab === t.key
                          ? 'bg-gray-800 text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 px-1">
                  <SortHeader label="Symbol" sortKey="symbol" current={moverSort.key} dir={moverSort.dir} onSort={toggleMoverSort} className="w-[60px] shrink-0" />
                  <SortHeader label="Price" sortKey="price" current={moverSort.key} dir={moverSort.dir} onSort={toggleMoverSort} className="w-[68px] shrink-0 justify-end" />
                  <SortHeader label="Vol" sortKey="volume" current={moverSort.key} dir={moverSort.dir} onSort={toggleMoverSort} className="w-[44px] shrink-0 justify-end" />
                  <SortHeader label="%" sortKey="changePercent" current={moverSort.key} dir={moverSort.dir} onSort={toggleMoverSort} className="w-[58px] shrink-0 justify-end" />
                  <SortHeader label="$Chg" sortKey="change" current={moverSort.key} dir={moverSort.dir} onSort={toggleMoverSort} className="w-[58px] shrink-0 justify-end" />
                </div>
              </div>
              {loading || !topMovers
                ? Array(8).fill(0).map((_, i) => <div key={i} className="px-4 py-2.5 animate-pulse h-10 border-b border-gray-50"><div className="h-3 bg-gray-200 rounded w-3/4" /></div>)
                : sortedMovers.length > 0
                  ? sortedMovers.map((s: any) => (
                      <MoverRow key={s.symbol} s={s} onClick={() => router.push(`/stock/${s.symbol}`)} />
                    ))
                  : <div className="px-4 py-8 text-center text-sm text-gray-400">No data available</div>}
            </section>
          </div>

          {/* Earnings (Pro) */}
          {homeEarnings && (homeEarnings.upcoming.length > 0 || homeEarnings.reported.length > 0) && (
            <div className="grid md:grid-cols-2 gap-5">
              <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h2 className="font-bold text-gray-800 text-sm">Earnings This Week</h2>
                  <div className="text-[10px] text-gray-400">
                    Next 7 days · largest companies first{homeEarnings.upcomingTotal > homeEarnings.upcoming.length && ` · ${homeEarnings.upcomingTotal} reporting in total`}
                  </div>
                </div>
                {homeEarnings.upcoming.length > 0
                  ? homeEarnings.upcoming.map(e => <EarningsEventRow key={`u-${e.symbol}-${e.date}`} e={e} onClick={() => router.push(`/stock/${e.symbol}`)} />)
                  : <div className="px-4 py-6 text-center text-xs text-gray-400">No reports scheduled this week.</div>}
              </section>
              <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h2 className="font-bold text-gray-800 text-sm">Just Reported</h2>
                  <div className="text-[10px] text-gray-400">
                    Last 3 days · EPS vs consensus{homeEarnings.reportedTotal > homeEarnings.reported.length && ` · ${homeEarnings.reportedTotal} reports`}
                  </div>
                </div>
                {homeEarnings.reported.length > 0
                  ? homeEarnings.reported.map(e => <EarningsEventRow key={`r-${e.symbol}-${e.date}`} e={e} onClick={() => router.push(`/stock/${e.symbol}`)} />)
                  : <div className="px-4 py-6 text-center text-xs text-gray-400">No reports in the last 3 days.</div>}
              </section>
            </div>
          )}

          {/* Sector Breakdown */}
          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Sector Breakdown <span className="normal-case font-normal text-gray-300 ml-1">Click to view in Quadrant</span>
            </h2>
            {loading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array(6).fill(0).map((_, i) => <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse h-24" />)}
              </div>
            ) : sectors.length > 0 ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {sectors.map((s: any) => {
                  const levels = ['put_low', 'put_int', 'put_call_int', 'call_int', 'call_high'];
                  const total = levels.reduce((sum, l) => sum + (s.closestLevels[l] || 0), 0) || 1;
                  const score = (
                    (s.closestLevels.call_int || 0) * 1 + (s.closestLevels.call_high || 0) * 2 -
                    (s.closestLevels.put_int || 0) * 1 - (s.closestLevels.put_low || 0) * 2
                  ) / total;
                  const label = score > 0.3 ? 'Bullish' : score < -0.3 ? 'Bearish' : 'Neutral';
                  const lc = score > 0.3 ? 'text-green-600' : score < -0.3 ? 'text-red-600' : 'text-yellow-600';
                  return (
                    <button key={s.sector}
                      onClick={() => router.push(`/quadrant?sector=${encodeURIComponent(s.sector)}`)}
                      className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:shadow-md hover:border-blue-300 transition-all w-full">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-gray-800 text-sm">{s.sector}</span>
                        <span className={`text-xs font-semibold ${lc}`}>{label}</span>
                      </div>
                      <div className="text-xs text-gray-400 mb-2">{s.count} stocks</div>
                      <div className="h-2 rounded-full overflow-hidden flex">
                        {levels.map(l => {
                          const w = ((s.closestLevels[l] || 0) / total) * 100;
                          if (w < 1) return null;
                          return <div key={l} title={`${LEVEL_LABELS[l]}: ${s.closestLevels[l] || 0}`}
                            style={{ width: `${w}%`, backgroundColor: LEVEL_COLORS[l] }} />;
                        })}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
                        {levels.filter(l => (s.closestLevels[l] || 0) > 0).map(l => (
                          <span key={l} className="text-[10px] text-gray-500 flex items-center gap-0.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: LEVEL_COLORS[l] }} />
                            {LEVEL_LABELS[l]}: {s.closestLevels[l]}
                          </span>
                        ))}
                      </div>
                      {(s.gainers > 0 || s.losers > 0) && (
                        <div className="mt-1.5 flex gap-3 text-xs">
                          <span className="text-green-600">▲ {s.gainers}</span>
                          <span className="text-red-600">▼ {s.losers}</span>
                          {s.unchanged > 0 && <span className="text-gray-400">— {s.unchanged}</span>}
                        </div>
                      )}
                      <div className="mt-1.5 text-[10px] text-blue-400 font-medium">View in Quadrant →</div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">No sector data</div>
            )}
          </section>

        </div>
      </div>
    </>
  );
}
