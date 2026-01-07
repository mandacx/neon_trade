import { NextResponse } from 'next/server';
import { getHistoricalBars, getLatestQuote } from '@/lib/alpaca';

export async function GET() {
  try {
    const apiKey = process.env.ALPACA_API_KEY;
    const secretKey = process.env.ALPACA_SECRET_KEY;
    const baseUrl = process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets';

    if (!apiKey || !secretKey) {
      return NextResponse.json({
        success: false,
        error: 'ALPACA_API_KEY or ALPACA_SECRET_KEY not configured',
      }, { status: 500 });
    }

    // Test 1: Latest quote request
    console.log('Testing Alpaca API connection...');
    console.log('API URL:', baseUrl);
    console.log('API Key:', apiKey.substring(0, 5) + '***');

    const quoteData = await getLatestQuote('AAPL');

    // Test 2: Historical data request (last 30 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    let historyData = [];
    let historyError = null;
    
    try {
      historyData = await getHistoricalBars(
        'AAPL', 
        '1Day', 
        startDate.toISOString().split('T')[0], 
        endDate.toISOString().split('T')[0]
      );
    } catch (err) {
      historyError = err instanceof Error ? err.message : 'Unknown error';
      console.error('History fetch error:', err);
    }

    return NextResponse.json({
      success: true,
      data: {
        message: 'Alpaca API connection successful',
        apiUrl: baseUrl,
        apiKeyPrefix: apiKey.substring(0, 5) + '***',
        tests: {
          latestQuote: {
            success: !!quoteData,
            data: quoteData,
          },
          historicalData: {
            success: historyData.length > 0,
            count: historyData.length,
            sample: historyData.slice(0, 3), // First 3 bars
            error: historyError,
          },
        },
      },
    });
  } catch (error) {
    console.error('Alpaca API test failed:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Alpaca API test failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: error,
    }, { status: 500 });
  }
}
