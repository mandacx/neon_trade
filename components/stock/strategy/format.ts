// Number formatting for the Strategy Builder.

/** Whole dollars with sign handled by the caller: $1,234 / −$1,234. */
export function fmtMoney(v: number): string {
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** Signed whole dollars: +$1,234 / −$1,234 / $0. */
export function fmtSignedMoney(v: number): string {
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** 0.4567 → "45.7%". */
export const fmtPct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;

/** Option price: 2 decimals, 3 below $0.10. */
export const fmtPx = (v: number | null | undefined) => (v == null ? '—' : v < 0.1 ? v.toFixed(3) : v.toFixed(2));

export const fmtStrike = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ''));
