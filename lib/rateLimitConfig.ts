/**
 * Rate limits, editable by an admin at /admin/settings (stored in nt_app_settings under 'rate_limits').
 *
 * Each limiter has a `standard` limit (anonymous and unentitled users) and, where it makes sense, an
 * `entitled` limit for users with the live-levels feature (FEATURE_LEVELS). The window length is fixed
 * per limiter (60 s); the heavy-users tile reads per-minute counters, so it isn't editable.
 *
 * Defaults live here. A saved value overrides a default; deleting the setting restores the defaults.
 * Reads are cached per server instance for CACHE_MS, so a change reaches every instance within about
 * 30 s (the instance that handled the save applies it immediately).
 */
import { getSetting, setSetting, deleteSetting } from '@/lib/appSettings';
import { LEVEL_RANGE_RATE, LEVEL_POINT_RATE } from '@/lib/levelAccess';
import { MIN_LIMIT, MAX_LIMIT } from '@/lib/rateLimitTypes';
import { evaluateHit, failOpen, recordBlocked, type RateLimitResult, type RecordedHit } from '@/lib/rateLimit';

export interface LimiterDef {
  name: string;
  label: string;
  description: string;
  windowSeconds: number;
  /** Limit for everyone, and for users without the entitlement. */
  standard: number;
  /** Limit for users with the live-levels feature; null when the limiter has a single tier. */
  entitled: number | null;
}

export const LIMITERS: LimiterDef[] = [
  {
    name: LEVEL_RANGE_RATE.name,
    label: 'Level history requests',
    description: 'Chart history: opening a stock, switching expiry or scrolling back each ask for a range of daily levels. This is the call that bulk-downloads the archive, so it is the tightest.',
    windowSeconds: LEVEL_RANGE_RATE.windowSeconds,
    standard: LEVEL_RANGE_RATE.limit,
    entitled: 30,
  },
  {
    name: LEVEL_POINT_RATE.name,
    label: 'Latest-levels requests',
    description: 'The stock page header and levels for one day (one call per stock opened).',
    windowSeconds: LEVEL_POINT_RATE.windowSeconds,
    standard: LEVEL_POINT_RATE.limit,
    entitled: 120,
  },
  {
    name: 'oi_tracker',
    label: 'OI tracker requests',
    description: 'Screen, strategies and per-stock OI queries on the Options OI tracker (Pro-only, so one tier).',
    windowSeconds: 60,
    standard: 90,
    entitled: null,
  },
  {
    name: 'us_scanner',
    label: 'US Market Scanner requests',
    description: 'Scans on the US Market Scanner (Pro-only, so one tier). The page auto-refreshes every 30 s in market hours.',
    windowSeconds: 60,
    standard: 120,
    entitled: null,
  },
  {
    name: 'option_chain',
    label: 'Option chain requests',
    description: 'Live option chain for the Strategy Builder on the stock page: one per expiry opened and one per "Refresh quotes" click (Pro-only, so one tier).',
    windowSeconds: 60,
    standard: 30,
    entitled: null,
  },
];

export const RATE_LIMITS_KEY = 'rate_limits';
export { MIN_LIMIT, MAX_LIMIT };
const CACHE_MS = 30_000;

export type RateLimitValues = Record<string, { standard: number; entitled: number | null }>;

export function defaultRateLimits(): RateLimitValues {
  return Object.fromEntries(LIMITERS.map(l => [l.name, { standard: l.standard, entitled: l.entitled }]));
}

const isLimit = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= MIN_LIMIT && v <= MAX_LIMIT;

/**
 * Validate an admin's submission: every limiter present, integers within [MIN_LIMIT, MAX_LIMIT], the entitled
 * limit at least the standard one (paying users must never be stricter than everyone else), and nothing for
 * a limiter that has no entitled tier. Returns the cleaned values, or an error message.
 */
export function validateRateLimits(input: unknown): { ok: true; values: RateLimitValues } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Expected an object of limiters' };
  const src = input as Record<string, { standard?: unknown; entitled?: unknown } | undefined>;
  const values: RateLimitValues = {};
  for (const def of LIMITERS) {
    const v = src[def.name];
    if (!v) return { ok: false, error: `Missing limiter "${def.name}"` };
    if (!isLimit(v.standard)) return { ok: false, error: `${def.label}: the standard limit must be a whole number from ${MIN_LIMIT} to ${MAX_LIMIT}` };
    let entitled: number | null = null;
    if (def.entitled !== null) {
      if (!isLimit(v.entitled)) return { ok: false, error: `${def.label}: the entitled limit must be a whole number from ${MIN_LIMIT} to ${MAX_LIMIT}` };
      if (v.entitled < v.standard) return { ok: false, error: `${def.label}: the entitled limit (${v.entitled}) can't be lower than the standard limit (${v.standard})` };
      entitled = v.entitled;
    }
    values[def.name] = { standard: v.standard, entitled };
  }
  for (const name of Object.keys(src)) {
    if (!LIMITERS.some(l => l.name === name)) return { ok: false, error: `Unknown limiter "${name}"` };
  }
  return { ok: true, values };
}

/**
 * Saved limits plus the defaults of limiters added since they were saved (and without limiters that no
 * longer exist), so adding a limiter in code doesn't make the saved set invalid and silently drop every
 * admin-edited value back to the defaults. The admin save path still validates strictly.
 */
function withDefaultLimiters(saved: unknown): unknown {
  if (!saved || typeof saved !== 'object') return saved;
  const src = saved as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const def of LIMITERS) out[def.name] = src[def.name] ?? { standard: def.standard, entitled: def.entitled };
  return out;
}

let cache: { at: number; values: RateLimitValues } | null = null;

export function clearRateLimitCache(): void {
  cache = null;
}

/** The effective limits: saved values over the defaults. Falls back to the defaults if the store can't be read. */
export async function loadRateLimits(): Promise<RateLimitValues> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.values;
  let values = defaultRateLimits();
  try {
    const saved = await getSetting<unknown>(RATE_LIMITS_KEY);
    if (saved) {
      const checked = validateRateLimits(withDefaultLimiters(saved.value));
      if (checked.ok) values = checked.values;
      else console.error('rateLimitConfig: saved limits are invalid, using defaults:', checked.error);
    }
  } catch (err) {
    console.error('rateLimitConfig: could not read saved limits, using defaults', err);
  }
  cache = { at: Date.now(), values };
  return values;
}

/** Limit and window for one limiter; `entitled` selects the higher tier when the limiter has one. */
export async function resolveLimit(name: string, entitled: boolean): Promise<{ limit: number; windowSeconds: number }> {
  const def = LIMITERS.find(l => l.name === name);
  if (!def) throw new Error(`Unknown rate limiter "${name}"`);
  const v = (await loadRateLimits())[name] ?? { standard: def.standard, entitled: def.entitled };
  return { limit: entitled && v.entitled !== null ? v.entitled : v.standard, windowSeconds: def.windowSeconds };
}

/**
 * Decide a request that was counted with recordHit() (in parallel with the user lookup): pick the tier's
 * limit, evaluate, and note a rejection for the heavy-users tile. `hit` is null when the counter write
 * failed, in which case the request is let through (fail open, as checkRateLimit does).
 */
export async function applyTieredLimit(hit: RecordedHit | null, name: string, key: string, entitled: boolean): Promise<RateLimitResult> {
  const { limit, windowSeconds } = await resolveLimit(name, entitled);
  if (!hit) return failOpen(limit, windowSeconds);
  const result = evaluateHit(hit, limit);
  if (!result.allowed) await recordBlocked(name, key, hit);
  return result;
}

export interface RateLimitSettingsView {
  limiters: Array<LimiterDef & { current: { standard: number; entitled: number | null }; isCustom: boolean }>;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Fresh read for the admin page (bypasses the cache). */
export async function getRateLimitSettings(): Promise<RateLimitSettingsView> {
  clearRateLimitCache();
  const saved = await getSetting<unknown>(RATE_LIMITS_KEY).catch(() => null);
  const checked = saved ? validateRateLimits(saved.value) : null;
  const values = checked?.ok ? checked.values : defaultRateLimits();
  return {
    limiters: LIMITERS.map(l => ({
      ...l,
      current: values[l.name],
      isCustom: values[l.name].standard !== l.standard || values[l.name].entitled !== l.entitled,
    })),
    updatedAt: saved && checked?.ok ? saved.updatedAt : null,
    updatedBy: saved && checked?.ok ? saved.updatedBy : null,
  };
}

export async function saveRateLimits(values: RateLimitValues, updatedBy: string | null): Promise<void> {
  await setSetting(RATE_LIMITS_KEY, values, updatedBy);
  clearRateLimitCache();
}

export async function resetRateLimits(): Promise<void> {
  await deleteSetting(RATE_LIMITS_KEY);
  clearRateLimitCache();
}
