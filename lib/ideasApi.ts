/**
 * Shared request handling for app/api/ideas/* routes: sign-in, plan gate (any idea term, or publisher),
 * and a per-user rate limit (admin-editable limiter "ideas", lib/rateLimitConfig.ts).
 */
import { NextResponse } from 'next/server';
import { getCurrentUserContext, type CurrentUserContext } from '@/lib/appUsers';
import { FEATURE_IDEAS_LONG_TERM, FEATURE_IDEAS_SHORT_TERM, FEATURE_PUBLISH_IDEAS } from '@/lib/features';
import { ideaAccess, IdeaError, type IdeaAccess } from '@/lib/ideas';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rateLimit';
import { resolveLimit } from '@/lib/rateLimitConfig';

const LIMITER = 'ideas';

export type IdeaGuard =
  | { ctx: CurrentUserContext; access: IdeaAccess; blocked: null }
  | { ctx: CurrentUserContext; access: IdeaAccess; blocked: NextResponse };

export async function guardIdeas(opts: { publish?: boolean; rateLimited?: boolean } = {}): Promise<IdeaGuard> {
  const ctx = await getCurrentUserContext();
  const access = ideaAccess(ctx);
  const deny = (status: number, body: Record<string, unknown>): IdeaGuard => ({ ctx, access, blocked: NextResponse.json({ success: false, ...body }, { status }) });
  if (!ctx.loggedIn) return deny(401, { error: 'Login required' });
  if (opts.publish) {
    if (!access.canPublish) return deny(403, { error: 'Publishing ideas is not enabled for your account', feature: FEATURE_PUBLISH_IDEAS });
  } else if (access.terms.length === 0) {
    return deny(403, { error: 'Upgrade required', feature: FEATURE_IDEAS_SHORT_TERM, features: [FEATURE_IDEAS_SHORT_TERM, FEATURE_IDEAS_LONG_TERM] });
  }
  if (opts.rateLimited !== false) {
    const { limit: cap, windowSeconds } = await resolveLimit(LIMITER, false);
    const limit = await checkRateLimit(LIMITER, `user:${ctx.userId}`, cap, windowSeconds);
    if (!limit.allowed) {
      return {
        ctx, access,
        blocked: NextResponse.json({ success: false, error: 'Rate limit exceeded', message: 'Too many requests, slow down for a minute.' }, { status: 429, headers: rateLimitHeaders(limit) }),
      };
    }
  }
  return { ctx, access, blocked: null };
}

/** Map a thrown IdeaError to a JSON response; anything else is a logged 500 with no detail leaked. */
export function ideaErrorResponse(label: string, error: unknown): NextResponse {
  if (error instanceof IdeaError) {
    return NextResponse.json({ success: false, error: error.message, ...(error.details ? { details: error.details } : {}) }, { status: error.status });
  }
  console.error(`[ideas] ${label} failed`, error);
  return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
}

export async function readJson(request: Request): Promise<any | null> {
  try { return await request.json(); } catch { return null; }
}
