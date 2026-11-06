/**
 * Expiry entitlement. Two restriction tiers, both features that *limit* a plan:
 *
 *  - FEATURE_STANDARD_EXPIRY_ONLY  -> 'standard':  monthly + quarterly (3rd Friday of any month).
 *  - FEATURE_QUARTERLY_EXPIRY_ONLY -> 'quarterly': 3rd Friday of Mar/Jun/Sep/Dec, plus January
 *    (the LEAPS month) of every year. Stricter, and wins when a user has both codes.
 *
 * quarterly is a subset of standard, which is a subset of everything. Everything else is a weekly.
 * Same 3rd-Friday rule as expiryKind() in lib/oiStrategies.ts and the stock page. Dependency-free
 * (no db import). Every route that serializes expiry-keyed data goes through here; do not re-derive it.
 *
 * Holiday-shifted monthlies (a Thursday because the 3rd Friday was a holiday) are listed in
 * HOLIDAY_SHIFTED_EXPIRIES; elsewhere in the app (expiryKind(), colours) they still read as weeklies.
 */
import { FEATURE_QUARTERLY_EXPIRY_ONLY, FEATURE_STANDARD_EXPIRY_ONLY, hasFeature } from '@/lib/features';
import { isThirdFridayOfMonth } from '@/lib/utils';

export type ExpiryScope = 'standard' | 'quarterly';

/** Months whose 3rd Friday a 'quarterly' viewer may see: Mar/Jun/Sep/Dec, plus January. */
export const QUARTERLY_SCOPE_MONTHS = [1, 3, 6, 9, 12] as const;

/**
 * Monthly expiries that moved to the Thursday because the 3rd Friday was a market holiday, so the
 * 3rd-Friday rule would call them weeklies. They count as the monthly (and, in Mar/Jun/Sep/Dec/Jan,
 * the quarterly) of their month for the gates only. Found by listing Thursdays (14th-20th) in
 * nt_market_expiries with no expiry on the next day: 2025-04-17 (Good Friday), 2026-06-18 and
 * 2027-06-17 (Juneteenth). Add a date here when a new holiday shift appears (the SQL predicates
 * read this list too).
 */
export const HOLIDAY_SHIFTED_EXPIRIES: readonly string[] = ['2025-04-17', '2026-06-18', '2027-06-17'];

function isMonthlyDate(dateStr: string): boolean {
  return isThirdFridayOfMonth(dateStr) || HOLIDAY_SHIFTED_EXPIRIES.includes(dateStr);
}

/** True for a monthly or quarterly expiry (`YYYY-MM-DD`). */
export function isStandardExpiry(dateStr: string): boolean {
  return isMonthlyDate(dateStr);
}

/** True for a quarterly expiry or the January expiry (`YYYY-MM-DD`). */
export function isQuarterlyScopeExpiry(dateStr: string): boolean {
  if (!isMonthlyDate(dateStr)) return false;
  return (QUARTERLY_SCOPE_MONTHS as readonly number[]).includes(Number(dateStr.slice(5, 7)));
}

/** The viewer's expiry restriction, or null when they see every expiry. Quarterly wins. */
export function expiryScope(features: string[] | null | undefined): ExpiryScope | null {
  if (hasFeature(features, FEATURE_QUARTERLY_EXPIRY_ONLY)) return 'quarterly';
  if (hasFeature(features, FEATURE_STANDARD_EXPIRY_ONLY)) return 'standard';
  return null;
}

/** Accepts a scope, or the legacy boolean (true = 'standard'); null when unrestricted. */
export function normalizeScope(scope: ExpiryScope | boolean | null | undefined): ExpiryScope | null {
  return scope === true ? 'standard' : scope || null;
}

/** Whether a date passes a scope (null = unrestricted). */
export function expiryInScope(scope: ExpiryScope | boolean | null | undefined, dateStr: string): boolean {
  const s = normalizeScope(scope);
  if (!s) return true;
  return s === 'quarterly' ? isQuarterlyScopeExpiry(dateStr) : isStandardExpiry(dateStr);
}

/**
 * SQL predicate (string form, for queries assembled by hand) for a scope on an expiry column;
 * null when unrestricted. The scope is one of two literals, never user input.
 */
export function expirySqlPredicate(scope: ExpiryScope | boolean | null | undefined, col = 'expiry_dt'): string | null {
  const s = normalizeScope(scope);
  if (!s) return null;
  const shifted = HOLIDAY_SHIFTED_EXPIRIES.map(d => `'${d}'::date`).join(', ');
  const third = `((EXTRACT(DOW FROM ${col}) = 5 AND EXTRACT(DAY FROM ${col}) BETWEEN 15 AND 21) OR ${col} IN (${shifted}))`;
  return s === 'quarterly' ? `(${third} AND EXTRACT(MONTH FROM ${col}) IN (${QUARTERLY_SCOPE_MONTHS.join(', ')}))` : third;
}

/** True when the viewer is limited to monthly/quarterly expiries or stricter (no weeklies). */
export function standardExpiryOnly(features: string[] | null | undefined): boolean {
  return expiryScope(features) !== null;
}

/** True when the viewer is limited to quarterly + January expiries (no other monthlies either). */
export function quarterlyExpiryOnly(features: string[] | null | undefined): boolean {
  return expiryScope(features) === 'quarterly';
}

/** Whether the viewer may see data for this expiry. A missing expiry is not judged here. */
export function expiryAllowed(features: string[] | null | undefined, expiry: string): boolean {
  return expiryInScope(expiryScope(features), expiry);
}

/** An expiry list as the viewer may see it. */
export function filterExpiries(features: string[] | null | undefined, expiries: string[]): string[] {
  const scope = expiryScope(features);
  return scope ? expiries.filter(e => expiryInScope(scope, e)) : expiries;
}

/** Rows keyed by an expiry, as the viewer may see them. */
export function filterByExpiry<T>(features: string[] | null | undefined, rows: T[], expiryOf: (row: T) => string | null | undefined): T[] {
  const scope = expiryScope(features);
  if (!scope) return rows;
  return rows.filter(r => {
    const e = expiryOf(r);
    return !!e && expiryInScope(scope, e);
  });
}

/** Message and body for a rejected expiry; the wording follows the viewer's tier. */
export function expiryErrorFor(features: string[] | null | undefined) {
  const quarterly = quarterlyExpiryOnly(features);
  return {
    success: false,
    error: quarterly ? 'This expiry is not available on your plan' : 'Weekly expiries are not available on your plan',
    message: quarterly
      ? 'Your plan includes quarterly (Mar/Jun/Sep/Dec) and January expiries only.'
      : 'Your plan includes monthly and quarterly expiries only.',
    feature: quarterly ? FEATURE_QUARTERLY_EXPIRY_ONLY : FEATURE_STANDARD_EXPIRY_ONLY,
  };
}
