import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { format, subDays } from 'date-fns'; // format used for default date params

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

    const rows = await sql`
      SELECT
        trade_date::text as "date",
        COALESCE(call_oi, 0) as "callOi",
        COALESCE(put_oi, 0) as "putOi",
        COALESCE((put_oi - call_oi), 0) as "oiDiff"
      FROM public.eod_usmkts_price
      WHERE symbol = ${symbol.toUpperCase()}
        AND trade_date >= ${from}
        AND trade_date <= ${to}
      ORDER BY trade_date ASC
    `;

    const oiData = rows.map((row: any) => ({
      date: row.date,
      callOi: row.callOi,
      putOi: row.putOi,
      oiDiff: row.oiDiff,
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
