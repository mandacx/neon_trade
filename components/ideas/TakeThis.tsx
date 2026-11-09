'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { IdeaDisclaimer, api, fmtPrice, inputClass, labelClass, type DisclaimerData } from '@/components/ideas/ideaUi';
import type { TakenPreview } from '@/lib/ideaTakenMath';
import type { IdeaView } from '@/lib/ideas';

interface Preview { qty: number; entryPrice: number; preview: TakenPreview; disclaimer: DisclaimerData }
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

/**
 * "I took this": record your own trade from an idea. You type your own quantity and price (nothing is pre-filled
 * with a quantity; the price has a helper button for the zone, but you must press it or type your own). A preview
 * is shown first. This is a personal record only: no order is placed anywhere.
 */
export default function TakeThis({ idea }: { idea: IdeaView }) {
  const open = ['live', 'triggered'].includes(idea.status);
  const [mine, setMine] = useState<{ id: string; qty: number; entryPrice: number; closed: boolean } | null | undefined>(undefined);
  const [show, setShow] = useState(false);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { api<{ taken: typeof mine }>(`/api/ideas/${idea.id}/taken`).then(d => setMine(d.taken)).catch(() => setMine(null)); }, [idea.id]);
  useEffect(load, [load]);

  const body = () => JSON.stringify({ qty: qty === '' ? null : Number(qty), entryPrice: price === '' ? null : Number(price), note });
  const fail = (e: any) => setErrors(e.details?.length ? e.details : [e.message ?? 'Failed']);

  async function doPreview() {
    setBusy(true); setErrors([]);
    try { setPreview(await api<Preview>(`/api/ideas/${idea.id}/taken?dry_run=true`, { method: 'POST', body: body() })); }
    catch (e) { setPreview(null); fail(e); }
    finally { setBusy(false); }
  }
  async function doSave() {
    setBusy(true); setErrors([]);
    try { await api(`/api/ideas/${idea.id}/taken`, { method: 'POST', body: body() }); setShow(false); setPreview(null); load(); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  }

  if (mine === undefined) return null;
  if (mine) {
    return (
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
        You recorded this idea: {mine.qty} @ {fmtPrice(mine.entryPrice)}{mine.closed ? ' (closed)' : ''}. <Link href="/ideas/mine" className="font-semibold underline">Open My trades</Link>
      </div>
    );
  }
  if (!open) return null;

  const zoneMid = idea.direction === 'short' ? idea.entryLow : idea.entryHigh;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setShow(true)} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700">✓ I took this</button>
        <span className="text-[11px] text-gray-500">Record your own trade to compare with the desk. Nothing is sent to a broker.</span>
      </div>
      {show && (
        <Modal title={`I took ${idea.symbol} (${idea.direction})`} onClose={() => setShow(false)} widthClassName="max-w-lg">
          <div className="space-y-3">
            <p className="text-xs text-gray-600">Enter what <b>you</b> bought or sold. This is your own private record; it does not place an order and nothing is assumed for you.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelClass}>Your quantity</label><input className={`${inputClass} w-full`} type="number" min="0" step="any" value={qty} onChange={e => { setQty(e.target.value); setPreview(null); }} placeholder="shares / units" /></div>
              <div>
                <label className={labelClass}>Your price</label>
                <input className={`${inputClass} w-full`} type="number" min="0" step="any" value={price} onChange={e => { setPrice(e.target.value); setPreview(null); }} placeholder={`zone ${fmtPrice(idea.entryLow)} – ${fmtPrice(idea.entryHigh)}`} />
                <button type="button" className="mt-1 text-[11px] text-indigo-600 underline" onClick={() => { setPrice(String(zoneMid)); setPreview(null); }}>use {fmtPrice(zoneMid)} (the zone&apos;s {idea.direction === 'short' ? 'low' : 'high'})</button>
              </div>
            </div>
            <div><label className={labelClass}>Note (optional)</label><input className={`${inputClass} w-full`} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></div>

            {errors.length > 0 && <ul className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 list-disc pl-6">{errors.map(e => <li key={e}>{e}</li>)}</ul>}

            {preview && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs space-y-1.5">
                <div className="font-bold text-gray-800">Preview at your numbers</div>
                {preview.preview.warnings.map(w => <div key={w} className="rounded bg-amber-50 border border-amber-300 px-2 py-1 text-amber-900">{w}</div>)}
                <div>Position value <b>{money(preview.preview.positionValue)}</b></div>
                <div>If the original stop ({fmtPrice(idea.stop)}) is hit you lose about <b className="text-red-700">{money(preview.preview.riskAmount)}</b> ({preview.preview.riskPct}% of your price)</div>
                <div className="space-y-0.5">
                  {preview.preview.atTarget.map((t, i) => <div key={i}>All out at T{i + 1} ({fmtPrice(t.price)}): <b className={t.profit >= 0 ? 'text-green-700' : 'text-red-700'}>{money(t.profit)}</b> <span className="text-gray-500">({t.r}R)</span></div>)}
                </div>
                <div className="text-[11px] text-gray-500">Before fees, slippage and taxes. The desk&apos;s tracked result will differ from yours.</div>
              </div>
            )}
            <IdeaDisclaimer data={preview?.disclaimer ?? null} variant="banner" />
            <div className="flex gap-2 justify-end">
              <button onClick={doPreview} disabled={busy} className="px-3 py-1.5 rounded-lg bg-white border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">{busy ? 'Working…' : 'Preview'}</button>
              <button onClick={doSave} disabled={busy || !preview} title={preview ? '' : 'Preview first'} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">Save to My trades</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
