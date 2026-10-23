/**
 * Split / reverse-split detection for stored daily bars. Pure and dependency-free (tested by
 * scripts/test-us-scanner.mjs).
 *
 * Stored bars are split-adjusted as of the day they were pulled. After a split the feed re-adjusts
 * every earlier day, so a fresh fetch of days we already hold comes back scaled by the split ratio.
 * The daily top-up re-requests a few already-stored sessions (the overlap) and compares closes:
 * when EVERY overlap day moved by more than `minDiff` and all by the same ratio (within `tolerance`),
 * the stored history is stale and must be re-pulled. A single revised print, or noise, is not a split.
 */

export interface CloseOnDate { date: string; close: number }

export interface Rebase {
  /** fresh / stored close, e.g. 0.5 after a 2:1 split, 10 after a 1:10 reverse split. */
  ratio: number;
  days: number;
}

export function detectRebase(
  stored: CloseOnDate[],
  fresh: CloseOnDate[],
  opts: { minDiff?: number; tolerance?: number; minDays?: number } = {},
): Rebase | null {
  const minDiff = opts.minDiff ?? 0.005;
  const tolerance = opts.tolerance ?? 0.01;
  const minDays = opts.minDays ?? 2;
  const byDate = new Map(stored.filter(s => s.close > 0).map(s => [s.date, s.close]));
  const ratios: number[] = [];
  for (const f of fresh) {
    const old = byDate.get(f.date);
    if (old && f.close > 0) ratios.push(f.close / old);
  }
  if (ratios.length < minDays) return null;
  if (!ratios.every(r => Math.abs(r - 1) > minDiff)) return null;
  const sorted = [...ratios].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!ratios.every(r => Math.abs(r / median - 1) <= tolerance)) return null;
  return { ratio: median, days: ratios.length };
}
