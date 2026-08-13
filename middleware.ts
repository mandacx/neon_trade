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
// `/upgrade`. /performance will be added here once that page exists.
export default auth.middleware({ loginUrl: '/login' });

export const config = {
  matcher: [
    '/profile/:path*',
    '/admin/:path*',
    '/quadrant/:path*',
    '/scan-alerts/latest/:path*',
    '/scan-alerts/historical/:path*',
    '/watchlists/:path*',
  ],
};
