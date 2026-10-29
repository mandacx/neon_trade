/**
 * Black-76 pricing on the forward, implied-vol solve and model greeks
 * (docs/strategy-builder.md). Port of options-alert-lab backend/app/payoff.py
 * (`_bs`, `_implied_vol`), kept dependency-free so the browser and
 * scripts/test-payoff.mjs share it.
 */

export type Right = 'C' | 'P';

export function intrinsic(right: Right, strike: number, s: number): number {
  return right === 'C' ? Math.max(s - strike, 0) : Math.max(strike - s, 0);
}

/** erf, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}

export function ncdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

const npdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/**
 * Black-76 price on the forward F = S·basis, discounted by `disc`.
 * basis = F/S = e^{(r-q)τ} and disc = e^{-rτ} for this τ; (1, 1) is zero-carry
 * Black-Scholes on spot. Falls back to discounted intrinsic at τ ≤ 0 or σ ≤ 0.
 */
export function black76(right: Right, S: number, K: number, tau: number, sigma: number, basis = 1, disc = 1): number {
  const F = S * basis;
  if (tau <= 0 || sigma <= 0 || F <= 0) return disc * intrinsic(right, K, F);
  const vol = sigma * Math.sqrt(tau);
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * tau) / vol;
  const d2 = d1 - vol;
  return right === 'C'
    ? disc * (F * ncdf(d1) - K * ncdf(d2))
    : disc * (K * ncdf(-d2) - F * ncdf(-d1));
}

/** σ that reproduces `price` (bisection, 64 steps, σ ∈ [1e-4, 5]); null outside the model's range. */
export function impliedVol(right: Right, S: number, K: number, tau: number, price: number, basis = 1, disc = 1): number | null {
  if (tau <= 0 || price <= 0 || S <= 0) return null;
  let lo = 1e-4, hi = 5;
  if (!(black76(right, S, K, tau, lo, basis, disc) <= price && price <= black76(right, S, K, tau, hi, basis, disc))) return null;
  for (let i = 0; i < 64; i++) {
    const mid = 0.5 * (lo + hi);
    if (black76(right, S, K, tau, mid, basis, disc) < price) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export interface Greeks { delta: number; gamma: number; theta: number; vega: number }

/**
 * Per-share model greeks (zero carry). Used only when the chain has no greeks
 * for a contract. theta is per calendar day, vega per 1 vol point.
 */
export function bsGreeks(right: Right, S: number, K: number, tau: number, sigma: number): Greeks | null {
  if (tau <= 0 || sigma <= 0 || S <= 0 || K <= 0) return null;
  const sq = Math.sqrt(tau);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * tau) / (sigma * sq);
  const pdf = npdf(d1);
  return {
    delta: right === 'C' ? ncdf(d1) : ncdf(d1) - 1,
    gamma: pdf / (S * sigma * sq),
    theta: -(S * pdf * sigma) / (2 * sq) / 365,
    vega: (S * pdf * sq) / 100,
  };
}
