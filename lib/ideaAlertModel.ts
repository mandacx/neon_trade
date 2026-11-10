/**
 * Trade Ideas alert model: the facts behind one alert and the pure helpers every channel shares (docs/trade-ideas.md,
 * "Alerts"). Dependency-free (explicit `.ts` imports, no `server-only`, no `@/` alias, no clock: `today` is passed in),
 * so `scripts/test-idea-alerts.mjs` can check every event type on every channel.
 *
 * Rules every builder follows:
 *  - truncate RAW text first, then escape (`escapeHtml`) every dynamic value; never slice an escaped string;
 *  - a missing value drops its clause; nothing prints `null`, `undefined`, `NaN`, `Infinity` or a dash placeholder;
 *  - the plan comes from the immutable `nt_trade_ideas` row, the event's own facts from `nt_idea_events.payload`.
 */
import { horizonMeta, horizonTerm, riskMeta, riskReward } from './ideaTypes.ts';
import { SITE_URL } from './site.ts';
import type { ScoreResult } from './ideaScoring.ts';

// ---------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------

export type AlertKind =
  | 'published' | 'triggered' | 'target' | 'all_targets' | 'stopped' | 'expired' | 'not_triggered'
  | 'note' | 'stop_moved' | 'partial_booked' | 'closed' | 'cancelled' | 'unknown';

export interface AlertIdea {
  symbol: string;
  direction: 'long' | 'short';
  horizon: string;
  title: string;
  rationale: string;
  entryLow: number;
  entryHigh: number;
  stop: number;
  targets: Array<{ price: number; label?: string }>;
  validUntil: string | null;
  riskRating: string;
  optionStrategyName: string | null;
}

/** Facts of ONE event, written once into `nt_idea_events.payload` (version 1). Everything but `v` is optional. */
export interface AlertFacts {
  v: 1;
  date?: string;
  price?: number;
  target?: string;
  targetsHit?: number;
  targetsTotal?: number;
  r?: number;
  gapped?: boolean;
  newStop?: number;
  pct?: number;
  note?: string;
}

export interface AlertInput {
  eventId: string | number | null;
  ideaId: string | number | null;
  eventType: string;
  eventKey: string;
  summary: string;
  idea: AlertIdea | null;
  facts: AlertFacts | null;
  /** US/Eastern YYYY-MM-DD, used only to decide whether a date shows its year. */
  today: string;
}

export type AlertTone = 'blue' | 'green' | 'red' | 'gray' | 'amber';

export interface AlertMeta {
  group: 'NEW IDEA' | 'OUTCOME' | 'DESK UPDATE';
  tone: AlertTone;
  tgGlyph: string;
  emailGlyph: string;
  headline: string;
}

export const ALERT_META: Record<AlertKind, AlertMeta> = {
  published: { group: 'NEW IDEA', tone: 'blue', tgGlyph: '\u{1F195}', emailGlyph: '★', headline: 'New idea' },
  triggered: { group: 'OUTCOME', tone: 'blue', tgGlyph: '\u{1F514}', emailGlyph: '●', headline: 'Entered its zone' },
  target: { group: 'OUTCOME', tone: 'green', tgGlyph: '\u{1F3AF}', emailGlyph: '✓', headline: 'Target reached' },
  all_targets: { group: 'OUTCOME', tone: 'green', tgGlyph: '\u{1F3C6}', emailGlyph: '✓✓', headline: 'All targets reached' },
  stopped: { group: 'OUTCOME', tone: 'red', tgGlyph: '\u{1F6D1}', emailGlyph: '✕', headline: 'Stopped out' },
  expired: { group: 'OUTCOME', tone: 'gray', tgGlyph: '⌛', emailGlyph: '◷', headline: 'Expired' },
  not_triggered: { group: 'OUTCOME', tone: 'gray', tgGlyph: '\u{1F4A4}', emailGlyph: '○', headline: 'Never triggered' },
  note: { group: 'DESK UPDATE', tone: 'gray', tgGlyph: '\u{1F4DD}', emailGlyph: '✎', headline: 'Update from the desk' },
  stop_moved: { group: 'DESK UPDATE', tone: 'blue', tgGlyph: '\u{1F527}', emailGlyph: '⇄', headline: 'Stop moved' },
  partial_booked: { group: 'DESK UPDATE', tone: 'green', tgGlyph: '\u{1F4B5}', emailGlyph: '◐', headline: 'Partial profit booked' },
  closed: { group: 'DESK UPDATE', tone: 'amber', tgGlyph: '\u{1F512}', emailGlyph: '■', headline: 'Closed early' },
  cancelled: { group: 'DESK UPDATE', tone: 'gray', tgGlyph: '\u{1F6AB}', emailGlyph: '⊘', headline: 'Cancelled' },
  unknown: { group: 'DESK UPDATE', tone: 'gray', tgGlyph: '\u{1F514}', emailGlyph: '●', headline: 'Idea update' },
};

const ONE_TO_ONE: Record<string, AlertKind> = {
  published: 'published', triggered: 'triggered', stopped: 'stopped', expired: 'expired', not_triggered: 'not_triggered',
  note: 'note', stop_moved: 'stop_moved', partial_booked: 'partial_booked', closed: 'closed', cancelled: 'cancelled',
};

export function alertKind(eventType: string, eventKey: string): AlertKind {
  if (eventType === 'target_hit') return eventKey === 'all_targets' ? 'all_targets' : 'target';
  return ONE_TO_ONE[eventType] ?? 'unknown';
}

/** The designer's summary-only layout: used when the event has no facts (recorded before the column) or no plan, or is unknown. */
export const isFallback = (i: AlertInput): boolean => i.facts == null || i.idea == null || alertKind(i.eventType, i.eventKey) === 'unknown';

// ---------------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------------

export const ideaPath = (ideaId: string | number | null): string => (ideaId != null && /^\d{1,18}$/.test(String(ideaId)) ? `/ideas/${ideaId}` : '/ideas');
export const ideaLink = (ideaId: string | number | null): string => `${SITE_URL}${ideaPath(ideaId)}`;
/** The Alerts menu lives in the Trade Ideas frame, on every /ideas page. */
export const MANAGE_ALERTS_URL = `${SITE_URL}/ideas`;

// ---------------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------------

export const escapeHtml = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Strip control characters and line breaks (subject, preheader, push strings). */
export const oneLine = (s: string): string => String(s ?? '').replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Cut RAW text to at most `max` characters (the ellipsis counts), on a word boundary when one is reasonably near.
 * Whitespace runs collapse; with `keepNewlines` single line breaks stay and 3+ blank lines become one.
 */
export function clampWords(s: string, max: number, ellipsis = '...', keepNewlines = false): string {
  let t = String(s ?? '');
  if (keepNewlines) t = t.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim();
  else t = t.replace(/\s+/g, ' ').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (t.length <= max) return t;
  const room = Math.max(0, max - ellipsis.length);
  let cut = t.slice(0, room);
  const i = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  if (i > room * 0.4) cut = cut.slice(0, i);
  cut = cut.replace(/[\s.,;:!?\-]+$/, '');
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut + ellipsis;
}

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Same rule as the app (`fmtPrice` in components/ideas/ideaUi.tsx): en-US, 2 to 4 decimals. Null (never a dash) when unusable. */
export const fmtPrice = (n: unknown): string | null => (fin(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : null);

export function fmtRange(lo: unknown, hi: unknown): string | null {
  const a = fmtPrice(lo);
  const b = fmtPrice(hi);
  if (a == null || b == null) return a ?? b;
  return a === b ? a : `${a} - ${b}`;
}

/** `+1.14R` / `-1.00R` (ASCII sign). */
export const fmtR = (n: unknown): string | null => (fin(n) ? `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n).toFixed(2)}R` : null);
export const fmtPct = (n: unknown): string | null => (fin(n) ? `${Number.isInteger(n) ? n : Number(n.toFixed(1))}%` : null);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `Nov 10`, plus `, 2025` when the year differs from today's. String based: never `new Date('YYYY-MM-DD')`. */
export function fmtDate(ymd: unknown, today: string): string | null {
  const m = typeof ymd === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd) : null;
  if (!m) return null;
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const sameYear = typeof today === 'string' && today.slice(0, 4) === m[1];
  return `${MONTHS[mon - 1]} ${Number(m[3])}${sameYear ? '' : `, ${m[1]}`}`;
}

export const termLabel = (horizon: string): string => (horizonTerm(horizon) === 'short' ? 'Short term' : 'Long term');
export const sideWord = (idea: AlertIdea): string => idea.direction; // 'long' | 'short'
export const sideLabel = (idea: AlertIdea): string => (idea.direction === 'short' ? '▼ SHORT' : '▲ LONG');

/** `Short term . Swing . Medium risk` (horizon dropped when it repeats the term). */
export function identityParts(idea: AlertIdea): string[] {
  const term = termLabel(idea.horizon);
  const hz = horizonMeta(idea.horizon).label;
  const risk = riskMeta(idea.riskRating).label;
  return [term, hz.toLowerCase() === term.toLowerCase() ? '' : hz, risk].filter(Boolean).map(oneLine).filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------
// Facts: from the scorer (write side) and from the database (read side)
// ---------------------------------------------------------------------------------------------------

function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out as T;
}

/** Facts for each scorer event, aligned 1:1 with `s.events` (so `recordEvent` stores the numbers the event was about). */
export function scoreEventFacts(s: ScoreResult): AlertFacts[] {
  let hit = 0;
  return s.events.map((e): AlertFacts => {
    switch (e.type) {
      case 'triggered': return clean({ v: 1 as const, date: e.date, price: e.price ?? undefined });
      case 'target_hit': hit++; return clean({ v: 1 as const, target: e.detail, date: e.date, price: e.price ?? undefined, targetsHit: hit, targetsTotal: s.targetsTotal });
      case 'stopped': return clean({ v: 1 as const, date: e.date, price: e.price ?? undefined, gapped: e.detail === 'gapped through the stop', targetsHit: hit, targetsTotal: s.targetsTotal, r: s.r ?? undefined });
      case 'expired': return clean({ v: 1 as const, date: e.date, price: e.price ?? undefined, targetsHit: hit, targetsTotal: s.targetsTotal, r: s.r ?? undefined });
      default: return clean({ v: 1 as const, date: e.date });
    }
  });
}

/** Facts for the `all_targets` event (the ladder completing). */
export const allTargetsFacts = (s: ScoreResult): AlertFacts =>
  clean({ v: 1 as const, date: s.exitOn ?? undefined, price: s.exitPrice ?? undefined, targetsHit: s.targetsHit, targetsTotal: s.targetsTotal, r: s.r ?? undefined });

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Validate facts read back from the database. Null (fallback layout) unless it is a version-1 object. */
export function parseFacts(raw: unknown): AlertFacts | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let o: any = raw;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return null;
  const out: AlertFacts = { v: 1 };
  if (typeof o.date === 'string' && YMD.test(o.date)) out.date = o.date;
  for (const k of ['price', 'r', 'newStop', 'pct'] as const) if (fin(o[k])) out[k] = o[k];
  for (const k of ['targetsHit', 'targetsTotal'] as const) if (fin(o[k]) && o[k] >= 0 && o[k] <= 50) out[k] = Math.floor(o[k]);
  if (typeof o.target === 'string' && /^T\d{1,2}$/.test(o.target)) out.target = o.target;
  if (typeof o.gapped === 'boolean') out.gapped = o.gapped;
  if (typeof o.note === 'string' && o.note.trim()) out.note = clampWords(o.note, 1000, '...', true);
  return out;
}

/** The plan side, from a `nt_trade_ideas` row (snake_case columns). Null when the row cannot support the layout. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toAlertIdea(row: any): AlertIdea | null {
  if (!row || typeof row !== 'object') return null;
  const symbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : '';
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return null;
  const direction = row.direction === 'short' ? 'short' : row.direction === 'long' ? 'long' : null;
  const entryLow = Number(row.entry_low ?? row.entryLow);
  const entryHigh = Number(row.entry_high ?? row.entryHigh);
  const stop = Number(row.stop);
  if (!direction || !(entryLow > 0) || !(entryHigh > 0) || !(stop > 0) || !Number.isFinite(entryLow + entryHigh + stop)) return null;
  const rawTargets = Array.isArray(row.targets) ? row.targets : [];
  const targets: AlertIdea['targets'] = [];
  for (const t of rawTargets.slice(0, 10)) {
    const price = Number(t && typeof t === 'object' ? t.price : t);
    if (!(price > 0) || !Number.isFinite(price)) return null;
    targets.push(typeof t?.label === 'string' && t.label.trim() ? { price, label: clampWords(t.label, 40) } : { price });
  }
  if (!targets.length) return null;
  const os = row.option_strategy ?? row.optionStrategy;
  const optName = os && typeof os === 'object' && typeof os.name === 'string' && os.name.trim() ? clampWords(os.name, 80) : null;
  const vu = row.valid_until ?? row.validUntil;
  return {
    symbol, direction, horizon: String(row.horizon ?? ''), title: String(row.title ?? ''), rationale: String(row.rationale ?? ''),
    entryLow, entryHigh, stop, targets, validUntil: typeof vu === 'string' && YMD.test(vu.slice(0, 10)) ? vu.slice(0, 10) : null,
    riskRating: String(row.risk_rating ?? row.riskRating ?? 'medium'), optionStrategyName: optName,
  };
}

// ---------------------------------------------------------------------------------------------------
// Wording shared by the channels
// ---------------------------------------------------------------------------------------------------

/** `T1`..`Tn` label of the target an event is about (from facts, else from the key `target:T1`). */
export function targetLabelOf(input: Pick<AlertInput, 'eventKey'>, facts: AlertFacts | null): string | null {
  if (facts?.target) return facts.target;
  const m = /^target:(T\d{1,2})$/.exec(input.eventKey ?? '');
  return m ? m[1] : null;
}
const targetIndex = (label: string | null): number => { const m = label ? /^T(\d{1,2})$/.exec(label) : null; return m ? Number(m[1]) - 1 : -1; };

/** Reward:risk of a target from the plan entry (the desk's convention). Null when unusable. */
export function plannedR(idea: AlertIdea, index: number): number | null {
  if (index < 0 || index >= idea.targets.length) return null;
  const rr = riskReward({ direction: idea.direction, entryLow: idea.entryLow, entryHigh: idea.entryHigh, stop: idea.stop, targets: idea.targets });
  return rr.risk > 0 && Number.isFinite(rr.perTarget[index]) ? rr.perTarget[index] : null;
}

export function headlineOf(kind: AlertKind, label: string | null): string {
  return kind === 'target' && label ? `${label} reached` : ALERT_META[kind].headline;
}

const isEntryPrice = (idea: AlertIdea, p: number) => Math.abs((idea.direction === 'short' ? idea.entryLow : idea.entryHigh) - p) < 1e-9;

/** The one "what happened" sentence (designer 4.3); a clause whose number is missing is dropped. */
export function whatHappened(kind: AlertKind, idea: AlertIdea | null, facts: AlertFacts | null, today: string, label: string | null = null): string {
  const f = facts ?? ({ v: 1 } as AlertFacts);
  const price = fmtPrice(f.price);
  const date = fmtDate(f.date, today);
  switch (kind) {
    case 'published': return 'The desk published a new idea. Review the plan before acting.';
    case 'triggered': return 'Price entered the entry zone, so the idea is now live.';
    case 'target': {
      const L = label ?? 'A target';
      let s = `${L} was reached${price ? ` at ${price}` : ''}${date ? ` on ${date}` : ''}.`;
      const hit = f.targetsHit;
      const total = f.targetsTotal ?? idea?.targets.length;
      if (fin(hit) && fin(total) && total > 0) {
        s += ` ${hit} of ${total} target${total === 1 ? '' : 's'} hit`;
        const next = idea && hit < total ? fmtPrice(idea.targets[hit]?.price) : null;
        s += next ? `; T${hit + 1} at ${next} is next.` : '.';
      }
      return s;
    }
    case 'all_targets': return 'Every target on the plan has been reached. The idea is complete.';
    case 'stopped': {
      const r = fmtR(f.r);
      const closeTail = !r ? ' The idea is closed.' : (f.r as number) < 0 ? ` The idea is closed at a loss of ${Math.abs(f.r as number).toFixed(2)}R.` : ` The idea is closed with a result of ${r}.`;
      if (f.gapped) return `Price gapped through the stop${price ? ` and closed at ${price}` : ''}${date ? ` on ${date}` : ''}.${closeTail}`;
      return `Price hit the stop${price ? ` at ${price}` : ''}${date ? ` on ${date}` : ''}.${closeTail}`;
    }
    case 'expired': return 'The valid-until date passed before the plan finished. The idea is closed.';
    case 'not_triggered': return 'Price never entered the entry zone before the idea expired. No trade was made.';
    case 'note': return 'The desk added a note.';
    case 'stop_moved': {
      const ns = fmtPrice(f.newStop);
      const be = ns && idea && isEntryPrice(idea, f.newStop as number) ? ' (breakeven)' : '';
      const orig = idea ? fmtPrice(idea.stop) : null;
      return `The desk moved its stop${ns ? ` to ${ns}${be}` : ''}.${orig ? ` The original stop of ${orig} is still what the desk's results are scored on.` : ''}`;
    }
    case 'partial_booked': {
      const pct = fmtPct(f.pct);
      const px = fmtPrice(f.price);
      const head = pct ? `The desk booked ${pct} of the position${px ? ` at ${px}` : ''}.` : px ? `The desk booked part of the position at ${px}.` : 'The desk booked part of the position.';
      return `${head} Results are still scored on the original targets.`;
    }
    case 'closed': return "The desk closed this idea early. It is scored at that session's close.";
    case 'cancelled': return 'The desk withdrew this idea.';
    default: return 'The desk posted an update.';
  }
}

export type RowStatus = 'planned' | 'entered' | 'hit' | 'open' | 'notreached';
export interface LevelRow {
  label: string;
  value: string;
  status?: RowStatus;
  /** Date shown next to the status (e.g. when it was hit). */
  date?: string;
  /** Planned or realised R next to the price (the email's R column). */
  rNote?: string;
  /** Second, smaller line under the value. */
  sub?: string;
  highlight: boolean;
  /** Context only: email shows it, Telegram leaves it out. */
  ctx?: boolean;
}
export const statusWord = (s: RowStatus): string => ({ planned: 'Planned', entered: 'Entered', hit: 'Hit', open: 'Open', notreached: 'Not reached' }[s]);

/** Plan strip for a note: `Entry 100.00 - 102.00 . Stop 95.00 . T1 110.00 . T2 120.00`. */
export function planStrip(idea: AlertIdea): string {
  const parts = [`Entry ${fmtRange(idea.entryLow, idea.entryHigh)}`, `Stop ${fmtPrice(idea.stop)}`, ...idea.targets.map((t, i) => `T${i + 1} ${fmtPrice(t.price)}`)];
  return parts.join(' . ');
}

/** The levels table rows per event type (designer 4.2). Empty when the type shows no table. */
export function levelRows(kind: AlertKind, idea: AlertIdea, facts: AlertFacts | null, today: string, label: string | null = null): LevelRow[] {
  const f = facts ?? ({ v: 1 } as AlertFacts);
  const zone = fmtRange(idea.entryLow, idea.entryHigh) ?? '';
  const stopTxt = fmtPrice(idea.stop) ?? '';
  const nT = idea.targets.length;
  const idx = targetIndex(label);
  const hitCount = fin(f.targetsHit) ? f.targetsHit : null;
  const date = fmtDate(f.date, today) ?? undefined;
  const entry = (status: RowStatus | undefined, highlight = false, d?: string): LevelRow => ({ label: 'Entry zone', value: zone, status, date: d, highlight });
  const stop = (status: RowStatus | undefined, highlight = false, extra: Partial<LevelRow> = {}): LevelRow => ({ label: 'Stop', value: stopTxt, status, highlight, ...extra });
  const targets = (statusOf: (i: number) => RowStatus | undefined, withR = false, hi: (i: number) => boolean = () => false, dateOf: (i: number) => string | undefined = () => undefined): LevelRow[] =>
    idea.targets.map((t, i) => {
      const r = withR ? fmtR(plannedR(idea, i)) : null;
      return { label: `T${i + 1}`, value: fmtPrice(t.price) ?? '', status: statusOf(i), date: dateOf(i), rNote: r ?? undefined, highlight: hi(i) };
    });
  const valid = fmtDate(idea.validUntil, today);
  const validRow: LevelRow[] = valid ? [{ label: 'Valid until', value: valid, highlight: false }] : [];
  // Which targets count as hit: known from the event's own counter, otherwise unknown (no marks).
  const hitStatus = (i: number): RowStatus | undefined => (hitCount == null ? undefined : i < hitCount ? 'hit' : 'open');
  const finalStatus = (i: number): RowStatus | undefined => (hitCount == null ? undefined : i < hitCount ? 'hit' : 'notreached');

  switch (kind) {
    case 'published': {
      const sr = fmtR(-1);
      return [entry('planned'), stop('planned', false, { rNote: sr ?? undefined }), ...targets(() => 'planned', true), ...validRow];
    }
    case 'triggered': return [entry('entered', true, date), stop('open'), ...targets(() => 'open')];
    case 'target': {
      const justHit = (i: number) => i === idx;
      return [entry('entered'), ...targets(i => (hitCount != null ? (i < hitCount ? 'hit' : 'open') : justHit(i) ? 'hit' : undefined), false, justHit, i => (justHit(i) ? date : undefined)), stop('open')];
    }
    case 'all_targets': return [entry('entered'), ...targets(() => 'hit', false, i => i === nT - 1, i => (i === nT - 1 ? date : undefined)), stop('notreached')];
    case 'stopped': {
      const gapPx = f.gapped ? fmtPrice(f.price) : null;
      return [entry('entered'), ...targets(finalStatus), stop('hit', true, { date, sub: gapPx ? `Gapped through the stop, closed at ${gapPx}` : undefined })];
    }
    case 'expired': {
      const close = fmtPrice(f.price);
      return [entry('entered'), ...targets(finalStatus), stop(hitCount == null ? undefined : 'notreached'), ...(close ? [{ label: 'Last close', value: close, date, highlight: false } as LevelRow] : [])];
    }
    case 'not_triggered': return [entry('notreached', true), stop(undefined), ...targets(() => undefined), ...validRow];
    case 'stop_moved': {
      const ns = fmtPrice(f.newStop);
      return [
        ...(ns ? [{ label: 'New stop', value: ns, highlight: true } as LevelRow] : []),
        { label: 'Original stop', value: stopTxt, sub: 'Still used for scoring', highlight: false },
        { ...entry(undefined), ctx: true }, ...targets(() => undefined).map(r => ({ ...r, ctx: true })),
      ];
    }
    case 'partial_booked': {
      const px = fmtPrice(f.price);
      const pct = fmtPct(f.pct);
      const booked = [pct ? `${pct}` : '', px ? `at ${px}` : ''].filter(Boolean).join(' ');
      return [
        ...(booked ? [{ label: 'Booked', value: booked, highlight: true } as LevelRow] : []),
        { ...stop(undefined) }, ...targets(() => undefined),
      ];
    }
    case 'closed': return [{ ...entry(undefined), ctx: true }, ...targets(hitStatus).map(r => ({ ...r, ctx: true })), { ...stop(undefined), ctx: true }];
    default: return [];
  }
}

/** `Result: ...` line for outcome events (R rules: per-target R on a target, the scorer's realised R on terminal events). */
export function resultLine(kind: AlertKind, idea: AlertIdea, facts: AlertFacts | null, label: string | null): string | null {
  const f = facts ?? ({ v: 1 } as AlertFacts);
  if (kind === 'target') {
    const r = fmtR(plannedR(idea, targetIndex(label)));
    return r && label ? `Result so far: ${r} at ${label} (R from plan entry)` : null;
  }
  const r = fmtR(f.r);
  if (!r) return null;
  if (kind === 'all_targets' || kind === 'stopped') return `Result: ${r}`;
  if (kind === 'expired') return `Result at the last close: ${r}`;
  return null;
}

/** Small closing line under the table for some events. */
export const footnoteOf = (kind: AlertKind): string | null => (kind === 'stopped' ? 'A stop is part of the plan.' : null);

/** The R shown in subject / push title: per-target R on a target, the scorer's R on terminal events. */
export function headlineR(kind: AlertKind, idea: AlertIdea, facts: AlertFacts | null, label: string | null): string | null {
  if (kind === 'target') return fmtR(plannedR(idea, targetIndex(label)));
  if (kind === 'all_targets' || kind === 'stopped') return fmtR(facts?.r);
  return null;
}

/** `stopped out at 95.00` style phrase after `SYM side: ` (lowercase, designer 6.1 / 7.1). Published has its own pattern. */
export function eventPhrase(kind: AlertKind, facts: AlertFacts | null, label: string | null): string {
  const price = fmtPrice(facts?.price);
  switch (kind) {
    case 'triggered': return 'entered its zone';
    case 'target': return `${label ?? 'target'} reached${price ? ` at ${price}` : ''}`;
    case 'all_targets': return 'all targets reached';
    case 'stopped': return `stopped out${price ? ` at ${price}` : ''}`;
    case 'expired': return 'idea expired';
    case 'not_triggered': return 'never triggered';
    case 'note': return 'update from the desk';
    case 'stop_moved': { const ns = fmtPrice(facts?.newStop); return `stop moved${ns ? ` to ${ns}` : ''}`; }
    case 'partial_booked': return 'partial profit booked';
    case 'closed': return 'closed early';
    case 'cancelled': return 'cancelled';
    case 'published': return 'new idea';
    default: return 'idea update';
  }
}

const joinAnd = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const sentence = (parts: Array<string | null | false>): string => parts.filter(Boolean).join(' ');

/** Second line of the email preheader (designer 6.1). */
export function preheaderOf(kind: AlertKind, idea: AlertIdea, facts: AlertFacts | null, today: string): string {
  const f = facts ?? ({ v: 1 } as AlertFacts);
  const stop = fmtPrice(idea.stop);
  const zone = fmtRange(idea.entryLow, idea.entryHigh);
  const date = fmtDate(f.date, today);
  const tprices = idea.targets.map(t => fmtPrice(t.price)).filter((x): x is string => !!x);
  switch (kind) {
    case 'published': return sentence([stop && `Stop ${stop}.`, tprices.length ? `Target${tprices.length > 1 ? 's' : ''} ${joinAnd(tprices)}.` : null, `${horizonMeta(idea.horizon).label} idea, ${riskMeta(idea.riskRating).label.toLowerCase()}.`]);
    case 'triggered': return sentence([zone && `Entry zone ${zone}.`, stop && `Stop ${stop}.`, tprices[0] && `First target ${tprices[0]}.`]);
    case 'target': {
      const hit = f.targetsHit; const total = f.targetsTotal ?? idea.targets.length;
      const next = fin(hit) && hit < total ? fmtPrice(idea.targets[hit]?.price) : null;
      return sentence([fin(hit) && `${hit} of ${total} target${total === 1 ? '' : 's'} hit.`, next && `Next: T${(hit as number) + 1} at ${next}.`, stop && `Stop ${stop}.`]) || 'Review the plan on the idea page.';
    }
    case 'all_targets': return `Plan completed: all ${idea.targets.length} target${idea.targets.length === 1 ? '' : 's'} reached.`;
    case 'stopped': return sentence([stop && `The stop at ${fmtPrice(f.gapped ? idea.stop : f.price) ?? stop} was hit${date ? ` on ${date}` : ''}.`, 'The idea is closed.']);
    case 'expired': return 'The valid-until date passed. The idea is closed.';
    case 'not_triggered': return sentence([zone && `Price never entered ${zone}.`, 'No trade was made.']);
    case 'note': return f.note ? clampWords(oneLine(f.note), 90) : 'The desk added a note.';
    case 'stop_moved': return stop ? `Original stop ${stop} is still used for scoring.` : 'The original stop is still used for scoring.';
    case 'partial_booked': { const pct = fmtPct(f.pct); const px = fmtPrice(f.price); return sentence([pct && `${pct} booked${px ? ` at ${px}` : ''}.`, !pct && px && `Part booked at ${px}.`, 'The original targets still apply.']); }
    case 'closed': return 'The desk closed this idea at the session close.';
    case 'cancelled': return 'The desk withdrew this idea.';
    default: return 'There is an update on this idea.';
  }
}

/** Body line 1 of the push (designer 7.1), numbers only, ` . ` separated. */
export function pushLine(kind: AlertKind, idea: AlertIdea, facts: AlertFacts | null, label: string | null): string {
  const f = facts ?? ({ v: 1 } as AlertFacts);
  const stop = fmtPrice(idea.stop);
  const zone = fmtRange(idea.entryLow, idea.entryHigh);
  const t1 = fmtPrice(idea.targets[0]?.price);
  const j = (xs: Array<string | null | false>) => xs.filter(Boolean).join(' . ');
  switch (kind) {
    case 'published': return j([zone && `Entry ${zone}`, stop && `Stop ${stop}`, t1 && `T1 ${t1}`]);
    case 'triggered': return j([zone && `Zone ${zone}`, stop && `Stop ${stop}`, t1 && `T1 ${t1}`]);
    case 'target': {
      const hit = f.targetsHit; const total = f.targetsTotal ?? idea.targets.length;
      const next = fin(hit) && hit < total ? fmtPrice(idea.targets[hit]?.price) : null;
      return j([fmtR(plannedR(idea, targetIndex(label))), next && `Next T${(hit as number) + 1} ${next}`, stop && `Stop ${stop}`]);
    }
    case 'all_targets': return j([fmtR(f.r), 'Plan completed']);
    case 'stopped': return j([fmtR(f.r), 'Idea closed']);
    case 'expired': return 'Valid-until date passed . Idea closed';
    case 'not_triggered': return zone ? `Price never entered ${zone}` : 'Price never entered the zone';
    case 'note': return f.note ? clampWords(oneLine(f.note), 70) : 'The desk added a note';
    case 'stop_moved': return stop ? `Original stop ${stop} still used for scoring` : 'Original stop still used for scoring';
    case 'partial_booked': { const pct = fmtPct(f.pct); const px = fmtPrice(f.price); return j([pct && px ? `${pct} at ${px}` : pct || (px && `Booked at ${px}`), 'Original targets still apply']); }
    case 'closed': return 'Scored at the session close';
    case 'cancelled': return 'The desk withdrew this idea';
    default: return 'There is an update on this idea';
  }
}
