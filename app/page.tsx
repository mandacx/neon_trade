'use client';

import { useEffect, useState } from 'react';
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

function OIRow({ s, i, onClick }: { s: any; i: number; onClick: () => void }) {
  const putRatio = s.totalOi > 0 ? s.putOi / s.totalOi : 0;
  const sentiment = putRatio > 0.6 ? 'bearish' : putRatio < 0.4 ? 'bullish' : 'neutral';
  const sc = sentiment === 'bullish' ? 'text-green-600' : sentiment === 'bearish' ? 'text-red-600' : 'text-yellow-600';
  return (
    <button
      onClick={onClick}
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
          <div className="text-[10px] text-gray-300 mt-0.5">exp {s.expiryDate}</div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold text-gray-700">{fmt(s.totalOi)}</div>
        <div className={`text-[10px] ${sc}`}>{sentiment}</div>
      </div>
    </button>
  );
}

function MoverRow({ s, onClick }: { s: any; onClick: () => void }) {
  const up = s.changePercent >= 0;
  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0"
    >
      <div className="shrink-0 w-[72px]">
        <div className="font-bold text-gray-800 text-sm">{s.symbol}</div>
        {s.name && (
          <div className="text-[10px] text-gray-400 leading-tight truncate max-w-[72px]" title={s.name}>
            {s.name}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 text-xs text-gray-400">
        {s.price != null ? `$${s.price.toFixed(2)}` : ''}
        {s.volume && <span className="ml-2">{fmt(s.volume)}</span>}
      </div>
      <div className={`text-sm font-semibold shrink-0 ${up ? 'text-green-600' : 'text-red-600'}`}>
        {pct(s.changePercent)}
      </div>
    </button>
  );
}

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [moverTab, setMoverTab] = useState('gainers');

  useEffect(() => {
    fetch('/api/home/data')
      .then(r => r.json())
      .then(res => { if (res.success) setData(res.data); })
      .finally(() => setLoading(false));
  }, []);

  const indices: any[] = data?.indices || [];
  const topStocks: any[] = data?.topStocks || [];
  const topETFs: any[] = data?.topETFs || [];
  const sectors: any[] = data?.sectorBreakdown || [];
  const topMovers: any = data?.topMovers;
  const moverList: any[] = topMovers?.[moverTab] || [];

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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {loading
                ? Array(4).fill(0).map((_, i) => <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse h-24" />)
                : indices.map((idx: any) => {
                    const up = idx.changePercent != null && idx.changePercent >= 0;
                    const color = idx.changePercent == null ? 'text-gray-500' : up ? 'text-green-600' : 'text-red-600';
                    const bg = up ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200';
                    return (
                      <button key={idx.symbol} onClick={() => router.push(`/stock/${idx.symbol}`)}
                        className={`${idx.changePercent == null ? 'bg-white border-gray-200' : bg} border rounded-xl p-4 text-left hover:shadow-md transition-all`}>
                        <div className="flex justify-between items-start">
                          <span className="font-bold text-gray-800">{idx.symbol}</span>
                          <span className={`text-xs font-semibold ${color}`}>{pct(idx.changePercent)}</span>
                        </div>
                        <div className="text-2xl font-bold text-gray-900 mt-1">
                          {idx.price != null ? `$${idx.price.toFixed(2)}` : '—'}
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className={`text-xs ${color}`}>
                            {idx.change != null ? `${idx.change >= 0 ? '+' : ''}$${idx.change.toFixed(2)}` : ''}
                          </span>
                          {idx.volume && <span className="text-xs text-gray-400">Vol {fmt(idx.volume)}</span>}
                        </div>
                        {idx.date && <div className="text-[10px] text-gray-300 mt-0.5">{idx.date}</div>}
                      </button>
                    );
                  })}
            </div>
          </section>

          {/* OI Tables + Top Movers */}
          <div className="grid lg:grid-cols-3 gap-5">

            {/* Top Stocks OI */}
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
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
              {loading
                ? Array(8).fill(0).map((_, i) => <div key={i} className="px-4 py-2.5 animate-pulse h-10 border-b border-gray-50"><div className="h-3 bg-gray-200 rounded w-3/4" /></div>)
                : topStocks.map((s: any, i: number) => (
                    <OIRow key={s.symbol} s={s} i={i} onClick={() => router.push(`/stock/${s.symbol}`)} />
                  ))}
            </section>

            {/* Top ETFs OI */}
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
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
              {loading
                ? Array(8).fill(0).map((_, i) => <div key={i} className="px-4 py-2.5 animate-pulse h-10 border-b border-gray-50"><div className="h-3 bg-gray-200 rounded w-3/4" /></div>)
                : topETFs.length > 0
                  ? topETFs.map((s: any, i: number) => (
                      <OIRow key={s.symbol} s={s} i={i} onClick={() => router.push(`/stock/${s.symbol}`)} />
                    ))
                  : <div className="px-4 py-8 text-center text-sm text-gray-400">No ETF data</div>}
            </section>

            {/* Top Movers */}
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-bold text-gray-800 text-sm mb-2">S&amp;P 500 Movers</h2>
                <div className="flex gap-1 flex-wrap">
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
              </div>
              {loading || !topMovers
                ? Array(8).fill(0).map((_, i) => <div key={i} className="px-4 py-2.5 animate-pulse h-10 border-b border-gray-50"><div className="h-3 bg-gray-200 rounded w-3/4" /></div>)
                : moverList.length > 0
                  ? moverList.map((s: any) => (
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
