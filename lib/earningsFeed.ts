/**
 * Pure rules for the structured-actuals step of the earnings sync (lib/earnings.ts, `syncStructuredActuals`): which row of a
 * feed belongs to a calendar report. No imports from the app (no path aliases), so `scripts/test-earnings-feed.mjs` can
 * load it directly. Dates are 'YYYY-MM-DD' strings; day arithmetic never goes through local time.
 */

const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export interface CalendarFigures {
  fiscalPeriod: number | null;
  expectedDate: string | null;
  currency: string | null;
  epsActual: number | null;
  salesActual: number | null;
}

/**
 * The earnings-calendar row for the report dated `reportDate` (its expected date within 3 days; the closest wins) that has
 * a reported EPS in USD, else null. A non-USD row is skipped entirely: its EPS and revenue are not dollars.
 */
export function pickFeedActuals(rows: CalendarFigures[], reportDate: string): { period: string | null; eps: number; sales: number | null } | null {
  let best: { gap: number; period: string | null; eps: number; sales: number | null } | null = null;
  for (const r of rows) {
    if (!r.expectedDate || r.epsActual === null || r.currency !== 'USD') continue;
    const gap = Math.abs(daysBetween(reportDate, r.expectedDate));
    if (gap > 3 || (best && gap >= best.gap)) continue;
    best = {
      gap,
      period: r.fiscalPeriod !== null && r.fiscalPeriod >= 1 && r.fiscalPeriod <= 4 ? `Q${r.fiscalPeriod}` : null,
      eps: r.epsActual,
      sales: r.salesActual,
    };
  }
  return best && { period: best.period, eps: best.eps, sales: best.sales };
}

/** A fallback quarter belongs to this report only when it ended 7-75 days before it (the previous quarter ended ~130 days before). */
export const QUARTER_END_MIN_DAYS = 7;
export const QUARTER_END_MAX_DAYS = 75;

/** Diluted EPS of the quarter that ended `asOf`, when that quarter is the one reported on `reportDate`; else null. */
export function pickFallbackEps(q: { asOf: string; epsDiluted: number | null }, reportDate: string): number | null {
  const days = daysBetween(q.asOf, reportDate);
  return q.epsDiluted !== null && days >= QUARTER_END_MIN_DAYS && days <= QUARTER_END_MAX_DAYS ? q.epsDiluted : null;
}
