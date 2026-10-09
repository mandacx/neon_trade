import { getUserBehavior, type CountRow } from '@/lib/activity';
import { getUserApiUsage } from '@/lib/apiUsage';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

function Rank({ title, rows }: { title: string; rows: CountRow[] }) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-xs font-semibold text-gray-700 mb-2">{title}</h3>
      {rows.length === 0 ? <p className="text-[11px] text-gray-400">Nothing yet.</p> : (
        <div className="space-y-1.5">
          {rows.map(r => (
            <div key={r.label} className="flex items-center gap-2 text-xs">
              <span className="w-28 shrink-0 truncate font-medium text-gray-600" title={r.label}>{r.label}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
              <span className="w-8 text-right font-mono text-gray-500">{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Server component: tracked behavior for one user. Rendered under the admin layout, which gates access. */
export default async function UserBehaviorPanel({ userId }: { userId: string }) {
  const [b, api] = await Promise.all([getUserBehavior(userId), getUserApiUsage(userId)]);
  const dur = (s: number | null) => (s == null ? '—' : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-700">Behavior</h3>
        <p className="text-[11px] text-gray-400">
          {b.firstSeen
            ? <>First seen {fmtTime(b.firstSeen)} · last seen {b.lastSeen ? fmtTime(b.lastSeen) : '—'}</>
            : 'No tracked activity for this user yet (tracking only covers visits since it was deployed).'}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Page views" value={String(b.totalViews)} />
        <Stat label="Sessions" value={String(b.sessions)} />
        <Stat label="Active days (30d)" value={String(b.activeDays30d)} />
        <Stat label="Avg time on page" value={dur(b.avgPageSeconds)} />
        <Stat label="Errors hit" value={String(b.errors)} />
        <Stat label="API calls (24h)" value={api ? String(api.requests) : '0'} />
      </div>
      {api && (api.flagged || api.throttledMinutes > 0) && (
        <p className="text-[11px] text-red-600">
          Heavy API use: peak {api.peakPerMinute}/min, throttled in {api.throttledMinutes} minute window{api.throttledMinutes === 1 ? '' : 's'} (last 24h).
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Rank title="Top pages (30d)" rows={b.topPages} />
        <Rank title="Stocks viewed (30d)" rows={b.topStocks} />
        <Rank title="Devices (30d)" rows={b.devices} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-xs font-semibold text-gray-700 mb-2">Activity timeline <span className="font-normal text-gray-400">(latest {b.timeline.length})</span></h3>
        {b.timeline.length === 0 ? <p className="text-[11px] text-gray-400">Nothing yet.</p> : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-gray-50">
                {b.timeline.map((e, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-3 text-gray-400 whitespace-nowrap">{fmtTime(e.createdAt)}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {e.kind === 'pageview'
                        ? <span className="text-gray-500">{e.durationSeconds == null ? 'Opened' : 'Left'}</span>
                        : <span className="text-red-600">Error</span>}
                    </td>
                    <td className="py-1.5 pr-3 font-medium text-gray-700 break-all">{e.path ?? '—'}{e.message && <span className="block font-normal text-red-600 break-words">{e.message}</span>}</td>
                    <td className="py-1.5 text-right text-gray-400 whitespace-nowrap">{e.durationSeconds == null ? '' : dur(e.durationSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
