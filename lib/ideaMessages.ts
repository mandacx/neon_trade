/**
 * Alert message builders for Telegram and web push (email is lib/ideaEmail.ts). Pure; fixtures in
 * scripts/test-idea-alerts.mjs. Every message carries a disclaimer line (docs/trade-ideas.md, rule 9); the wording comes
 * from lib/ideaDisclaimer.ts, never from here.
 *
 * Telegram uses parse mode HTML with only <b>, <i>, <pre> and <a>. Every dynamic value is truncated raw, then escaped.
 * The note is the only variable-length part: it gets whatever budget is left under the 4000-character cap, and the
 * assembled string is never sliced (that could cut a tag or an entity).
 */
import {
  ALERT_META, alertKind, clampWords, escapeHtml, eventPhrase, headlineOf, identityParts, ideaLink, ideaPath, isFallback, levelRows,
  oneLine, pushLine, resultLine, footnoteOf, sideLabel, sideWord, targetLabelOf, whatHappened,
  type AlertInput, type LevelRow, type RowStatus,
} from './ideaAlertModel.ts';
import { IDEA_DISCLAIMER, IDEA_DISCLAIMER_MICRO } from './ideaDisclaimer.ts';

const TG_MAX = 4000; // Telegram allows 4096; keep headroom
const TG_ROWS_MAX = 8;
const NOTE_KINDS = ['note', 'stop_moved', 'partial_booked', 'closed', 'cancelled'];

export interface BuiltTelegram { html: string; plain: string; button: { text: 'Open idea'; url: string } }

const TG_LABEL: Record<string, string> = { 'Entry zone': 'Entry', 'Valid until': 'Valid to', 'Original stop': 'Orig. stop', 'Last close': 'Close' };

function tgStatus(r: LevelRow): string {
  const s: RowStatus | undefined = r.status;
  if (!s || s === 'planned') return '';
  if (s === 'entered') return '✓ entered';
  if (s === 'hit') return r.label === 'Stop' ? '× hit' : r.highlight ? '✓ hit' : '✓';
  if (s === 'open') return '○';
  return r.highlight ? '× not reached' : '×';
}

/** The monospace block: fixed label column, one row per level, `+1.14R` only on planned targets. */
function levelsBlock(rows: LevelRow[]): string[] {
  const use = rows.filter(r => !r.ctx).slice(0, TG_ROWS_MAX);
  if (!use.length) return [];
  const labels = use.map(r => TG_LABEL[r.label] ?? r.label);
  const w = Math.max(...labels.map(l => l.length));
  const vw = Math.max(...use.map(r => r.value.length));
  const out: string[] = [];
  use.forEach((r, i) => {
    const parts = [labels[i].padEnd(w), tgStatus(r) || r.rNote ? r.value.padEnd(vw) : r.value];
    if (r.rNote && /^T\d/.test(r.label)) parts.push(r.rNote);
    const st = tgStatus(r);
    if (st) parts.push(st);
    out.push(parts.join('  ').trimEnd());
    if (r.sub) out.push(`${' '.repeat(w)}  ${r.sub}`);
  });
  return out;
}

export function buildTelegram(input: AlertInput): BuiltTelegram {
  const kind = alertKind(input.eventType, input.eventKey);
  const label = targetLabelOf(input, input.facts);
  const meta = ALERT_META[kind];
  const link = ideaLink(input.ideaId);
  const fallback = isFallback(input);
  const idea = input.idea;
  const headline = headlineOf(kind, label);
  const button = { text: 'Open idea' as const, url: link };
  const disc = IDEA_DISCLAIMER.short;

  const compose = (noteRaw: string | null): { html: string; plain: string } => {
    const H: string[] = [];
    const P: string[] = [];
    const both = (s: string) => { H.push(escapeHtml(s)); P.push(s); };
    const blank = () => { H.push(''); P.push(''); };
    if (fallback || !idea) {
      H.push(`${meta.tgGlyph} <b>${escapeHtml(headline)}</b>`); P.push(`${meta.tgGlyph} ${headline}`);
      blank();
      both(clampWords(input.summary, 600));
    } else {
      H.push(`${meta.tgGlyph} <b>${escapeHtml(idea.symbol)} . ${escapeHtml(headline)}</b>`); P.push(`${meta.tgGlyph} ${idea.symbol} . ${headline}`);
      both([sideLabel(idea), ...identityParts(idea)].join(' . '));
      if (idea.title.trim()) { const t = clampWords(idea.title, 120); H.push(`<i>${escapeHtml(t)}</i>`); P.push(t); }
      blank();
      both(whatHappened(kind, idea, input.facts, input.today, label));
      const rows = kind === 'note' || kind === 'cancelled' ? [] : levelBlockRows(kind, input, label);
      if (rows.length) { blank(); H.push(`<pre>${escapeHtml(rows.join('\n'))}</pre>`); P.push(rows.join('\n')); }
      const result = resultLine(kind, idea, input.facts, label);
      if (result) both(result);
      const foot = footnoteOf(kind);
      if (foot) both(foot);
      if (noteRaw) { blank(); both(`"${noteRaw}"`); }
    }
    blank();
    H.push(`<a href="${escapeHtml(link)}">Open idea</a>`); P.push(`Open idea: ${link}`);
    blank();
    H.push(`<i>⚠ ${escapeHtml(disc)}</i>`); P.push(`⚠ ${disc}`);
    return { html: H.join('\n'), plain: P.join('\n') };
  };

  const noteFull = !fallback && input.facts?.note && NOTE_KINDS.includes(kind) ? input.facts.note : null;
  let budget = 500;
  let out = compose(null);
  if (noteFull) {
    const base = Math.max(out.html.length, out.plain.length);
    // Raw note chars can grow when escaped, so shrink until both forms fit.
    budget = Math.max(0, Math.min(500, TG_MAX - base - 10));
    for (let i = 0; i < 30; i++) {
      const note = budget > 20 ? clampWords(noteFull, budget, '...', true) : null;
      out = compose(note);
      if (out.html.length <= TG_MAX && out.plain.length <= TG_MAX) break;
      budget = Math.floor(budget * 0.75);
      if (i === 29) out = compose(null);
    }
  }
  return { ...out, button };
}

function levelBlockRows(kind: ReturnType<typeof alertKind>, input: AlertInput, label: string | null): string[] {
  if (!input.idea) return [];
  return levelsBlock(levelRows(kind, input.idea, input.facts, input.today, label));
}

// ---------------------------------------------------------------------------------------------------
// Web push
// ---------------------------------------------------------------------------------------------------

/** Notification artwork (hand-written SVGs in /public). Support for SVG here varies by browser; the notification shows without it. */
export const IDEA_ALERT_ICON = '/idea-alert-icon.svg';
export const IDEA_ALERT_BADGE = '/idea-alert-badge.svg';

export interface PushPayload { title: string; body: string; url: string; tag: string; icon: string; badge: string }

const PUSH_TITLE_MAX = 60;
const PUSH_LINE_MAX = 80;

/** Web push payload: kept short (push services cap the encrypted body near 4 KB). One tag per event, so T2 never replaces T1. */
export function buildPush(input: AlertInput): PushPayload {
  const kind = alertKind(input.eventType, input.eventKey);
  const label = targetLabelOf(input, input.facts);
  const idea = input.idea;
  let title: string;
  let line: string;
  if (isFallback(input) || !idea) {
    title = `Trade Ideas: ${headlineOf(kind, label)}`;
    line = input.summary;
    line = clampWords(oneLine(line), 70);
  } else {
    title = kind === 'published' ? `New idea: ${idea.symbol} ${sideWord(idea)}` : `${idea.symbol} ${sideWord(idea)}: ${eventPhrase(kind, input.facts, label)}`;
    line = pushLine(kind, idea, input.facts, label);
  }
  const idPart = String(input.ideaId ?? 'new').replace(/[^A-Za-z0-9_-]/g, '-');
  const evPart = String(input.eventId ?? input.eventKey).replace(/[^A-Za-z0-9_-]/g, '-');
  return {
    title: clampWords(oneLine(title), PUSH_TITLE_MAX),
    body: `${clampWords(oneLine(line), PUSH_LINE_MAX)}\n${IDEA_DISCLAIMER_MICRO}`,
    url: ideaPath(input.ideaId),
    tag: `idea-${idPart}-${evPart}`,
    icon: IDEA_ALERT_ICON,
    badge: IDEA_ALERT_BADGE,
  };
}
