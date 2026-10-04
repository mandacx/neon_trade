export type EarningsOutcome = 'beat' | 'miss' | 'inline';
export type EarningsTime = 'pre-market' | 'post-market' | 'during-market' | null;

/** A scheduled (not yet reported) earnings date. */
export interface UpcomingEarnings {
  date: string; // 'YYYY-MM-DD', US/Eastern calendar date
  time: EarningsTime;
  epsEstimate: number | null;
  /** Calendar days from today (US/Eastern); 0 = today. */
  daysUntil: number;
}

/** A reported quarter. */
export interface EarningsResult {
  date: string;
  time: EarningsTime;
  period: string | null; // 'Q2', 'H1', 'FY'
  fiscalDateEnding: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  epsSurprisePct: number | null;
  epsOutcome: EarningsOutcome | null;
  epsAdjusted: boolean | null;
  salesActual: number | null;
  salesEstimate: number | null;
  salesOutcome: EarningsOutcome | null;
  source: 'alpaca_news' | 'alphavantage';
}

export interface EarningsSummary {
  symbol: string;
  next: UpcomingEarnings | null;
  last: EarningsResult | null;
  /** A scheduled date that has passed with no result stored yet. */
  pending: { date: string; time: EarningsTime } | null;
}

/** Item for event lists (watchlist alerts widget). */
export interface EarningsEvent {
  symbol: string;
  kind: 'upcoming' | 'reported';
  date: string;
  time: EarningsTime;
  daysUntil: number; // negative for past events
  epsEstimate: number | null;
  epsActual: number | null;
  epsSurprisePct: number | null;
  epsOutcome: EarningsOutcome | null;
}
