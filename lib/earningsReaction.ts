/**
 * Price reaction to an earnings report, from split-adjusted daily closes.
 * Pure and dependency-free. Dates are US/Eastern 'YYYY-MM-DD' strings.
 *
 * The report's session decides which two closes bracket the move:
 *   pre-market / during-market  prior close  -> close on the report date
 *   post-market                 close on the report date -> next close
 *   unknown session             prior close  -> close the day after (spans both)
 * The first close is the reference ("pre-report") close; `sincePct` measures from
 * it to the live price, so it is the whole move since the report.
 */
import type { EarningsTime } from '@/types/earnings';

export interface DailyClose { date: string; close: number }

export interface Reaction {
  /** Close-to-close % move bracketing the report; null until the second close exists. */
  reactionPct: number | null;
  /** Reference (pre-report) close and its session date. */
  refClose: number | null;
  refDate: string | null;
  /** % move from the reference close to `ltp`. */
  sincePct: number | null;
}

const NONE: Reaction = { reactionPct: null, refClose: null, refDate: null, sincePct: null };
const pct = (to: number, from: number) => (from ? (to / from - 1) * 100 : null);

/** `bars` ascending by date. */
export function computeReaction(bars: DailyClose[] | undefined, reportDate: string, time: EarningsTime, ltp: number | null): Reaction {
  if (!bars || bars.length === 0) return NONE;
  const i = bars.findIndex(b => b.date >= reportDate);
  if (i === -1) return NONE; // report date is after the newest bar
  const onDay = bars[i].date === reportDate;
  let ref: DailyClose | undefined;
  let after: DailyClose | undefined;
  if (time === 'post-market') {
    if (!onDay) return NONE;
    ref = bars[i];
    after = bars[i + 1];
  } else if (time === 'pre-market' || time === 'during-market') {
    ref = bars[i - 1];
    after = onDay ? bars[i] : undefined;
  } else {
    ref = bars[i - 1];
    after = onDay ? bars[i + 1] : undefined;
  }
  if (!ref) return NONE;
  return {
    reactionPct: after ? pct(after.close, ref.close) : null,
    refClose: ref.close,
    refDate: ref.date,
    sincePct: ltp != null ? pct(ltp, ref.close) : null,
  };
}
