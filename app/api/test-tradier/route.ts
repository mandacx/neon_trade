import { NextResponse } from 'next/server';
import axios from 'axios';

export async function GET() {
  try {
    const apiKey = process.env.TRADIER_API_KEY;
    const apiUrl = process.env.TRADIER_API_URL || 'https://api.tradier.com/v1';

    if (!apiKey) {
      return NextResponse.json({
        success: false,
        error: 'TRADIER_API_KEY not configured',
      }, { status: 500 });
    }

    // Test 1: Simple quote request
    console.log('Testing Tradier API connection...');
    console.log('API URL:', apiUrl);
    console.log('API Key:', apiKey.substring(0, 5) + '***');

    const quoteResponse = await axios.get(`${apiUrl}/markets/quotes`, {
      params: { symbols: 'AAPL' },
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      timeout: 10000,
    });

    // Test 2: Historical data request
    const historyResponse = await axios.get(`${apiUrl}/markets/history`, {
      params: {
        symbol: 'AAPL',
        interval: 'daily',
        start: '2025-12-01',
        end: '2025-12-31',
      },
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      timeout: 10000,
    });

    return NextResponse.json({
      success: true,
      data: {
        message: 'Tradier API connection successful',
        apiUrl,
        apiKeyPrefix: apiKey.substring(0, 5) + '***',
        quote: quoteResponse.data,
        historySample: {
          hasData: !!historyResponse.data?.history,
          dataPoints: Array.isArray(historyResponse.data?.history?.day) 
            ? historyResponse.data.history.day.length 
            : (historyResponse.data?.history?.day ? 1 : 0),
        },
      },
    });
  } catch (error: any) {
    console.error('Tradier API test failed:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Tradier API connection failed',
      details: {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
      },
    }, { status: 500 });
  }
}
