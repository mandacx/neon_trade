export type EarningsOutcome = 'beat' | 'miss' | 'inline';
export type EarningsTime = 'pre-market' | 'post-market' | 'during-market' | null;

/** A scheduled (not yet reported) earnings date. */
export interface UpcomingEarnings {
  date: string; // 'YYYY-MM-DD', US/Eastern calendar date
  time: EarningsTime;
  epsEstimate: number | null;
  /** Calendar days from today (US/Eastern); 0 = today. */
  daysUntil: number;
  /**
   * True when the source gave no session (BMO/AMC). Alpha Vantage only sets a
   * session once the company has announced the date, so a blank one is treated
   * as a projected, unconfirmed date.
   */
  estimated: boolean;
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
  /** Where the result came from: a results headline ('news') or the earnings calendar feed. */
  source: 'news' | 'calendar';
}

export interface EarningsSummary {
  symbol: string;
  next: UpcomingEarnings | null;
  last: EarningsResult | null;
  /** A scheduled date that has passed with no result stored yet. */
  pending: { date: string; time: EarningsTime } | null;
}

/**
 * Compact per-row earnings flag for list/ladder surfaces (quadrant, scan
 * alerts, home). `beforeExpiry` is relative to that row's own expiry.
 */
export interface EarningsBadge {
  nextDate: string | null;
  nextTime: EarningsTime;
  nextEstimated: boolean;
  daysUntil: number | null;
  beforeExpiry: boolean;
  lastDate: string | null;
  lastOutcome: EarningsOutcome | null;
  lastSurprisePct: number | null;
}

/** Item for event lists (watchlist alerts widget). */
export interface EarningsEvent {
  symbol: string;
  kind: 'upcoming' | 'reported';
  date: string;
  time: EarningsTime;
  daysUntil: number; // negative for past events
  estimated?: boolean; // upcoming only: date not yet confirmed by the company
  epsEstimate: number | null;
  epsActual: number | null;
  epsSurprisePct: number | null;
  epsOutcome: EarningsOutcome | null;
}

/** One line of the Earnings page: an upcoming date, a stored result, or a passed date still awaiting its result. */
export interface EarningsRangeRow {
  symbol: string;
  /** `pending`: the scheduled date has passed but no results headline is stored yet. */
  kind: 'upcoming' | 'reported' | 'pending';
  date: string;
  time: EarningsTime;
  /** Upcoming only: the company hasn't confirmed the date. */
  estimated: boolean;
  daysUntil: number; // negative for past
  period: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
  epsSurprisePct: number | null;
  epsOutcome: EarningsOutcome | null;
  salesEstimate: number | null;
  salesActual: number | null;
  salesSurprisePct: number | null;
  salesOutcome: EarningsOutcome | null;
}
