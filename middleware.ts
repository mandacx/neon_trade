import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/server';

// Login-required gate for every page that needs at least a signed-in
// session. This only checks "logged in or not" — the finer-grained
// feature/admin checks (e.g. Free-tier user hitting a Pro-only page) happen
// per-page via lib/routeGuards.ts::requireFeaturePage() (redirects to
// /upgrade) or getCurrentUserContext().isAdmin (admin pages), not here:
// Edge middleware can't cleanly tell an API fetch() "redirect to /login"
// (it'd get an HTML body where it expected JSON), so gated API routes each
// do their own requireFeatureApi() check instead of being matched here.
//
// Deliberately NOT matched (stay public): `/`, `/stock/*`, `/login`,
// `/upgrade`.
const authMiddleware = auth.middleware({ loginUrl: '/login' });

// Wraps the SDK's middleware to stamp a `redirect` param onto its
// /login bounce — the SDK itself always redirects to a bare loginUrl with
// no memory of where the request came from (confirmed in its source: it
// builds `new URL(loginUrl, request.url)` with no query params). Login and
// the social-callback page read this back to return the user to whatever
// page sent them to sign in, instead of always landing on `/`.
export default async function middleware(request: NextRequest) {
  const response = await authMiddleware(request);
  const location = response.headers.get('location');
  if (location) {
    const redirectUrl = new URL(location);
    if (redirectUrl.pathname === '/login') {
      redirectUrl.searchParams.set('redirect', request.nextUrl.pathname + request.nextUrl.search);
      response.headers.set('location', redirectUrl.toString());
    }
  }
  return response;
}

export const config = {
  matcher: [
    '/profile/:path*',
    '/admin/:path*',
    '/quadrant/:path*',
    '/scan-alerts/latest/:path*',
    '/scan-alerts/historical/:path*',
    '/watchlists/:path*',
    '/performance/:path*',
  ],
};
