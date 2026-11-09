'use client';

import { useState } from 'react';
import { outcomeMeta, statusMeta, riskMeta, horizonMeta, type CatalogEntry } from '@/lib/ideaTypes';

export interface DisclaimerData { version: string; title: string; short: string; bullets: string[] }

const TONE: Record<CatalogEntry['tone'], string> = {
  gray: 'bg-gray-100 text-gray-700',
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-green-50 text-green-700',
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-800',
  violet: 'bg-violet-50 text-violet-700',
};

export function Pill({ meta, title }: { meta: Pick<CatalogEntry, 'label' | 'tone'>; title?: string }) {
  return <span title={title} className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${TONE[meta.tone]}`}>{meta.label}</span>;
}
export const StatusPill = ({ status }: { status: string }) => <Pill meta={statusMeta(status)} title={statusMeta(status).description} />;
export const OutcomePill = ({ outcome }: { outcome: string }) => <Pill meta={outcomeMeta(outcome)} title={outcomeMeta(outcome).description} />;
export const RiskPill = ({ risk }: { risk: string }) => <Pill meta={riskMeta(risk)} />;
export const HorizonPill = ({ horizon }: { horizon: string }) => <Pill meta={horizonMeta(horizon)} title={horizonMeta(horizon).description} />;
export function DirectionPill({ direction }: { direction: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold uppercase ${direction === 'short' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>{direction}</span>;
}

export const fmtPrice = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
export const fmtR = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}R`);
export const fmtPct = (n: number | null | undefined, digits = 1) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`);
export const rTone = (n: number | null | undefined) => (n == null ? 'text-gray-500' : n > 0 ? 'text-green-700' : n < 0 ? 'text-red-700' : 'text-gray-700');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-11-20 -> "Nov 20, 2026" (string based; never parsed in local time). */
export function fmtDay(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(day)}, ${y}`;
}
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
}

/**
 * The risk disclaimer, as a designed element (brief rule 9). The wording always comes from the server
 * (lib/ideaDisclaimer.ts, via the API payload); this component never hardcodes it. The app is light-only (no dark
 * theme exists, see app/globals.css), so the colours are fixed light surfaces with enough contrast.
 *  - `full`: icon, title, bullet points (idea page, performance page, publisher preview)
 *  - `banner`: one line with "Read more" that opens the full text (board, alerts)
 */
export function IdeaDisclaimer({ data, variant = 'full' }: { data: DisclaimerData | null; variant?: 'full' | 'banner' }) {
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const full = (
    <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
      <div className="flex items-center gap-2 font-bold text-sm">
        <svg aria-hidden className="w-4 h-4 text-amber-600 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.49 2.6a1.7 1.7 0 0 1 3.02 0l6.1 11.6A1.7 1.7 0 0 1 16.1 16.7H3.9a1.7 1.7 0 0 1-1.5-2.5L8.5 2.6zM10 7a.9.9 0 0 0-.9.9v3.2a.9.9 0 1 0 1.8 0V7.9A.9.9 0 0 0 10 7zm0 7.2a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" clipRule="evenodd" /></svg>
        {data.title}
      </div>
      <ul className="mt-1.5 list-disc pl-5 space-y-0.5 text-xs leading-relaxed">
        {data.bullets.map(b => <li key={b}>{b}</li>)}
      </ul>
    </div>
  );
  if (variant === 'full') return full;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-950">
        <span aria-hidden>⚠</span>
        <span className="font-semibold">{data.title}.</span>
        <span>{data.short}</span>
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="font-semibold underline underline-offset-2 hover:text-amber-700">
          {open ? 'Show less' : 'Read more'}
        </button>
      </div>
      {open && <div className="mt-1.5">{full}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="p-8 text-center text-sm text-gray-400">
      <div className="inline-block animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full mr-2 align-middle" />
      {label ?? 'Loading…'}
    </div>
  );
}

/** fetch + JSON with the app's { success, data, error } envelope. Throws an Error carrying the server message. */
export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const e = new Error(json?.error ?? `Request failed (${res.status})`) as Error & { details?: string[]; status?: number };
    e.details = json?.details;
    e.status = res.status;
    throw e;
  }
  return json.data as T;
}

export const inputClass = 'px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white';
export const labelClass = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1';
