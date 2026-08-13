'use client';

import { useEffect, useRef, useState } from 'react';

interface WatchlistOption {
  id: string;
  name: string;
  isSystem: boolean;
  symbolCount: number;
}

interface Status {
  linked: boolean;
  disabled: boolean;
  activeWatchlistId: string | null;
}

const LINK_POLL_MS = 3000;
const LINK_POLL_TIMEOUT_MS = 2 * 60 * 1000;

export default function TelegramCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [webLink, setWebLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [waitingForLink, setWaitingForLink] = useState(false);
  const [watchlists, setWatchlists] = useState<WatchlistOption[] | null>(null);
  const [selectedWatchlist, setSelectedWatchlist] = useState('');
  const [subscribing, setSubscribing] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadStatus() {
    const res = await fetch('/api/telegram/status');
    const json = await res.json();
    if (json.success) setStatus(json.data);
    return json.success ? (json.data as Status) : null;
  }

  useEffect(() => {
    (async () => {
      await loadStatus();
      setLoading(false);
    })();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  useEffect(() => {
    if (status?.linked && watchlists === null) {
      fetch('/api/watchlists')
        .then(res => res.json())
        .then(json => {
          if (json.success) {
            setWatchlists(json.data.watchlists);
            setSelectedWatchlist(status.activeWatchlistId ?? json.data.watchlists[0]?.id ?? '');
          }
        });
    }
  }, [status, watchlists]);

  function startPolling() {
    setWaitingForLink(true);
    const startedAt = Date.now();
    pollTimer.current = setInterval(async () => {
      const fresh = await loadStatus();
      if (fresh?.linked || Date.now() - startedAt > LINK_POLL_TIMEOUT_MS) {
        if (pollTimer.current) clearInterval(pollTimer.current);
        setWaitingForLink(false);
      }
    }, LINK_POLL_MS);
  }

  async function generateCode() {
    setGenerating(true);
    setError(null);
    const res = await fetch('/api/telegram/link', { method: 'POST' });
    const json = await res.json();
    setGenerating(false);
    if (!json.success) { setError(json.error ?? 'Could not generate a link code.'); return; }
    setCode(json.data.code);
    setDeepLink(json.data.deepLink);
    setWebLink(json.data.webLink);
    startPolling();
  }

  async function subscribe() {
    if (!selectedWatchlist) return;
    setSubscribing(true);
    setError(null);
    setSubscribed(false);
    const res = await fetch('/api/telegram/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watchlistId: selectedWatchlist }),
    });
    const json = await res.json();
    setSubscribing(false);
    if (!json.success) { setError(json.error ?? 'Could not subscribe.'); return; }
    setSubscribed(true);
    setStatus(s => (s ? { ...s, disabled: false, activeWatchlistId: selectedWatchlist } : s));
  }

  async function unlink() {
    setUnlinking(true);
    setError(null);
    const res = await fetch('/api/telegram/unlink', { method: 'POST' });
    const json = await res.json();
    setUnlinking(false);
    if (!json.success) { setError(json.error ?? 'Could not unlink.'); return; }
    setStatus({ linked: false, disabled: false, activeWatchlistId: null });
    setWatchlists(null);
    setCode(null);
    setDeepLink(null);
    setWebLink(null);
    setSubscribed(false);
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">📨 Telegram alerts</h3>
        <p className="text-xs text-gray-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-700">📨 Telegram alerts</h3>
        {status?.linked && (
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${status.disabled ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
            {status.disabled ? 'Paused' : 'Connected'}
          </span>
        )}
      </div>

      {!status?.linked && (
        <>
          <p className="text-xs text-gray-500 mb-3">Get scan alerts pushed straight to Telegram for any watchlist, the moment they fire.</p>
          {!code ? (
            <button
              onClick={generateCode}
              disabled={generating}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-40"
            >
              {generating ? 'Generating…' : 'Connect Telegram'}
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-600">
                Open Telegram and tap the link below to link your account (code expires in 15 minutes):
              </p>
              <a href={deepLink ?? '#'} target="_blank" rel="noopener noreferrer" className="block text-xs font-semibold text-blue-600 break-all">
                {deepLink}
              </a>
              <p className="text-[11px] text-gray-400">Code: <span className="font-mono font-semibold text-gray-600">{code}</span></p>
              {waitingForLink && <p className="text-[11px] text-gray-400">Waiting for confirmation…</p>}
              <div className="pt-2 border-t border-gray-100">
                <p className="text-[11px] text-gray-500">
                  Using Telegram in a browser? Desktop apps often don&apos;t offer a web option for this link.{' '}
                  <a href={webLink ?? '#'} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600">
                    Open Telegram Web
                  </a>{' '}
                  instead, then send this message to the bot:
                </p>
                <p className="text-[11px] font-mono font-semibold text-gray-600 mt-1">/start {code}</p>
              </div>
            </div>
          )}
        </>
      )}

      {status?.linked && (
        <div className="space-y-3">
          {status.disabled && (
            <p className="text-[11px] text-amber-600">Delivery paused after repeated failures. Pick a watchlist below to resume.</p>
          )}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Alert watchlist</label>
            {watchlists === null ? (
              <p className="text-xs text-gray-400">Loading watchlists…</p>
            ) : (
              <div className="flex gap-2">
                <select
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                  value={selectedWatchlist}
                  onChange={e => { setSelectedWatchlist(e.target.value); setSubscribed(false); }}
                >
                  {watchlists.length === 0 && <option value="">No watchlists yet</option>}
                  <optgroup label="My Watchlists">
                    {watchlists.filter(w => !w.isSystem).map(w => (
                      <option key={w.id} value={w.id}>{w.name} ({w.symbolCount})</option>
                    ))}
                  </optgroup>
                  <optgroup label="Sectors & Indices">
                    {watchlists.filter(w => w.isSystem).map(w => (
                      <option key={w.id} value={w.id}>{w.name} ({w.symbolCount})</option>
                    ))}
                  </optgroup>
                </select>
                <button
                  onClick={subscribe}
                  disabled={subscribing || !selectedWatchlist}
                  className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-40 shrink-0"
                >
                  {subscribing ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
            {subscribed && <p className="text-[11px] text-green-600 mt-1">Saved. Alerts will be sent for this watchlist.</p>}
          </div>
          <button onClick={unlink} disabled={unlinking} className="text-[11px] font-semibold text-gray-400 hover:text-red-600 disabled:opacity-40">
            {unlinking ? 'Unlinking…' : 'Unlink Telegram'}
          </button>
        </div>
      )}

      {error && <p className="text-[11px] text-red-600 mt-2">{error}</p>}
    </div>
  );
}
