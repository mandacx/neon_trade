'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

function send(payload: Record<string, unknown>) {
  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', body);
    else fetch('/api/track', { method: 'POST', body, keepalive: true }).catch(() => {});
  } catch { /* tracking is best-effort */ }
}

/**
 * First few stack frames of an error with the origin stripped
 * (`/_next/static/chunks/x.js:1:2`), so the admin dashboard can show where it
 * came from. Chrome frames look like `at fn (url)`, Safari/Firefox like
 * `fn@url`; the leading "Name: message" line is dropped.
 */
function shortStack(err: unknown): string | undefined {
  const raw = err instanceof Error ? err.stack : undefined;
  if (!raw) return undefined;
  const frames = raw.split('\n').map(l => l.trim()).filter(l => /^at |@/.test(l)).slice(0, 6);
  return frames.length ? frames.map(l => l.replace(/https?:\/\/[^/\s)]+/g, '')).join('\n').slice(0, 1200) : undefined;
}

/**
 * Arrival ping on each route, an exit beacon with time-on-page when leaving
 * (route change or tab hidden/closed), and window errors. Renders nothing.
 */
export default function ActivityTracker() {
  const pathname = usePathname();
  const startRef = useRef<{ path: string; at: number } | null>(null);
  const firstRef = useRef(true);

  const flush = () => {
    const s = startRef.current;
    if (!s) return;
    send({ type: 'pageview', path: s.path, durationMs: Date.now() - s.at });
    startRef.current = null;
  };

  useEffect(() => {
    startRef.current = { path: pathname, at: Date.now() };
    // document.referrer never changes on client-side navigation, so only the
    // first ping of a visit carries it (otherwise every route would repeat it).
    send({ type: 'pageview', path: pathname, referrer: firstRef.current ? document.referrer || undefined : undefined });
    firstRef.current = false;
    return flush;
  }, [pathname]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        const s = startRef.current;
        if (s) { send({ type: 'pageview', path: s.path, durationMs: Date.now() - s.at }); startRef.current = null; }
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !startRef.current) startRef.current = { path: window.location.pathname, at: Date.now() };
    };
    const onError = (e: ErrorEvent) => send({ type: 'error_client', path: window.location.pathname, message: e.message, stack: shortStack(e.error) });
    const onRejection = (e: PromiseRejectionEvent) => send({ type: 'error_client', path: window.location.pathname, message: String(e.reason), stack: shortStack(e.reason) });
    document.addEventListener('visibilitychange', onHide);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
