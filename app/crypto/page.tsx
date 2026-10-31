'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import { getLevelColor, getLevelDisplayName } from '@/lib/utils';
import {
  CryptoTickerStrip, closestLevel, fmtCompact, fmtOi, fmtPct, fmtPrice, pricePrecisionFor, useCryptoTickers,
  type CryptoLevels, type CryptoTicker,
} from '@/components/crypto/cryptoShared';

interface InstrumentRow {
  slug: string;
  coin: string;
  settlement: string;
  label: string;
  latestTradeDate: string;
  ticker: CryptoTicker | null;
  nearest: { expiry: string; tradeDate: string; cmp: number | null; levels: CryptoLevels; callOi: number; putOi: number } | null;
}

const RELOAD_MS = 5 * 60_000;

export default function CryptoPage() {
  const [rows, setRows] = useState<InstrumentRow[] | null>(null);
  const [entitled, setEntitled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const live = useCryptoTickers();

  // Instruments and levels change once a day; reload them every few minutes, quotes poll separately.
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch('/api/crypto/instruments', { cache: 'no-store' });
        const body = await res.json();
        if (stopped) return;
        if (!body.success) throw new Error(body.error || 'Failed to load');
        setRows(body.data.instruments);
        setEntitled(body.data.entitled);
        setError(null);
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : 'Failed to load');
      }
    };
    load();
    const t = setInterval(load, RELOAD_MS);
    return () => { stopped = true; clearInterval(t); };
  }, [reloadKey]);

  const coins = useMemo(() => {
    const seen = new Map<string, string>();
    rows?.forEach(r => { if (!seen.has(r.coin)) seen.set(r.coin, r.slug); });
    return [...seen].map(([coin, slug]) => ({ coin, slug }));
  }, [rows]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="container mx-auto px-4 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">Crypto Levels</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Put / call open-interest levels for crypto options, from a daily snapshot at 08:00 UTC (option expiry time). Prices are live, 24/7.
          </p>
        </div>

        {coins.length > 0 && <div className="mb-4"><CryptoTickerStrip tickers={{ ...Object.fromEntries(rows!.filter(r => r.ticker).map(r => [r.coin, r.ticker!])), ...live }} coins={coins} /></div>}

        {!entitled && rows && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Crypto price levels are a paid feature. Prices and charts stay free.{' '}
            <Link href="/upgrade?feature=crypto_levels" className="font-semibold underline">See plans</Link>
          </div>
        )}

        {error && !rows ? (
          <ErrorDisplay error={error} onRetry={() => setReloadKey(k => k + 1)} />
        ) : !rows ? (
          <LoadingSpinner message="Loading crypto markets..." />
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">No crypto levels stored yet.</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Market</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">24h</th>
                  <th className="px-3 py-2 text-right hidden md:table-cell">24h range</th>
                  <th className="px-3 py-2 text-right hidden lg:table-cell">24h volume</th>
                  {entitled && <>
                    <th className="px-3 py-2 text-left">Nearest expiry</th>
                    <th className="px-3 py-2 text-left">Closest level</th>
                    <th className="px-3 py-2 text-right hidden md:table-cell">Put Int</th>
                    <th className="px-3 py-2 text-right hidden md:table-cell">Call Int</th>
                    <th className="px-3 py-2 text-right hidden lg:table-cell">Call / Put OI</th>
                  </>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => {
                  const t = live[r.coin] ?? r.ticker;
                  const price = t?.price ?? r.nearest?.cmp ?? null;
                  const prec = pricePrecisionFor(price);
                  const close = closestLevel(r.nearest?.levels, price);
                  return (
                    <tr key={r.slug} className="hover:bg-blue-50/40">
                      <td className="px-3 py-2">
                        <Link href={`/crypto/${r.slug}`} className="font-semibold text-blue-700 hover:underline">{r.label}</Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtPrice(price, prec)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${(t?.changePct24h ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtPct(t?.changePct24h)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 hidden md:table-cell">{fmtPrice(t?.low24h, prec)} – {fmtPrice(t?.high24h, prec)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 hidden lg:table-cell">${fmtCompact(t?.volumeUsd24h)}</td>
                      {entitled && (r.nearest ? <>
                        <td className="px-3 py-2 tabular-nums text-gray-700">{r.nearest.expiry}</td>
                        <td className="px-3 py-2">
                          {close ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full" style={{ background: getLevelColor(close.name) }} />
                              <span className="font-medium">{getLevelDisplayName(close.name)}</span>
                              <span className="tabular-nums text-gray-500">{fmtPrice(close.price, prec)} ({fmtPct(close.pct * 100)})</span>
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">{fmtPrice(r.nearest.levels.put_int, prec)}</td>
                        <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">{fmtPrice(r.nearest.levels.call_int, prec)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600 hidden lg:table-cell">{fmtOi(r.nearest.callOi)} / {fmtOi(r.nearest.putOi)}</td>
                      </> : <td colSpan={5} className="px-3 py-2 text-gray-400">No levels in the latest snapshot</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
