'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isUsMarketHours } from '@/lib/utils';

interface IndexQuote {
  symbol: string;
  label: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
}

// Every page renders its own <Header>, so this remounts on each navigation.
// Keeping the last response at module level lets the strip paint instantly
// from it instead of flashing empty while the next fetch is in flight.
let lastIndices: IndexQuote[] = [];

// Compact one-line market indices row shown under the nav on every page.
export default function IndicesStrip() {
  const [indices, setIndices] = useState<IndexQuote[]>(lastIndices);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    function poll() {
      fetch('/api/market/indices')
        .then(r => r.json())
        .then(res => {
          if (cancelled || !res.success) return;
          lastIndices = res.data;
          setIndices(res.data);
        })
        .catch(() => {})
        .finally(() => {
          if (cancelled) return;
          // Fast while the market is open; the quotes can't move otherwise.
          timeoutId = setTimeout(poll, isUsMarketHours(new Date()) ? 30_000 : 5 * 60_000);
        });
    }

    poll();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, []);

  if (indices.length === 0) return null;

  return (
    <div className="border-t border-gray-100 bg-gray-50">
      <div className="container mx-auto px-4">
        <div className="flex items-stretch gap-2 py-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {indices.map(idx => {
            const pct = idx.changePercent;
            const color = pct == null ? 'text-gray-500' : pct >= 0 ? 'text-green-600' : 'text-red-600';
            const bg = pct == null ? 'bg-white border-gray-200' : pct >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200';
            return (
              <Link
                key={idx.symbol}
                href={`/stock/${idx.symbol}`}
                title={idx.label}
                className={`${bg} flex-1 min-w-[190px] flex items-baseline justify-center gap-2 border rounded px-2 py-1 text-xs leading-tight hover:shadow-sm transition-shadow`}
              >
                <span className="font-bold text-gray-800">{idx.symbol}</span>
                <span className="font-semibold text-gray-900">{idx.price != null ? idx.price.toFixed(2) : '—'}</span>
                {idx.change != null && (
                  <span className={`font-semibold ${color}`}>
                    {idx.change >= 0 ? '+' : '−'}{Math.abs(idx.change).toFixed(2)}
                  </span>
                )}
                <span className={`font-semibold ${color}`}>
                  {pct != null ? `(${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toFixed(2)}%)` : '—'}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
