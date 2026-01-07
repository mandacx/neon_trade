import { NextRequest, NextResponse } from 'next/server';
import { getLatestStockData } from '@/lib/db';
import { processStockData } from '@/lib/calculations';
import { formatPercentage } from '@/lib/utils';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    // Get latest data from database
    const stockData = await getLatestStockData(symbol);

    if (!stockData) {
      // No database data - return success with null to indicate broker-only mode
      return NextResponse.json({
        success: true,
        data: null,
        message: 'Stock not found in database, using broker data only'
      });
    }

    // Process and calculate levels
    const processed = processStockData(stockData);

    return NextResponse.json({
      success: true,
      data: {
        symbol: processed.symbol,
        close: processed.close,
        tradeDate: processed.tradeDate,
        expiryDate: processed.expiryDate,
        levels: processed.levels.map(level => ({
          name: level.name,
          value: level.value,
          price: level.price,
          distance: level.distance,
          percentage: formatPercentage(level.value),
        })),
        closestLevel: {
          name: processed.closestLevel.name,
          value: processed.closestLevel.value,
          price: processed.closestLevel.price,
          percentage: formatPercentage(processed.closestLevel.value),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching stock details:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch stock details',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
