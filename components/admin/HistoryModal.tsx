'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { HistoryKind, HistoryResult } from '@/lib/adminHistory';
import { formatCT } from '@/lib/time';

export interface HistoryTarget { kind: HistoryKind; id: string; label: string }

const dur = (s: number | null) => (s == null ? '' : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-bold text-gray-900 mt-0.5 break-words">{value}</div>
    </div>
  );
}

/** Marker attribute so other modals can tell a history modal is open on top of them. */
export const HISTORY_MODAL_ATTR = 'data-history-modal';

export default function HistoryModal({ target, onClose, onOpenSession }: {
  target: HistoryTarget;
  onClose: () => void;
  /** Lets a user's history jump into one of their sessions. */
  onOpenSession?: (sessionId: string, label: string) => void;
}) {
  const [data, setData] = useState<HistoryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true); setError(null); setData(null);
    fetch(`/api/admin/history?${target.kind}=${encodeURIComponent(target.id)}`)
      .then(r => r.json())
      .then(json => { if (json.success) setData(json.data); else setError(json.error ?? 'Failed to load'); })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false));
  }, [target.kind, target.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const heading = target.kind === 'user' ? 'User history' : 'Session history';

  return (
    <div {...{ [HISTORY_MODAL_ATTR]: '' }} className="fixed inset-0 z-[60] bg-black/40 flex items-start sm:items-center justify-center p-2 sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={heading}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900">{heading}: <span className="break-all">{data?.who ?? target.label}</span></h2>
            <p className="text-[11px] text-gray-400">
              {target.kind === 'session' && <>Session {target.id.slice(0, 8)} · </>}
              All times in Central Time
              {data && ` · ${data.events.length}${data.truncated ? '+' : ''} event${data.events.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {data?.userId && <Link href={`/admin/users/${data.userId}`} className="text-blue-600 hover:text-blue-800 text-xs font-semibold px-2 py-1">Open user page →</Link>}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs font-semibold px-2 py-1">✕ Close</button>
          </div>
        </div>

        <div className="p-4 overflow-auto space-y-4">
          {loading && <p className="text-xs text-gray-400">Loading…</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {data && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="First seen" value={formatCT(data.firstSeen)} />
                <Stat label="Last seen" value={formatCT(data.lastSeen)} />
                <Stat label="Page views" value={String(data.views)} />
                <Stat label="Errors" value={String(data.errors)} />
                {data.kind === 'user' && <Stat label="Sessions" value={String(data.sessions)} />}
                {data.device && <Stat label="Device" value={data.device} />}
                {data.kind === 'session' && <Stat label="Came from" value={data.referrer ?? 'Direct / unknown'} />}
              </div>

              {data.kind === 'user' && data.logins.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-700 mb-1">Recent logins <span className="font-normal text-gray-400">(latest {data.logins.length})</span></h3>
                  <ul className="text-xs text-gray-500 space-y-0.5">
                    {data.logins.map((l, i) => <li key={i}>{formatCT(l.createdAt)} · {l.ipAddress ?? 'IP unknown'}</li>)}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold text-gray-700 mb-1">Activity {data.kind === 'session' ? 'in this session' : 'timeline'} <span className="font-normal text-gray-400">(newest first)</span></h3>
                {data.events.length === 0 ? <p className="text-[11px] text-gray-400">No tracked activity.</p> : (
                  <div className="overflow-auto max-h-[50vh] border border-gray-100 rounded-lg">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-gray-50">
                        {data.events.map((e, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{formatCT(e.createdAt)}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap">
                              {e.kind === 'pageview'
                                ? <span className="text-gray-500">{e.durationSeconds == null ? 'Opened' : 'Left'}</span>
                                : <span className="text-red-600">Error</span>}
                            </td>
                            <td className="px-3 py-1.5 font-medium text-gray-700 break-all">
                              {e.path ?? '—'}
                              {e.message && <span className="block font-normal text-red-600 break-words">{e.message}</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right text-gray-400 whitespace-nowrap">
                              {dur(e.durationSeconds)}
                              {data.kind === 'user' && onOpenSession && (
                                <button
                                  onClick={() => onOpenSession(e.sessionId, data.who)}
                                  className="ml-2 text-blue-600 hover:underline"
                                  title="Open this session's history"
                                >{e.sessionId.slice(0, 8)}</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.truncated && <p className="text-[11px] text-amber-600 mt-1">Showing the newest 300 events.</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
