'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/layout/Header';
import StockSearch from '@/components/ui/StockSearch';

const LEVEL_COLORS: Record<string, string> = {
  put_low: '#dc2626',
  put_int: '#ea580c',
  put_call_int: '#16a34a',
  call_int: '#2563eb',
  call_high: '#9333ea',
};

const LEVEL_LABELS: Record<string, string> = {
  put_low: 'Put Low',
  put_int: 'Put Int',
  put_call_int: 'P/C Int',
  call_int: 'Call Int',
  call_high: 'Call High',
};

function formatBigNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function pct(n: number | null): string {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        {/* Hero */}
        <div className="bg-white border-b border-gray-200 py-10">
          <div className="container mx-auto px-4 text-center">
            <h1 className="text-4xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-green-600">
              Neon Trade
            </h1>
            <p className="text-gray-500 mb-6">Options flow · Price levels · Quadrant analysis</p>
            <div className="flex justify-center mb-8">
              <StockSearch />
            </div>
            {/* Navigation */}
            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={() => router.push('/quadrant')}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
              >
                <span>📊</span> Quadrant Analysis
              </button>
              <button
                onClick={() => router.push('/stock/SPY')}
                className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors"
              >
                <span>📈</span> Stock Analysis
              </button>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-6 space-y-6">

          {/* Index Tiles */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Market Indices</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {loading
                ? Array(4).fill(0).map((_, i) => (
                    <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse h-24" />
                  ))
                : indices.map((idx: any) => {
                    const up = idx.changePercent != null && idx.changePercent >= 0;
                    const color = idx.changePercent == null ? 'text-gray-500'
                      : up ? 'text-green-600' : 'text-red-600';
                    const bg = idx.changePercent == null ? 'bg-white'
                      : up ? 'bg-green-50' : 'bg-red-50';
                    const border = idx.changePercent == null ? 'border-gray-200'
                      : up ? 'border-green-200' : 'border-red-200';
                    return (
                      <button
                        key={idx.symbol}
                        onClick={() => router.push(`/stock/${idx.symbol}`)}
                        className={`${bg} border ${border} rounded-xl p-4 text-left hover:shadow-md transition-all`}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold text-gray-800">{idx.symbol}</span>
                          <span className={`text-xs font-semibold ${color}`}>{pct(idx.changePercent)}</span>
                        </div>
                        <div className="text-2xl font-bold text-gray-900">
                          {idx.price != null ? `$${idx.price.toFixed(2)}` : '—'}
                        </div>
                        <div className={`text-xs mt-1 ${color}`}>
                          {idx.change != null ? `${idx.change >= 0 ? '+' : ''}$${idx.change.toFixed(2)}` : ''}
                        </div>
                        {idx.volume && (
                          <div className="text-xs text-gray-400 mt-1">Vol {formatBigNum(idx.volume)}</div>
                        )}
                      </button>
                    );
                  })}
            </div>
          </section>

          {/* Top Stocks by OI + Top ETFs */}
          <div className="grid md:grid-cols-2 gap-6">

            {/* Top Stocks by OI */}
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-bold text-gray-800">Top Stocks by OI Volume</h2>
                <span className="text-xs text-gray-400">Latest trade date</span>
              </div>
              <div className="divide-y divide-gray-50">
                {loading
                  ? Array(8).fill(0).map((_, i) => (
                      <div key={i} className="px-5 py-3 flex items-center gap-3 animate-pulse">
                        <div className="h-4 bg-gray-200 rounded w-12" />
                        <div className="h-4 bg-gray-200 rounded flex-1" />
                      </div>
                    ))
                  : topStocks.slice(0, 12).map((s: any, i: number) => {
                      const putRatio = s.totalOi > 0 ? s.putOi / s.totalOi : 0;
                      const sentiment = putRatio > 0.6 ? 'bearish' : putRatio < 0.4 ? 'bullish' : 'neutral';
                      const sentimentColor = sentiment === 'bullish' ? 'text-green-600'
                        : sentiment === 'bearish' ? 'text-red-600' : 'text-yellow-600';
                      return (
                        <button
                          key={s.symbol}
                          onClick={() => router.push(`/stock/${s.symbol}`)}
                          className="w-full px-5 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                        >
                          <span className="text-xs text-gray-400 w-5 text-right">{i + 1}</span>
                          <div className="shrink-0 w-16">
                            <div className="font-bold text-gray-800">{s.symbol}</div>
                            {s.name && <div className="text-[10px] text-gray-400 truncate w-16" title={s.name}>{s.name}</div>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-400 truncate">{s.sector || ''}</div>
                            {/* OI bar */}
                            <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                              <div
                                className="h-full bg-green-400 float-left"
                                style={{ width: `${(1 - putRatio) * 100}%` }}
                              />
                              <div
                                className="h-full bg-red-400 float-right"
                                style={{ width: `${putRatio * 100}%` }}
                              />
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-semibold text-gray-700">{formatBigNum(s.totalOi)}</div>
                            <div className={`text-xs ${sentimentColor}`}>{sentiment}</div>
                          </div>
                        </button>
                      );
                    })}
              </div>
            </section>

            {/* Top ETFs by OI */}
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-bold text-gray-800">Top ETFs by OI Volume</h2>
                <span className="text-xs text-gray-400">Latest trade date</span>
              </div>
              <div className="divide-y divide-gray-50">
                {loading
                  ? Array(8).fill(0).map((_, i) => (
                      <div key={i} className="px-5 py-3 flex items-center gap-3 animate-pulse">
                        <div className="h-4 bg-gray-200 rounded w-12" />
                        <div className="h-4 bg-gray-200 rounded flex-1" />
                      </div>
                    ))
                  : topETFs.length > 0
                  ? topETFs.map((s: any, i: number) => {
                      const putRatio = s.totalOi > 0 ? s.putOi / s.totalOi : 0;
                      const sentiment = putRatio > 0.6 ? 'bearish' : putRatio < 0.4 ? 'bullish' : 'neutral';
                      const sentimentColor = sentiment === 'bullish' ? 'text-green-600'
                        : sentiment === 'bearish' ? 'text-red-600' : 'text-yellow-600';
                      return (
                        <button
                          key={s.symbol}
                          onClick={() => router.push(`/stock/${s.symbol}`)}
                          className="w-full px-5 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                        >
                          <span className="text-xs text-gray-400 w-5 text-right">{i + 1}</span>
                          <div className="shrink-0 w-16">
                            <div className="font-bold text-gray-800">{s.symbol}</div>
                            {s.name && <div className="text-[10px] text-gray-400 truncate w-16" title={s.name}>{s.name}</div>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="h-1.5 rounded-full bg-gray-100 mt-1 overflow-hidden">
                              <div className="h-full bg-green-400 float-left" style={{ width: `${(1 - putRatio) * 100}%` }} />
                              <div className="h-full bg-red-400 float-right" style={{ width: `${putRatio * 100}%` }} />
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-semibold text-gray-700">{formatBigNum(s.totalOi)}</div>
                            <div className={`text-xs ${sentimentColor}`}>{sentiment}</div>
                          </div>
                        </button>
                      );
                    })
                  : (
                    <div className="px-5 py-8 text-center text-sm text-gray-400">No ETF data found</div>
                  )}
              </div>
            </section>
          </div>

          {/* Sector Breakdown */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Sector Breakdown</h2>
            {loading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array(6).fill(0).map((_, i) => (
                  <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse h-24" />
                ))}
              </div>
            ) : sectors.length > 0 ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {sectors.map((s: any) => {
                  const levels = ['put_low', 'put_int', 'put_call_int', 'call_int', 'call_high'];
                  const total = levels.reduce((sum, l) => sum + (s.closestLevels[l] || 0), 0) || 1;
                  const sentimentScore = (
                    (s.closestLevels.call_int || 0) * 1 +
                    (s.closestLevels.call_high || 0) * 2 -
                    (s.closestLevels.put_int || 0) * 1 -
                    (s.closestLevels.put_low || 0) * 2
                  ) / total;
                  const sentimentLabel = sentimentScore > 0.3 ? 'Bullish'
                    : sentimentScore < -0.3 ? 'Bearish' : 'Neutral';
                  const sentimentColor = sentimentScore > 0.3 ? 'text-green-600'
                    : sentimentScore < -0.3 ? 'text-red-600' : 'text-yellow-600';

                  return (
                    <button
                      key={s.sector}
                      onClick={() => router.push(`/quadrant?sector=${encodeURIComponent(s.sector)}`)}
                      className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:shadow-md hover:border-blue-300 transition-all w-full"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-gray-800 text-sm">{s.sector}</span>
                        <span className={`text-xs font-semibold ${sentimentColor}`}>{sentimentLabel}</span>
                      </div>
                      <div className="text-xs text-gray-400 mb-2">{s.count} stocks</div>
                      {/* Level distribution bar */}
                      <div className="h-2 rounded-full overflow-hidden flex">
                        {levels.map(l => {
                          const w = ((s.closestLevels[l] || 0) / total) * 100;
                          if (w < 1) return null;
                          return (
                            <div
                              key={l}
                              title={`${LEVEL_LABELS[l]}: ${s.closestLevels[l] || 0}`}
                              style={{ width: `${w}%`, backgroundColor: LEVEL_COLORS[l] }}
                            />
                          );
                        })}
                      </div>
                      {/* Mini legend */}
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                        {levels.filter(l => (s.closestLevels[l] || 0) > 0).map(l => (
                          <span key={l} className="text-[10px] text-gray-500 flex items-center gap-0.5">
                            <span
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ backgroundColor: LEVEL_COLORS[l] }}
                            />
                            {LEVEL_LABELS[l]}: {s.closestLevels[l]}
                          </span>
                        ))}
                      </div>
                      {(s.gainers > 0 || s.losers > 0) && (
                        <div className="mt-2 flex gap-3 text-xs">
                          <span className="text-green-600">▲ {s.gainers}</span>
                          <span className="text-red-600">▼ {s.losers}</span>
                          {s.unchanged > 0 && <span className="text-gray-400">— {s.unchanged}</span>}
                        </div>
                      )}
                      <div className="mt-2 text-[10px] text-blue-400 font-medium">View in Quadrant →</div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
                No sector data available
              </div>
            )}
          </section>

          {/* Footer nav */}
          <div className="flex flex-wrap justify-center gap-4 py-6 border-t border-gray-200">
            <button
              onClick={() => router.push('/quadrant')}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              📊 Quadrant Analysis
            </button>
            <button
              onClick={() => router.push('/stock/SPY')}
              className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
            >
              📈 Stock Analysis
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
