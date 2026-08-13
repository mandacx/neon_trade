'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminUserDetail, AdminPlan } from '@/lib/admin';

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

export default function UserDetailEditor({
  user, plans, allFeatures, currentAdminId,
}: {
  user: AdminUserDetail;
  plans: AdminPlan[];
  allFeatures: Array<{ code: string; label: string }>;
  currentAdminId: string | null;
}) {
  const router = useRouter();
  const [planId, setPlanId] = useState(user.plan_id ?? plans[0]?.id ?? 0);
  const [expiresAt, setExpiresAt] = useState(toDateInputValue(user.plan_expires_at));
  const [savingPlan, setSavingPlan] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, boolean>>(
    Object.fromEntries(user.overrides.map(o => [o.feature, o.granted]))
  );
  const [savingOverride, setSavingOverride] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  const [role, setRole] = useState(user.role ?? 'user');

  async function savePlan() {
    setSavingPlan(true);
    try {
      await fetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, planExpiresAt: expiresAt || null }),
      });
      router.refresh();
    } finally {
      setSavingPlan(false);
    }
  }

  async function toggleOverride(feature: string) {
    const current = overrides[feature]; // undefined = no override (plan default)
    setSavingOverride(feature);
    try {
      if (current === undefined) {
        // No override yet -> grant it.
        await fetch(`/api/admin/users/${user.id}/overrides`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feature, granted: true }),
        });
        setOverrides(prev => ({ ...prev, [feature]: true }));
      } else if (current === true) {
        // Granted -> revoke.
        await fetch(`/api/admin/users/${user.id}/overrides`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feature, granted: false }),
        });
        setOverrides(prev => ({ ...prev, [feature]: false }));
      } else {
        // Revoked -> clear back to plan default.
        await fetch(`/api/admin/users/${user.id}/overrides?feature=${encodeURIComponent(feature)}`, { method: 'DELETE' });
        setOverrides(prev => { const next = { ...prev }; delete next[feature]; return next; });
      }
    } finally {
      setSavingOverride(null);
    }
  }

  async function toggleRole() {
    const nextRole = role === 'admin' ? 'user' : 'admin';
    setSavingRole(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/role`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole }),
      });
      const json = await res.json();
      if (json.success) setRole(nextRole);
      else alert(json.error);
    } finally {
      setSavingRole(false);
    }
  }

  const isSelf = user.id === currentAdminId;

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Account</h3>
          <dl className="text-xs space-y-1">
            <div className="flex justify-between"><dt className="text-gray-500">Email</dt><dd>{user.email}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Name</dt><dd>{user.name ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Verified</dt><dd>{user.email_verified ? '✓' : 'No'}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Joined</dt><dd>{new Date(user.created_at).toLocaleString()}</dd></div>
          </dl>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Admin role</h3>
          <button
            onClick={toggleRole}
            disabled={savingRole || isSelf}
            title={isSelf ? "You can't change your own role" : undefined}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 ${role === 'admin' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-blue-600 text-white'}`}
          >
            {savingRole ? 'Saving…' : role === 'admin' ? 'Remove admin' : 'Make admin'}
          </button>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Plan</h3>
          <div className="flex gap-2 items-end">
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Plan</label>
              <select value={planId} onChange={e => setPlanId(Number(e.target.value))} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs">
                {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Expires (blank = never)</label>
              <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs" />
            </div>
            <button onClick={savePlan} disabled={savingPlan} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-50">
              {savingPlan ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Feature overrides</h3>
        <p className="text-[11px] text-gray-400 mb-3">Click to cycle: plan default → granted → revoked → plan default.</p>
        <div className="space-y-1.5">
          {allFeatures.map(f => {
            const state = overrides[f.code]; // undefined | true | false
            const label = state === undefined ? 'Plan default' : state ? 'Granted' : 'Revoked';
            const color = state === undefined ? 'text-gray-400' : state ? 'text-green-600' : 'text-red-600';
            return (
              <button
                key={f.code}
                onClick={() => toggleOverride(f.code)}
                disabled={savingOverride === f.code}
                className="w-full flex items-center justify-between text-xs px-2 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                <span className="text-gray-700">{f.label}</span>
                <span className={`font-semibold ${color}`}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
