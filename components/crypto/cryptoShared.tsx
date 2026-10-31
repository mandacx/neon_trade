'use client';

/** Shared client pieces for the crypto pages (docs/crypto.md): formatting, expiry kinds, closest level, ticker strip. */
import { useEffect, useState } from 'react';
import Link from 'next/link';

export interface CryptoTicker {
  coin: string;
  price: number;
  index: number | null;
  mark: number | null;
  high24h: number | null;
  low24h: number | null;
  changePct24h: number | null;
  volumeUsd24h: number | null;
  at: number;
}

export type CryptoLevelName = 'put_low' | 'put_int' | 'put_high' | 'put_call_int' | 'call_low' | 'call_int' | 'call_high';
export type CryptoLevels = Record<CryptoLevelName, number | null>;

/** All seven, low to high as they normally sit. */
export const LEVEL_ORDER: CryptoLevelName[] = ['put_low', 'put_int', 'put_high', 'put_call_int', 'call_low', 'call_int', 'call_high'];
/** The five "official" levels the closest-level logic uses (same as stocks, lib/calculations.ts). */
export const CORE_LEVELS: CryptoLevelName[] = ['put_low', 'put_int', 'put_call_int', 'call_int', 'call_high'];

/** Decimals that keep ~5 significant digits: BTC 2, AVAX 3, XRP 4, TRX 5. */
export function pricePrecisionFor(price: number | null | undefined): number {
  const p = Math.abs(price ?? 0);
  if (p >= 100) return 2;
  if (p >= 10) return 3;
  if (p >= 1) return 4;
  return 5;
}

export function fmtPrice(v: number | null | undefined, precision?: number): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const d = precision ?? pricePrecisionFor(v);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`;
}

export function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
}

/** OI in contracts (coin units for BTC/ETH): up to 2 decimals, float noise removed. */
export function fmtOi(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 });
}

/** Level closest to `price` among the five core levels, as a signed fraction (price - level) / price. */
export function closestLevel(levels: CryptoLevels | null | undefined, price: number | null | undefined): { name: CryptoLevelName; price: number; pct: number } | null {
  if (!levels || !price) return null;
  let best: { name: CryptoLevelName; price: number; pct: number } | null = null;
  for (const name of CORE_LEVELS) {
    const lv = levels[name];
    if (!lv) continue;
    const pct = (price - lv) / price;
    if (!best || Math.abs(pct) < Math.abs(best.pct)) best = { name, price: lv, pct };
  }
  return best;
}

/**
 * Crypto option expiries: dailies, weeklies on Friday, monthly = last Friday of the month, quarterly =
 * last Friday of Mar / Jun / Sep / Dec. Dates are 'YYYY-MM-DD' (UTC; expiry is 08:00 UTC).
 */
export type CryptoExpiryKind = 'daily' | 'weekly' | 'monthly' | 'quarterly';
export function cryptoExpiryKind(date: string): CryptoExpiryKind {
  const d = new Date(`${date}T00:00:00Z`);
  if (d.getUTCDay() !== 5) return 'daily';
  const nextWeek = new Date(d.getTime() + 7 * 86_400_000);
  if (nextWeek.getUTCMonth() === d.getUTCMonth()) return 'weekly';
  return [2, 5, 8, 11].includes(d.getUTCMonth()) ? 'quarterly' : 'monthly';
}

export const EXPIRY_KIND_STYLE: Record<CryptoExpiryKind, string> = {
  daily: 'bg-white text-gray-700 border-gray-300',
  weekly: 'bg-gray-100 text-gray-800 border-gray-300',
  monthly: 'bg-sky-50 text-sky-800 border-sky-300',
  quarterly: 'bg-violet-50 text-violet-800 border-violet-300',
};

/** Polls /api/crypto/tickers every `ms` while the tab is visible. */
export function useCryptoTickers(ms = 5000): Record<string, CryptoTicker> {
  const [tickers, setTickers] = useState<Record<string, CryptoTicker>>({});
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const res = await fetch('/api/crypto/tickers', { cache: 'no-store' });
          const body = await res.json();
          if (!stopped && body.success) setTickers(body.data);
        } catch { /* keep the last quotes */ }
      }
      if (!stopped) timer = setTimeout(tick, ms);
    };
    tick();
    const onVisible = () => { if (document.visibilityState === 'visible') { clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [ms]);
  return tickers;
}

/** One row of live coin quotes; each links to that coin's first instrument. */
export function CryptoTickerStrip({ tickers, coins, active }: {
  tickers: Record<string, CryptoTicker>;
  coins: Array<{ coin: string; slug: string }>;
  active?: string;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
      {coins.map(({ coin, slug }) => {
        const t = tickers[coin];
        const up = (t?.changePct24h ?? 0) >= 0;
        return (
          <Link
            key={coin}
            href={`/crypto/${slug}`}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              active === coin ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <span className="font-semibold text-gray-900">{coin}</span>{' '}
            <span className="tabular-nums text-gray-700">{t ? fmtPrice(t.price) : '…'}</span>{' '}
            {t && <span className={`tabular-nums ${up ? 'text-green-600' : 'text-red-600'}`}>{fmtPct(t.changePct24h)}</span>}
          </Link>
        );
      })}
    </div>
  );
}
