import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { format, subDays } from 'date-fns';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const searchParams = request.nextUrl.searchParams;
    
    // Get date range from query params or default to last 90 days
    const to = searchParams.get('to') || format(new Date(), 'yyyy-MM-dd');
    const from = searchParams.get('from') || format(subDays(new Date(), 90), 'yyyy-MM-dd');

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    // Query database for OI data
    const result = await query(
      `SELECT 
        trade_date as "date",
        COALESCE(call_oi, 0) as "callOi",
        COALESCE(put_oi, 0) as "putOi",
        COALESCE((put_oi - call_oi), 0) as "oiDiff"
      FROM eod_usmkts_price
      WHERE UPPER(symbol) = UPPER($1)
        AND trade_date >= $2
        AND trade_date <= $3
      ORDER BY trade_date ASC`,
      [symbol, from, to]
    );

    const oiData = result.rows.map(row => ({
      date: typeof row.date === 'string' ? row.date : format(new Date(row.date), 'yyyy-MM-dd'),
      callOi: parseInt(row.callOi) || 0,
      putOi: parseInt(row.putOi) || 0,
      oiDiff: parseInt(row.oiDiff) || 0,
    }));

    return NextResponse.json({
      success: true,
      data: {
        symbol: symbol.toUpperCase(),
        from,
        to,
        data: oiData,
      },
    });
  } catch (error) {
    console.error('Error fetching OI data:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch OI data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
