/**
 * Neutral market-data shapes. Every caller outside lib/marketdata/provider/* uses these, never a
 * vendor's own types or field names (see lib/marketdata/index.ts).
 */

/** One OHLCV bar. `t` is an ISO instant (daily bars are stamped at 00:00 US/Eastern). */
export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  /** Number of trades, when the source reports it. */
  n?: number;
  /** Volume-weighted average price, when the source reports it. */
  vw?: number;
}

/** Latest stock snapshot: last trade, today's regular-session bar and the previous day's bar. */
export interface Snapshot {
  latestTrade?: { p: number; s: number; t: string };
  dailyBar?: { o: number; h: number; l: number; c: number; v: number; t: string };
  prevDailyBar?: { o?: number; h?: number; l?: number; c: number; v?: number; t?: string };
}

export interface OptionSnapshot {
  dailyBar?: Bar;
  prevDailyBar?: Bar;
  latestTrade?: { p: number; s: number; t: string };
  latestQuote?: { bp: number; ap: number; bs: number; as: number; t: string };
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number; rho?: number };
  impliedVolatility?: number;
}

/** One trading day from the exchange calendar; times are ET wall clock 'HH:MM'. */
export interface CalendarRow { date: string; open: string; close: string; sessionOpen: string | null; sessionClose: string | null }

export interface NewsArticle { id: number; headline: string; symbols: string[]; created_at: string }
