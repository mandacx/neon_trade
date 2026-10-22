/**
 * A stock's own-session daily bars, for measuring each load date's levels against the price of the
 * same date. The EOD table's `close` for load date D is the close of session D-1 (docs/CHANGES.md,
 * 2026-10-16), so a level's proximity at the stored close is a day behind the candle drawn for D.
 * Server-only. A failure returns an empty map and callers fall back to the stored close.
 */
import { getDailyBars } from '@/lib/dailyBars';

export interface DayBar { open: number; high: number; low: number; close: number }

/**
 * Bars further from the stored close than this are not used: a split-adjusted bar against an unadjusted
 * stored close (or a bad print) would put every level at a nonsense distance. Normal day-to-day gaps are far smaller.
 */
export const MAX_BAR_DEVIATION = 0.3;

/** Daily bars by US/Eastern session date for [from, to]: past days from the stored table, today live (lib/dailyBars.ts). */
export async function getDayBars(symbol: string, from: string, to: string): Promise<Map<string, DayBar>> {
  const { bars } = await getDailyBars(symbol, from, to);
  return new Map(bars.map(b => [b.date, { open: b.open, high: b.high, low: b.low, close: b.close }]));
}

/** The bar's close when it can be trusted as the reference for a row whose stored close is `storedClose`, else null. */
export function referenceClose(bar: DayBar | undefined, storedClose: number): number | null {
  if (!bar || !(storedClose > 0)) return null;
  return Math.abs(bar.close / storedClose - 1) <= MAX_BAR_DEVIATION ? bar.close : null;
}
