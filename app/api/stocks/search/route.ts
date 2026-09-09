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

    // Search our DB and Tradier in parallel — Tradier only supplements with
    // symbols missing from the DB, so a slow/cold Tradier call (see
    // lib/tradier.ts's client timeout) shouldn't hold up the DB results.
    // searchSymbols already catches its own errors and resolves to [].
    const [dbResults, tradierResults] = await Promise.all([
      searchStocks(query, 20),
      searchSymbols(query),
    ]);

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
