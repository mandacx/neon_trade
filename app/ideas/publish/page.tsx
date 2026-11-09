'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { IDEA_HORIZONS, RISK_RATINGS, riskReward, type IdeaOptionStrategy } from '@/lib/ideaTypes';
import {
  DirectionPill, HorizonPill, IdeaDisclaimer, OutcomePill, Spinner, StatusPill, api, fmtDay, fmtPrice, fmtR, fmtWhen, inputClass, labelClass, rTone,
  type DisclaimerData,
} from '@/components/ideas/ideaUi';
import type { IdeaPreview, IdeaView } from '@/lib/ideas';

interface Form {
  id: string | null;
  symbol: string; direction: 'long' | 'short'; horizon: string; title: string; rationale: string;
  entryLow: string; entryHigh: string; stop: string; validUntil: string; riskRating: string;
  targets: string[];
  useOption: boolean;
  option: { name: string; expiry: string; note: string; legs: Array<{ side: 'buy' | 'sell'; type: 'call' | 'put'; strike: string; qty: string }> };
}

const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const blank = (): Form => ({
  id: null, symbol: '', direction: 'long', horizon: 'swing', title: '', rationale: '', entryLow: '', entryHigh: '', stop: '', validUntil: plusDays(30),
  riskRating: 'medium', targets: ['', ''], useOption: false,
  option: { name: '', expiry: '', note: '', legs: [{ side: 'buy', type: 'call', strike: '', qty: '1' }] },
});

const n = (s: string) => (s.trim() === '' ? NaN : Number(s));

function toPayload(f: Form) {
  return {
    id: f.id ?? undefined,
    symbol: f.symbol, direction: f.direction, horizon: f.horizon, title: f.title, rationale: f.rationale,
    entryLow: n(f.entryLow), entryHigh: n(f.entryHigh), stop: n(f.stop), validUntil: f.validUntil, riskRating: f.riskRating,
    targets: f.targets.filter(t => t.trim() !== '').map(t => ({ price: Number(t) })),
    optionStrategy: f.useOption
      ? { name: f.option.name, expiry: f.option.expiry || null, note: f.option.note || null, legs: f.option.legs.map(l => ({ side: l.side, type: l.type, strike: Number(l.strike), qty: Number(l.qty) })) } satisfies IdeaOptionStrategy
      : null,
  };
}

function fromIdea(i: IdeaView): Form {
  const o = i.optionStrategy;
  return {
    id: i.id, symbol: i.symbol, direction: i.direction as 'long' | 'short', horizon: i.horizon, title: i.title, rationale: i.rationale,
    entryLow: String(i.entryLow), entryHigh: String(i.entryHigh), stop: String(i.stop), validUntil: i.validUntil, riskRating: i.riskRating,
    targets: i.targets.map(t => String(t.price)), useOption: !!o,
    option: { name: o?.name ?? '', expiry: o?.expiry ?? '', note: o?.note ?? '', legs: (o?.legs ?? []).map(l => ({ side: l.side, type: l.type, strike: String(l.strike), qty: String(l.qty) })) },
  };
}

export default function PublishPage() {
  const [form, setForm] = useState<Form>(blank);
  const [managed, setManaged] = useState<IdeaView[] | null>(null);
  const [disclaimer, setDisclaimer] = useState<DisclaimerData | null>(null);
  const [preview, setPreview] = useState<IdeaPreview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');

  const loadManaged = useCallback(() => {
    api<{ items: IdeaView[]; disclaimer: DisclaimerData }>('/api/ideas/managed')
      .then(d => { setManaged(d.items); setDisclaimer(d.disclaimer); })
      .catch(e => { if (e.status === 403) setForbidden(true); else setErrors([e.message]); });
  }, []);
  useEffect(loadManaged, [loadManaged]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm(f => ({ ...f, [k]: v })); setPreview(null); setNotice(null); };

  // Live reward : risk readout while typing.
  const live = useMemo(() => {
    const entryLow = n(form.entryLow), entryHigh = n(form.entryHigh), stop = n(form.stop);
    const targets = form.targets.map(n).filter(x => Number.isFinite(x)).map(price => ({ price }));
    if (![entryLow, entryHigh, stop].every(Number.isFinite) || targets.length === 0) return null;
    const rr = riskReward({ direction: form.direction, entryLow, entryHigh, stop, targets });
    return rr.risk > 0 ? rr : null;
  }, [form.entryLow, form.entryHigh, form.stop, form.targets, form.direction]);

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(label); setErrors([]); setNotice(null);
    try { return await fn(); }
    catch (e: any) { setErrors(e.details?.length ? e.details : [e.message ?? 'Failed']); return null; }
    finally { setBusy(null); }
  }

  const doPreview = () => run('preview', async () => {
    const p = await api<IdeaPreview>('/api/ideas?dry_run=true', { method: 'POST', body: JSON.stringify(toPayload(form)) });
    setPreview(p);
    return p;
  });

  const doSave = async (): Promise<string | null> => {
    const r = await run('save', () => api<{ id: string }>('/api/ideas', { method: 'POST', body: JSON.stringify(toPayload(form)) }));
    if (!r) return null;
    setForm(f => ({ ...f, id: r.id }));
    setNotice('Draft saved.');
    loadManaged();
    return r.id;
  };

  const doPublish = async () => {
    if (!window.confirm('Publish this idea? Subscribers on the matching plans are alerted, and the entry, targets and stop can never be edited afterwards.')) return;
    // Always save first, so what is published is exactly what the preview showed (not an older stored draft).
    const id = await doSave();
    if (!id) return;
    const done = await run('publish', () => api(`/api/ideas/${id}/publish`, { method: 'POST' }));
    if (done) { setForm(blank()); setPreview(null); setNotice(`Published. View it at /ideas/${id}.`); loadManaged(); }
  };

  const doSchedule = async () => {
    if (!scheduleAt) { setErrors(['Pick the date and time to publish.']); return; }
    const at = new Date(scheduleAt);
    if (Number.isNaN(at.getTime())) { setErrors(['Pick a valid date and time.']); return; }
    const id = await doSave();
    if (!id) return;
    const done = await run('schedule', () => api<{ scheduledFor: string }>(`/api/ideas/${id}/schedule`, { method: 'POST', body: JSON.stringify({ at: at.toISOString() }) }));
    if (done) {
      setForm(blank()); setPreview(null); setScheduleAt('');
      setNotice(`Scheduled for ${fmtWhen(done.scheduledFor)}. It publishes on the tracker's first run after that time (every 30 minutes) and can be edited until then.`);
      loadManaged();
    }
  };

  const doUnschedule = async (id: string) => {
    const r = await run('unschedule', () => api(`/api/ideas/${id}/schedule`, { method: 'DELETE' }));
    if (r) { setNotice('Schedule removed; it is a plain draft again.'); loadManaged(); }
  };

  const doDelete = async (id: string) => {
    if (!window.confirm('Delete this draft?')) return;
    const r = await run('delete', () => api(`/api/ideas/${id}`, { method: 'DELETE' }));
    if (r) { if (form.id === id) setForm(blank()); loadManaged(); }
  };

  const doEvaluate = async () => {
    const r = await run('evaluate', () => api<{ evaluated: number; finished: number; errors: number }>('/api/ideas/evaluate', { method: 'POST', body: JSON.stringify({}) }));
    if (r) { setNotice(`Tracker ran: ${r.evaluated} idea(s) scored, ${r.finished} finished, ${r.errors} error(s).`); loadManaged(); }
  };

  if (forbidden) {
    return <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-600">Publishing ideas is not enabled for your account. Admins can grant the &ldquo;Publish trade ideas&rdquo; feature per user in /admin/users.</div>;
  }

  const drafts = managed?.filter(i => i.status === 'draft' || i.status === 'scheduled') ?? [];
  const published = managed?.filter(i => i.status !== 'draft' && i.status !== 'scheduled') ?? [];
  const field = (label: string, el: React.ReactNode) => <div><label className={labelClass}>{label}</label>{el}</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-900">{form.id ? `Editing draft #${form.id}` : 'New idea'}</h2>
          {form.id && <button className="text-xs text-gray-500 underline" onClick={() => { setForm(blank()); setPreview(null); }}>start a new one</button>}
        </div>
        <p className="text-[11px] text-gray-500">An idea is a published thesis plus a plan. It is not your position and not a subscriber&apos;s trade. Once published, the entry zone, targets, stop and horizon are frozen and are what get scored.</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {field('Symbol', <input className={`${inputClass} w-full uppercase`} value={form.symbol} onChange={e => set('symbol', e.target.value.toUpperCase())} placeholder="AAPL" />)}
          {field('Direction', <select className={`${inputClass} w-full`} value={form.direction} onChange={e => set('direction', e.target.value as 'long' | 'short')}><option value="long">Long</option><option value="short">Short</option></select>)}
          {field('Horizon', <select className={`${inputClass} w-full`} value={form.horizon} onChange={e => set('horizon', e.target.value)}>{IDEA_HORIZONS.map(h => <option key={h.key} value={h.key}>{h.label} ({h.term === 'short' ? 'short-term plans' : 'long-term plans'})</option>)}</select>)}
          {field('Risk rating', <select className={`${inputClass} w-full`} value={form.riskRating} onChange={e => set('riskRating', e.target.value)}>{RISK_RATINGS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}</select>)}
        </div>
        {field('Title', <input className={`${inputClass} w-full`} value={form.title} onChange={e => set('title', e.target.value)} maxLength={140} placeholder="One line: the call" />)}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {field('Entry zone low', <input className={`${inputClass} w-full`} type="number" step="any" value={form.entryLow} onChange={e => set('entryLow', e.target.value)} />)}
          {field('Entry zone high', <input className={`${inputClass} w-full`} type="number" step="any" value={form.entryHigh} onChange={e => set('entryHigh', e.target.value)} />)}
          {field('Stop', <input className={`${inputClass} w-full`} type="number" step="any" value={form.stop} onChange={e => set('stop', e.target.value)} />)}
          {field('Valid until', <input className={`${inputClass} w-full`} type="date" value={form.validUntil} onChange={e => set('validUntil', e.target.value)} />)}
        </div>

        <div>
          <label className={labelClass}>Target ladder (equal split across targets)</label>
          <div className="flex flex-wrap gap-2 items-center">
            {form.targets.map((t, i) => (
              <input key={i} className={`${inputClass} w-24`} type="number" step="any" value={t} placeholder={`T${i + 1}`} aria-label={`Target ${i + 1}`}
                onChange={e => set('targets', form.targets.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
            {form.targets.length < 5 && <button className="text-xs font-semibold text-indigo-600" onClick={() => set('targets', [...form.targets, ''])}>＋ target</button>}
            {form.targets.length > 1 && <button className="text-xs text-gray-500" onClick={() => set('targets', form.targets.slice(0, -1))}>remove last</button>}
          </div>
        </div>

        <div className={`rounded-lg border px-3 py-2 text-xs ${live ? 'border-indigo-200 bg-indigo-50 text-indigo-900' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
          {live
            ? <>Risk per share <b>{fmtPrice(live.risk)}</b> (from {form.direction === 'short' ? 'zone low' : 'zone high'} to the stop). Reward : risk <b>{live.blended?.toFixed(2)} : 1</b> blended · {live.perTarget.map((x, i) => `T${i + 1} ${x.toFixed(1)}R`).join(' · ')}</>
            : 'Enter the entry zone, stop and at least one target to see reward : risk.'}
        </div>

        {field('Rationale', <textarea className={`${inputClass} w-full`} rows={5} value={form.rationale} onChange={e => set('rationale', e.target.value)} maxLength={8000} placeholder="Why this idea, what invalidates it" />)}

        <div className="rounded-lg border border-gray-200 p-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <input type="checkbox" checked={form.useOption} onChange={e => set('useOption', e.target.checked)} /> Attach an option strategy (reference only; the idea is scored on the underlying)
          </label>
          {form.useOption && (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-2 gap-3">
                {field('Strategy name', <input className={`${inputClass} w-full`} value={form.option.name} onChange={e => set('option', { ...form.option, name: e.target.value })} placeholder="Bull call spread" />)}
                {field('Expiry', <input className={`${inputClass} w-full`} type="date" value={form.option.expiry} onChange={e => set('option', { ...form.option, expiry: e.target.value })} />)}
              </div>
              {form.option.legs.map((l, i) => {
                const upd = (patch: Partial<typeof l>) => set('option', { ...form.option, legs: form.option.legs.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={i} className="flex flex-wrap gap-2 items-center">
                    <select className={inputClass} value={l.side} onChange={e => upd({ side: e.target.value as 'buy' | 'sell' })}><option value="buy">Buy</option><option value="sell">Sell</option></select>
                    <input className={`${inputClass} w-16`} type="number" min={1} value={l.qty} onChange={e => upd({ qty: e.target.value })} aria-label="Quantity" />
                    <span className="text-xs text-gray-500">×</span>
                    <input className={`${inputClass} w-24`} type="number" step="any" placeholder="Strike" value={l.strike} onChange={e => upd({ strike: e.target.value })} aria-label="Strike" />
                    <select className={inputClass} value={l.type} onChange={e => upd({ type: e.target.value as 'call' | 'put' })}><option value="call">Call</option><option value="put">Put</option></select>
                    {form.option.legs.length > 1 && <button className="text-xs text-gray-500" onClick={() => set('option', { ...form.option, legs: form.option.legs.filter((_, j) => j !== i) })}>remove</button>}
                  </div>
                );
              })}
              {form.option.legs.length < 4 && <button className="text-xs font-semibold text-indigo-600" onClick={() => set('option', { ...form.option, legs: [...form.option.legs, { side: 'buy', type: 'call', strike: '', qty: '1' }] })}>＋ leg</button>}
              {field('Note', <input className={`${inputClass} w-full`} value={form.option.note} onChange={e => set('option', { ...form.option, note: e.target.value })} maxLength={1000} />)}
            </div>
          )}
        </div>

        {errors.length > 0 && <ul className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 list-disc pl-6">{errors.map(e => <li key={e}>{e}</li>)}</ul>}
        {notice && <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800">{notice}</div>}

        <div className="flex flex-wrap gap-2">
          <button onClick={doPreview} disabled={!!busy} className="px-3 py-1.5 rounded-lg bg-white border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">{busy === 'preview' ? 'Checking…' : 'Preview what subscribers get'}</button>
          <button onClick={doSave} disabled={!!busy} className="px-3 py-1.5 rounded-lg bg-white border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
          <button onClick={doPublish} disabled={!!busy || !preview} title={preview ? '' : 'Preview first'} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">{busy === 'publish' ? 'Publishing…' : 'Publish'}</button>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
          <div>
            <label className={labelClass}>Or publish automatically at (your local time)</label>
            <input type="datetime-local" className={inputClass} value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} />
          </div>
          <button onClick={doSchedule} disabled={!!busy || !preview || !scheduleAt} title={preview ? '' : 'Preview first'} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-50">{busy === 'schedule' ? 'Scheduling…' : 'Schedule'}</button>
        </div>
        <p className="text-[11px] text-gray-400">Publishing or scheduling needs a preview of the current values first. A scheduled idea stays private and editable until it goes live; its entry zone, targets and stop freeze at that moment. The tracker runs every 30 minutes, so the actual time can be up to 30 minutes later.</p>
      </div>

      <div className="lg:col-span-2 space-y-4">
        {preview && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-gray-900">Preview</h3>
            {preview.warnings.map(w => <div key={w} className="rounded-lg bg-amber-50 border border-amber-300 px-3 py-2 text-xs text-amber-900">{w}</div>)}
            <div className="text-xs text-gray-600">Last close {preview.refPrice == null ? 'unavailable' : fmtPrice(preview.refPrice)} · reward : risk {preview.riskReward.blended?.toFixed(2)} : 1</div>
            <div>
              <div className={labelClass}>Who sees it</div>
              <ul className="text-xs space-y-1">
                {preview.tiers.map(t => (
                  <li key={t.tier} className="flex gap-2"><span className={t.sees ? 'text-green-700 font-bold' : 'text-gray-400 font-bold'}>{t.sees ? '✓' : '✗'}</span><span><b>{t.label}</b>{t.reason ? <span className="text-gray-500"> · {t.reason}</span> : ''}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <div className={labelClass}>Alert (in-app and email)</div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs">
                <div className="font-semibold text-gray-800">{preview.alert.subject}</div>
                <div className="text-gray-600 mt-0.5">{preview.alert.summary}</div>
              </div>
              <div className="mt-2"><IdeaDisclaimer data={preview.alert.disclaimer} variant="banner" /></div>
            </div>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-bold text-gray-900">Your ideas</h3>
            <button onClick={doEvaluate} disabled={!!busy} className="ml-auto text-[11px] font-semibold text-indigo-600 underline underline-offset-2 disabled:opacity-60">{busy === 'evaluate' ? 'Running…' : 'Run tracker now'}</button>
          </div>
          {!managed ? <Spinner /> : managed.length === 0 ? <p className="text-xs text-gray-500">Nothing yet.</p> : (
            <div className="space-y-3">
              {drafts.length > 0 && (
                <div>
                  <div className={labelClass}>Drafts</div>
                  <ul className="divide-y divide-gray-100">
                    {drafts.map(i => (
                      <li key={i.id} className="py-1.5 flex flex-wrap items-center gap-2 text-xs">
                        <b>{i.symbol}</b><DirectionPill direction={i.direction} />{i.status === 'scheduled' && <StatusPill status="scheduled" />}<span className="text-gray-600 truncate flex-1" title={i.title}>{i.title}{i.scheduledFor ? ' · ' + fmtWhen(i.scheduledFor) : ''}</span>
                        <button className="text-indigo-600 font-semibold" onClick={() => { setForm(fromIdea(i)); setPreview(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>edit</button>
                        {i.status === 'scheduled' && <button className="text-amber-700 font-semibold" onClick={() => doUnschedule(i.id)}>unschedule</button>}
                        <button className="text-red-600" onClick={() => doDelete(i.id)}>delete</button>
                        {i.scheduleError && <div className="w-full text-[11px] text-red-700 bg-red-50 rounded px-2 py-1">Scheduled publish failed: {i.scheduleError}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <div className={labelClass}>Published</div>
                {published.length === 0 ? <p className="text-xs text-gray-500">None yet.</p> : (
                  <ul className="divide-y divide-gray-100">
                    {published.map(i => (
                      <li key={i.id} className="py-1.5">
                        <Link href={`/ideas/${i.id}`} className="flex flex-wrap items-center gap-1.5 text-xs hover:bg-gray-50 rounded">
                          <b>{i.symbol}</b><DirectionPill direction={i.direction} /><HorizonPill horizon={i.horizon} /><StatusPill status={i.status} />
                          {i.outcome && <OutcomePill outcome={i.outcome.outcome} />}
                          {i.outcome?.r != null && <span className={`font-bold ${rTone(i.outcome.r)}`}>{fmtR(i.outcome.r)}</span>}
                          <span className="ml-auto text-gray-400">{i.publishedAt ? fmtDay(i.publishedAt.slice(0, 10)) : ''}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
        <IdeaDisclaimer data={disclaimer} variant="banner" />
      </div>
    </div>
  );
}
