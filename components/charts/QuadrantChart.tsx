'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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

// Canonical level order, ascending by price. Rungs sit at x = index (0..N-1).
const LEVEL_ORDER: Exclude<QuadrantLevel, null>[] = [
  'put_low', 'put_int', 'put_call_int', 'call_int', 'call_high',
];
const N_LEVELS = LEVEL_ORDER.length;

// Warm (put side) → cool (call side) zone fills between adjacent rungs.
const ZONES = [
  { fill: '#fef2f2' }, // put_low → put_int
  { fill: '#fff7ed' }, // put_int → put_call_int
  { fill: '#ecfdf5' }, // put_call_int → call_int
  { fill: '#eff6ff' }, // call_int → call_high
];

// Domain defaults: a touch of padding past the end rungs so clamped points clip cleanly.
const DEFAULT_X: [number, number] = [-0.4, N_LEVELS - 1 + 0.4];
const DEFAULT_Y: [number, number] = [-60, 60];
const MARGIN = { top: 24, right: 20, bottom: 50, left: 40 };
const ZOOM_STEP = 0.85;
const DRAG_THRESHOLD = 3; // px — separates pan from click

// §1 — Position a stock on the ladder between its own price levels.
// Interpolate CLOSE across the adjacent level-pair that brackets it.
function ladderX(close: number, levels: QuadrantStock['levels']): number {
  const prices = LEVEL_ORDER.map(name => {
    const lv = levels.find(l => l.name === name);
    return lv && lv.price != null && lv.price > 0 ? lv.price : NaN;
  });
  const valid = prices
    .map((p, i) => ({ p, i }))
    .filter(o => !Number.isNaN(o.p));

  // Guards: snap to nearest rung when we can't interpolate.
  if (valid.length === 0) return (N_LEVELS - 1) / 2;
  if (valid.length === 1) return valid[0].i;

  const lo = valid[0];
  const hi = valid[valid.length - 1];
  // Clamp just past the ends.
  if (close <= lo.p) return Math.max(lo.i - 0.35, DEFAULT_X[0] + 0.05);
  if (close >= hi.p) return Math.min(hi.i + 0.35, DEFAULT_X[1] - 0.05);

  for (let k = 0; k < valid.length - 1; k++) {
    const a = valid[k];
    const b = valid[k + 1];
    if (close >= a.p && close <= b.p) {
      const denom = b.p - a.p;
      const frac = denom !== 0 ? (close - a.p) / denom : 0; // divide-by-zero guard
      return a.i + frac * (b.i - a.i);
    }
  }
  return lo.i;
}

function clampDomain(
  [min, max]: [number, number],
  [dmin, dmax]: [number, number],
): [number, number] {
  const range = max - min;
  const full = dmax - dmin;
  if (range >= full) return [dmin, dmax];
  if (min < dmin) return [dmin, dmin + range];
  if (max > dmax) return [dmax - range, dmax];
  return [min, max];
}

// Scale dot radius logarithmically from market cap
function dotRadius(marketCap: number | null | undefined): number {
  if (!marketCap || marketCap <= 0) return 6;
  const log = Math.log10(marketCap);
  const r = 2 + log * 1.2;
  return Math.max(4, Math.min(14, Math.round(r)));
}

export default function QuadrantChart({ data, onStockClick, height = 600 }: QuadrantChartProps) {
  const [selectedQuadrant, setSelectedQuadrant] = useState<QuadrantLevel>(null);
  const [showGuide, setShowGuide] = useState(false);

  // §3 — zoom / pan driven entirely by axis domain state.
  const [xDomain, setXDomain] = useState<[number, number]>(DEFAULT_X);
  const [yDomain, setYDomain] = useState<[number, number]>(DEFAULT_Y);
  const plotRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    px: number; py: number;
    x: [number, number]; y: [number, number];
    moved: boolean;
  } | null>(null);
  const movedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const isZoomed = xDomain[0] !== DEFAULT_X[0] || xDomain[1] !== DEFAULT_X[1]
    || yDomain[0] !== DEFAULT_Y[0] || yDomain[1] !== DEFAULT_Y[1];

  const chartData = useMemo(() => {
    const groupedByLevel: Record<string, QuadrantStock[]> = {
      put_low: [], put_int: [], put_call_int: [], call_int: [], call_high: [],
    };
    data.forEach(stock => {
      if (groupedByLevel[stock.closestLevel]) groupedByLevel[stock.closestLevel].push(stock);
    });

    const allData: any[] = [];
    Object.entries(groupedByLevel).forEach(([level, stocks]) => {
      const count = stocks.length;
      if (count === 0) return;
      // Sort by ladder position so the grid de-overlap is stable left→right.
      const withX = stocks.map(s => ({ s, lx: ladderX(s.close, s.levels) }));
      withX.sort((a, b) => a.lx - b.lx);
      withX.forEach(({ s: stock, lx }, index) => {
        const cols = Math.ceil(Math.sqrt(count));
        const col = index % cols;
        const row = Math.floor(index / cols);
        const rowCount = Math.ceil(count / cols);
        const ySpread = Math.min(70 / Math.max(rowCount, 1), 20);
        const baseY = (row - (rowCount - 1) / 2) * ySpread;
        const jitterX = (col - (cols - 1) / 2) * 0.05;
        allData.push({
          symbol: stock.symbol,
          x: lx + jitterX,
          y: baseY,
          ladderX: lx,
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

  const resetView = useCallback(() => {
    setXDomain(DEFAULT_X);
    setYDomain(DEFAULT_Y);
  }, []);

  const zoomAroundCenter = useCallback((scale: number) => {
    setXDomain(prev => {
      const c = (prev[0] + prev[1]) / 2;
      return clampDomain([c - (c - prev[0]) * scale, c + (prev[1] - c) * scale], DEFAULT_X);
    });
    setYDomain(prev => {
      const c = (prev[0] + prev[1]) / 2;
      return clampDomain([c - (c - prev[0]) * scale, c + (prev[1] - c) * scale], DEFAULT_Y);
    });
  }, []);

  // Wheel zoom toward the cursor — needs a non-passive listener to preventDefault.
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const plotW = rect.width - MARGIN.left - MARGIN.right;
      const plotH = rect.height - MARGIN.top - MARGIN.bottom;
      const fx = (e.clientX - rect.left - MARGIN.left) / plotW;
      const fy = (e.clientY - rect.top - MARGIN.top) / plotH;
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
      const scale = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
      setXDomain(prev => {
        const dataX = prev[0] + fx * (prev[1] - prev[0]);
        return clampDomain([dataX - (dataX - prev[0]) * scale, dataX + (prev[1] - dataX) * scale], DEFAULT_X);
      });
      setYDomain(prev => {
        const dataY = prev[1] - fy * (prev[1] - prev[0]); // axis is inverted (top = max)
        return clampDomain([dataY - (dataY - prev[0]) * scale, dataY + (prev[1] - dataY) * scale], DEFAULT_Y);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { px: e.clientX, py: e.clientY, x: xDomain, y: yDomain, moved: false };
    movedRef.current = false;
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const el = plotRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const plotW = rect.width - MARGIN.left - MARGIN.right;
    const plotH = rect.height - MARGIN.top - MARGIN.bottom;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    movedRef.current = true;
    if (!isDragging) setIsDragging(true);
    const ddx = (dx / plotW) * (d.x[1] - d.x[0]);
    const ddy = (dy / plotH) * (d.y[1] - d.y[0]);
    setXDomain(clampDomain([d.x[0] - ddx, d.x[1] - ddx], DEFAULT_X));
    setYDomain(clampDomain([d.y[0] - ddy, d.y[1] - ddy], DEFAULT_Y));
  };
  const endDrag = () => {
    dragRef.current = null;
    if (isDragging) setIsDragging(false);
  };

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

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold mb-0.5">5-Level Stock Ladder</h2>
          <p className="text-gray-500 text-sm">
            {chartData.length} stocks · X-axis = price position across the stock&apos;s own levels
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
        {/* §3 — zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => zoomAroundCenter(ZOOM_STEP)}
            className="w-8 h-8 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 font-bold text-lg leading-none"
            title="Zoom in" aria-label="Zoom in"
          >+</button>
          <button
            onClick={() => zoomAroundCenter(1 / ZOOM_STEP)}
            className="w-8 h-8 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 font-bold text-lg leading-none"
            title="Zoom out" aria-label="Zoom out"
          >−</button>
          <button
            onClick={resetView}
            disabled={!isZoomed}
            className="h-8 px-2.5 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 text-xs disabled:opacity-40 disabled:cursor-default"
            title="Reset view"
          >Reset</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div
          ref={plotRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        >
          <ResponsiveContainer width="100%" height={height}>
            <ScatterChart margin={MARGIN}>
              {/* §2 — colored zones between rungs (warm → cool) */}
              {ZONES.map((zone, i) => (
                <ReferenceArea
                  key={i}
                  x1={i === 0 ? DEFAULT_X[0] : i}
                  x2={i === ZONES.length - 1 ? DEFAULT_X[1] : i + 1}
                  fill={zone.fill} fillOpacity={1}
                  ifOverflow="visible"
                />
              ))}

              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.6} />

              {/* §2 — level names as X-axis ticks (index → label) */}
              <XAxis
                type="number"
                dataKey="x"
                domain={xDomain}
                allowDataOverflow
                ticks={LEVEL_ORDER.map((_, i) => i)}
                interval={0}
                label={{
                  value: '← Lower price · position across option levels · Higher price →',
                  position: 'bottom',
                  offset: 35,
                  style: { fontSize: 12, fill: '#6b7280' },
                }}
                tick={{ fontSize: 10, fill: '#6b7280' }}
                tickFormatter={(v) => {
                  const idx = Math.round(v);
                  return LEVEL_ORDER[idx] ? getLevelDisplayName(LEVEL_ORDER[idx]) : '';
                }}
              />

              <YAxis type="number" dataKey="y" hide domain={yDomain} allowDataOverflow />

              {/* §2 — rung lines, one per level */}
              {LEVEL_ORDER.map((lvl, i) => (
                <ReferenceLine
                  key={lvl}
                  x={i}
                  stroke={i === 2 ? '#374151' : '#9ca3af'}
                  strokeWidth={i === 2 ? 2 : 1.5}
                  strokeDasharray={i === 2 ? undefined : '6 3'}
                />
              ))}

              <Tooltip content={<CustomTooltip />} cursor={false} />

              <Scatter
                data={chartData}
                shape={<CustomDot />}
                isAnimationActive={false}
                onClick={(d) => {
                  if (movedRef.current) return; // suppress click after a pan
                  if (onStockClick) onStockClick(d.symbol);
                  else window.open(`/stock/${d.symbol}`, '_blank');
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Level summary cards — click to isolate a category */}
        <div className="mt-1 grid grid-cols-5 gap-2 text-center px-[40px]">
          {LEVEL_ORDER.map(lvl => {
            const color = getLevelColor(lvl);
            return (
              <button
                key={lvl}
                onClick={() => setSelectedQuadrant(selectedQuadrant === lvl ? null : lvl)}
                className={`py-2 rounded-lg border-2 transition-all cursor-pointer hover:shadow-md ${
                  selectedQuadrant === lvl
                    ? 'ring-2 shadow-md'
                    : selectedQuadrant !== null
                    ? 'opacity-40'
                    : ''
                }`}
                style={{ borderColor: color }}
              >
                <div className="font-bold text-xs" style={{ color }}>{getLevelDisplayName(lvl).toUpperCase()}</div>
                <div className="text-xl font-bold mt-0.5" style={{ color }}>
                  {levelCounts[lvl] || 0}
                </div>
                <div className="text-[10px] text-gray-500">stocks</div>
              </button>
            );
          })}
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
            <p>• X-axis = where the close price sits <strong>among the stock&apos;s own 5 levels</strong> (rungs), interpolated between adjacent levels</p>
            <p>• Dot color = closest level (category) · Dot size = market cap (larger = bigger company)</p>
            <p>• Scroll to zoom toward the cursor · Drag to pan · Use + / − / Reset to control the view</p>
            <p>• Click a level card to isolate stocks in that category · Click again to clear</p>
            <p>• Hover dots for detailed level info · Click a dot to open its chart</p>
          </div>
        )}
      </div>
    </div>
  );
}
