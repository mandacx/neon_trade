'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { COPY, MANUAL_PATH, MANUAL_STEPS, SUPPORT_HREF, type ViewState } from './unsubscribeCopy';
import { SUPPORT_EMAIL } from '@/lib/site';

const ICON: Record<string, { glyph: string; cls: string }> = {
  envelope: { glyph: '✉', cls: 'bg-gray-100 text-gray-600' },
  check: { glyph: '✓', cls: 'bg-green-50 text-green-700' },
  info: { glyph: '✓', cls: 'bg-gray-100 text-gray-600' },
  warn: { glyph: '!', cls: 'bg-amber-50 text-amber-700' },
  alert: { glyph: '!', cls: 'bg-red-50 text-red-700' },
};

const BTN = 'w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2';
const BTN2 = 'w-full py-3 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-sm font-semibold disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2';
const LINK = 'text-blue-600 underline break-words';

/**
 * The card. The server-rendered state (initial) is replaced in place after a JSON POST; without JavaScript the real form
 * posts to /api/email/unsubscribe and lands on /unsubscribe?s=<state>. The token only leaves the page in that POST; the
 * Undo token comes back in the response and lives in component state only.
 */
export default function UnsubscribeView({ initial, token }: { initial: ViewState; token: string | null }) {
  const [state, setState] = useState<ViewState>(initial);
  const [busy, setBusy] = useState(false);
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const h1 = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    h1.current?.focus();
  }, [state]);

  async function post(op: 'unsubscribe' | 'undo', t: string | null) {
    setBusy(true);
    try {
      const res = await fetch('/api/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, t }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) {
        const s = j.data?.state;
        if (s === 'resubscribed') { setUndoToken(null); setState('undone'); }
        else if (s === 'done') { setUndoToken(typeof j.data.undoToken === 'string' ? j.data.undoToken : null); setState('done'); }
        else setState('already');
      } else {
        setState(res.status === 429 ? 'limited' : res.status === 400 ? 'invalid' : 'error');
      }
    } catch {
      setState('error');
    } finally {
      setBusy(false);
    }
  }

  const c = COPY[state];
  const icon = ICON[c.icon];
  const manual = state === 'invalid' || state === 'limited' || state === 'error';
  const reasub = state === 'done' || state === 'already';
  const isAlert = state === 'error' || state === 'limited';

  return (
    <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl p-6 sm:p-8">
      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold mb-4 ${icon.cls}`} aria-hidden="true">{icon.glyph}</div>
      <h1 ref={h1} tabIndex={-1} className="text-xl font-bold text-gray-900 focus:outline-none break-words">{c.title}</h1>
      <div role={isAlert ? 'alert' : 'status'} className={isAlert ? 'mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700 space-y-2' : 'mt-3 text-sm text-gray-700 leading-relaxed space-y-2'}>
        {c.body.map(p => <p key={p}>{p}</p>)}
      </div>

      {state === 'confirm' && (
        <form method="post" action="/api/email/unsubscribe" className="mt-5" onSubmit={e => { e.preventDefault(); if (!busy) post('unsubscribe', token); }}>
          <input type="hidden" name="t" value={token ?? ''} />
          <input type="hidden" name="op" value="unsubscribe" />
          <button type="submit" disabled={busy} aria-busy={busy} className={BTN}>{busy ? 'Unsubscribing...' : 'Unsubscribe'}</button>
          <p className="mt-2 text-xs text-gray-600 text-center">This takes effect straight away.</p>
          <p className="text-center"><Link href="/" prefetch={false} className={`inline-block py-3 text-sm ${LINK}`}>No, keep my emails</Link></p>
        </form>
      )}

      {state === 'done' && undoToken && (
        <div className="mt-5">
          <button type="button" disabled={busy} aria-busy={busy} className={BTN2} onClick={() => post('undo', undoToken)}>{busy ? 'Working...' : 'Undo, turn emails back on'}</button>
        </div>
      )}

      {state === 'error' && token && (
        <div className="mt-4">
          <button type="button" disabled={busy} aria-busy={busy} className={BTN} onClick={() => post('unsubscribe', token)}>{busy ? 'Unsubscribing...' : 'Try again'}</button>
        </div>
      )}

      {state === 'error' && !token && (
        <p className="mt-4 text-sm text-gray-700"><strong>Try again:</strong> open the unsubscribe link in your email once more.</p>
      )}

      {reasub && (
        <p className="mt-5 text-sm text-gray-700">
          Changed your mind later? {MANUAL_PATH} <Link href="/ideas" prefetch={false} className={LINK}>Go to Trade Ideas</Link>
        </p>
      )}
      {state === 'undone' && (
        <p className="mt-5 text-sm text-gray-700"><Link href="/ideas" prefetch={false} className={LINK}>Manage alerts</Link></p>
      )}

      {manual && (
        <div className="mt-4 text-sm text-gray-700 space-y-2">
          {state === 'invalid' && (
            <ol className="list-decimal pl-5 space-y-1">{MANUAL_STEPS.map(s => <li key={s}>{s}</li>)}</ol>
          )}
          {state !== 'invalid' && <p>Still stuck? Sign in, open Trade Ideas, choose Alerts and untick Email, or contact {SUPPORT_EMAIL}.</p>}
          <p><Link href="/ideas" prefetch={false} className={LINK}>Sign in and open Trade Ideas</Link></p>
          <p><a href={SUPPORT_HREF} className={LINK}>Contact support</a></p>
        </div>
      )}
    </div>
  );
}
