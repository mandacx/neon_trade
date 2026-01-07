import { NextRequest, NextResponse } from 'next/server';
import { getExpiryDates } from '@/lib/db';

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

    const expiryDates = await getExpiryDates(symbol);

    return NextResponse.json({
      success: true,
      data: {
        symbol: symbol.toUpperCase(),
        expiryDates,
      },
    });
  } catch (error) {
    console.error('Error fetching expiry dates:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch expiry dates',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
