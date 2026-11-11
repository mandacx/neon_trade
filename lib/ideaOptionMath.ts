/**
 * Trade Ideas Desk: profit and loss of an idea's OPTION STRATEGY (docs/trade-ideas.md, "Option strategy tracking").
 * Pure and dependency-free (fixtures: `node scripts/test-idea-scoring.mjs`), so it is safe in routes, components and scripts.
 *
 * What it is: the published legs priced at the moment the UNDERLYING enters (entry), at each target hit (information
 * only), at the end (exit) and at the latest read (mark). Every price is an ESTIMATE: the mid of the bid and ask when a
 * live quote exists, otherwise the last trade at or before that moment, never a fill anyone got.
 * What it is not: the idea's score. It is separate from R, never fed to `scoreIdea` and never counted in desk statistics.
 *
 * Conventions: prices are per share, a contract is 100 shares, `side` 'buy' = long the leg (+1), 'sell' = short (-1).
 * `value` of the position = sum(sign x qty x 100 x price) (> 0 is an asset). Entry value V0 > 0 is a net DEBIT paid,
 * V0 < 0 a net CREDIT received. P&L on closing at prices P = value(P) - V0. Estimated capital = the larger of the
 * max loss at expiry and the debit paid (a floor when the loss is unlimited): it is NOT a broker margin requirement
 * (Reg T / SPAN / portfolio margin depend on the account), so the return on it is "return on estimated capital".
 */

export interface OptLeg { side: 'buy' | 'sell'; type: 'call' | 'put'; strike: number; qty: number }

/** One priced moment of the strategy. `prices[i]` is the per-share estimate for `legs[i]`, or null when none could be found. */
export interface OptPoint {
  kind: 'entry' | 'target' | 'mark' | 'exit';
  /** 'entry' | 'target:T1' | 'exit' | 'latest' */
  key: string;
  /** ISO instant the prices describe. */
  at: string;
  /** The stock's price at that moment, when known. */
  underlying: number | null;
  prices: Array<number | null>;
  /** 'quote_mid' | 'quote_mid_late' | 'replay_last_trade' | 'last_trade' | 'expiry_intrinsic' | 'mixed' */
  basis: string;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const sgn = (l: OptLeg) => (l.side === 'buy' ? 1 : -1);

/** Intrinsic value per share of one leg at stock price S. */
export const intrinsicOf = (type: 'call' | 'put', strike: number, S: number) => Math.max(0, type === 'call' ? S - strike : strike - S);

/** Per-leg intrinsic prices at S (expiry settlement). */
export const intrinsicPrices = (legs: OptLeg[], S: number): number[] => legs.map(l => intrinsicOf(l.type, l.strike, S));

/** Value of the position at `prices` (null if any leg has no price). */
export function positionValue(legs: OptLeg[], prices: Array<number | null>): number | null {
  if (!legs.length || prices.length !== legs.length) return null;
  let v = 0;
  for (let i = 0; i < legs.length; i++) {
    const p = prices[i];
    if (!finite(p) || p < 0) return null;
    v += sgn(legs[i]) * legs[i].qty * 100 * p;
  }
  return v;
}

export interface ExpiryProfile {
  maxProfit: number;
  maxLoss: number;
  unboundedProfit: boolean;
  unboundedLoss: boolean;
  /** Estimated capital: max(max loss at expiry, debit paid); `floor` when the loss is unlimited. */
  capital: { value: number; floor: boolean };
}

/** Payoff at expiry given the entry value V0 (net debit > 0). Evaluated at 0, every strike, and far above to detect unlimited sides. */
export function expiryProfile(legs: OptLeg[], v0: number): ExpiryProfile | null {
  if (!legs.length || !finite(v0)) return null;
  const strikes = legs.map(l => l.strike).filter(finite);
  if (!strikes.length) return null;
  const hi = Math.max(...strikes);
  const pnlAt = (S: number) => legs.reduce((v, l) => v + sgn(l) * l.qty * 100 * intrinsicOf(l.type, l.strike, S), 0) - v0;
  // The payoff is piecewise linear with kinks at the strikes, so its extremes are at 0, a strike, or the far tail.
  const pnls = [0, ...strikes, hi * 5].map(pnlAt);
  const slope = pnlAt(hi * 10) - pnlAt(hi * 5); // != 0 only if a side never stops growing
  const unboundedProfit = slope > 1e-6;
  const unboundedLoss = slope < -1e-6;
  // When a side is unlimited the figure is the extreme at 5x the top strike: a floor, flagged.
  const maxProfit = Math.max(...pnls);
  const maxLoss = Math.min(...pnls);
  const capital = Math.max(Math.abs(Math.min(maxLoss, 0)), Math.max(v0, 0));
  return { maxProfit: round(maxProfit), maxLoss: round(maxLoss), unboundedProfit, unboundedLoss, capital: { value: round(capital), floor: unboundedLoss } };
}

export interface OptMarkView {
  key: string;
  kind: OptPoint['kind'];
  at: string;
  underlying: number | null;
  basis: string;
  /** P&L in dollars at this moment, relative to the entry; null when a leg price is missing. */
  pnl: number | null;
  /** pnl / estimated capital, in %. */
  returnPct: number | null;
  /** Per-leg prices used. */
  prices: Array<number | null>;
}

export interface OptSummary {
  /** 'pending' = the underlying has not entered; 'unpriced' = entered but no entry prices yet; 'open'; 'closed'. */
  status: 'pending' | 'unpriced' | 'open' | 'closed';
  /** 'credit' (V0 < 0) or 'debit'. */
  kind: 'credit' | 'debit' | null;
  /** Net debit (+) or credit (-) at entry, in dollars per strategy unit. */
  v0: number | null;
  profile: ExpiryProfile | null;
  entry: OptMarkView | null;
  /** Information only: the strategy marked at each target the stock reached. */
  targets: OptMarkView[];
  /** The latest mark while open. */
  latest: OptMarkView | null;
  exit: OptMarkView | null;
  /** The figure to show: the exit when closed, else the latest mark. */
  current: OptMarkView | null;
}

function view(legs: OptLeg[], v0: number, cap: number | null, p: OptPoint): OptMarkView {
  const v = positionValue(legs, p.prices);
  const pnl = v == null ? null : round(v - v0);
  return {
    key: p.key, kind: p.kind, at: p.at, underlying: p.underlying, basis: p.basis, prices: p.prices, pnl,
    returnPct: pnl != null && cap != null && cap > 0 ? round((pnl / cap) * 100, 1) : null,
  };
}

/** Everything the page needs from the stored points. `entered` comes from the OFFICIAL outcome (the stock entered). */
export function summarizeOption(legs: OptLeg[], points: OptPoint[], entered: boolean): OptSummary {
  const empty: OptSummary = { status: entered ? 'unpriced' : 'pending', kind: null, v0: null, profile: null, entry: null, targets: [], latest: null, exit: null, current: null };
  if (!entered || !legs.length) return { ...empty, status: entered ? 'unpriced' : 'pending' };
  const e = points.find(p => p.kind === 'entry');
  const v0 = e ? positionValue(legs, e.prices) : null;
  if (!e || v0 == null) return empty;
  const profile = expiryProfile(legs, v0);
  const cap = profile ? profile.capital.value : null;
  const targets = points.filter(p => p.kind === 'target').sort((a, b) => (a.key < b.key ? -1 : 1)).map(p => view(legs, v0, cap, p));
  const exitP = points.find(p => p.kind === 'exit');
  const latestP = points.find(p => p.kind === 'mark');
  const exit = exitP ? view(legs, v0, cap, exitP) : null;
  const latest = latestP ? view(legs, v0, cap, latestP) : null;
  return {
    status: exit ? 'closed' : 'open', kind: v0 < 0 ? 'credit' : 'debit', v0: round(v0), profile, entry: view(legs, v0, cap, e), targets, latest, exit,
    current: exit ?? latest ?? view(legs, v0, cap, e),
  };
}

/** Mid of a bid/ask when both exist and are sane (ask >= bid > 0); otherwise null. */
export function midOf(bid: number | null | undefined, ask: number | null | undefined): number | null {
  if (!finite(bid) || !finite(ask) || bid <= 0 || ask <= 0 || ask < bid) return null;
  return round((bid + ask) / 2, 4);
}

/** OCC option symbol, e.g. buildOcc('ISRG', '2026-12-18', 'call', 450) = 'ISRG261218C00450000'. */
export function occSymbol(underlying: string, expiry: string, type: 'call' | 'put', strike: number): string {
  const [y, m, d] = expiry.split('-');
  return `${underlying.toUpperCase()}${y.slice(2)}${m}${d}${type === 'call' ? 'C' : 'P'}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
}
