// Stock chart settings saved per user (key `chart.settings` in nt_user_prefs, or localStorage when
// signed out). Dependency-free: the server (lib/userPrefs.ts) and the client (components/charts/
// useChartPrefs.ts) both import it. Every field falls back to its default when missing or invalid,
// so older or hand-edited saves still load and new fields need no migration.

export const CHART_PREF_KEY = 'chart.settings';

export const CHART_INTERVALS = ['1min', '5min', '15min', '30min', '1hour', 'daily'] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];

export const CHART_PERIODS = ['1D', '1W', '1M', '3M', '6M', '1Y', 'YTD', 'ALL'] as const;
export type ChartPeriod = (typeof CHART_PERIODS)[number];

export const MIN_CHART_HEIGHT = 360;
export const MAX_CHART_HEIGHT = 1200;
export const DEFAULT_CHART_HEIGHT = 600;

export interface ChartPrefs {
  interval: ChartInterval;
  /** Last picked expiry (current mode only). Used only when the stock still lists it, else the nearest expiry. */
  expiry: string | null;
  period: ChartPeriod;
  showPrice: boolean;
  showOI: boolean;
  fitLevels: boolean;
  /** "Alt" button on: Call Low and Put High are not drawn. */
  hideExtended: boolean;
  /** Chart height in px (the stock page; the embedded watchlist chart keeps its own fixed height). */
  height: number;
  /** Timeframe overlay (top-left) expanded. */
  intervalsOpen: boolean;
}

export const DEFAULT_CHART_PREFS: ChartPrefs = {
  interval: 'daily',
  expiry: null,
  period: 'ALL',
  showPrice: true,
  showOI: true,
  fitLevels: false,
  hideExtended: false,
  height: DEFAULT_CHART_HEIGHT,
  intervalsOpen: true,
};

export const clampChartHeight = (h: number) => Math.round(Math.min(MAX_CHART_HEIGHT, Math.max(MIN_CHART_HEIGHT, h)));

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** A saved value as ChartPrefs (invalid fields take their defaults), or null when it isn't an object. */
export function normalizeChartPrefs(v: unknown): ChartPrefs | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const D = DEFAULT_CHART_PREFS;
  return {
    interval: (CHART_INTERVALS as readonly unknown[]).includes(o.interval) ? (o.interval as ChartInterval) : D.interval,
    expiry: typeof o.expiry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.expiry) ? o.expiry : null,
    period: (CHART_PERIODS as readonly unknown[]).includes(o.period) ? (o.period as ChartPeriod) : D.period,
    showPrice: bool(o.showPrice, D.showPrice),
    showOI: bool(o.showOI, D.showOI),
    fitLevels: bool(o.fitLevels, D.fitLevels),
    hideExtended: bool(o.hideExtended, D.hideExtended),
    height: typeof o.height === 'number' && Number.isFinite(o.height) ? clampChartHeight(o.height) : D.height,
    intervalsOpen: bool(o.intervalsOpen, D.intervalsOpen),
  };
}
