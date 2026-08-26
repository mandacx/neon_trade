'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function TrialStartButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/trial/start', { method: 'POST' });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? 'Could not start your trial.');
        setBusy(false);
        return;
      }
      // Re-resolves getCurrentUserContext() server-side, so this page and
      // the header (via the root layout) both pick up Pro immediately.
      router.refresh();
    } catch {
      setError('Could not start your trial — please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="text-center">
      <button
        onClick={handleStart}
        disabled={busy}
        className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-bold disabled:opacity-50"
      >
        {busy ? 'Starting…' : '🚀 Start your 1-month free trial'}
      </button>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      <p className="text-[11px] text-gray-400 mt-1.5">No card required. Full Pro access for 30 days.</p>
    </div>
  );
}
