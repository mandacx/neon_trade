/**
 * Pure indicator helpers over ascending daily series. Dependency-free (tested by
 * scripts/test-us-scanner.mjs). Every function returns null when the series is too short,
 * never a guess.
 */

export interface DayBar { date: string; o: number; h: number; l: number; c: number; v: number }

export const VOL_BASELINE = 20;
export const JUMP_PCT = 30;

export const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
export const pct = (a: number, b: number): number => (a / b - 1) * 100;

/**
 * Consecutive strictly higher (dir 1) or lower (dir -1) closes, counted back from the newest bar.
 * An unchanged close breaks the streak. `from` is the index of the bar before the streak began.
 */
export function streak(s: DayBar[], dir: 1 | -1): { len: number; from: number } {
  let len = 0;
  for (let i = s.length - 1; i > 0; i--) {
    const d = s[i].c - s[i - 1].c;
    if ((dir === 1 && d > 0) || (dir === -1 && d < 0)) len++;
    else break;
  }
  return { len, from: s.length - 1 - len };
}

/**
 * Mean volume of the last `n` bars vs the mean of the `VOL_BASELINE` bars before them. Null when the
 * window is short, the baseline has fewer than 10 bars, or the baseline mean is not positive.
 */
export function volumeRatio(s: DayBar[], n: number): number | null {
  if (s.length < n) return null;
  const recent = s.slice(-n);
  const base = s.slice(Math.max(0, s.length - n - VOL_BASELINE), s.length - n);
  if (base.length < Math.min(10, VOL_BASELINE)) return null;
  const b = mean(base.map(x => x.v));
  if (!(b > 0)) return null;
  return mean(recent.map(x => x.v)) / b;
}

/** Newest close-to-close move over JUMP_PCT within the last `lookback` bars (a likely corporate action). */
export function findJump(s: DayBar[], lookback: number): { date: string; pct: number } | null {
  const start = Math.max(1, s.length - lookback);
  for (let i = s.length - 1; i >= start; i--) {
    if (!(s[i - 1].c > 0)) continue;
    const move = pct(s[i].c, s[i - 1].c);
    if (Math.abs(move) > JUMP_PCT) return { date: s[i].date, pct: Math.round(move * 10) / 10 };
  }
  return null;
}

/** Simple moving average of the `n` values ending at index `end` (default: the last). */
export function sma(xs: number[], n: number, end = xs.length - 1): number | null {
  if (end < n - 1 || end >= xs.length) return null;
  let sum = 0;
  for (let i = end - n + 1; i <= end; i++) sum += xs[i];
  return sum / n;
}

/** % change over `n` sessions (last value vs the value n sessions earlier). */
export function roc(xs: number[], n: number): number | null {
  if (xs.length < n + 1) return null;
  const from = xs[xs.length - 1 - n];
  return from > 0 ? pct(xs[xs.length - 1], from) : null;
}

/** Average true range over the last `n` bars (simple mean of true ranges), as a % of the last close. */
export function atrPct(s: DayBar[], n = 14): number | null {
  if (s.length < n + 1) return null;
  let sum = 0;
  for (let i = s.length - n; i < s.length; i++) {
    const prev = s[i - 1].c;
    sum += Math.max(s[i].h - s[i].l, Math.abs(s[i].h - prev), Math.abs(s[i].l - prev));
  }
  const last = s[s.length - 1].c;
  return last > 0 ? (sum / n / last) * 100 : null;
}

/**
 * The newest crossing of the `fast` SMA over/under the `slow` SMA within the last `within` sessions.
 * `ago` 0 = crossed on the newest bar.
 */
export function crossWithin(closes: number[], fast: number, slow: number, within: number): { type: 'golden' | 'death'; ago: number } | null {
  const last = closes.length - 1;
  for (let ago = 0; ago < within; ago++) {
    const f1 = sma(closes, fast, last - ago), s1 = sma(closes, slow, last - ago);
    const f0 = sma(closes, fast, last - ago - 1), s0 = sma(closes, slow, last - ago - 1);
    if (f1 === null || s1 === null || f0 === null || s0 === null) return null;
    const before = f0 - s0, after = f1 - s1;
    if (before <= 0 && after > 0) return { type: 'golden', ago };
    if (before >= 0 && after < 0) return { type: 'death', ago };
  }
  return null;
}

/** Newest bar's range inside the previous bar's range (and not identical to it). */
export function insideDay(s: DayBar[]): { ratio: number } | null {
  if (s.length < 2) return null;
  const a = s[s.length - 2], b = s[s.length - 1];
  if (!(b.h <= a.h && b.l >= a.l) || (b.h === a.h && b.l === a.l)) return null;
  const prior = a.h - a.l;
  return { ratio: prior > 0 ? (b.h - b.l) / prior : 0 };
}

/**
 * Close beyond the highest high / lowest low of the `n` sessions before the newest one.
 * Returns the % beyond that level, or null when the close is inside the range or history is short.
 */
export function rangeBreakout(highs: number[], lows: number[], lastClose: number, n: number, dir: 'up' | 'down'): { level: number; beyondPct: number } | null {
  if (highs.length < n + 1 || lows.length < n + 1) return null;
  if (dir === 'up') {
    const level = Math.max(...highs.slice(-n - 1, -1));
    return lastClose > level ? { level, beyondPct: pct(lastClose, level) } : null;
  }
  const level = Math.min(...lows.slice(-n - 1, -1));
  return lastClose < level ? { level, beyondPct: pct(lastClose, level) } : null;
}

/** Percentile rank (0–100) of `v` within `values`: the share of values strictly below it. */
export function percentileRank(values: number[], v: number): number {
  if (values.length === 0) return 0;
  let below = 0;
  for (const x of values) if (x < v) below++;
  return Math.round((below / values.length) * 100);
}
