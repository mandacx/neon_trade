import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function GET() {
  try {
    // Get distinct symbols
    const symbols = await sql`
      SELECT DISTINCT symbol 
      FROM public.eod_usmkts_price 
      ORDER BY symbol 
      LIMIT 20
    `;

    // Get count of records
    const count = await sql`
      SELECT COUNT(*) as total 
      FROM public.eod_usmkts_price
    `;

    // Get latest trade date
    const latestDate = await sql`
      SELECT MAX(trade_date)::text as latest_date 
      FROM public.eod_usmkts_price
    `;

    // Get sample record
    const sample = await sql`
      SELECT * 
      FROM public.eod_usmkts_price 
      LIMIT 1
    `;

    return NextResponse.json({
      success: true,
      totalRecords: count[0]?.total,
      latestDate: latestDate[0]?.latest_date,
      symbols: symbols.map((s: any) => s.symbol),
      sampleRecord: sample[0]
    });
  } catch (error: any) {
    console.error('Database test error:', error);
    return NextResponse.json(
      { success: false, error: error.message, detail: error },
      { status: 500 }
    );
  }
}
