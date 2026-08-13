'use client';

import { useState } from 'react';
import type { AdminPlan } from '@/lib/admin';

export default function PlansEditor({ plans, allFeatures }: { plans: AdminPlan[]; allFeatures: Array<{ code: string; label: string }> }) {
  const [state, setState] = useState<Record<number, Set<string>>>(() =>
    Object.fromEntries(plans.map(p => [p.id, new Set(p.features)]))
  );
  const [saving, setSaving] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<Record<number, number>>({});

  function toggle(planId: number, feature: string) {
    setState(prev => {
      const next = new Set(prev[planId]);
      if (next.has(feature)) next.delete(feature);
      else next.add(feature);
      return { ...prev, [planId]: next };
    });
  }

  async function save(planId: number) {
    setSaving(planId);
    try {
      const res = await fetch(`/api/admin/plans/${planId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: Array.from(state[planId]) }),
      });
      const json = await res.json();
      if (json.success) setSavedAt(prev => ({ ...prev, [planId]: Date.now() }));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="grid md:grid-cols-3 gap-4">
      {plans.map(plan => (
        <div key={plan.id} className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-900">{plan.name}</h3>
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{plan.code}</span>
          </div>
          <div className="space-y-1.5">
            {allFeatures.map(f => (
              <label key={f.code} className="flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={state[plan.id]?.has(f.code) ?? false}
                  onChange={() => toggle(plan.id, f.code)}
                  className="rounded border-gray-300"
                />
                {f.label}
              </label>
            ))}
          </div>
          <button
            onClick={() => save(plan.id)}
            disabled={saving === plan.id}
            className="mt-4 w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50"
          >
            {saving === plan.id ? 'Saving…' : 'Save'}
          </button>
          {savedAt[plan.id] && <p className="text-[11px] text-green-600 text-center mt-1.5">Saved</p>}
        </div>
      ))}
    </div>
  );
}
