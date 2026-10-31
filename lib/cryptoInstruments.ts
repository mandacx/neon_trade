/**
 * Crypto instruments: slugs, labels, the day key and chart intervals (docs/crypto.md).
 * Client-safe: no data-source code or names here, so pages and components can import it.
 *
 * An instrument is one options market: a coin plus the currency its options settle in. BTC and ETH
 * have two (coin-settled and USDC-settled), the others only USDC. Both markets of a coin share one
 * underlying price, but their open interest and so their levels differ.
 */

export interface CryptoInstrument {
  slug: string;
  coin: string;
  settlement: string;
  label: string;
}

/** `btc` for BTC options settled in BTC, `btc-usdc` for the USDC-settled ones. */
export function instrumentSlug(coin: string, settlement: string): string {
  return (coin === settlement ? coin : `${coin}-${settlement}`).toLowerCase();
}

/** Inverse of instrumentSlug; null for anything that isn't letters/digits with an optional `-SETTLEMENT`. */
export function parseInstrumentSlug(slug: string): { coin: string; settlement: string } | null {
  const m = /^([a-z0-9]{2,10})(?:-([a-z0-9]{2,10}))?$/i.exec(slug);
  if (!m) return null;
  const coin = m[1].toUpperCase();
  return { coin, settlement: (m[2] ?? m[1]).toUpperCase() };
}

export function instrumentLabel(coin: string, settlement: string): string {
  return coin === settlement ? `${coin} · coin-settled` : `${coin} · ${settlement}`;
}

export function toInstrument(coin: string, settlement: string): CryptoInstrument {
  return { slug: instrumentSlug(coin, settlement), coin, settlement, label: instrumentLabel(coin, settlement) };
}

/**
 * The crypto "day" a bar belongs to: options expire and the levels snapshot is taken at 08:00 UTC, and
 * daily candles open at 08:00 UTC, so a day runs 08:00 UTC to 08:00 UTC the next day. Levels for trade
 * date D are joined onto every bar in that window.
 */
export const CRYPTO_DAY_OFFSET_HOURS = 8;
export function cryptoDayKey(epochSeconds: number): string {
  return new Date((epochSeconds - CRYPTO_DAY_OFFSET_HOURS * 3600) * 1000).toISOString().slice(0, 10);
}

export type CryptoInterval = '5min' | '15min' | '30min' | '1hour' | 'daily';

/** initialDays = first load; chunkDays = each scroll-back load (same idea as the stock page). */
export const CRYPTO_INTERVALS: Record<CryptoInterval, { label: string; initialDays: number; chunkDays: number }> = {
  '5min': { label: '5m', initialDays: 3, chunkDays: 3 },
  '15min': { label: '15m', initialDays: 8, chunkDays: 8 },
  '30min': { label: '30m', initialDays: 16, chunkDays: 16 },
  '1hour': { label: '1H', initialDays: 30, chunkDays: 30 },
  daily: { label: '1D', initialDays: 120, chunkDays: 180 },
};
export const CRYPTO_INTERVAL_ORDER: CryptoInterval[] = ['5min', '15min', '30min', '1hour', 'daily'];

export function isCryptoInterval(v: string | null): v is CryptoInterval {
  return !!v && v in CRYPTO_INTERVALS;
}
