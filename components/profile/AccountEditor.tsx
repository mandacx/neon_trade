'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';

const inputClass = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white disabled:bg-gray-50 disabled:text-gray-400";
const labelClass = "block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1";

export default function AccountEditor({ name, email, emailVerified, hasPassword }: { name: string; email: string; emailVerified: boolean; hasPassword: boolean }) {
  const router = useRouter();
  const [nameInput, setNameInput] = useState(name);
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    setNameError(null);
    setNameSaved(false);
    const { error } = await authClient.updateUser({ name: nameInput.trim() });
    setSavingName(false);
    if (error) { setNameError(error.message ?? 'Could not update name.'); return; }
    setNameSaved(true);
    router.refresh();
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setSavingPassword(true);
    setPasswordError(null);
    setPasswordSaved(false);
    // Revoke other sessions on password change too — consistent with the
    // single-session policy (a changed password shouldn't leave old
    // sessions elsewhere still valid).
    const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    setSavingPassword(false);
    if (error) { setPasswordError(error.message ?? 'Could not change password.'); return; }
    setCurrentPassword('');
    setNewPassword('');
    setPasswordSaved(true);
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
      <form onSubmit={saveName}>
        <label className={labelClass}>Name</label>
        <div className="flex gap-2">
          <input className={inputClass} value={nameInput} onChange={e => { setNameInput(e.target.value); setNameSaved(false); }} />
          <button disabled={savingName || nameInput.trim() === name} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-40 shrink-0">
            {savingName ? 'Saving…' : 'Save'}
          </button>
        </div>
        {nameError && <p className="text-[11px] text-red-600 mt-1">{nameError}</p>}
        {nameSaved && <p className="text-[11px] text-green-600 mt-1">Saved.</p>}
      </form>

      <div>
        <label className={labelClass}>Email</label>
        <div className="flex items-center gap-2">
          <input className={inputClass} value={email} disabled />
          <span className={`text-[10px] font-semibold shrink-0 ${emailVerified ? 'text-green-600' : 'text-amber-600'}`}>
            {emailVerified ? '✓ Verified' : 'Unverified'}
          </span>
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Contact support to change your email address.</p>
      </div>

      {hasPassword ? (
        <form onSubmit={savePassword} className="pt-4 border-t border-gray-100 space-y-3">
          <h3 className="text-xs font-semibold text-gray-700">Change password</h3>
          <div>
            <label className={labelClass}>Current password</label>
            <input className={inputClass} type="password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>New password</label>
            <input className={inputClass} type="password" required minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
          </div>
          <button disabled={savingPassword} className="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-900 text-white text-xs font-semibold disabled:opacity-40">
            {savingPassword ? 'Updating…' : 'Update password'}
          </button>
          {passwordError && <p className="text-[11px] text-red-600">{passwordError}</p>}
          {passwordSaved && <p className="text-[11px] text-green-600">Password updated. Other devices have been signed out.</p>}
        </form>
      ) : (
        <div className="pt-4 border-t border-gray-100">
          <h3 className="text-xs font-semibold text-gray-700">Password</h3>
          <p className="text-[11px] text-gray-400 mt-1">You sign in with Google — no password is set for this account.</p>
        </div>
      )}
    </div>
  );
}
