import { NextRequest, NextResponse } from 'next/server';
import { getAllStocksLatest, getAllStocksByDate, getAllStocksByDateAndExpiry, getAvailableDates, getAvailableExpiryDates } from '@/lib/db';
import { calculateLevels, findClosestLevel } from '@/lib/calculations';
import { format } from 'date-fns';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    const expiryDate = searchParams.get('expiry');
    const threshold = searchParams.get('threshold') ? parseFloat(searchParams.get('threshold')!) : undefined;
    const search = searchParams.get('search');
    const metadataOnly = searchParams.get('metadata') === 'true';

    // If requesting metadata only (dates)
    if (metadataOnly) {
      const [tradeDates, expiryDates] = await Promise.all([
        getAvailableDates(30),
        getAvailableExpiryDates(),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          tradeDates,
          expiryDates,
        },
      });
    }

    // Get all stocks for the specified filters
    let stocksData;
    
    if (date && expiryDate) {
      stocksData = await getAllStocksByDateAndExpiry(date, expiryDate);
    } else if (date) {
      stocksData = await getAllStocksByDate(date);
    } else {
      stocksData = await getAllStocksLatest();
    }

    // Process each stock to calculate levels
    const processedStocks = stocksData.map(data => {
      const levels = calculateLevels(data);
      const closest = findClosestLevel(levels);

      return {
        symbol: data.SYMBOL,
        close: data.CLOSE,
        tradeDate: data.TRADE_DATE,
        expiryDate: data.EXPIRY_DT,
        levels: levels.map(l => ({
          name: l.name,
          value: l.value,
          price: l.price,
        })),
        closestLevel: closest.name,
        closestValue: closest.value,
      };
    });

    // Filter out stocks where all levels are 100% (value = 1) - indicates invalid data
    const validStocks = processedStocks.filter(stock => {
      // Check if all levels have value of 1 (100%)
      const allLevelsAre100Percent = stock.levels.every(level => level.value === 1);
      return !allLevelsAre100Percent;
    });

    // Apply filters
    let filteredStocks = validStocks;

    // Filter by threshold if specified
    if (threshold !== undefined) {
      filteredStocks = filteredStocks.filter(stock => 
        Math.abs(stock.closestValue) <= threshold
      );
    }

    // Filter by search if specified
    if (search) {
      const searchUpper = search.toUpperCase();
      filteredStocks = filteredStocks.filter(stock =>
        stock.symbol.includes(searchUpper)
      );
    }

    const tradeDate = processedStocks.length > 0 
      ? processedStocks[0].tradeDate 
      : format(new Date(), 'yyyy-MM-dd');

    return NextResponse.json({
      success: true,
      data: {
        date: tradeDate,
        count: filteredStocks.length,
        total: processedStocks.length,
        stocks: filteredStocks,
      },
    });
  } catch (error) {
    console.error('Error fetching quadrant data:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch quadrant data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
