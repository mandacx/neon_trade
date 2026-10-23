'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

export default function DiagnosticsPage() {
  const [dbHealth, setDbHealth] = useState<any>(null);
  const [marketHealth, setMarketHealth] = useState<any>(null);
  const [ohlcTest, setOhlcTest] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const runTests = async () => {
      setLoading(true);

      // Test 1: Database Health
      try {
        const dbRes = await fetch('/api/health');
        const dbData = await dbRes.json();
        setDbHealth(dbData);
      } catch (error) {
        setDbHealth({ success: false, error: String(error) });
      }

      // Test 2: Market data (quotes, daily bars, symbol search)
      try {
        const marketRes = await fetch('/api/diagnostics/market-data');
        setMarketHealth(await marketRes.json());
      } catch (error) {
        setMarketHealth({ success: false, error: String(error) });
      }

      // Test 3: OHLC Endpoint
      try {
        const ohlcRes = await fetch('/api/stocks/AAPL/ohlc');
        const ohlcData = await ohlcRes.json();
        setOhlcTest(ohlcData);
      } catch (error) {
        setOhlcTest({ success: false, error: String(error) });
      }

      setLoading(false);
    };

    runTests();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4" />
          <p className="text-lg">Running diagnostics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">System Diagnostics</h1>

        {/* Database Health */}
        <div className="mb-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span className={dbHealth?.success ? 'text-green-600' : 'text-red-600'}>
              {dbHealth?.success ? '✓' : '✗'}
            </span>
            Database Connection
          </h2>
          <pre className="bg-gray-100 p-4 rounded overflow-auto text-xs">
            {JSON.stringify(dbHealth, null, 2)}
          </pre>
        </div>

        {/* Market data health */}
        <div className="mb-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span className={marketHealth?.success ? 'text-green-600' : 'text-red-600'}>
              {marketHealth?.success ? '✓' : '✗'}
            </span>
            Market Data Connection
          </h2>
          <pre className="bg-gray-100 p-4 rounded overflow-auto text-xs">
            {JSON.stringify(marketHealth, null, 2)}
          </pre>
        </div>

        {/* OHLC Test */}
        <div className="mb-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span className={ohlcTest?.success ? 'text-green-600' : 'text-red-600'}>
              {ohlcTest?.success ? '✓' : '✗'}
            </span>
            OHLC Endpoint (AAPL)
          </h2>
          <pre className="bg-gray-100 p-4 rounded overflow-auto text-xs max-h-96">
            {JSON.stringify(ohlcTest, null, 2)}
          </pre>
          {ohlcTest?.success && ohlcTest?.data?.data?.length > 0 && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded">
              <p className="text-green-800 font-semibold">
                ✓ Successfully fetched {ohlcTest.data.data.length} daily data points
              </p>
              <p className="text-sm text-green-700 mt-2">
                Date range: {ohlcTest.data.from} to {ohlcTest.data.to}
              </p>
            </div>
          )}
        </div>

        <div className="text-center">
          <Link
            href="/"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors inline-block"
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
