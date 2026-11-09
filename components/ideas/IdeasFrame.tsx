'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Header from '@/components/layout/Header';
import { IdeaDisclaimer, api, fmtWhen, type DisclaimerData } from '@/components/ideas/ideaUi';
import AlertChannels from '@/components/ideas/AlertChannels';

interface FeedItem { id: string; ideaId: string; type: string; summary: string; createdAt: string; unread: boolean }

const TAB = (active: boolean) => `px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${active ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`;

/**
 * Chrome for every Trade Ideas page: site header, section tabs, the alert feed (in-app channel) with the email
 * opt-in, the server-supplied disclaimer and the one-time acknowledgement. The disclaimer is shown in full on the
 * idea and performance pages and as a compact banner elsewhere (docs/trade-ideas.md, rule 9).
 */
export default function IdeasFrame({ canPublish, children }: { canPublish: boolean; children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const [disclaimer, setDisclaimer] = useState<DisclaimerData | null>(null);
  const [acknowledged, setAcknowledged] = useState(true);
  const [feed, setFeed] = useState<{ items: FeedItem[]; unread: number } | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [ackBusy, setAckBusy] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api<{ disclaimer: DisclaimerData; acknowledged: boolean }>('/api/ideas/disclaimer')
      .then(d => { if (alive) { setDisclaimer(d.disclaimer); setAcknowledged(d.acknowledged); } })
      .catch(() => {});
    api<{ items: FeedItem[]; unread: number }>('/api/ideas/feed').then(d => alive && setFeed(d)).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (feedRef.current && !feedRef.current.contains(e.target as Node)) setFeedOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const openFeed = useCallback(() => {
    setFeedOpen(v => !v);
    if (feed && feed.unread > 0) {
      api('/api/ideas/feed', { method: 'POST' }).catch(() => {});
      // Keep the "new" markers visible while the list is open; clear the badge.
      setFeed({ ...feed, unread: 0 });
    }
  }, [feed]);

  async function acknowledge() {
    setAckBusy(true);
    setAckError(null);
    try { await api('/api/ideas/disclaimer', { method: 'POST' }); setAcknowledged(true); }
    catch (e) { setAckError(e instanceof Error ? e.message : 'Could not save'); }
    finally { setAckBusy(false); }
  }

  const full = /^\/ideas\/(performance|\d+)/.test(pathname);

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h1 className="text-lg font-bold text-gray-900 mr-2">💡 Trade Ideas</h1>
            <Link href="/ideas" className={TAB(pathname === '/ideas')}>Board</Link>
            <Link href="/ideas/mine" className={TAB(pathname.startsWith('/ideas/mine'))}>My trades</Link>
            <Link href="/ideas/performance" className={TAB(pathname.startsWith('/ideas/performance'))}>Performance</Link>
            {canPublish && <Link href="/ideas/publish" className={TAB(pathname.startsWith('/ideas/publish'))}>Publish</Link>}
            <div className="ml-auto relative" ref={feedRef}>
              <button onClick={openFeed} className="relative px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-gray-700 border border-gray-200 hover:bg-gray-50" aria-label="Alerts">
                🔔 Alerts
                {feed && feed.unread > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold">{feed.unread}</span>}
              </button>
              {feedOpen && (
                <div className="absolute right-0 mt-1 w-80 max-w-[92vw] bg-white rounded-lg shadow-lg border border-gray-200 z-30">
                  <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
                    {!feed ? <div className="p-3 text-xs text-gray-400">Loading…</div> : feed.items.length === 0 ? (
                      <div className="p-3 text-xs text-gray-500">No alerts yet. New ideas and changes to ideas show up here.</div>
                    ) : feed.items.map(i => (
                      <Link key={i.id} href={`/ideas/${i.ideaId}`} onClick={() => setFeedOpen(false)} className={`block px-3 py-2 hover:bg-gray-50 ${i.unread ? 'bg-indigo-50/60' : ''}`}>
                        <div className="text-xs text-gray-800">{i.summary}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{fmtWhen(i.createdAt)}</div>
                      </Link>
                    ))}
                  </div>
                  <div className="px-3 py-2 border-t border-gray-100 space-y-1.5">
                    <AlertChannels />
                    <IdeaDisclaimer data={disclaimer} variant="banner" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {!full && <div className="mb-3"><IdeaDisclaimer data={disclaimer} variant="banner" /></div>}
          {children}
          <div className="mt-6"><IdeaDisclaimer data={disclaimer} variant="full" /></div>
        </div>
      </div>

      {!acknowledged && disclaimer && (
        <div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={disclaimer.title}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5">
            <h2 className="text-base font-bold text-gray-900 mb-1">Before you read trade ideas</h2>
            <p className="text-xs text-gray-500 mb-3">Please read and acknowledge this once. We store when you did.</p>
            <IdeaDisclaimer data={disclaimer} variant="full" />
            {ackError && <p className="mt-2 text-xs text-red-600">{ackError}</p>}
            <button onClick={acknowledge} disabled={ackBusy} className="mt-4 w-full px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
              {ackBusy ? 'Saving…' : 'I understand and agree'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
