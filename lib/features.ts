// Feature-code registry. This module is dependency-free (no lib/db.ts import)
// so it's safe to import from any runtime, including middleware.
//
// The plan -> feature mapping is NOT here — it lives in the `plans.features`
// column in Postgres (see scripts/bootstrap-app-tables.mjs), editable
// directly without a redeploy. These constants are just the shared
// vocabulary both the DB rows and the route/nav gating checks use.
//
// Unlike neon_nifty (which sells Index/Stocks plans separately), this app is
// single-asset-class, so there's no group split — just FREE vs PRO.

/** Gates the /stock/* nav item and page, which stay free. The premium part of
 * that page is the *levels*, gated separately by FEATURE_LEVELS below. */
export const FEATURE_STOCK_ANALYSIS = 'stock_analysis';
/** Latest put/call levels; without it, levels are LEVEL_DELAY_DAYS delayed. */
export const FEATURE_LEVELS = 'levels';
export const FEATURE_SCAN_ALERTS_LATEST = 'scan_alerts_latest';
export const FEATURE_SCAN_ALERTS_HISTORY = 'scan_alerts_history';
export const FEATURE_QUADRANT = 'quadrant';
export const FEATURE_WATCHLISTS = 'watchlists';
export const FEATURE_PERFORMANCE = 'performance';
export const FEATURE_TELEGRAM_ALERTS = 'telegram_alerts';

/** True if `features` (a plan's feature-code list) includes `code`. */
export function hasFeature(features: string[] | undefined | null, code: string): boolean {
  return !!features?.includes(code);
}

/**
 * All known feature codes + display labels, for the admin plan editor, the
 * /upgrade comparison table and the /profile entitlement list.
 */
export const ALL_FEATURES: Array<{ code: string; label: string }> = [
  { code: FEATURE_STOCK_ANALYSIS, label: 'Charts & Stock Analysis' },
  { code: FEATURE_LEVELS, label: 'Price Levels (live)' },
  { code: FEATURE_SCAN_ALERTS_LATEST, label: 'Latest Scan Alerts' },
  { code: FEATURE_SCAN_ALERTS_HISTORY, label: 'Historical Scan Alerts' },
  { code: FEATURE_QUADRANT, label: 'Quadrant Analysis' },
  { code: FEATURE_WATCHLISTS, label: 'Custom Watchlists' },
  { code: FEATURE_PERFORMANCE, label: 'Performance Tracking' },
  { code: FEATURE_TELEGRAM_ALERTS, label: 'Telegram Alerts' },
];

// Route gating lives in exactly two places: middleware.ts (login) and the
// per-section layout.tsx / route.ts guards in lib/routeGuards.ts. Level
// gating lives in lib/levelAccess.ts. Don't add a fourth.
