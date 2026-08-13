'use client';

import { useEffect, useMemo, useState } from 'react';

interface PlanDist { code: string; name: string; count: number }
interface Stats {
  totalUsers: number;
  planDistribution: PlanDist[];
  telegramLinkedCount: number;
  signupsLast7Days: number;
  loginsToday: number;
}
interface TodaysLoginRow { userId: string; email: string; createdAt: string; ipAddress: string | null }
interface RecentSignupRow { id: string; email: string; name: string | null; createdAt: string }
interface TelegramLinkedRow { userId: string; email: string; telegramLinkedAt: string | null }
interface AllUserRow { id: string; email: string; createdAt: string }
interface PlanUserRow { userId: string; email: string; planExpiresAt: string | null }

interface DashboardData {
  stats: Stats;
  todaysLogins: TodaysLoginRow[];
  recentSignups: RecentSignupRow[];
  telegramLinked: TelegramLinkedRow[];
  allUsers: AllUserRow[];
  usersByPlan: Record<string, PlanUserRow[]>;
}

type DrillKey = 'users' | 'signups' | 'telegram' | 'logins' | `plan:${string}`;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function StatTile({ label, value, onClick, active }: { label: string; value: string; onClick?: () => void; active?: boolean }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`bg-white rounded-xl border p-4 ${active ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'} ${onClick ? 'hover:border-blue-300 cursor-pointer transition-colors' : ''}`}
    >
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
    </div>
  );
}

/** Generic "list of users" table — most drills reduce to this shape. */
function UserTable({ rows }: { rows: Array<{ email: string; sub: string; timestamp?: string }> }) {
  if (rows.length === 0) return <p className="text-[11px] text-gray-400">Nothing here.</p>;
  return (
    <div className="max-h-96 overflow-y-auto">
      <table className="w-full text-xs">
        <tbody className="divide-y divide-gray-50">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1.5 pr-3 font-medium text-gray-700 whitespace-nowrap">{r.email}</td>
              <td className="py-1.5 text-gray-500">{r.sub}</td>
              {r.timestamp && <td className="py-1.5 text-right text-gray-400 whitespace-nowrap">{fmtTime(r.timestamp)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DrillPanel({ title, count, onClose, children }: { title: string; count: number; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-blue-200 ring-1 ring-blue-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-xs font-semibold text-gray-700">{title}</h3>
          <p className="text-[11px] text-gray-400">{count} row{count === 1 ? '' : 's'}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs font-semibold px-2 py-1 shrink-0">✕ Close</button>
      </div>
      {children}
    </div>
  );
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drillKey, setDrillKey] = useState<DrillKey | null>(null);

  useEffect(() => {
    fetch('/api/admin/dashboard')
      .then(res => res.json())
      .then(json => {
        if (!json.success) { setError(json.error ?? 'Failed to load'); return; }
        setData(json.data);
      })
      .catch(() => setError('Failed to load dashboard'));
  }, []);

  const toggle = (key: DrillKey) => setDrillKey(prev => (prev === key ? null : key));

  const maxPlanCount = useMemo(() => Math.max(1, ...(data?.stats.planDistribution.map(p => p.count) ?? [1])), [data]);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!data) return <p className="text-xs text-gray-400">Loading…</p>;

  const { stats } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Total users" value={String(stats.totalUsers)} onClick={() => toggle('users')} active={drillKey === 'users'} />
        <StatTile label="Signups (7 days)" value={String(stats.signupsLast7Days)} onClick={() => toggle('signups')} active={drillKey === 'signups'} />
        <StatTile label="Telegram linked" value={String(stats.telegramLinkedCount)} onClick={() => toggle('telegram')} active={drillKey === 'telegram'} />
        <StatTile label="Logins today" value={String(stats.loginsToday)} onClick={() => toggle('logins')} active={drillKey === 'logins'} />
      </div>

      {drillKey === 'users' && (
        <DrillPanel title="All users" count={data.allUsers.length} onClose={() => setDrillKey(null)}>
          <UserTable rows={data.allUsers.map(u => ({ email: u.email, sub: u.id.slice(0, 8), timestamp: u.createdAt }))} />
        </DrillPanel>
      )}
      {drillKey === 'signups' && (
        <DrillPanel title="Signups — last 7 days" count={data.recentSignups.length} onClose={() => setDrillKey(null)}>
          <UserTable rows={data.recentSignups.map(u => ({ email: u.email, sub: u.name ?? '—', timestamp: u.createdAt }))} />
        </DrillPanel>
      )}
      {drillKey === 'telegram' && (
        <DrillPanel title="Telegram linked" count={data.telegramLinked.length} onClose={() => setDrillKey(null)}>
          <UserTable rows={data.telegramLinked.map(u => ({ email: u.email, sub: 'linked', timestamp: u.telegramLinkedAt ?? undefined }))} />
        </DrillPanel>
      )}
      {drillKey === 'logins' && (
        <DrillPanel title="Logins today" count={data.todaysLogins.length} onClose={() => setDrillKey(null)}>
          <UserTable rows={data.todaysLogins.map(l => ({ email: l.email, sub: l.ipAddress ?? '—', timestamp: l.createdAt }))} />
        </DrillPanel>
      )}
      {drillKey?.startsWith('plan:') && (() => {
        const code = drillKey.slice('plan:'.length);
        const rows = data.usersByPlan[code] ?? [];
        return (
          <DrillPanel title={`Plan: ${code}`} count={rows.length} onClose={() => setDrillKey(null)}>
            <UserTable rows={rows.map(u => ({ email: u.email, sub: u.planExpiresAt ? `expires ${u.planExpiresAt.slice(0, 10)}` : 'no expiry' }))} />
          </DrillPanel>
        );
      })()}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Plan distribution</h2>
        <div className="space-y-2">
          {stats.planDistribution.map(p => {
            const key: DrillKey = `plan:${p.code}`;
            const active = drillKey === key;
            return (
              <div
                key={p.code}
                onClick={() => p.count > 0 && toggle(key)}
                role={p.count > 0 ? 'button' : undefined}
                tabIndex={p.count > 0 ? 0 : undefined}
                className={`flex items-center gap-3 rounded-lg -mx-1 px-1 py-0.5 ${p.count > 0 ? 'cursor-pointer transition-colors' : ''} ${active ? 'bg-blue-50 ring-1 ring-blue-200' : p.count > 0 ? 'hover:bg-gray-50' : ''}`}
              >
                <span className="w-20 text-xs font-medium text-gray-600">{p.name}</span>
                <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(p.count / maxPlanCount) * 100}%` }} />
                </div>
                <span className="w-8 text-right text-xs font-mono text-gray-500">{p.count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
