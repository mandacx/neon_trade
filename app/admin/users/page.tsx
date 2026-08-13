'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminUserSummary } from '@/lib/admin';

const PAGE_SIZE = 25;

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (search) params.set('search', search);
    fetch(`/api/admin/users?${params}`)
      .then(r => r.json())
      .then(json => { if (json.success) { setUsers(json.data.users); setTotal(json.data.total); } })
      .finally(() => setLoading(false));
  }, [search, offset]);

  return (
    <div className="space-y-3">
      <input
        value={search}
        onChange={e => { setSearch(e.target.value); setOffset(0); }}
        placeholder="Search by email or name…"
        className="w-full max-w-sm px-3 py-2 border border-gray-200 rounded-lg text-sm"
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Email</th>
              <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Name</th>
              <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase">Plan</th>
              <th className="px-4 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase">Role</th>
              <th className="px-4 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase">Telegram</th>
              <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase">Joined</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2 text-gray-500">{u.name ?? '—'}</td>
                <td className="px-4 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{u.plan_code ?? 'FREE'}</span>
                </td>
                <td className="px-4 py-2 text-center">{u.role === 'admin' ? '⭐' : ''}</td>
                <td className="px-4 py-2 text-center">{u.telegram_chat_id ? '✓' : ''}</td>
                <td className="px-4 py-2 text-right text-gray-500 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/users/${u.id}`} className="text-blue-600 text-xs font-semibold">Manage →</Link>
                </td>
              </tr>
            ))}
            {!loading && users.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{total} user{total === 1 ? '' : 's'}</span>
        <div className="flex gap-2">
          <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">Prev</button>
          <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(o => o + PAGE_SIZE)} className="px-2 py-1 border border-gray-200 rounded disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
