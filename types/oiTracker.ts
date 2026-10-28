// Shared types for the OI tracker (lib/oiTracker.ts, app/api/oi-tracker/*,
// app/oi-tracker). See docs/oi-tracker.md.

export type OptType = 'call' | 'put';
export type OiGroupBy = 'contract' | 'underlying' | 'expiry' | 'strike' | 'date';
export type ExpiryKind = 'weekly' | 'monthly' | 'quarterly';
export type ValueBucket = 'all' | 'b' | 'm' | 'k';
export type ValueBasis = 'chg' | 'oi';
export type SideHint = { side: 'BTO' | 'STO' | null; reason: string };

/** One option contract, aggregated over the selected load dates. */
export interface OiContractRow {
  contract: string;
  underlying: string;
  expiry: string;
  optType: OptType;
  strike: number;
  dte: number;
  /** Underlying close on the last load date in range. */
  close: number;
  /** Option LTP from the report, last load date in range. */
  ltp: number;
  /** OI on the last load date in range. */
  oi: number;
  /** Sum of OI change over the range (+ opened, - closed). */
  oiChg: number;
  /** OI change as % of the OI before it: how new the position is. Null when the start OI is 0. */
  newPct: number | null;
  /** Sum of oi_chg x 100 x ltp per load date. */
  chgValue: number;
  /** oi x 100 x ltp (last load date). */
  oiValue: number;
  /** oi x 100 x underlying close: the stock exposure the OI controls. */
  notional: number;
  /** (strike - close) / close, %. */
  moneynessPct: number;
  itm: boolean;
  /** Volume of the session(s) behind the OI change; null when not captured. */
  vol: number | null;
  /** vol / |oiChg|: ~1 = mostly opening/closing flow, >>1 = churn. */
  volToChg: number | null;
  /** Session bar of the latest load's OI change (open/close/vwap), for the side hint. */
  sessOpen: number | null;
  sessClose: number | null;
  days: number;
  firstLoad: string;
  lastLoad: string;
  /** The trading session whose activity produced the OI change (the day before the load date); the latest one in the range. */
  tradeDate: string;
  /** The earliest such session in the range (equals tradeDate for a single load). */
  firstTradeDate: string;
  hint: SideHint | null;
}

/** Aggregate row for underlying / expiry / strike / date grouping. */
export interface OiGroupRow {
  key: string;
  underlying: string | null;
  expiry: string | null;
  strike: number | null;
  loadDate: string | null;
  /** The session behind a per-date row (the trading day before its load date); null for other groupings. */
  tradeDate: string | null;
  close: number | null;
  callOpened: number;
  callClosed: number;
  putOpened: number;
  putClosed: number;
  callChg: number;
  putChg: number;
  netChg: number;
  callChgValue: number;
  putChgValue: number;
  chgValue: number;
  absChgValue: number;
  callOi: number;
  putOi: number;
  oiValue: number;
  /** Put opened / call opened contracts. */
  pcOpened: number | null;
  vol: number | null;
  contracts: number;
  topContract: string | null;
  topChg: number | null;
}

export interface OiSummary {
  contracts: number;
  underlyings: number;
  opened: number;
  closed: number;
  openedValue: number;
  closedValue: number;
  callChgValue: number;
  putChgValue: number;
  vol: number | null;
}

export interface OiScreenResult {
  from: string;
  to: string;
  loadDates: string[];
  groupBy: OiGroupBy;
  rows: OiContractRow[] | OiGroupRow[];
  summary: OiSummary;
  truncated: boolean;
  volumeCoverage: { loads: number; withVolume: number };
}

export interface StrategyLeg {
  contract: string;
  optType: OptType;
  strike: number;
  expiry: string;
  oiChg: number;
  ltp: number;
  chgValue: number;
  vol: number | null;
}

export type StrategyKind =
  | 'iron_condor' | 'iron_butterfly' | 'butterfly' | 'vertical' | 'strike_roll' | 'straddle'
  | 'strangle' | 'type_switch' | 'calendar' | 'expiry_roll' | 'diagonal' | 'ratio';

export interface StrategyCandidate {
  id: string;
  underlying: string;
  loadDate: string;
  /** The session behind the load date (the trading day before it). */
  tradeDate?: string;
  close: number;
  kind: StrategyKind;
  label: string;
  /** opened = all legs' OI rose, closed = all fell, rolled = mixed signs. */
  status: 'opened' | 'closed' | 'rolled';
  legs: StrategyLeg[];
  /** Largest relative difference between the quantities that should match, %. */
  qtyDiffPct: number;
  totalValue: number;
  confidence: number;
  note: string;
}

export interface TrackedPosition {
  id: string;
  contract: string;
  underlying: string;
  expiry: string;
  optType: OptType;
  strike: number;
  side: 'BTO' | 'STO';
  qty: number;
  entryDate: string;
  entryPrice: number;
  entryUnderlying: number | null;
  strategyGroup: string | null;
  strategyLabel: string | null;
  note: string | null;
  closedAt: string | null;
  exitPrice: number | null;
  createdAt: string;
  // Performance (filled by getTrackedPerformance)
  currentPrice: number | null;
  priceSource: 'live' | 'last_bar' | 'intrinsic' | 'exit' | null;
  currentUnderlying: number | null;
  pnl: number | null;
  pnlPct: number | null;
  underlyingChgPct: number | null;
  daysHeld: number;
  expired: boolean;
}
