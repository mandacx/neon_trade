import type { Metadata } from 'next';
import Link from 'next/link';
import LegalPage from '@/components/layout/LegalPage';

export const metadata: Metadata = {
  title: 'About - StocksTrendz',
  description: 'StocksTrendz is a US stock and options analysis platform: option-open-interest price levels, candlestick charts, scanners and earnings tracking.',
};

export default function AboutPage() {
  return (
    <LegalPage title="About StocksTrendz">
      <p>
        StocksTrendz is a stock and options analysis web application for US markets. It helps traders and investors
        see where option open interest clusters around a stock&apos;s price, and track related market data.
      </p>
      <h2>What the platform offers</h2>
      <ul>
        <li>Candlestick charts with price levels derived from put and call open interest, per option expiry.</li>
        <li>A quadrant view ranking stocks by how close price is to each level.</li>
        <li>Scan alerts, watchlists, an earnings tracker and an options open-interest tracker.</li>
        <li>A US market scanner over liquid stocks and ETFs, and an options chain with a strategy builder.</li>
        <li>Crypto price levels.</li>
      </ul>
      <h2>Data</h2>
      <p>
        Market data comes from licensed market-data providers and is shown with the delays noted on each page.
        Some features are free; others require a paid plan (see <Link href="/upgrade">Plans</Link>).
      </p>
      <h2>Not investment advice</h2>
      <p>
        StocksTrendz is an analysis tool. It is not a broker-dealer or a registered investment adviser, does not
        execute trades, and does not provide personalized investment advice. See the <Link href="/terms">Terms of Use</Link>.
      </p>
      <h2>Contact</h2>
      <p>Questions? See our <Link href="/contact">Contact</Link> page.</p>
    </LegalPage>
  );
}
