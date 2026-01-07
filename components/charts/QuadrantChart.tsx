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
  Legend,
  Cell,
} from 'recharts';
import { QuadrantStock } from '@/types/stock';
import { getLevelColor, getLevelDisplayName, formatCurrency, formatPercentage } from '@/lib/utils';

interface QuadrantChartProps {
  data: QuadrantStock[];
  onStockClick?: (symbol: string) => void;
  height?: number;
}

type QuadrantLevel = 'put_low' | 'put_int' | 'put_call_int' | 'call_int' | 'call_high' | null;

export default function QuadrantChart({ data, onStockClick, height = 600 }: QuadrantChartProps) {
  const [selectedQuadrant, setSelectedQuadrant] = useState<QuadrantLevel>(null);
  const [showGuide, setShowGuide] = useState(false);

  // Transform data for the scatter chart - use actual quadrant positions
  const chartData = useMemo(() => {
    // Group stocks by level first to distribute them evenly
    const groupedByLevel: Record<string, typeof data> = {
      put_low: [],
      put_int: [],
      put_call_int: [],
      call_int: [],
      call_high: [],
    };

    data.forEach(stock => {
      if (groupedByLevel[stock.closestLevel]) {
        groupedByLevel[stock.closestLevel].push(stock);
      }
    });

    const allData: any[] = [];

    // Distribute stocks within each quadrant to avoid overlap
    Object.entries(groupedByLevel).forEach(([level, stocks]) => {
      const count = stocks.length;
      if (count === 0) return;

      // Calculate grid dimensions for better distribution
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const xSpacing = 25 / Math.max(cols, 1);
      const ySpacing = 70 / Math.max(rows, 1);

      stocks.forEach((stock, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        
        let baseX = 0;
        
        // Position based on closest level
        switch (level) {
          case 'put_low':
            baseX = -75;
            break;
          case 'put_int':
            baseX = -37.5;
            break;
          case 'put_call_int':
            baseX = 0;
            break;
          case 'call_int':
            baseX = 37.5;
            break;
          case 'call_high':
            baseX = 75;
            break;
        }

        // Calculate position within the quadrant
        const x = baseX - (cols - 1) * xSpacing / 2 + col * xSpacing;
        const y = -35 + row * ySpacing;
        
        const actualDistance = stock.closestValue * 100;
        
        allData.push({
          symbol: stock.symbol,
          x: x,
          y: y,
          actualDistance: actualDistance,
          close: stock.close,
          closestLevel: stock.closestLevel,
          levels: stock.levels,
          tradeDate: stock.tradeDate,
          expiryDate: stock.expiryDate,
          color: getLevelColor(stock.closestLevel),
        });
      });
    });

    // Filter by selected quadrant if one is selected
    if (selectedQuadrant) {
      return allData.filter(stock => stock.closestLevel === selectedQuadrant);
    }
    
    return allData;
  }, [data, selectedQuadrant]);

  // Group by level for legend
  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(stock => {
      counts[stock.closestLevel] = (counts[stock.closestLevel] || 0) + 1;
    });
    return counts;
  }, [data]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-4 border-2 border-gray-400 rounded-lg shadow-xl min-w-[300px]">
          <p className="font-bold text-xl mb-2 text-blue-600">{data.symbol}</p>
          <div className="text-xs text-gray-500 mb-2 space-y-0.5">
            <p>Trade Date: {data.tradeDate}</p>
            <p>Expiry Date: {data.expiryDate}</p>
          </div>
          <p className="text-base text-gray-600 mb-2">
            Close: <span className="font-semibold">{formatCurrency(data.close)}</span>
          </p>
          <p className="text-base font-semibold mb-3 pb-2 border-b" style={{ color: data.color }}>
            Closest: <span className="text-lg">{getLevelDisplayName(data.closestLevel)}</span>
            <br />
            <span className="text-sm text-gray-600">Distance: {formatPercentage(data.actualDistance / 100)}</span>
          </p>
          <div className="text-sm space-y-1 mt-2">
            <p className="font-bold mb-2 text-gray-700 text-base">All Price Levels:</p>
            {data.levels.map((level: any) => (
              <div key={level.name} className="flex justify-between gap-6 items-center">
                <span className="text-sm font-medium" style={{ color: getLevelColor(level.name) }}>
                  {getLevelDisplayName(level.name)}
                </span>
                <div className="text-right flex items-center gap-2">
                  <div className="font-semibold text-sm min-w-[60px]">
                    {level.price !== undefined && level.price !== null ? formatCurrency(level.price) : 'N/A'}
                  </div>
                  <div className="font-mono text-xs text-gray-600 min-w-[55px]">{formatPercentage(level.value)}</div>
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
    const size = 8;
    
    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={size}
          fill={payload.color}
          opacity={0.8}
          stroke="#fff"
          strokeWidth={2}
          className="cursor-pointer hover:opacity-100 hover:r-[10]"
        />
        <text
          x={cx}
          y={cy - size - 3}
          textAnchor="middle"
          fontSize="9"
          fontWeight="600"
          fill="#374151"
          className="pointer-events-none"
        >
          {payload.symbol}
        </text>
      </g>
    );
  };

  return (
    <div className="w-full">
      <div className="mb-4">
        <h2 className="text-2xl font-bold mb-2">5-Quadrant Stock Analysis</h2>
        <p className="text-gray-600">
          Showing {chartData.length} stocks grouped by their closest price level
          {selectedQuadrant && (
            <span className="ml-2 text-sm">
              (Filtered: <span className="font-semibold" style={{ color: getLevelColor(selectedQuadrant) }}>
                {getLevelDisplayName(selectedQuadrant)}
              </span>)
              <button
                onClick={() => setSelectedQuadrant(null)}
                className="ml-2 text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded"
              >
                Clear Filter
              </button>
            </span>
          )}
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <ResponsiveContainer width="100%" height={height}>
          <ScatterChart margin={{ top: 40, right: 20, bottom: 80, left: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            
            <XAxis
              type="number"
              dataKey="x"
              name="Quadrant Position"
              domain={[-100, 100]}
              ticks={[-75, -37.5, 0, 37.5, 75]}
              label={{
                value: 'Price Level Quadrants',
                position: 'bottom',
                offset: 60,
                style: { fontSize: 14, fontWeight: 'bold' },
              }}
              tick={{ fontSize: 10 }}
            />
            
            <YAxis
              type="number"
              dataKey="y"
              domain={[-25, 25]}
              hide
            />

            {/* Quadrant dividing lines */}
            <ReferenceLine 
              x={-56.25} 
              stroke="#9ca3af" 
              strokeWidth={1} 
              strokeDasharray="5 5"
              label={{ value: 'PUT INT', position: 'top', fontSize: 11, fontWeight: 'bold', fill: '#ea580c' }}
            />
            <ReferenceLine 
              x={-18.75} 
              stroke="#9ca3af" 
              strokeWidth={1} 
              strokeDasharray="5 5"
            />
            <ReferenceLine 
              x={18.75} 
              stroke="#9ca3af" 
              strokeWidth={1} 
              strokeDasharray="5 5"
            />
            <ReferenceLine 
              x={56.25} 
              stroke="#9ca3af" 
              strokeWidth={1} 
              strokeDasharray="5 5"
              label={{ value: 'CALL INT', position: 'top', fontSize: 11, fontWeight: 'bold', fill: '#2563eb' }}
            />

            {/* Quadrant name labels at extreme positions */}
            <ReferenceLine 
              x={-75} 
              stroke="transparent"
              label={{ value: 'PUT LOW', position: 'top', fontSize: 11, fontWeight: 'bold', fill: '#dc2626' }}
            />
            <ReferenceLine 
              x={75} 
              stroke="transparent"
              label={{ value: 'CALL HIGH', position: 'top', fontSize: 11, fontWeight: 'bold', fill: '#9333ea' }}
            />

            {/* Center line */}
            <ReferenceLine
              x={0}
              stroke="#374151"
              strokeWidth={2}
              label={{
                value: 'PUT/CALL INT',
                position: 'top',
                style: { fontSize: 11, fontWeight: 'bold' },
              }}
            />

            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />

            <Scatter
              data={chartData}
              shape={<CustomDot />}
              onClick={(data) => {
                if (onStockClick) {
                  onStockClick(data.symbol);
                } else {
                  // Open in new tab
                  window.open(`/stock/${data.symbol}`, '_blank');
                }
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>

        {/* Quadrant Labels Below Chart */}
        <div className="mt-6 grid grid-cols-5 gap-3 text-center">
          <div 
            onClick={() => setSelectedQuadrant(selectedQuadrant === 'put_low' ? null : 'put_low')}
            className={`p-4 bg-gradient-to-br from-red-50 to-red-100 rounded-lg border-2 shadow-sm cursor-pointer transition-all hover:shadow-md ${
              selectedQuadrant === 'put_low' ? 'border-red-600 ring-2 ring-red-400' : 'border-red-300'
            }`}
          >
            <div className="font-bold text-red-800 text-base mb-1">PUT LOW</div>
            <div className="text-xs text-red-600 font-medium">Far Below Price</div>
            <div className="mt-2 text-lg font-bold text-red-900">{levelCounts['put_low'] || 0}</div>
          </div>
          <div 
            onClick={() => setSelectedQuadrant(selectedQuadrant === 'put_int' ? null : 'put_int')}
            className={`p-4 bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg border-2 shadow-sm cursor-pointer transition-all hover:shadow-md ${
              selectedQuadrant === 'put_int' ? 'border-orange-600 ring-2 ring-orange-400' : 'border-orange-300'
            }`}
          >
            <div className="font-bold text-orange-800 text-base mb-1">PUT INT</div>
            <div className="text-xs text-orange-600 font-medium">Below Price</div>
            <div className="mt-2 text-lg font-bold text-orange-900">{levelCounts['put_int'] || 0}</div>
          </div>
          <div 
            onClick={() => setSelectedQuadrant(selectedQuadrant === 'put_call_int' ? null : 'put_call_int')}
            className={`p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-lg border-2 shadow-sm cursor-pointer transition-all hover:shadow-md ${
              selectedQuadrant === 'put_call_int' ? 'border-green-600 ring-2 ring-green-400' : 'border-green-300'
            }`}
          >
            <div className="font-bold text-green-800 text-base mb-1">PUT/CALL INT</div>
            <div className="text-xs text-green-600 font-medium">At Price</div>
            <div className="mt-2 text-lg font-bold text-green-900">{levelCounts['put_call_int'] || 0}</div>
          </div>
          <div 
            onClick={() => setSelectedQuadrant(selectedQuadrant === 'call_int' ? null : 'call_int')}
            className={`p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg border-2 shadow-sm cursor-pointer transition-all hover:shadow-md ${
              selectedQuadrant === 'call_int' ? 'border-blue-600 ring-2 ring-blue-400' : 'border-blue-300'
            }`}
          >
            <div className="font-bold text-blue-800 text-base mb-1">CALL INT</div>
            <div className="text-xs text-blue-600 font-medium">Above Price</div>
            <div className="mt-2 text-lg font-bold text-blue-900">{levelCounts['call_int'] || 0}</div>
          </div>
          <div 
            onClick={() => setSelectedQuadrant(selectedQuadrant === 'call_high' ? null : 'call_high')}
            className={`p-4 bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg border-2 shadow-sm cursor-pointer transition-all hover:shadow-md ${
              selectedQuadrant === 'call_high' ? 'border-purple-600 ring-2 ring-purple-400' : 'border-purple-300'
            }`}
          >
            <div className="font-bold text-purple-800 text-base mb-1">CALL HIGH</div>
            <div className="text-xs text-purple-600 font-medium">Far Above Price</div>
            <div className="mt-2 text-lg font-bold text-purple-900">{levelCounts['call_high'] || 0}</div>
          </div>
        </div>

        {/* Custom Legend */}
        <div className="mt-6 flex flex-wrap gap-4 justify-center">
          {Object.entries(levelCounts).map(([levelName, count]) => (
            <div
              key={levelName}
              className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded"
            >
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: getLevelColor(levelName) }}
              />
              <span className="text-sm font-medium">
                {getLevelDisplayName(levelName)}
              </span>
              <span className="text-xs text-gray-600">({count})</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg">
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-100 transition-colors rounded-lg"
        >
          <h3 className="font-semibold text-gray-800">How to Read This Chart</h3>
          <svg
            className={`w-5 h-5 transform transition-transform ${showGuide ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {showGuide && (
          <div className="px-4 pb-4 pt-2">
            <ul className="text-sm text-gray-700 space-y-1">
              <li>• Each dot represents a stock positioned in its corresponding price level quadrant</li>
              <li>• <strong>Put Low</strong>: Stocks where Put Low level is closest (far from current price)</li>
              <li>• <strong>Put Int</strong>: Stocks where Put Intermediate level is closest</li>
              <li>• <strong>Put/Call Int</strong>: Stocks at the combined intermediate level (center)</li>
              <li>• <strong>Call Int</strong>: Stocks where Call Intermediate level is closest</li>
              <li>• <strong>Call High</strong>: Stocks where Call High level is closest (far from current price)</li>
              <li>• Hover over dots to see detailed level information and actual distance</li>
              <li>• Click on a dot to view the stock&apos;s detailed chart</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
