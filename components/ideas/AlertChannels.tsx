'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/components/ideas/ideaUi';

interface Prefs {
  emailAlerts: boolean; telegramAlerts: boolean; pushAlerts: boolean;
  emailAvailable: boolean; telegramAvailable: boolean; telegramLinked: boolean; telegramEntitled: boolean;
  pushAvailable: boolean; pushDevices: number;
}

/** VAPID public keys are URL-safe base64; the Push API wants bytes. */
function keyBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/**
 * Where alerts are delivered besides the in-app feed (always on): email, Telegram, this browser. Each switch says why it
 * cannot be used when that is the case (not set up on the server, Telegram not linked or not on the plan, browser
 * permission denied) instead of silently doing nothing.
 */
export default function AlertChannels() {
  const [p, setP] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { api<Prefs>('/api/ideas/prefs').then(setP).catch(() => {}); }, []);
  useEffect(load, [load]);

  async function set(key: 'emailAlerts' | 'telegramAlerts', value: boolean) {
    setBusy(key); setError(null);
    try { await api('/api/ideas/prefs', { method: 'POST', body: JSON.stringify({ [key]: value }) }); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(null); }
  }

  async function togglePush(on: boolean) {
    setBusy('push'); setError(null);
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if (on) {
        if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site in your browser settings.');
        const { publicKey } = await api<{ publicKey: string | null }>('/api/ideas/push');
        if (!publicKey) throw new Error('Browser notifications are not set up yet.');
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
        await api('/api/ideas/push', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
      } else {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await api('/api/ideas/push', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) });
          await sub.unsubscribe();
        } else {
          await api('/api/ideas/prefs', { method: 'POST', body: JSON.stringify({ pushAlerts: false }) });
        }
      }
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not change notifications'); }
    finally { setBusy(null); }
  }

  if (!p) return null;
  const row = (label: string, checked: boolean, disabled: boolean, onChange: (v: boolean) => void, hint?: React.ReactNode) => (
    <div>
      <label className="flex items-center gap-2 text-xs text-gray-700">
        <input type="checkbox" checked={checked} disabled={disabled || !!busy} onChange={e => onChange(e.target.checked)} />
        {label}
      </label>
      {hint && <div className="ml-6 text-[11px] text-gray-500">{hint}</div>}
    </div>
  );

  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase font-semibold text-gray-400">Also alert me by</div>
      {row('Email', p.emailAlerts, !p.emailAvailable, v => set('emailAlerts', v), !p.emailAvailable ? 'Email is not set up yet.' : undefined)}
      {row('Telegram', p.telegramAlerts, !p.telegramAvailable || !p.telegramLinked || !p.telegramEntitled, v => set('telegramAlerts', v),
        !p.telegramAvailable ? 'Telegram is not set up yet.'
          : !p.telegramEntitled ? <>Telegram alerts are not on your plan. <Link href="/upgrade?feature=telegram_alerts" className="underline">See plans</Link></>
          : !p.telegramLinked ? <>Link Telegram first in your <Link href="/profile" className="underline">profile</Link>.</> : undefined)}
      {row('This browser (push notification)', p.pushAlerts && p.pushDevices > 0, !p.pushAvailable || !pushSupported(), togglePush,
        !p.pushAvailable ? 'Browser notifications are not set up yet.' : !pushSupported() ? 'This browser does not support push notifications.' : p.pushDevices > 0 ? `${p.pushDevices} device${p.pushDevices === 1 ? '' : 's'} registered` : undefined)}
      {error && <div className="text-[11px] text-red-600">{error}</div>}
    </div>
  );
}
