'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth/client';

// Only ever honor a same-origin relative path — see app/login/page.tsx's
// identical guard for why (an open `redirect` param is an off-site
// redirect vector for a freshly-authenticated session).
function safeRedirectTarget(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

// Landing point for authClient.signIn.social()'s redirect back from the
// OAuth provider — a dedicated page (not the final destination directly)
// so revokeOtherSessions() runs exactly once, right after a fresh social
// login, rather than on every visit to wherever it lands.
//
// The redirect back from Neon Auth's hosted OAuth callback carries a
// one-time `neonAuthSessionVerifier`-style query param (session cookies
// can't cross from Neon's own domain to ours directly). getSession() MUST
// be called first — the client SDK detects that param, exchanges it via
// our own /api/auth proxy, and only THEN is a real session cookie set on
// this app's domain. Skipping straight to revokeOtherSessions() leaves the
// verifier unconsumed, so no local session is ever established.
function SocialCallbackPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = safeRedirectTarget(searchParams.get('redirect'));

  useEffect(() => {
    (async () => {
      // Both calls are best-effort housekeeping (consuming the one-time
      // verifier, then trimming to a single session) — if either throws
      // (a transient network blip, a cookie not settled yet), the user must
      // still leave this page rather than being stuck on "Signing you in…"
      // forever with no session and no way back.
      try {
        await authClient.getSession();
        await authClient.revokeOtherSessions();
      } catch (err) {
        console.error('Error finalizing social sign-in:', err);
      }
      // router.refresh() re-fetches the root layout's server-rendered
      // AuthContextProvider data — without it, a client-side router.replace()
      // leaves Header showing the pre-login state (matches the email/password
      // flow's afterSessionEstablished(), which already does both).
      router.replace(redirectTarget);
      router.refresh();
    })();
  }, [router, redirectTarget]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-400">
      Signing you in…
    </div>
  );
}

export default function SocialCallbackPage() {
  return (
    <Suspense fallback={null}>
      <SocialCallbackPageInner />
    </Suspense>
  );
}
