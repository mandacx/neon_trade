import { NextRequest, NextResponse } from 'next/server';
import { searchStocks } from '@/lib/db';
import { searchSymbols } from '@/lib/tradier';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');

    if (!query || query.length < 1) {
      return NextResponse.json(
        { success: false, error: 'Query parameter is required' },
        { status: 400 }
      );
    }

    // Search in our database first
    const dbResults = await searchStocks(query, 20);

    // Also try Tradier for additional symbols
    let tradierResults: Array<{ symbol: string; description: string }> = [];
    try {
      tradierResults = await searchSymbols(query);
    } catch (error) {
      console.warn('Tradier search failed, using DB results only');
    }

    // Combine and deduplicate results
    const combined = [
      ...dbResults.map(symbol => ({
        symbol,
        name: tradierResults.find(t => t.symbol === symbol)?.description || symbol,
        exchange: 'US',
      })),
      ...tradierResults
        .filter(t => !dbResults.includes(t.symbol))
        .map(t => ({
          symbol: t.symbol,
          name: t.description,
          exchange: 'US',
        })),
    ];

    return NextResponse.json({
      success: true,
      data: {
        results: combined.slice(0, 20),
      },
    });
  } catch (error) {
    console.error('Error in stock search:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to search stocks',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
