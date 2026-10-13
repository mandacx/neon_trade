/**
 * Earnings date filters shared by the watchlists (client) and the quadrant
 * route (server). Pure and dependency-free. Dates are US/Eastern 'YYYY-MM-DD'
 * strings, stepped through UTC arithmetic — never local-time Date parsing.
 */

export type EarningsFilter =
  | '' | 'today' | 'tomorrow' | 'week' | 'nextWeek' | '7' | '14' | '30' | '60' | '90' | 'month' | 'range'
  | 'beforeExpiry' | 'afterExpiry'
  | 'reported1' | 'reported7' | 'reported14' | 'reported30'
  | 'unconfirmed' | 'confirmed' | 'none';

export const EARNINGS_FILTER_OPTIONS: { value: EarningsFilter; label: string }[] = [
  { value: '', label: 'Any' },
  { value: 'today', label: 'Reporting today' },
  { value: 'tomorrow', label: 'Reporting tomorrow' },
  { value: 'week', label: 'This week' },
  { value: 'nextWeek', label: 'Next week' },
  { value: '7', label: 'Next 7 days' },
  { value: '14', label: 'Next 14 days' },
  { value: '30', label: 'Next 30 days' },
  { value: '60', label: 'Next 60 days' },
  { value: '90', label: 'Next 90 days' },
  { value: 'month', label: 'This month' },
  { value: 'range', label: 'Custom date range…' },
  { value: 'beforeExpiry', label: 'Before selected expiry' },
  { value: 'afterExpiry', label: 'After selected expiry' },
  { value: 'reported1', label: 'Reported today / yesterday' },
  { value: 'reported7', label: 'Reported last 7 days' },
  { value: 'reported14', label: 'Reported last 14 days' },
  { value: 'reported30', label: 'Reported last 30 days' },
  { value: 'confirmed', label: 'Date confirmed' },
  { value: 'unconfirmed', label: 'Date estimated (unconfirmed)' },
  { value: 'none', label: 'No upcoming date' },
];

/** The slice of an earnings summary / badge that the filters read. */
export interface EarningsFilterInput {
  nextDate: string | null;
  nextEstimated: boolean;
  /** Most recent reported or pending-result date. */
  reportedDate: string | null;
  /** The report falls on/before the row's expiry (caller decides which expiry). */
  beforeExpiry: boolean;
}

export interface EarningsFilterContext {
  today: string;
  from?: string | null;
  to?: string | null;
}

const DAY = 86_400_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDaysET = (d: string, n: number) => ymd(ms(d) + n * DAY);
const daysFrom = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY);

/** Days left in the current Mon–Fri week (Fri → 0; on a weekend, through next Friday). */
function daysToFriday(today: string): number {
  const dow = new Date(ms(today)).getUTCDay(); // 0 Sun … 6 Sat
  return dow === 6 ? 6 : dow === 0 ? 5 : 5 - dow;
}

export function earningsFilterMatches(
  e: EarningsFilterInput | null | undefined,
  filter: EarningsFilter,
  { today, from, to }: EarningsFilterContext,
): boolean {
  if (!filter) return true;
  const next = e?.nextDate ?? null;
  const ahead = next ? daysFrom(today, next) : null;
  const sinceReport = e?.reportedDate ? daysFrom(e.reportedDate, today) : null;
  const within = (n: number) => ahead != null && ahead >= 0 && ahead <= n;
  switch (filter) {
    case 'today': return ahead === 0;
    case 'tomorrow': return ahead === 1;
    case 'week': return within(daysToFriday(today));
    case 'nextWeek': {
      const friday = daysToFriday(today);
      return ahead != null && ahead >= friday + 3 && ahead <= friday + 7;
    }
    case '7': return within(7);
    case '14': return within(14);
    case '30': return within(30);
    case '60': return within(60);
    case '90': return within(90);
    case 'month': return !!next && ahead! >= 0 && next.slice(0, 7) === today.slice(0, 7);
    case 'range': return !!next && (!from || next >= from) && (!to || next <= to);
    case 'beforeExpiry': return !!next && !!e?.beforeExpiry;
    case 'afterExpiry': return !!next && !e?.beforeExpiry;
    case 'reported1': return sinceReport != null && sinceReport >= 0 && sinceReport <= 1;
    case 'reported7': return sinceReport != null && sinceReport >= 0 && sinceReport <= 7;
    case 'reported14': return sinceReport != null && sinceReport >= 0 && sinceReport <= 14;
    case 'reported30': return sinceReport != null && sinceReport >= 0 && sinceReport <= 30;
    case 'confirmed': return !!next && !e?.nextEstimated;
    case 'unconfirmed': return !!next && !!e?.nextEstimated;
    case 'none': return !next;
  }
}
