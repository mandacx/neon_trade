/**
 * Time-axis labels for lightweight-charts in a chosen zone (the library labels its axis in UTC).
 * Client-safe. Used by TVChart (crypto page, `axisTimeZone`) and OptionContractChart.
 */
import { TickMarkType } from 'lightweight-charts';

/**
 * Axis tick label in `timeZone`. lightweight-charts places ticks and picks their granularity on UTC
 * boundaries, so for intraday bars a "day" tick sits at UTC midnight, which is not midnight in `timeZone`.
 * Intraday ticks therefore show the clock time, and the date only for a tick that really is local midnight
 * (the month name on the 1st, the year on Jan 1). Daily bars (08:00 UTC) fall on the same local date, so
 * they use the granularity as given.
 */
export function axisTickLabel(epochSeconds: number, type: TickMarkType, intraday: boolean, timeZone: string): string {
  const d = new Date(epochSeconds * 1000);
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleString('en-US', { timeZone, hourCycle: 'h23', ...o });
  const dateLabel = (granularity: 'year' | 'month' | 'day') =>
    granularity === 'year' ? f({ year: 'numeric' }) : granularity === 'month' ? f({ month: 'short' }) : f({ day: 'numeric' });
  if (intraday) {
    if (f({ hour: '2-digit', minute: '2-digit' }) === '00:00') {
      const day = Number(f({ day: 'numeric' }));
      return dateLabel(day !== 1 ? 'day' : Number(f({ month: 'numeric' })) === 1 ? 'year' : 'month');
    }
    return type === TickMarkType.TimeWithSeconds ? f({ hour: '2-digit', minute: '2-digit', second: '2-digit' }) : f({ hour: '2-digit', minute: '2-digit' });
  }
  switch (type) {
    case TickMarkType.Year: return dateLabel('year');
    case TickMarkType.Month: return dateLabel('month');
    case TickMarkType.DayOfMonth: return dateLabel('day');
    case TickMarkType.TimeWithSeconds: return f({ hour: '2-digit', minute: '2-digit', second: '2-digit' });
    default: return f({ hour: '2-digit', minute: '2-digit' });
  }
}

/** Crosshair time label in `timeZone`: date and time for intraday bars, the date for daily ones. */
export function axisCrosshairLabel(epochSeconds: number, intraday: boolean, timeZone: string): string {
  const d = new Date(epochSeconds * 1000);
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleString('en-US', { timeZone, hourCycle: 'h23', ...o });
  if (!intraday) return f({ day: 'numeric', month: 'short', year: 'numeric' });
  return `${f({ day: 'numeric' })} ${f({ month: 'short' })} '${f({ year: '2-digit' })} ${f({ hour: '2-digit', minute: '2-digit' })}`;
}
