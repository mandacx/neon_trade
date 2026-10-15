'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import DrillModal, { type DrillPreset } from '@/components/admin/DrillModal';
import HistoryModal, { type HistoryTarget } from '@/components/admin/HistoryModal';
import type { DrillMetric } from '@/lib/adminDrill';
import { formatCT } from '@/lib/time';

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

interface ActiveSessionRow { sessionId: string; userId: string | null; who: string; pageviews: number; lastSeen: string }
interface TopPageRow { path: string; views: number; avgSeconds: number | null }
interface ErrorRow { userId: string | null; email: string | null; path: string | null; message: string | null; stack: string | null; kind: string; createdAt: string }
interface Activity {
  activeSessionsToday: number;
  pageViewsToday: number;
  errorsToday: number;
  activeSessions: ActiveSessionRow[];
  topPages: TopPageRow[];
  errors: ErrorRow[];
}
interface HeavyUserRow { userId: string; email: string; requests: number; peakPerMinute: number; throttledMinutes: number; flagged: boolean }

interface CountRow { label: string; count: number; extra?: number }
interface Behavior {
  days: number;
  daily: Array<{ day: string; views: number; sessions: number; users: number }>;
  dau: number; wau: number; mau: number;
  sessions7d: number;
  avgSessionSeconds: number | null;
  bounceRate: number | null;
  topStocks: CountRow[];
  sections: CountRow[];
  referrers: CountRow[];
  devices: CountRow[];
  topPages: CountRow[];
  returningUsers7d: number;
}

interface DashboardData {
  behavior: Behavior;
  activity: Activity;
  heavyUsers: HeavyUserRow[];
  stats: Stats;
  todaysLogins: TodaysLoginRow[];
  recentSignups: RecentSignupRow[];
  telegramLinked: TelegramLinkedRow[];
  allUsers: AllUserRow[];
  usersByPlan: Record<string, PlanUserRow[]>;
}

type DrillKey = 'users' | 'signups' | 'telegram' | 'logins' | 'sessions' | 'pages' | 'errors' | 'heavy' | `plan:${string}`;
interface ModalState { metric: DrillMetric; title: string; preset: DrillPreset }
type OpenModal = (metric: DrillMetric, title: string, preset?: DrillPreset) => void;

const HistoryContext = createContext<(t: HistoryTarget) => void>(() => {});

/**
 * Clickable cell: opens the history of a signed-in user (`id`), or — for an
 * anonymous row that has a tracker session (`sessionId`) — that session's history.
 * (The history modal links on to the full /admin/users/[id] page.)
 */
function UserCell({ id, label, sessionId }: { id: string | null | undefined; label: string; sessionId?: string }) {
  const openHistory = useContext(HistoryContext);
  const target: HistoryTarget | null = id
    ? { kind: 'user', id, label }
    : sessionId ? { kind: 'session', id: sessionId, label } : null;
  if (!target) return <>{label}</>;
  return (
    <button
      onClick={() => openHistory(target)}
      title={target.kind === 'user' ? 'Show this user’s history' : 'Show this session’s history'}
      className="text-blue-600 hover:underline text-left"
    >{label}</button>
  );
}

/** Short session id that opens that session's history. */
function SessionCell({ id }: { id: string }) {
  const openHistory = useContext(HistoryContext);
  return (
    <button onClick={() => openHistory({ kind: 'session', id, label: 'Session' })} title="Show this session’s history" className="font-mono text-blue-600 hover:underline">
      {id.slice(0, 8)}
    </button>
  );
}

/** Table shell for drills whose columns differ from the simple user list. */
function DataTable({ head, children, empty }: { head: string[]; children: React.ReactNode; empty: boolean }) {
  if (empty) return <p className="text-[11px] text-gray-400">Nothing here.</p>;
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
            {head.map((h, i) => <th key={h} className={`pb-1.5 pr-3 font-semibold whitespace-nowrap ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">{children}</tbody>
      </table>
    </div>
  );
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

/** A section title that opens the period drill-down. */
function TitleButton({ title, onClick, className = 'text-xs' }: { title: string; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      title="Open drill-down with period filters"
      className={`${className} font-semibold text-gray-700 hover:text-blue-600 underline decoration-dotted underline-offset-4 text-left`}
    >
      {title} <span aria-hidden className="text-[10px] text-gray-400">↗</span>
    </button>
  );
}

/** Generic "list of users" table — most drills reduce to this shape. */
function UserTable({ rows }: { rows: Array<{ id: string | null; email: string; sub: string; timestamp?: string }> }) {
  if (rows.length === 0) return <p className="text-[11px] text-gray-400">Nothing here.</p>;
  return (
    <div className="max-h-96 overflow-y-auto">
      <table className="w-full text-xs">
        <tbody className="divide-y divide-gray-50">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1.5 pr-3 font-medium text-gray-700 whitespace-nowrap"><UserCell id={r.id} label={r.email} /></td>
              <td className="py-1.5 text-gray-500">{r.sub}</td>
              {r.timestamp && <td className="py-1.5 text-right text-gray-400 whitespace-nowrap">{formatCT(r.timestamp)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DrillPanel({ title, count, onClose, onExpand, children }: { title: string; count: number; onClose: () => void; onExpand?: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-blue-200 ring-1 ring-blue-100 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-xs font-semibold text-gray-700">{title}</h3>
          <p className="text-[11px] text-gray-400">{count} row{count === 1 ? '' : 's'}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onExpand && <button onClick={onExpand} className="text-blue-600 hover:text-blue-800 text-xs font-semibold px-2 py-1">View over time ↗</button>}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs font-semibold px-2 py-1">✕ Close</button>
        </div>
      </div>
      {children}
    </div>
  );
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return '—';
  return sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
}

/** Ranked list with proportional bars — used for stocks, sections, referrers, devices, pages. */
function RankList({ title, subtitle, rows, empty, onOpen, extraSuffix = 'sess.', barClass = 'bg-blue-500' }: {
  title: string; subtitle?: string; rows: CountRow[]; empty: string; onOpen: () => void; extraSuffix?: string; barClass?: string;
}) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <TitleButton title={title} onClick={onOpen} />
      {subtitle && <p className="text-[11px] text-gray-400 mb-2">{subtitle}</p>}
      {rows.length === 0 ? <p className="text-[11px] text-gray-400 mt-2">{empty}</p> : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto mt-2">
          {rows.map(r => (
            <div key={r.label} className="flex items-center gap-2 text-xs">
              <span className="w-24 sm:w-28 shrink-0 truncate font-medium text-gray-600" title={r.label}>{r.label}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full ${barClass} rounded-full`} style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
              <span className="w-10 text-right font-mono text-gray-500">{r.count}</span>
              {r.extra != null && <span className="hidden sm:inline w-16 text-right text-[10px] text-gray-400">{r.extra}{extraSuffix === 's' ? 's avg' : ` ${extraSuffix}`}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TrendChart({ daily, onOpen }: { daily: Behavior['daily']; onOpen: () => void }) {
  const max = Math.max(1, ...daily.map(d => d.views));
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <TitleButton title={`Traffic — last ${daily.length} days`} onClick={onOpen} />
      <p className="text-[11px] text-gray-400 mb-3">Light bar = page views, dark = sessions. Central Time days. Hover a bar for details.</p>
      <div className="flex items-end gap-1 h-32">
        {daily.map(d => (
          <div key={d.day} className="flex-1 h-full flex flex-col justify-end min-w-0" title={`${d.day}: ${d.views} views, ${d.sessions} sessions, ${d.users} signed-in users`}>
            <div className="w-full bg-blue-200 rounded-t relative" style={{ height: `${(d.views / max) * 100}%`, minHeight: d.views ? 2 : 0 }}>
              <div className="absolute bottom-0 inset-x-0 bg-blue-600 rounded-t" style={{ height: d.views ? `${Math.min(100, (d.sessions / d.views) * 100)}%` : 0 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{daily[0]?.day.slice(5)}</span>
        <span>{daily[daily.length - 1]?.day.slice(5)}</span>
      </div>
    </div>
  );
}

function FunnelCard({ data, onOpen }: { data: DashboardData; onOpen: OpenModal }) {
  const { stats, behavior } = data;
  const paid = stats.planDistribution.filter(p => p.code !== 'FREE').reduce((n, p) => n + p.count, 0);
  const steps = [
    { label: 'Visitor sessions (7d)', value: behavior.sessions7d },
    { label: 'Signups (7d)', value: stats.signupsLast7Days },
    { label: 'Total users', value: stats.totalUsers },
    { label: 'On a paid plan', value: paid },
  ];
  const top = Math.max(1, ...steps.map(x => x.value));
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <TitleButton title="Funnel & retention" onClick={() => onOpen('funnel', 'Funnel & retention', '7d')} />
      <p className="text-[11px] text-gray-400 mb-3">Visitors to paying users, plus how many come back.</p>
      <div className="space-y-2">
        {steps.map(st => (
          <div key={st.label} className="flex items-center gap-2 text-xs">
            <span className="w-32 sm:w-40 shrink-0 text-gray-600">{st.label}</span>
            <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(st.value / top) * 100}%` }} />
            </div>
            <span className="w-10 text-right font-mono text-gray-500">{st.value}</span>
          </div>
        ))}
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100">
          <div className="rounded-lg bg-gray-50 px-2 py-2 text-center">
            <div className="text-sm font-bold text-gray-900">{behavior.returningUsers7d}</div>
            <div className="text-[10px] text-gray-400">returning (2+ days this week)</div>
          </div>
          <div className="rounded-lg bg-gray-50 px-2 py-2 text-center">
            <div className="text-sm font-bold text-gray-900">{behavior.wau > 0 ? `${Math.round((behavior.returningUsers7d / behavior.wau) * 100)}%` : '—'}</div>
            <div className="text-[10px] text-gray-400">of weekly active</div>
          </div>
          <div className="rounded-lg bg-gray-50 px-2 py-2 text-center">
            <div className="text-sm font-bold text-gray-900">{behavior.mau > 0 ? `${Math.round((behavior.dau / behavior.mau) * 100)}%` : '—'}</div>
            <div className="text-[10px] text-gray-400">DAU / MAU stickiness</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drillKey, setDrillKey] = useState<DrillKey | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [history, setHistory] = useState<HistoryTarget | null>(null);

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
  const open: OpenModal = (metric, title, preset = '7d') => setModal({ metric, title, preset });

  const maxPlanCount = useMemo(() => Math.max(1, ...(data?.stats.planDistribution.map(p => p.count) ?? [1])), [data]);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!data) return <p className="text-xs text-gray-400">Loading…</p>;

  const { stats, behavior } = data;
  const close = () => setDrillKey(null);

  return (
    <HistoryContext.Provider value={setHistory}>
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">All times are shown in Central Time (CST/CDT), and “today” means the current Central day. Click a user or session to see its history.</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Total users" value={String(stats.totalUsers)} onClick={() => toggle('users')} active={drillKey === 'users'} />
        <StatTile label="Signups (7 days)" value={String(stats.signupsLast7Days)} onClick={() => toggle('signups')} active={drillKey === 'signups'} />
        <StatTile label="Telegram linked" value={String(stats.telegramLinkedCount)} onClick={() => toggle('telegram')} active={drillKey === 'telegram'} />
        <StatTile label="Logins today" value={String(stats.loginsToday)} onClick={() => toggle('logins')} active={drillKey === 'logins'} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Active sessions today" value={String(data.activity.activeSessionsToday)} onClick={() => toggle('sessions')} active={drillKey === 'sessions'} />
        <StatTile label="Page views today" value={String(data.activity.pageViewsToday)} onClick={() => toggle('pages')} active={drillKey === 'pages'} />
        <StatTile label="Errors today" value={String(data.activity.errorsToday)} onClick={() => toggle('errors')} active={drillKey === 'errors'} />
        <StatTile label="Heavy API users (24h)" value={String(data.heavyUsers.length)} onClick={() => toggle('heavy')} active={drillKey === 'heavy'} />
      </div>

      {drillKey === 'sessions' && (
        <DrillPanel title="Active sessions today" count={data.activity.activeSessions.length} onClose={close} onExpand={() => open('sessions', 'Sessions', 'today')}>
          <DataTable head={['Who', 'Session', 'Pageviews', 'Last seen']} empty={data.activity.activeSessions.length === 0}>
            {data.activity.activeSessions.map(s => (
              <tr key={s.sessionId + s.lastSeen}>
                <td className="py-1.5 pr-3 font-medium text-gray-700 whitespace-nowrap"><UserCell id={s.userId} label={s.who} sessionId={s.sessionId} /></td>
                <td className="py-1.5 pr-3 text-right"><SessionCell id={s.sessionId} /></td>
                <td className="py-1.5 pr-3 text-right text-gray-500">{s.pageviews}</td>
                <td className="py-1.5 text-right text-gray-400 whitespace-nowrap">{formatCT(s.lastSeen)}</td>
              </tr>
            ))}
          </DataTable>
        </DrillPanel>
      )}
      {drillKey === 'pages' && (
        <DrillPanel title="Top pages today" count={data.activity.topPages.length} onClose={close} onExpand={() => open('pages', 'Top pages', 'today')}>
          <DataTable head={['Path', 'Views', 'Avg time']} empty={data.activity.topPages.length === 0}>
            {data.activity.topPages.map(p => (
              <tr key={p.path}>
                <td className="py-1.5 pr-3 font-medium text-gray-700 break-all">{p.path}</td>
                <td className="py-1.5 pr-3 text-right text-gray-500">{p.views}</td>
                <td className="py-1.5 text-right text-gray-400 whitespace-nowrap">{p.avgSeconds == null ? '—' : `${p.avgSeconds}s`}</td>
              </tr>
            ))}
          </DataTable>
        </DrillPanel>
      )}
      {drillKey === 'errors' && (
        <DrillPanel title="Errors today" count={data.activity.errors.length} onClose={close} onExpand={() => open('errors', 'Errors', 'today')}>
          <DataTable head={['User', 'Path', 'Message', 'Time']} empty={data.activity.errors.length === 0}>
            {data.activity.errors.map((er, i) => (
              <tr key={i}>
                <td className="py-1.5 pr-3 font-medium text-gray-700 whitespace-nowrap"><UserCell id={er.userId} label={er.email ?? 'Anonymous'} /></td>
                <td className="py-1.5 pr-3 text-right text-gray-700 break-all">{er.path ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right text-red-600 break-words">
                  {er.message ?? er.kind}
                  {er.stack && (
                    <details className="text-left mt-0.5">
                      <summary className="text-[10px] text-gray-400 cursor-pointer select-none text-right">stack</summary>
                      <pre className="text-[10px] text-gray-500 whitespace-pre-wrap break-all font-mono">{er.stack}</pre>
                    </details>
                  )}
                </td>
                <td className="py-1.5 text-right text-gray-400 whitespace-nowrap">{formatCT(er.createdAt)}</td>
              </tr>
            ))}
          </DataTable>
        </DrillPanel>
      )}
      {drillKey === 'heavy' && (
        <DrillPanel title="Heavy API users — last 24h" count={data.heavyUsers.length} onClose={close} onExpand={() => open('heavy', 'Heavy API users', 'today')}>
          <DataTable head={['User', 'Requests', 'Peak/min', 'Throttled min']} empty={data.heavyUsers.length === 0}>
            {data.heavyUsers.map(u => (
              <tr key={u.userId} className={u.flagged ? 'bg-red-50' : undefined}>
                <td className={`py-1.5 pr-3 pl-1 font-medium whitespace-nowrap ${u.flagged ? 'text-red-700' : 'text-gray-700'}`}><UserCell id={u.userId} label={u.email} /></td>
                <td className="py-1.5 pr-3 text-right text-gray-500">{u.requests}</td>
                <td className="py-1.5 pr-3 text-right text-gray-500">{u.peakPerMinute}</td>
                <td className="py-1.5 pr-1 text-right text-gray-500">{u.throttledMinutes}</td>
              </tr>
            ))}
          </DataTable>
        </DrillPanel>
      )}

      {drillKey === 'users' && (
        <DrillPanel title="All users" count={data.allUsers.length} onClose={close} onExpand={() => open('users', 'Users joined', '30d')}>
          <UserTable rows={data.allUsers.map(u => ({ id: u.id, email: u.email, sub: u.id.slice(0, 8), timestamp: u.createdAt }))} />
        </DrillPanel>
      )}
      {drillKey === 'signups' && (
        <DrillPanel title="Signups — last 7 days" count={data.recentSignups.length} onClose={close} onExpand={() => open('signups', 'Signups', '7d')}>
          <UserTable rows={data.recentSignups.map(u => ({ id: u.id, email: u.email, sub: u.name ?? '—', timestamp: u.createdAt }))} />
        </DrillPanel>
      )}
      {drillKey === 'telegram' && (
        <DrillPanel title="Telegram linked" count={data.telegramLinked.length} onClose={close} onExpand={() => open('telegram', 'Telegram linked', '90d')}>
          <UserTable rows={data.telegramLinked.map(u => ({ id: u.userId, email: u.email, sub: 'linked', timestamp: u.telegramLinkedAt ?? undefined }))} />
        </DrillPanel>
      )}
      {drillKey === 'logins' && (
        <DrillPanel title="Logins today" count={data.todaysLogins.length} onClose={close} onExpand={() => open('logins', 'Logins', 'today')}>
          <UserTable rows={data.todaysLogins.map(l => ({ id: l.userId, email: l.email, sub: l.ipAddress ?? '—', timestamp: l.createdAt }))} />
        </DrillPanel>
      )}
      {drillKey?.startsWith('plan:') && (() => {
        const code = drillKey.slice('plan:'.length);
        const rows = data.usersByPlan[code] ?? [];
        return (
          <DrillPanel title={`Plan: ${code}`} count={rows.length} onClose={close}>
            <UserTable rows={rows.map(u => ({ id: u.userId, email: u.email, sub: u.planExpiresAt ? `expires ${formatCT(u.planExpiresAt)}` : 'no expiry' }))} />
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

      <div className="pt-2">
        <h2 className="text-sm font-semibold text-gray-700">User behavior</h2>
        <p className="text-[11px] text-gray-400">From first-party activity tracking (page arrivals and exits). Stats start when tracking was deployed. Click any title or tile to open a drill-down with period filters.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="DAU (signed-in)" value={String(behavior.dau)} onClick={() => open('funnel', 'Daily active users', '7d')} />
        <StatTile label="WAU" value={String(behavior.wau)} onClick={() => open('funnel', 'Weekly active users', '30d')} />
        <StatTile label="MAU" value={String(behavior.mau)} onClick={() => open('funnel', 'Monthly active users', '30d')} />
        <StatTile label="Sessions (7d)" value={String(behavior.sessions7d)} onClick={() => open('sessions', 'Sessions', '7d')} />
        <StatTile label="Avg session" value={fmtDuration(behavior.avgSessionSeconds)} onClick={() => open('sessions', 'Sessions', '7d')} />
        <StatTile label="Bounce rate" value={behavior.bounceRate == null ? '—' : `${Math.round(behavior.bounceRate * 100)}%`} onClick={() => open('sessions', 'Sessions', '7d')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TrendChart daily={behavior.daily} onOpen={() => open('pages', 'Traffic', '30d')} />
        <FunnelCard data={data} onOpen={open} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <RankList title="Most viewed stocks — 7 days" subtitle="By page views" rows={behavior.topStocks} empty="No stock page views yet." onOpen={() => open('stocks', 'Most viewed stocks', '7d')} />
        <RankList title="Top pages — 7 days" subtitle="By page views, with average time on page" rows={behavior.topPages} empty="No page views yet." extraSuffix="s" barClass="bg-indigo-500" onOpen={() => open('pages', 'Top pages', '7d')} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <RankList title="Sections used — 7 days" subtitle="By page views" rows={behavior.sections} empty="No page views yet." barClass="bg-emerald-500" onOpen={() => open('sections', 'Sections used', '7d')} />
        <RankList title="Traffic sources — 7 days" subtitle="External referrers" rows={behavior.referrers} empty="No external referrers yet (direct traffic only)." barClass="bg-amber-500" onOpen={() => open('referrers', 'Traffic sources', '7d')} />
        <RankList title="Devices — 7 days" subtitle="Sessions" rows={behavior.devices} empty="No sessions yet." barClass="bg-violet-500" onOpen={() => open('devices', 'Devices', '7d')} />
      </div>

      {modal && <DrillModal metric={modal.metric} title={modal.title} initialPreset={modal.preset} onClose={() => setModal(null)} onHistory={setHistory} />}
      {history && (
        <HistoryModal
          target={history}
          onClose={() => setHistory(null)}
          onOpenSession={(id, label) => setHistory({ kind: 'session', id, label })}
        />
      )}
    </div>
    </HistoryContext.Provider>
  );
}
