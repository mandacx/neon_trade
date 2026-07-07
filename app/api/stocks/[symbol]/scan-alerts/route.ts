import { NextRequest, NextResponse } from 'next/server';
import { getScanAlertsForSymbol } from '@/lib/scanAlerts';

// Scan alerts for a single symbol, for annotating that stock's chart.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const searchParams = request.nextUrl.searchParams;
    const from = searchParams.get('from') || undefined;
    const to = searchParams.get('to') || undefined;

    if (!symbol) {
      return NextResponse.json({ success: false, error: 'Symbol parameter is required' }, { status: 400 });
    }

    const alerts = await getScanAlertsForSymbol(symbol, from, to);

    return NextResponse.json({
      success: true,
      data: { symbol: symbol.toUpperCase(), from, to, alerts },
    });
  } catch (error) {
    console.error('Error fetching stock scan alerts:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch scan alerts', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
