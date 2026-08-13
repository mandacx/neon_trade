'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';

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
export default function SocialCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      await authClient.getSession();
      await authClient.revokeOtherSessions();
      // router.refresh() re-fetches the root layout's server-rendered
      // AuthContextProvider data — without it, a client-side router.replace()
      // leaves Header showing the pre-login state (matches the email/password
      // flow's afterSessionEstablished(), which already does both).
      router.replace('/');
      router.refresh();
    })();
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-400">
      Signing you in…
    </div>
  );
}
