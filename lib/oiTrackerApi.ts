/**
 * Shared request handling for app/api/oi-tracker/* routes: feature gate,
 * per-user rate limit, and query-string parsing into OiScreenParams.
 */
import { NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/routeGuards';
import { FEATURE_OI_TRACKER, FEATURE_WATCHLISTS, hasFeature } from '@/lib/features';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rateLimit';
import { resolveLimit } from '@/lib/rateLimitConfig';
import type { CurrentUserContext } from '@/lib/appUsers';
import type { OiScreenParams } from '@/lib/oiTracker';
import type { ExpiryKind, OiGroupBy, OptType, ValueBasis, ValueBucket } from '@/types/oiTracker';

/** Screen/stock queries: generous for normal use, bounds a runaway client. The limit is admin-editable (lib/rateLimitConfig.ts). */
const OI_LIMITER = 'oi_tracker';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Feature gate (+ optional rate limit). Returns the context or a ready response. */
export async function guardOi(rateLimited = false): Promise<{ ctx: CurrentUserContext; blocked: NextResponse | null }> {
  const { ctx, blocked } = await requireFeatureApi(FEATURE_OI_TRACKER);
  if (blocked || !rateLimited) return { ctx, blocked };
  const { limit: cap, windowSeconds } = await resolveLimit(OI_LIMITER, false);
  const limit = await checkRateLimit(OI_LIMITER, `user:${ctx.userId}`, cap, windowSeconds);
  if (!limit.allowed) {
    return {
      ctx,
      blocked: NextResponse.json(
        { success: false, error: 'Rate limit exceeded', message: 'Too many requests, slow down for a minute.' },
        { status: 429, headers: rateLimitHeaders(limit) },
      ),
    };
  }
  return { ctx, blocked: null };
}

const pick = <T extends string>(v: string | null, allowed: readonly T[]): T | null => (v && (allowed as readonly string[]).includes(v) ? (v as T) : null);
const int = (v: string | null): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const list = (v: string | null, re: RegExp, max = 200): string[] | null => {
  if (!v) return null;
  const items = v.split(',').map(s => s.trim().toUpperCase()).filter(s => re.test(s));
  return items.length ? items.slice(0, max) : null;
};

/** Parse screen filters. Returns an error message for bad dates. */
export function parseScreenParams(sp: URLSearchParams): OiScreenParams | string {
  const to = sp.get('to') ?? '';
  const from = sp.get('from') || to;
  if (!YMD.test(from) || !YMD.test(to) || from > to) return 'from/to must be YYYY-MM-DD with from <= to';
  const expiries = sp.get('expiries')?.split(',').filter(d => YMD.test(d)).slice(0, 60) ?? null;
  return {
    from,
    to,
    groupBy: pick<OiGroupBy>(sp.get('groupBy'), ['contract', 'underlying', 'expiry', 'strike', 'date']) ?? 'contract',
    symbols: list(sp.get('symbols'), /^[A-Z][A-Z0-9.\-]{0,9}$/),
    optType: pick<OptType>(sp.get('optType'), ['call', 'put']),
    expiryFrom: YMD.test(sp.get('expiryFrom') ?? '') ? sp.get('expiryFrom') : null,
    expiryTo: YMD.test(sp.get('expiryTo') ?? '') ? sp.get('expiryTo') : null,
    expiries: expiries?.length ? expiries : null,
    expiryKind: pick<ExpiryKind>(sp.get('expiryKind'), ['weekly', 'monthly', 'quarterly']),
    dteMin: int(sp.get('dteMin')),
    dteMax: int(sp.get('dteMax')),
    direction: pick(sp.get('direction'), ['opened', 'closed', 'both'] as const) ?? 'both',
    minAbsChg: int(sp.get('minAbsChg')),
    valueBasis: pick<ValueBasis>(sp.get('valueBasis'), ['chg', 'oi']) ?? 'chg',
    valueBucket: pick<ValueBucket>(sp.get('valueBucket'), ['all', 'b', 'm', 'k']) ?? 'all',
    minValue: int(sp.get('minValue')),
    moneyness: pick(sp.get('moneyness'), ['itm', 'otm', 'all'] as const) ?? 'all',
    sector: sp.get('sector') || null,
    industry: sp.get('industry') || null,
    marketCapTier: sp.get('marketCapTier') || null,
    indexCode: sp.get('index') || null,
    watchlistId: sp.get('watchlist') || null,
    sort: sp.get('sort'),
    sortDir: sp.get('dir') === 'asc' ? 'asc' : 'desc',
    limit: int(sp.get('limit')) ?? 500,
  };
}

/**
 * Bind the watchlist filter to the caller: their own lists resolve, other users'
 * resolve empty; without the Watchlists feature the filter is ignored.
 */
export function scopeWatchlist<T extends { watchlistId?: string | null; userId?: string | null }>(params: T, ctx: CurrentUserContext): T {
  if (!params.watchlistId || !hasFeature(ctx.features, FEATURE_WATCHLISTS)) return { ...params, watchlistId: null };
  return { ...params, userId: ctx.userId };
}

export function serverError(tag: string, error: unknown) {
  console.error(`[oi-tracker] ${tag}`, error);
  return NextResponse.json(
    { success: false, error: `Failed to load ${tag}`, message: error instanceof Error ? error.message : 'Unknown error' },
    { status: 500 },
  );
}
