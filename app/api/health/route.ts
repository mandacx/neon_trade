import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { success: false, error: 'DATABASE_URL not configured' },
        { status: 500 }
      );
    }

    const sql = neon(process.env.DATABASE_URL);
    
    // Test connection
    const result = await sql`SELECT COUNT(*) as count FROM public.eod_usmkts_price`;
    
    // Get column names
    const columns = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'eod_usmkts_price' 
      ORDER BY ordinal_position
    `;
    
    // Get sample symbols
    const symbols = await sql`
      SELECT DISTINCT symbol 
      FROM public.eod_usmkts_price 
      ORDER BY symbol 
      LIMIT 10
    `;

    // Get latest date
    const latestDate = await sql`
      SELECT MAX(trade_date) as latest_date 
      FROM public.eod_usmkts_price
    `;

    return NextResponse.json({
      success: true,
      data: {
        message: 'Database connection successful',
        totalRecords: result[0].count,
        columns: columns.map((c: any) => c.column_name),
        sampleSymbols: symbols.map((s: any) => s.symbol),
        latestDate: latestDate[0].latest_date,
        databaseUrl: process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'connected',
      },
    });
  } catch (error) {
    console.error('Database health check failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Database connection failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
