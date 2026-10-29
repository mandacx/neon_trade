'use client';

import { useState } from 'react';
import { STRATEGIES, VIEWS, RISK_LABEL } from '@/lib/payoff/strategies';
import { formatCT } from '@/lib/time';
import type { StrategySettingsView } from '@/lib/strategySettings';

/** On/off switch per Strategy Builder template (lib/strategySettings.ts). */
export default function StrategySettingsEditor({ initial }: { initial: StrategySettingsView }) {
  const [settings, setSettings] = useState(initial);
  const [off, setOff] = useState<Set<string>>(() => new Set(initial.disabled));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const saved = new Set(settings.disabled);
  const dirty = off.size !== saved.size || [...off].some(id => !saved.has(id));

  const toggle = (id: string) => setOff(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setView = (view: string, enabled: boolean) => setOff(s => {
    const n = new Set(s);
    for (const t of STRATEGIES) if (t.view === view) { if (enabled) n.delete(t.id); else n.add(t.id); }
    return n;
  });

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/settings/strategies', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: [...off] }),
      });
      const json = await res.json();
      if (!json.success) { setMessage({ ok: false, text: json.error ?? 'Could not save' }); return; }
      setSettings(json.data);
      setOff(new Set(json.data.disabled));
      setMessage({ ok: true, text: 'Saved. Every server picks it up within about 30 seconds.' });
    } catch {
      setMessage({ ok: false, text: 'Could not reach the server' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mt-6">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900">Strategy builder: available strategies</h2>
        <p className="text-xs text-gray-500 mt-1">
          Predefined strategies users can pick in the stock page&apos;s Option Chain tab. A switched-off strategy disappears from
          the view cards and the strategy list; users can still build any position leg by leg.
          {' '}{STRATEGIES.length - off.size} of {STRATEGIES.length} enabled.
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {VIEWS.map(v => {
          const list = STRATEGIES.filter(t => t.view === v.id);
          const on = list.filter(t => !off.has(t.id)).length;
          return (
            <div key={v.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <span className="text-sm font-semibold text-gray-900">{v.label}</span>
                <span className="text-[11px] text-gray-400">{on} / {list.length} enabled</span>
                <button onClick={() => setView(v.id, true)} className="text-[11px] text-blue-600 hover:underline">enable all</button>
                <button onClick={() => setView(v.id, false)} className="text-[11px] text-gray-500 hover:underline">disable all</button>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
                {list.map(t => (
                  <label key={t.id} title={`${t.description} (${RISK_LABEL[t.risk]})`} className="flex items-center gap-2 text-xs text-gray-700 py-0.5 cursor-pointer">
                    <input type="checkbox" checked={!off.has(t.id)} onChange={() => toggle(t.id)} className="accent-blue-600" />
                    <span className={off.has(t.id) ? 'text-gray-400 line-through' : ''}>{t.name}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-5 py-4 border-t border-gray-100 flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={busy || !dirty}
          className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        {message && <span className={`text-xs ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</span>}
        <span className="ml-auto text-[11px] text-gray-400">
          {settings.updatedAt ? `Last changed ${formatCT(settings.updatedAt)}${settings.updatedBy ? ` by ${settings.updatedBy}` : ''}` : 'All strategies enabled (default)'}
        </span>
      </div>
    </div>
  );
}
