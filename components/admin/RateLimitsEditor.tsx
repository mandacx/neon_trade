'use client';

import { useState } from 'react';
import type { RateLimitSettingsView } from '@/lib/rateLimitConfig';
import { MAX_LIMIT, MIN_LIMIT } from '@/lib/rateLimitTypes';

type Draft = Record<string, { standard: string; entitled: string }>;

const toDraft = (s: RateLimitSettingsView): Draft =>
  Object.fromEntries(s.limiters.map(l => [l.name, { standard: String(l.current.standard), entitled: l.current.entitled === null ? '' : String(l.current.entitled) }]));

export default function RateLimitsEditor({ initial }: { initial: RateLimitSettingsView }) {
  const [settings, setSettings] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = settings.limiters.some(l => {
    const d = draft[l.name];
    return d.standard !== String(l.current.standard) || (l.entitled !== null && d.entitled !== String(l.current.entitled));
  });

  async function call(method: 'PUT' | 'DELETE') {
    setBusy(method === 'PUT' ? 'save' : 'reset');
    setMessage(null);
    try {
      const body = method === 'PUT'
        ? JSON.stringify({
            limiters: Object.fromEntries(settings.limiters.map(l => [l.name, {
              standard: Number(draft[l.name].standard),
              entitled: l.entitled === null ? null : Number(draft[l.name].entitled),
            }])),
          })
        : undefined;
      const res = await fetch('/api/admin/settings/rate-limits', { method, headers: { 'Content-Type': 'application/json' }, body });
      const json = await res.json();
      if (!json.success) { setMessage({ ok: false, text: json.error ?? 'Could not save' }); return; }
      setSettings(json.data);
      setDraft(toDraft(json.data));
      setMessage({ ok: true, text: method === 'PUT' ? 'Saved. Every server picks it up within about 30 seconds.' : 'Restored the built-in defaults.' });
    } catch {
      setMessage({ ok: false, text: 'Could not reach the server' });
    } finally {
      setBusy(null);
    }
  }

  const input = 'w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-sm tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-blue-400';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900">Rate limits</h2>
        <p className="text-xs text-gray-500 mt-1">
          Requests allowed per user per minute (signed-out visitors are counted by IP address). <b>Standard</b> applies to everyone;
          <b> Entitled</b> applies to users with the live-levels feature. A request over the limit gets HTTP 429 and shows in the
          dashboard&apos;s Heavy API users tile as a throttled minute.
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {settings.limiters.map(l => (
          <div key={l.name} className="px-5 py-4 flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-md">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">{l.label}</span>
                <code className="text-[10px] text-gray-400">{l.name}</code>
                {l.isCustom && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">customised</span>}
              </div>
              <p className="text-xs text-gray-500 mt-1">{l.description}</p>
              <p className="text-[11px] text-gray-400 mt-1">Window {l.windowSeconds}s · default {l.standard}{l.entitled !== null ? ` / ${l.entitled}` : ''}</p>
            </div>
            <div className="flex items-end gap-4">
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                Standard
                <input type="number" min={MIN_LIMIT} max={MAX_LIMIT} step={1} value={draft[l.name].standard} className={`${input} block mt-1`}
                  onChange={e => setDraft(d => ({ ...d, [l.name]: { ...d[l.name], standard: e.target.value } }))} />
              </label>
              {l.entitled !== null ? (
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  Entitled
                  <input type="number" min={MIN_LIMIT} max={MAX_LIMIT} step={1} value={draft[l.name].entitled} className={`${input} block mt-1`}
                    onChange={e => setDraft(d => ({ ...d, [l.name]: { ...d[l.name], entitled: e.target.value } }))} />
                </label>
              ) : (
                <div className="w-24 text-[11px] text-gray-400 pb-2">single tier</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="px-5 py-4 border-t border-gray-100 flex flex-wrap items-center gap-3">
        <button onClick={() => call('PUT')} disabled={busy !== null || !dirty}
          className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-50">
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { if (confirm('Restore the built-in defaults for every limit?')) call('DELETE'); }} disabled={busy !== null}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50">
          Reset to defaults
        </button>
        {message && <span className={`text-xs ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</span>}
        <span className="ml-auto text-[11px] text-gray-400">
          {settings.updatedAt ? `Last changed ${new Date(settings.updatedAt).toLocaleString()}${settings.updatedBy ? ` by ${settings.updatedBy}` : ''}` : 'Using the built-in defaults'}
        </span>
      </div>
    </div>
  );
}
