/**
 * Universe membership rules (pure, dependency-free; tested by scripts/test-us-scanner.mjs).
 * Liquid = last close >= $5 and 20-session average dollar volume >= $50M, on consolidated volume.
 * $10M let in ~3,500 names; $50M gives ~1,900 (chosen 2026-10-23, see docs/us-scanner.md).
 */

export const LIQUID_MIN_PRICE = 5;
export const LIQUID_MIN_DOLLAR_VOL = 50_000_000;
const LIQUIDITY_SESSIONS = 20;

/** 20-session liquidity from ascending daily bars (pure; exported for tests). */
export function liquidityFrom(bars: Array<{ c: number; v: number }>): { lastClose: number | null; avgVol: number; avgDollarVol: number; n: number; liquid: boolean } {
  const last = bars.slice(-LIQUIDITY_SESSIONS).filter(b => b.c > 0);
  if (last.length === 0) return { lastClose: null, avgVol: 0, avgDollarVol: 0, n: 0, liquid: false };
  const avgVol = last.reduce((s, b) => s + (Number(b.v) || 0), 0) / last.length;
  const avgDollarVol = last.reduce((s, b) => s + b.c * (Number(b.v) || 0), 0) / last.length;
  const lastClose = last[last.length - 1].c;
  // Fewer than 10 sessions (new listing) is too little to call liquid yet; index members are included anyway.
  const liquid = last.length >= 10 && lastClose >= LIQUID_MIN_PRICE && avgDollarVol >= LIQUID_MIN_DOLLAR_VOL;
  return { lastClose, avgVol, avgDollarVol, n: last.length, liquid };
}

