'use client';

import { useState } from 'react';

/**
 * "Request levels" for a stock that has no option levels: asks an admin to add it to the levels list
 * (POST /api/level-requests; docs/level-symbols.md). Signed-out users are sent to the login page.
 */
export default function RequestLevelsButton({ symbol, className = '' }: { symbol: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function request(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    setState('sending');
    try {
      const res = await fetch('/api/level-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol }) });
      if (res.status === 401) { window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`; return; }
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) { setState('sent'); setMessage('Requested: an admin will review it.'); return; }
      // "already requested" is a fine outcome for the user.
      if (json.error === 'pending') { setState('sent'); setMessage(json.message ?? 'Already requested.'); return; }
      setState('error'); setMessage(json.message ?? json.error ?? 'Could not send the request.');
    } catch { setState('error'); setMessage('Network error, try again.'); }
  }

  if (state === 'sent') return <span className={`text-[10px] font-semibold text-green-700 ${className}`} title={message}>Requested ✓</span>;
  return (
    <button type="button" onClick={request} disabled={state === 'sending'} title={state === 'error' ? message : `Ask an admin to add option levels for ${symbol}`}
      className={`text-[10px] font-semibold rounded border px-1.5 py-px disabled:opacity-60 ${state === 'error' ? 'text-red-700 border-red-300 bg-red-50' : 'text-blue-700 border-blue-200 bg-blue-50 hover:bg-blue-100'} ${className}`}>
      {state === 'sending' ? 'Sending…' : state === 'error' ? 'Retry request' : 'Request levels'}
    </button>
  );
}
