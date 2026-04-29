'use client';

import { useMemo, useState } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import { QuadrantStock } from '@/types/stock';
import { getLevelColor, getLevelDisplayName, formatCurrency, formatPercentage } from '@/lib/utils';

interface QuadrantChartProps {
  data: QuadrantStock[];
  onStockClick?: (symbol: string) => void;
  height?: number;
}

type QuadrantLevel = 'put_low' | 'put_int' | 'put_call_int' | 'call_int' | 'call_high' | null;

const BANDS = [
  { level: 'put_low',      x1: -100, x2: -15, fill: '#fef2f2', label: 'PUT LOW',      color: '#dc2626' },
  { level: 'put_int',      x1:  -15, x2:  -5, fill: '#fff7ed', label: 'PUT INT',       color: '#ea580c' },
  { level: 'put_call_int', x1:   -5, x2:   5, fill: '#f0fdf4', label: 'PUT/CALL INT',  color: '#16a34a' },
  { level: 'call_int',     x1:    5, x2:  15, fill: '#eff6ff', label: 'CALL INT',      color: '#2563eb' },
  { level: 'call_high',    x1:   15, x2: 100, fill: '#faf5ff', label: 'CALL HIGH',     color: '#9333ea' },
];

// Scale dot radius logarithmically from market cap
function dotRadius(marketCap: number | null | undefined): number {
  if (!marketCap || marketCap <= 0) return 6;
  // Log scale: $100M → r=4, $1B → r=5, $10B → r=7, $100B → r=9, $1T → r=11, $5T → r=13
  const log = Math.log10(marketCap);
  const r = 2 + log * 1.2;
  return Math.max(4, Math.min(14, Math.round(r)));
}

export default function QuadrantChart({ data, onStockClick, height = 600 }: QuadrantChartProps) {
  const [selectedQuadrant, setSelectedQuadrant] = useState<QuadrantLevel>(null);
  const [showGuide, setShowGuide] = useState(false);

  const chartData = useMemo(() => {
    const groupedByLevel: Record<string, typeof data> = {
      put_low: [], put_int: [], put_call_int: [], call_int: [], call_high: [],
    };
    data.forEach(stock => {
      if (groupedByLevel[stock.closestLevel]) groupedByLevel[stock.closestLevel].push(stock);
    });

    const allData: any[] = [];
    Object.entries(groupedByLevel).forEach(([level, stocks]) => {
      const count = stocks.length;
      if (count === 0) return;
      const sorted = [...stocks].sort((a, b) => a.closestValue - b.closestValue);
      sorted.forEach((stock, index) => {
        const cols = Math.ceil(Math.sqrt(count));
        const col = index % cols;
        const row = Math.floor(index / cols);
        const rowCount = Math.ceil(count / cols);
        const ySpread = Math.min(70 / Math.max(rowCount, 1), 20);
        const baseY = (row - (rowCount - 1) / 2) * ySpread;
        const jitterX = (col - (cols - 1) / 2) * 0.8;
        allData.push({
          symbol: stock.symbol,
          x: stock.closestValue * 100 + jitterX,
          y: baseY,
          actualDistance: stock.closestValue * 100,
          close: stock.close,
          closestLevel: stock.closestLevel,
          levels: stock.levels,
          tradeDate: stock.tradeDate,
          expiryDate: stock.expiryDate,
          sector: (stock as any).sector,
          industry: (stock as any).industry,
          marketCapTier: (stock as any).marketCapTier,
          marketCap: (stock as any).marketCap,
          indices: (stock as any).indices,
          name: (stock as any).name,
          color: getLevelColor(stock.closestLevel),
          r: dotRadius((stock as any).marketCap),
        });
      });
    });

    if (selectedQuadrant) return allData.filter(s => s.closestLevel === selectedQuadrant);
    return allData;
  }, [data, selectedQuadrant]);

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(stock => { counts[stock.closestLevel] = (counts[stock.closestLevel] || 0) + 1; });
    return counts;
  }, [data]);

  // Always keep full x-domain so all band labels stay visible
  const xDomain = useMemo(() => {
    if (chartData.length === 0) return [-20, 20];
    const xs = chartData.map((d: any) => d.actualDistance);
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const pad = Math.max((max - min) * 0.1, 5);
    // Widen to always show active band labels cleanly
    return [Math.min(Math.floor(min - pad), -18), Math.max(Math.ceil(max + pad), 18)];
  }, [chartData]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      const d = payload[0].payload;
      return (
        <div className="bg-white p-4 border-2 border-gray-300 rounded-lg shadow-xl min-w-[280px] z-50">
          <p className="font-bold text-xl mb-0 text-blue-600">{d.symbol}</p>
          {d.name && <p className="text-xs text-gray-500 mb-1 font-medium">{d.name}</p>}
          {(d.sector || d.industry) && (
            <p className="text-xs text-gray-400 mb-0.5">{[d.sector, d.industry].filter(Boolean).join(' · ')}</p>
          )}
          {(d.marketCapTier || d.marketCap || (d.indices?.length > 0)) && (
            <p className="text-xs text-gray-400 mb-2">
              {d.marketCap && <span className="mr-2">MCap: {d.marketCap >= 1e12 ? `$${(d.marketCap/1e12).toFixed(1)}T` : d.marketCap >= 1e9 ? `$${(d.marketCap/1e9).toFixed(0)}B` : `$${(d.marketCap/1e6).toFixed(0)}M`}</span>}
              {d.marketCapTier && <span className="mr-2">[{d.marketCapTier}]</span>}
              {d.indices?.length > 0 && <span>{d.indices.join(', ')}</span>}
            </p>
          )}
          <div className="text-xs text-gray-500 mb-2">
            <p>Trade: {d.tradeDate} · Expiry: {d.expiryDate}</p>
          </div>
          <p className="text-sm text-gray-600 mb-2">
            Close: <span className="font-semibold">{formatCurrency(d.close)}</span>
          </p>
          <p className="text-sm font-semibold mb-3 pb-2 border-b" style={{ color: d.color }}>
            Closest: {getLevelDisplayName(d.closestLevel)}
            <span className="text-xs text-gray-500 font-normal ml-2">
              {d.actualDistance > 0 ? '+' : ''}{d.actualDistance.toFixed(2)}%
            </span>
          </p>
          <div className="text-xs space-y-1">
            {d.levels.map((level: any) => (
              <div key={level.name} className="flex justify-between gap-4">
                <span style={{ color: getLevelColor(level.name) }}>{getLevelDisplayName(level.name)}</span>
                <div className="flex gap-2 text-right">
                  <span className="font-semibold">{level.price != null ? formatCurrency(level.price) : 'N/A'}</span>
                  <span className="text-gray-500">{formatPercentage(level.value)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props;
    const r = payload.r ?? 6;
    return (
      <g>
        <circle
          cx={cx} cy={cy} r={r}
          fill={payload.color} opacity={0.85}
          stroke="#fff" strokeWidth={1.5}
          className="cursor-pointer"
        />
        <text
          x={cx} y={cy - r - 3}
          textAnchor="middle" fontSize="9" fontWeight="700" fill="#1f2937"
          className="pointer-events-none select-none"
        >
          {payload.symbol}
        </text>
      </g>
    );
  };

  // Custom band label rendered inside chart via ReferenceArea label
  const BandLabel = ({ viewBox, band }: any) => {
    if (!viewBox) return null;
    const { x, width, y } = viewBox;
    const cx = x + width / 2;
    return (
      <g>
        <text
          x={cx} y={y + 16}
          textAnchor="middle"
          fontSize={10} fontWeight={700}
          fill={band.color} opacity={0.55}
          className="pointer-events-none select-none"
        >
          {band.label}
        </text>
      </g>
    );
  };

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold mb-0.5">5-Quadrant Stock Analysis</h2>
          <p className="text-gray-500 text-sm">
            {chartData.length} stocks · X-axis = % distance from closest level
            {selectedQuadrant && (
              <>
                <span className="ml-2 font-semibold" style={{ color: getLevelColor(selectedQuadrant) }}>
                  [{getLevelDisplayName(selectedQuadrant)}]
                </span>
                <button onClick={() => setSelectedQuadrant(null)} className="ml-2 text-xs underline text-gray-500 hover:text-gray-800">
                  Clear
                </button>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <ResponsiveContainer width="100%" height={height}>
          <ScatterChart margin={{ top: 24, right: 20, bottom: 50, left: 40 }}>
            {BANDS.map(band => (
              <ReferenceArea
                key={band.level}
                x1={band.x1} x2={band.x2}
                fill={band.fill} fillOpacity={1}
                ifOverflow="visible"
                label={(props: any) => <BandLabel {...props} band={band} />}
              />
            ))}

            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.6} />

            <XAxis
              type="number"
              dataKey="x"
              domain={xDomain}
              label={{
                value: '← Below Price · % Distance from Closest Level · Above Price →',
                position: 'bottom',
                offset: 35,
                style: { fontSize: 12, fill: '#6b7280' },
              }}
              tick={{ fontSize: 10, fill: '#6b7280' }}
              tickFormatter={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
            />

            <YAxis type="number" dataKey="y" hide domain={[-60, 60]} />

            <ReferenceLine x={-15} stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="6 3" />
            <ReferenceLine x={-5}  stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="6 3" />
            <ReferenceLine x={0}   stroke="#374151" strokeWidth={2} />
            <ReferenceLine x={5}   stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="6 3" />
            <ReferenceLine x={15}  stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="6 3" />

            <Tooltip content={<CustomTooltip />} cursor={false} />

            <Scatter
              data={chartData}
              shape={<CustomDot />}
              onClick={(d) => {
                if (onStockClick) onStockClick(d.symbol);
                else window.open(`/stock/${d.symbol}`, '_blank');
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>

        {/* Band summary cards */}
        <div className="mt-1 grid grid-cols-5 gap-2 text-center px-[40px]">
          {BANDS.map(band => (
            <button
              key={band.level}
              onClick={() => setSelectedQuadrant(selectedQuadrant === band.level as QuadrantLevel ? null : band.level as QuadrantLevel)}
              className={`py-2 rounded-lg border-2 transition-all cursor-pointer hover:shadow-md ${
                selectedQuadrant === band.level
                  ? 'ring-2 shadow-md'
                  : selectedQuadrant !== null
                  ? 'opacity-40'
                  : ''
              }`}
              style={{ backgroundColor: band.fill, borderColor: band.color }}
            >
              <div className="font-bold text-xs" style={{ color: band.color }}>{band.label}</div>
              <div className="text-xl font-bold mt-0.5" style={{ color: band.color }}>
                {levelCounts[band.level] || 0}
              </div>
              <div className="text-[10px] text-gray-500">stocks</div>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 bg-gray-50 border border-gray-200 rounded-lg">
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-gray-100 transition-colors rounded-lg"
        >
          <h3 className="font-semibold text-gray-800 text-sm">How to Read This Chart</h3>
          <svg className={`w-4 h-4 transform transition-transform ${showGuide ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showGuide && (
          <div className="px-4 pb-4 pt-2 text-sm text-gray-600 space-y-1">
            <p>• X-axis = actual % distance from the stock&apos;s closest price level (negative = below, positive = above)</p>
            <p>• Dot size = market cap (larger = bigger company)</p>
            <p>• Click a quadrant card to isolate stocks in that zone · Click again to clear</p>
            <p>• Hover dots for detailed level info · Click dot to open chart</p>
          </div>
        )}
      </div>
    </div>
  );
}
