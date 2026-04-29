'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';
import StockSearch from '@/components/ui/StockSearch';

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

function OIRow({ s, i, onClick }: { s: any; i: number; onClick: () => void }) {
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
            <div className="text-[10px] text-gray-500 mt-0.5">exp {s.expiryDate}</div>
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

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [moverTab, setMoverTab] = useState('gainers');

  // Indices — separate poll
  const [indices, setIndices] = useState<any[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(true);
  const indicesIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Indices — fetch + poll every 30s
  useEffect(() => {
    function fetchIndices() {
      fetch('/api/market/indices')
        .then(r => r.json())
        .then(res => { if (res.success) setIndices(res.data); })
        .catch(() => {})
        .finally(() => setIndicesLoading(false));
    }
    fetchIndices();
    indicesIntervalRef.current = setInterval(fetchIndices, 30_000);
    return () => { if (indicesIntervalRef.current) clearInterval(indicesIntervalRef.current); };
  }, []);

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
        {/* Hero */}
        <div className="bg-white border-b border-gray-200 py-8">
          <div className="container mx-auto px-4 text-center">
            <h1 className="text-4xl font-bold mb-1 bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-green-600">
              Neon Trade
            </h1>
            <p className="text-gray-400 mb-5 text-sm">Options flow · Price levels · Quadrant analysis</p>
            <div className="flex justify-center mb-5">
              <StockSearch />
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <button onClick={() => router.push('/quadrant')}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors text-sm">
                📊 Quadrant Analysis
              </button>
              <button onClick={() => router.push('/stock/SPY')}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors text-sm">
                📈 Stock Analysis
              </button>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-5 space-y-5">

          {/* Index Tiles */}
          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Market Indices</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {indicesLoading
                ? Array(6).fill(0).map((_, i) => <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse h-24" />)
                : indices.map((idx: any) => {
                    const up = idx.changePercent != null && idx.changePercent >= 0;
                    const color = idx.changePercent == null ? 'text-gray-500' : up ? 'text-green-600' : 'text-red-600';
                    const bg = idx.changePercent == null ? 'bg-white border-gray-200' : up ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200';
                    return (
                      <button key={idx.symbol} onClick={() => router.push(`/stock/${idx.symbol}`)}
                        className={`${bg} border rounded-xl p-3 text-left hover:shadow-md transition-all`}>
                        <div className="flex justify-between items-start mb-0.5">
                          <span className="font-bold text-gray-800 text-sm">{idx.symbol}</span>
                          <span className={`text-[10px] font-semibold ${color}`}>{pct(idx.changePercent)}</span>
                        </div>
                        <div className="text-xs text-gray-400 mb-1">{idx.label}</div>
                        <div className="text-xl font-bold text-gray-900">
                          {idx.price != null ? `$${idx.price.toFixed(2)}` : '—'}
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className={`text-xs ${color}`}>
                            {idx.change != null ? `${idx.change >= 0 ? '+' : ''}$${idx.change.toFixed(2)}` : ''}
                          </span>
                          {idx.volume && <span className="text-[10px] text-gray-400">Vol {fmt(idx.volume)}</span>}
                        </div>
                      </button>
                    );
                  })}
            </div>
          </section>

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
                    <OIRow key={s.symbol} s={s} i={i} onClick={() => router.push(`/stock/${s.symbol}`)} />
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
                      <OIRow key={s.symbol} s={s} i={i} onClick={() => router.push(`/stock/${s.symbol}`)} />
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

          {/* Footer nav */}
          <div className="flex flex-wrap justify-center gap-4 py-4 border-t border-gray-200">
            <button onClick={() => router.push('/quadrant')}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm">
              📊 Quadrant Analysis
            </button>
            <button onClick={() => router.push('/stock/SPY')}
              className="px-5 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors text-sm">
              📈 Stock Analysis
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
