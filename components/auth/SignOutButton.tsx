'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth/client';

export default function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message);
    } catch (e) {
      console.error('sign-out failed', e);
      setBusy(false);
      setFailed(true);
      return;
    }
    // Full page load (not router.push + refresh): the layout reads the session
    // cookie on the server, so a hard navigation guarantees no stale signed-in
    // state survives in the client router cache or the header.
    window.location.assign('/login');
  }

  return (
    <div>
      <button
        onClick={handleSignOut}
        disabled={busy}
        className="px-3 py-1.5 text-xs font-medium text-red-600 border border-gray-200 rounded-lg hover:bg-red-50 disabled:opacity-60"
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {failed && <p className="mt-1 text-[11px] text-red-600">Could not sign out. Please try again.</p>}
    </div>
  );
}
