'use client';

import { useParams } from 'next/navigation';
import StockAnalysis from '@/components/stock/StockAnalysis';
import Header from '@/components/layout/Header';
import ErrorDisplay from '@/components/ui/ErrorDisplay';

// Real tickers are short and alphanumeric, with . - ^ for share classes and
// indices (BRK.B, BF-B, ^GSPC). Anything else never reaches the chart.
const SYMBOL_PATTERN = /^[A-Za-z0-9.\-^]{1,10}$/;

export default function StockPage() {
  const params = useParams();
  const raw = String(params?.symbol ?? '');
  const symbol = (() => { try { return decodeURIComponent(raw); } catch { return ''; } })();

  if (!SYMBOL_PATTERN.test(symbol)) {
    return (
      <>
        <Header />
        <ErrorDisplay error="Invalid symbol" onRetry={() => window.location.assign('/stock/SPY')} />
      </>
    );
  }
  return <StockAnalysis symbol={symbol} />;
}
