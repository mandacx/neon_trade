// Which tickers the header index strip and the crypto ticker strip show, saved per user (keys
// `strip.indices` / `strip.crypto` in nt_user_prefs, or localStorage when signed out). The value is the
// list of HIDDEN symbols, so a ticker added later shows up by default. Dependency-free: the server
// (lib/userPrefs.ts) and the client (components/ui/useStripPrefs.ts) both import it.

export const STRIP_PREF_KEYS = ['strip.indices', 'strip.crypto'] as const;
export type StripPrefKey = (typeof STRIP_PREF_KEYS)[number];

export interface StripPrefs { hidden: string[] }
export const DEFAULT_STRIP_PREFS: StripPrefs = { hidden: [] };

/** Symbols look like SPX, BTC, BRK.B; anything else is dropped. Null when `v` isn't a strip preference. */
export function normalizeStripPrefs(v: unknown): StripPrefs | null {
  if (!v || typeof v !== 'object' || !Array.isArray((v as StripPrefs).hidden)) return null;
  const hidden = [...new Set((v as StripPrefs).hidden.filter((s): s is string => typeof s === 'string' && /^[A-Za-z0-9.\-]{1,16}$/.test(s)).map(s => s.toUpperCase()))].slice(0, 100);
  return { hidden };
}
