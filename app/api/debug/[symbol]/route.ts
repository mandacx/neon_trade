import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const searchParams = request.nextUrl.searchParams;
    const expiry = searchParams.get('expiry');

    let query;
    if (expiry) {
      query = sql`
        SELECT 
          symbol,
          expiry_dt::text,
          trade_date::text,
          close,
          put_low,
          put_int,
          comb_int,
          call_int,
          call_high,
          put_oi,
          call_oi
        FROM public.eod_usmkts_price
        WHERE symbol = ${symbol.toUpperCase()}
          AND expiry_dt::text = ${expiry}
        ORDER BY trade_date DESC
        LIMIT 1
      `;
    } else {
      query = sql`
        SELECT 
          symbol,
          expiry_dt::text,
          trade_date::text,
          close,
          put_low,
          put_int,
          comb_int,
          call_int,
          call_high,
          put_oi,
          call_oi
        FROM public.eod_usmkts_price
        WHERE symbol = ${symbol.toUpperCase()}
        ORDER BY trade_date DESC
        LIMIT 1
      `;
    }

    const result = await query;

    return NextResponse.json({
      success: true,
      query: expiry ? `With expiry ${expiry}` : 'Latest',
      data: result[0] || null,
      rowCount: result.length,
    });
  } catch (error) {
    console.error('Debug API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
