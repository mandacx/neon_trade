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
    const onError = (e: ErrorEvent) => send({ type: 'error_client', path: window.location.pathname, message: e.message });
    const onRejection = (e: PromiseRejectionEvent) => send({ type: 'error_client', path: window.location.pathname, message: String(e.reason) });
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
