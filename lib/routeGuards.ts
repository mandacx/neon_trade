import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getCurrentUserContext, type CurrentUserContext } from '@/lib/appUsers';
import { hasFeature } from '@/lib/features';

/**
 * For Server Component pages/layouts. Redirects (never returns) if the
 * requirement isn't met: to /login if logged out, to /upgrade?feature=X if
 * logged in but lacking the feature. Returns the resolved context otherwise,
 * for the page to reuse without a second DB round-trip.
 */
export async function requireFeaturePage(feature: string): Promise<CurrentUserContext> {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn) redirect('/login');
  if (!hasFeature(ctx.features, feature)) redirect(`/upgrade?feature=${encodeURIComponent(feature)}`);
  return ctx;
}

/**
 * For Route Handlers. Returns `{ ctx, blocked: null }` when allowed, or
 * `{ ctx, blocked: <NextResponse> }` to return immediately (a redirect isn't
 * appropriate for a JSON API — fetch() callers expect a 401/403 JSON body).
 */
export async function requireFeatureApi(feature: string): Promise<{ ctx: CurrentUserContext; blocked: NextResponse | null }> {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn) {
    return { ctx, blocked: NextResponse.json({ success: false, error: 'Login required' }, { status: 401 }) };
  }
  if (!hasFeature(ctx.features, feature)) {
    return { ctx, blocked: NextResponse.json({ success: false, error: 'Upgrade required', feature }, { status: 403 }) };
  }
  return { ctx, blocked: null };
}
