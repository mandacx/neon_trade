'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, HistogramData, MouseEventParams } from 'lightweight-charts';
import { LevelCalculation } from '@/types/stock';
import { getLevelColor, getLevelDisplayName, formatCurrency, formatPercentage } from '@/lib/utils';

interface KLineChartProps {
  symbol: string;
  candleData: Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  volumeData: Array<{
    time: string;
    value: number;
  }>;
  levels?: LevelCalculation[];
  closestLevel?: string;
  historicalLevels?: Map<string, { levels: LevelCalculation[], closestLevel: string }>;
  currentPrice?: number;
  height?: number;
  onLoadMore?: (direction: 'past' | 'future', firstVisibleTime: string, lastVisibleTime: string) => void;
  isLoadingMore?: boolean;
}

export default function KLineChart({
  symbol,
  candleData,
  volumeData,
  levels = [],
  closestLevel,
  historicalLevels,
  currentPrice,
  height = 500,
  onLoadMore,
  isLoadingMore = false,
}: KLineChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLineRefs = useRef<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: height,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#333',
      },
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#d1d4dc',
      },
      timeScale: {
        borderColor: '#d1d4dc',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Add candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    candleSeriesRef.current = candleSeries;

    // Add volume series
    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });

    volumeSeriesRef.current = volumeSeries;

    // Set volume scale
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    setIsLoading(false);

    // Subscribe to visible range changes to detect when to load more data
    let visibleRangeUnsubscribe: any = null;
    
    if (onLoadMore) {
      const chartTimeScale = chart.timeScale();
      
      const handleVisibleTimeRangeChange = () => {
        if (!chartRef.current || loadingMoreRef.current) return;

        const timeScale = chartRef.current.timeScale();
        const visibleRange = timeScale.getVisibleRange();
        
        if (!visibleRange || !candleSeriesRef.current) return;

        // Get actual data from the series
        const seriesData = candleSeriesRef.current.data();
        if (!seriesData || seriesData.length === 0) return;

        const firstDataTime = seriesData[0].time as string;
        const lastDataTime = seriesData[seriesData.length - 1].time as string;
        
        console.log('Visible range check:', {
          visibleFrom: visibleRange.from,
          visibleTo: visibleRange.to,
          firstData: firstDataTime,
          lastData: lastDataTime
        });
        
        // Check if user scrolled close to the beginning (load older data)
        const visibleFrom = visibleRange.from as number;
        const firstDataTimestamp = new Date(firstDataTime).getTime() / 1000;
        
        // If visible range is within 20% of the start, load more past data
        const totalRange = new Date(lastDataTime).getTime() / 1000 - firstDataTimestamp;
        const distanceFromStart = visibleFrom - firstDataTimestamp;
        
        if (distanceFromStart < totalRange * 0.2 && distanceFromStart >= 0) {
          console.log('Triggering load more past data');
          loadingMoreRef.current = true;
          onLoadMore('past', firstDataTime, lastDataTime);
          // Reset after a delay to prevent multiple triggers
          setTimeout(() => {
            loadingMoreRef.current = false;
          }, 3000);
        }
      };

      visibleRangeUnsubscribe = chartTimeScale.subscribeVisibleTimeRangeChange(handleVisibleTimeRangeChange);
    }

    // Add crosshair move handler for tooltip
    const handleCrosshairMove = (param: MouseEventParams) => {
      if (!tooltipRef.current || !param.time) {
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'none';
        }
        return;
      }

      const data = param.seriesData.get(candleSeriesRef.current!);
      if (!data) {
        tooltipRef.current.style.display = 'none';
        return;
      }

      const candleData = data as CandlestickData;
      const open = candleData.open;
      const high = candleData.high;
      const low = candleData.low;
      const close = candleData.close;
      const dateStr = param.time as string;

      console.log(`Tooltip for date: ${dateStr} (type: ${typeof dateStr}), historicalLevels size: ${historicalLevels?.size || 0}`);
      
      if (historicalLevels && historicalLevels.size > 0) {
        console.log('Available dates in map:', Array.from(historicalLevels.keys()));
      }

      // Get levels for this specific date from historical data
      let dateLevels = levels;
      let dateClosestLevel = closestLevel;
      
      if (historicalLevels && historicalLevels.size > 0) {
        const historicalData = historicalLevels.get(dateStr);
        console.log(`Looking up date "${dateStr}" in map:`, historicalData);
        if (historicalData) {
          dateLevels = historicalData.levels;
          dateClosestLevel = historicalData.closestLevel;
          console.log(`Using historical levels for ${dateStr}:`, dateLevels);
        } else {
          console.log(`No historical data found for "${dateStr}", using default levels`);
          console.log('Map has these keys:', Array.from(historicalLevels.keys()));
        }
      } else {
        console.log('historicalLevels is empty or undefined');
      }

      // Hide tooltip if no levels available for this date
      if (dateLevels.length === 0) {
        tooltipRef.current.style.display = 'none';
        return;
      }

      // Show tooltip with levels
      tooltipRef.current.style.display = 'block';
      tooltipRef.current.style.left = param.point?.x + 10 + 'px';
      tooltipRef.current.style.top = param.point?.y + 10 + 'px';

      // Build tooltip content with closest level highlighted
      const levelsWithProximity = dateLevels.map(level => {
        const isProximity = level.name === dateClosestLevel;
        const displayName = getLevelDisplayName(level.name);
        // Convert price and value to numbers if they're strings
        const priceValue = typeof level.price === 'string' ? parseFloat(level.price) : level.price;
        const valueNum = typeof level.value === 'string' ? parseFloat(level.value) : level.value;
        
        return {
          name: level.name,
          price: priceValue,
          value: valueNum,
          displayName,
          isProximity
        };
      }).reverse(); // Reverse the order: Call High -> Call Int -> Put/Call Int -> Put Int -> Put Low

      console.log('Rendering tooltip with levels:', levelsWithProximity);

      tooltipRef.current.innerHTML = `
        <div class="text-xs">
          <div class="font-bold mb-2">${dateStr}</div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 mb-3 pb-2 border-b border-gray-300">
            <div class="flex justify-between">
              <span class="text-gray-600">Open:</span>
              <span class="font-semibold">${formatCurrency(open)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600">High:</span>
              <span class="font-semibold text-green-600">${formatCurrency(high)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600">Low:</span>
              <span class="font-semibold text-red-600">${formatCurrency(low)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-600">Close:</span>
              <span class="font-semibold">${formatCurrency(close)}</span>
            </div>
          </div>
          <div class="font-semibold mb-1 text-gray-700">Support & Resistance Levels:</div>
          ${levelsWithProximity.map(level => `
            <div class="flex justify-between gap-4 ${level.isProximity ? 'font-bold text-blue-600' : ''}">
              <span>${level.displayName}:</span>
              <span>${formatCurrency(level.price)} (${formatPercentage(level.value)})</span>
            </div>
          `).join('')}
        </div>
      `;
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (visibleRangeUnsubscribe) {
        visibleRangeUnsubscribe();
      }
      chart.remove();
    };
  }, [height, onLoadMore, historicalLevels, levels, closestLevel]);

  // Update data
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || isLoading) return;

    // Format candlestick data
    const formattedCandles: CandlestickData[] = candleData.map(d => ({
      time: d.time as any,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    // Format volume data
    const formattedVolume: HistogramData[] = volumeData.map(d => ({
      time: d.time as any,
      value: d.value,
      color: '#26a69a66',
    }));

    // Use setData to replace all data (handles both initial load and updates)
    candleSeriesRef.current.setData(formattedCandles);
    volumeSeriesRef.current.setData(formattedVolume);

    // Only fit content on initial load, not when loading more data
    if (!isLoadingMore) {
      chartRef.current?.timeScale().fitContent();
    }
  }, [candleData, volumeData, isLoading, isLoadingMore]);

  // Add level lines
  useEffect(() => {
    console.log('Price lines effect triggered. Levels:', levels, 'ClosestLevel:', closestLevel);
    console.log('candleSeriesRef.current:', candleSeriesRef.current);
    
    if (!candleSeriesRef.current || !levels.length) {
      console.log('Skipping price lines - no series or no levels');
      // Clear existing price lines if no levels
      priceLineRefs.current.forEach(line => {
        if (line && candleSeriesRef.current) {
          candleSeriesRef.current.removePriceLine(line);
        }
      });
      priceLineRefs.current = [];
      return;
    }

    // Clear all existing price lines before adding new ones
    console.log('Clearing existing price lines. Count:', priceLineRefs.current.length);
    priceLineRefs.current.forEach(line => {
      if (line && candleSeriesRef.current) {
        candleSeriesRef.current.removePriceLine(line);
      }
    });
    priceLineRefs.current = [];

    console.log('Adding price lines for levels:', JSON.stringify(levels, null, 2));
    console.log('Closest level:', closestLevel);

    levels.forEach(level => {
      console.log('Processing level:', level);
      console.log('Level price type:', typeof level.price, 'Value:', level.price);
      
      // Convert price to number if it's a string
      const priceValue = typeof level.price === 'string' ? parseFloat(level.price) : level.price;
      
      console.log('Converted price:', priceValue, 'Type:', typeof priceValue);
      console.log('Is NaN check:', isNaN(priceValue));
      
      // Skip if level doesn't have a valid price
      if (!level || !priceValue || isNaN(priceValue) || priceValue === 0) {
        console.warn('Skipping invalid level:', level, 'Converted price:', priceValue);
        return;
      }

      const isClosest = level.name === closestLevel;
      const color = isClosest ? '#3B82F6' : getLevelColor(level.name);
      const lineWidth = isClosest ? 2 : 1;
      const displayName = getLevelDisplayName(level.name);

      console.log(`Creating price line for ${displayName} at ${priceValue} with color ${color}`);

      try {
        const priceLine = candleSeriesRef.current?.createPriceLine({
          price: priceValue,
          color: color,
          lineWidth: lineWidth,
          lineStyle: isClosest ? 0 : 2, // 0 = solid, 2 = dashed
          axisLabelVisible: true,
          axisLabelBackgroundColor: color,
          title: displayName,
        });

        if (priceLine) {
          priceLineRefs.current.push(priceLine);
          console.log(`Successfully created price line for ${displayName}`);
        } else {
          console.error(`Failed to create price line for ${displayName}`);
        }
      } catch (err) {
        console.error(`Error creating price line for ${displayName}:`, err);
      }
    });

    console.log('Total price lines created:', priceLineRefs.current.length);

    // Cleanup function to remove price lines when component unmounts or levels change
    return () => {
      priceLineRefs.current.forEach(line => {
        if (line && candleSeriesRef.current) {
          candleSeriesRef.current.removePriceLine(line);
        }
      });
      priceLineRefs.current = [];
    };
  }, [levels, closestLevel]);

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-2xl font-bold">{symbol}</h2>
            {currentPrice && (
              <p className="text-lg text-gray-600">
                {formatCurrency(currentPrice)}
              </p>
            )}
          </div>
          {isLoadingMore && (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
              <span>Loading more data...</span>
            </div>
          )}
        </div>
      </div>

      <div
        ref={chartContainerRef}
        className="relative bg-white rounded-lg border border-gray-200 shadow-sm"
        style={{ height: `${height}px` }}
      >
        {/* Tooltip */}
        <div
          ref={tooltipRef}
          className="absolute z-10 bg-white border border-gray-300 rounded-lg shadow-lg p-3 pointer-events-none"
          style={{ display: 'none' }}
        />
        
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-2" />
              <p className="text-gray-600">Loading chart...</p>
            </div>
          </div>
        )}
      </div>

      {levels.length > 0 && closestLevel && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="font-semibold text-blue-900 mb-2">Proximity Analysis</h3>
          {levels.find(l => l.name === closestLevel) && (
            <div className="text-sm">
              <p className="text-blue-800">
                <span className="font-semibold">Proximity ({getLevelDisplayName(closestLevel)})</span> is the nearest level at{' '}
                <span className="font-semibold">
                  {formatCurrency(levels.find(l => l.name === closestLevel)!.price)}
                </span>
                {' '}({formatPercentage(levels.find(l => l.name === closestLevel)!.value)})
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
