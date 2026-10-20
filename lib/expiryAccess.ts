/**
 * Expiry entitlement: plans with FEATURE_STANDARD_EXPIRY_ONLY see only monthly and quarterly
 * expiries (the 3rd Friday of a month; the quarterlies are those of Mar/Jun/Sep/Dec, so they are
 * a subset of the monthlies). Everything else is a weekly.
 *
 * Same rule as expiryKind() in lib/oiStrategies.ts and the stock page. Dependency-free (no db
 * import). Every route that serializes expiry-keyed data goes through here; do not re-derive it.
 *
 * Known edge: a monthly that moves to Thursday for a Friday market holiday is not a 3rd Friday,
 * so it counts as a weekly (as it does everywhere else in the app).
 */
import { FEATURE_STANDARD_EXPIRY_ONLY, hasFeature } from '@/lib/features';
import { isThirdFridayOfMonth } from '@/lib/utils';

/** True for a monthly or quarterly expiry (`YYYY-MM-DD`). */
export function isStandardExpiry(dateStr: string): boolean {
  return isThirdFridayOfMonth(dateStr);
}

/** True when the viewer is limited to monthly and quarterly expiries. */
export function standardExpiryOnly(features: string[] | null | undefined): boolean {
  return hasFeature(features, FEATURE_STANDARD_EXPIRY_ONLY);
}

/** Whether the viewer may see data for this expiry. A missing expiry is not judged here. */
export function expiryAllowed(features: string[] | null | undefined, expiry: string): boolean {
  return !standardExpiryOnly(features) || isStandardExpiry(expiry);
}

/** An expiry list as the viewer may see it. */
export function filterExpiries(features: string[] | null | undefined, expiries: string[]): string[] {
  return standardExpiryOnly(features) ? expiries.filter(isStandardExpiry) : expiries;
}

/** Rows keyed by an expiry, as the viewer may see them. */
export function filterByExpiry<T>(features: string[] | null | undefined, rows: T[], expiryOf: (row: T) => string | null | undefined): T[] {
  if (!standardExpiryOnly(features)) return rows;
  return rows.filter(r => {
    const e = expiryOf(r);
    return !!e && isStandardExpiry(e);
  });
}

/** Message and body for a rejected weekly expiry. */
export const WEEKLY_EXPIRY_ERROR = {
  success: false,
  error: 'Weekly expiries are not available on your plan',
  message: 'Your plan includes monthly and quarterly expiries only.',
  feature: FEATURE_STANDARD_EXPIRY_ONLY,
};
