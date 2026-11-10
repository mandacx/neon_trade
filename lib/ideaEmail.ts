/**
 * Trade Ideas alert email: subject, preheader, plain text and HTML for every event type (docs/trade-ideas.md, "Alerts").
 * Pure (see lib/ideaAlertModel.ts for the rules). Table layout with inline CSS, fixed light palette, no images, no
 * remote assets, no tracking. All publisher text is untrusted: truncated raw, then escaped.
 */
import {
  ALERT_META, MANAGE_ALERTS_URL, alertKind, clampWords, escapeHtml, eventPhrase, fmtRange, footnoteOf, headlineOf, headlineR,
  identityParts, ideaLink, isFallback, levelRows, oneLine, planStrip, preheaderOf, resultLine, sideWord, statusWord,
  targetLabelOf, whatHappened,
  type AlertInput, type AlertKind, type AlertTone, type LevelRow,
} from './ideaAlertModel.ts';
import { IDEA_DISCLAIMER, disclaimerHtmlQuiet, disclaimerText } from './ideaDisclaimer.ts';
import { IDEA_SENDER_NAME, SITE_NAME, SITE_URL, SUPPORT_EMAIL } from './site.ts';

export interface BuiltEmail { subject: string; preheader: string; text: string; html: string }

export const FILL: Record<AlertTone, string> = { blue: '#2563EB', green: '#15803D', red: '#B91C1C', gray: '#4B5563', amber: '#B45309' };
export const TINT: Record<AlertTone, string> = { blue: '#EFF6FF', green: '#F0FDF4', red: '#FEF2F2', gray: '#F3F4F6', amber: '#FFFBEB' };
/** Every neutral colour the email uses (the disclaimer block in lib/ideaDisclaimer.ts adds its own quiet grays). Light-only by decision (2026-11-10). */
export const INK = {
  page: '#F3F4F6', card: '#FFFFFF', border: '#E5E7EB', primary: '#111827', body: '#1F2937', footnote: '#374151',
  secondary: '#4B5563', muted: '#6B7280', link: '#1D4ED8', quote: '#9CA3AF', cta: '#2563EB', white: '#FFFFFF',
} as const;
export const EMAIL_PALETTE = { FILL, TINT, INK } as const;
const FONT = 'font-family:Arial,Helvetica,sans-serif;';

const SUBJECT_MAX = 78;
const PREHEADER_MAX = 110;

function subjectOf(input: AlertInput, kind: AlertKind, label: string | null): string {
  const { idea, facts } = input;
  if (isFallback(input) || !idea) return clampWords(`Trade Ideas: ${clampWords(oneLine(input.summary), 62)}`, SUBJECT_MAX);
  const side = sideWord(idea);
  let s: string;
  if (kind === 'published') {
    const zone = fmtRange(idea.entryLow, idea.entryHigh);
    s = `New idea: ${idea.symbol} ${side}${zone ? `, entry ${zone}` : ''}`;
  } else {
    const r = headlineR(kind, idea, facts, label);
    s = `${idea.symbol} ${side}: ${eventPhrase(kind, facts, label)}${r ? ` (${r})` : ''}`;
  }
  return clampWords(oneLine(s), SUBJECT_MAX);
}

const FILLER = '&zwnj;&nbsp;'.repeat(100);

function levelsTableHtml(rows: LevelRow[], tone: AlertTone): string {
  const showR = rows.some(r => r.rNote);
  const th = (t: string, align: string) => `<th scope="col" align="${align}" bgcolor="${INK.card}" style="background-color:${INK.card};${FONT}font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${INK.secondary};text-align:${align};padding:6px 6px;border-bottom:1px solid ${INK.border}">${t}</th>`;
  const head = `<tr>${th('Level', 'left')}${th('Price', 'right')}${th('Status', 'left')}${showR ? th(rows.some(r => r.label === 'T1' && r.rNote) ? 'If reached' : 'R', 'right') : ''}</tr>`;
  const body = rows.map(r => {
    const bg = r.highlight ? TINT[tone] : INK.card;
    const weight = r.highlight ? 'font-weight:700;' : '';
    const td = (inner: string, align: string, extra = '') => `<td align="${align}" bgcolor="${bg}" style="background-color:${bg};${FONT}${weight}font-size:14px;line-height:20px;color:${INK.body};text-align:${align};padding:8px 6px;border-bottom:1px solid ${INK.border};${extra}">${inner}</td>`;
    const status = r.status ? `${statusWord(r.status)}${r.date ? ` (${escapeHtml(r.date)})` : ''}` : '';
    const sub = r.sub ? `<div style="${FONT}font-size:12px;line-height:16px;font-weight:400;color:${INK.secondary}">${escapeHtml(r.sub)}</div>` : '';
    return `<tr>${td(escapeHtml(r.label), 'left')}${td(`<span style="font-variant-numeric:tabular-nums">${escapeHtml(r.value)}</span>${sub}`, 'right')}${td(status, 'left')}${showR ? td(r.rNote ? escapeHtml(r.rNote) : '', 'right') : ''}</tr>`;
  }).join('');
  return `<table role="table" class="lv" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function cell(bg: string, style: string, inner: string, attrs = ''): string {
  return `<td bgcolor="${bg}" ${attrs} style="background-color:${bg};${FONT}${style}">${inner}</td>`;
}

export interface EmailOptions { unsubscribeUrl?: string | null }

const UNSUB_PREFIX = `${SITE_URL}/unsubscribe?t=`;
/** Only our own unsubscribe page URL, with nothing that could break out of an attribute or a line. */
const safeUnsubUrl = (u: unknown): string | null =>
  typeof u === 'string' && u.startsWith(UNSUB_PREFIX) && u.length > UNSUB_PREFIX.length && !/[\s"<>]/.test(u) ? u : null;

export const FOOTER_WHY = 'You are getting this email because Trade Ideas email alerts are turned on for your StocksTrendz account.';
export const FOOTER_SCOPE = 'This turns off Trade Ideas email alerts only. Sign-in and other account emails, Telegram and browser notifications are not changed.';
export const FOOTER_FALLBACK = 'To stop these emails, sign in, open Trade Ideas, choose Alerts and untick Email.';
export const UNSUB_LINK_TEXT = 'Unsubscribe from Trade Ideas emails';

export function buildEmail(input: AlertInput, opts: EmailOptions = {}): BuiltEmail {
  const unsubUrl = safeUnsubUrl(opts?.unsubscribeUrl);
  const kind = alertKind(input.eventType, input.eventKey);
  const label = targetLabelOf(input, input.facts);
  const meta = ALERT_META[kind];
  const fallback = isFallback(input);
  const idea = input.idea;
  const facts = input.facts;
  const link = ideaLink(input.ideaId);
  const subject = subjectOf(input, kind, label);
  const headline = headlineOf(kind, label);
  const preheader = clampWords(oneLine(fallback || !idea ? input.summary : preheaderOf(kind, idea, facts, input.today)), PREHEADER_MAX);
  const buttonText = kind === 'published' && !fallback ? 'View the full plan' : 'View idea';
  const tone = meta.tone;

  // ---- shared pieces ----
  const sentence = fallback || !idea ? clampWords(input.summary, 600) : whatHappened(kind, idea, facts, input.today, label);
  const rows = !fallback && idea && kind !== 'note' && kind !== 'cancelled' ? levelRows(kind, idea, facts, input.today, label) : [];
  const result = !fallback && idea ? resultLine(kind, idea, facts, label) : null;
  const footnote = !fallback ? footnoteOf(kind) : null;
  const note = !fallback && facts?.note && ['note', 'stop_moved', 'partial_booked', 'closed', 'cancelled'].includes(kind) ? clampWords(facts.note, 600, '...', true) : null;
  const noteHtml = note ? clampWords(facts!.note!, 600, '…', true) : null;

  // ---- plain text ----
  const t: string[] = [];
  if (fallback || !idea) {
    t.push(`${headline.toUpperCase()}`, '', sentence);
  } else {
    t.push(`${headline.toUpperCase()}  |  ${idea.symbol}  ${sideWord(idea).toUpperCase()}`, identityParts(idea).join(' . '));
    if (idea.title.trim()) t.push(clampWords(idea.title, 140));
    t.push('', sentence);
    if (result) t.push(result);
    if (note) t.push('', note);
    if (kind === 'note' && !rows.length) t.push('', planStrip(idea));
    if (rows.length) {
      const w = Math.max(...rows.map(r => r.label.length));
      const vw = Math.max(...rows.map(r => r.value.length));
      t.push('', 'LEVELS');
      for (const r of rows) {
        const st = r.status ? (r.status === 'hit' ? `HIT${r.date ? ` (${r.date})` : ''}` : r.status === 'entered' ? `Entered${r.date ? ` (${r.date})` : ''}` : statusWord(r.status)) : '';
        t.push(`${r.label.padEnd(w)}  ${(r.rNote || st ? r.value.padEnd(vw) : r.value)}${r.rNote ? `  ${r.rNote}` : ''}${st ? `  ${st}` : ''}`.trimEnd());
        if (r.sub) t.push(`${' '.repeat(w)}  ${r.sub}`);
      }
    }
    if (footnote) t.push('', footnote);
    if (kind === 'published') {
      if (idea.rationale.trim()) t.push('', `Why: ${clampWords(idea.rationale, 240)}`);
      if (idea.optionStrategyName) t.push(`Option idea: ${idea.optionStrategyName}`);
    }
  }
  t.push('', `${buttonText}: ${link}`, '', '----------------------------------------', disclaimerText(), '', '----------------------------------------',
    'You are getting this email because Trade Ideas email alerts are turned on', 'for your StocksTrendz account.', '');
  if (unsubUrl) {
    t.push(`${UNSUB_LINK_TEXT}:`, unsubUrl, '', 'This turns off Trade Ideas email alerts only. Sign-in and other account', 'emails, Telegram and browser notifications are not changed.', '');
  } else {
    t.push(FOOTER_FALLBACK, '');
  }
  t.push(`Manage alerts (sign in, then Alerts, then Email): ${MANAGE_ALERTS_URL}`, `Questions? Contact ${SUPPORT_EMAIL}`, IDEA_SENDER_NAME);
  const text = t.join('\n');

  // ---- HTML ----
  const chip = !fallback && idea && result && (kind === 'target' || kind === 'all_targets' || kind === 'stopped')
    ? (() => { const r = headlineR(kind, idea, facts, label); return r ? `<span style="display:inline-block;border:1px solid ${FILL[tone]};border-radius:12px;padding:2px 10px;${FONT}font-size:13px;line-height:18px;font-weight:700;color:${FILL[tone]};background-color:${INK.card}">${escapeHtml(r)}</span>` : ''; })()
    : '';
  const idHtml = fallback || !idea ? '' : cell(INK.card, `padding:20px 24px 0 24px;color:${INK.primary};`,
    `<span style="font-size:28px;line-height:34px;font-weight:700;color:${INK.primary}">${escapeHtml(idea.symbol)}</span> `
    + `<span style="display:inline-block;vertical-align:middle;background-color:${idea.direction === 'short' ? FILL.red : FILL.green};color:${INK.white};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.5px;padding:3px 8px;border-radius:4px"><span aria-hidden="true">${idea.direction === 'short' ? '&#9660;' : '&#9650;'}</span> ${idea.direction === 'short' ? 'SHORT' : 'LONG'}</span>${chip ? ` &nbsp;${chip}` : ''}`
    + `<div style="font-size:13px;line-height:20px;color:${INK.secondary};padding-top:4px">${identityParts(idea).map(escapeHtml).join(' &middot; ')}</div>`
    + (idea.title.trim() ? `<div style="font-size:16px;line-height:22px;color:${INK.primary};padding-top:6px">${escapeHtml(clampWords(idea.title, 140, '…'))}</div>` : ''), 'align="left"');
  const bodyParts: string[] = [];
  bodyParts.push(`<p style="margin:0 0 14px 0;${FONT}font-size:15px;line-height:22px;color:${INK.body}">${escapeHtml(sentence)}</p>`);
  if (rows.length) bodyParts.push(levelsTableHtml(rows, tone));
  if (result) bodyParts.push(`<p style="margin:12px 0 0 0;${FONT}font-size:14px;line-height:20px;font-weight:700;color:${INK.primary}">${escapeHtml(result)}</p>`);
  if (footnote) bodyParts.push(`<p style="margin:8px 0 0 0;${FONT}font-size:14px;line-height:20px;color:${INK.footnote}">${escapeHtml(footnote)}</p>`);
  if (noteHtml) bodyParts.push(`<div style="margin:14px 0 0 0;border-left:3px solid ${INK.quote};padding:2px 0 2px 12px;${FONT}font-size:15px;line-height:22px;color:${INK.body};white-space:pre-line">${escapeHtml(noteHtml)}</div>`);
  if (!fallback && idea && kind === 'note') bodyParts.push(`<p style="margin:14px 0 0 0;${FONT}font-size:13px;line-height:20px;color:${INK.secondary}">${escapeHtml(planStrip(idea))}</p>`);
  if (!fallback && idea && kind === 'published') {
    // The option strategy follows canSeeOptionStrategy() in lib/ideas.ts (true for every reader today). If that ever
    // becomes per-reader, this block must follow it.
    if (idea.rationale.trim()) bodyParts.push(`<p style="margin:14px 0 0 0;${FONT}font-size:14px;line-height:21px;color:${INK.footnote}"><strong>Why:</strong> ${escapeHtml(clampWords(idea.rationale, 240, '…'))}</p>`);
    if (idea.optionStrategyName) bodyParts.push(`<p style="margin:8px 0 0 0;${FONT}font-size:14px;line-height:21px;color:${INK.footnote}"><strong>Option idea:</strong> ${escapeHtml(idea.optionStrategyName)}</p>`);
  }
  const safeLink = escapeHtml(link);
  const cta = `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:22px auto 0 auto"><tr><td align="center" bgcolor="${INK.cta}" style="background-color:${INK.cta};border-radius:8px"><a href="${safeLink}" style="display:block;padding:14px 28px;${FONT}font-size:16px;line-height:20px;font-weight:700;color:${INK.white};text-decoration:none">${buttonText}</a></td></tr></table>`
    + `<p style="margin:12px 0 0 0;${FONT}font-size:12px;line-height:18px;color:${INK.secondary};text-align:center">Or paste this link: <a href="${safeLink}" style="color:${INK.link};text-decoration:underline">${safeLink}</a></p>`;

  const linkStyle = `color:${INK.link};text-decoration:underline;font-size:13px;line-height:20px`;
  const manageLink = `<a href="${escapeHtml(MANAGE_ALERTS_URL)}" style="${linkStyle}">Manage alerts</a>`;
  const ft = `${FONT}font-size:12px;line-height:18px;color:${INK.secondary};margin:0;`;
  const footerHtml = `<div style="border-top:1px solid ${INK.border};padding-top:16px;${FONT}">`
    + `<p style="${ft}">${escapeHtml(FOOTER_WHY)}</p>`
    + (unsubUrl
      ? `<div style="padding:6px 0;${FONT}font-size:13px;line-height:20px;color:${INK.secondary}"><a href="${escapeHtml(unsubUrl)}" style="${linkStyle}">${UNSUB_LINK_TEXT}</a> &middot; ${manageLink}</div>`
        + `<p style="${ft}">${escapeHtml(FOOTER_SCOPE)}</p>`
      : `<p style="${ft}padding-top:6px">${escapeHtml(FOOTER_FALLBACK)}</p><div style="padding:6px 0;${FONT}font-size:13px;line-height:20px">${manageLink}</div>`)
    + `<p style="${ft}padding-top:8px">Questions? Contact <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:${INK.link};text-decoration:underline">${escapeHtml(SUPPORT_EMAIL)}</a></p>`
    + `<p style="${FONT}font-size:12px;line-height:18px;color:${INK.muted};margin:0">${escapeHtml(IDEA_SENDER_NAME)}</p>`
    + `</div>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(subject)}</title>
<style>:root{color-scheme:light;}@media (max-width:480px){.lv td,.lv th{font-size:13px !important}}@media (max-width:360px){.lv td,.lv th{padding-left:3px !important;padding-right:3px !important;font-size:12px !important}}</style></head>
<body style="margin:0;padding:0;background-color:${INK.page}" bgcolor="${INK.page}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${INK.white};opacity:0">${escapeHtml(preheader)}${FILLER}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${INK.page}" style="background-color:${INK.page}"><tr><td align="center" bgcolor="${INK.page}" style="background-color:${INK.page};padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${INK.card}" style="width:100%;max-width:600px;background-color:${INK.card};border:1px solid ${INK.border};border-radius:12px">
<tr>${cell(INK.card, `padding:16px 24px;color:${INK.secondary};font-size:14px;line-height:20px;`, `<span style="font-size:18px;font-weight:700;color:${INK.cta}">${escapeHtml(SITE_NAME)}</span> &nbsp;Trade Ideas`, 'align="left"')}</tr>
<tr>${cell(FILL[tone], `padding:16px 24px;color:${INK.white};`, `<div style="font-size:12px;line-height:16px;font-weight:700;letter-spacing:1px;color:${INK.white}">${meta.group}</div><div style="font-size:22px;line-height:28px;font-weight:700;color:${INK.white}"><span aria-hidden="true">${meta.emailGlyph}</span> ${escapeHtml(headline)}</div>`, 'align="left"')}</tr>
${idHtml ? `<tr>${idHtml}</tr>
` : ''}<tr>${cell(INK.card, `padding:16px 24px 24px 24px;color:${INK.body};`, bodyParts.join('') + cta, 'align="left"')}</tr>
<tr>${cell(INK.card, 'padding:0 24px 20px 24px;', disclaimerHtmlQuiet(IDEA_DISCLAIMER), 'align="left"')}</tr>
<tr>${cell(INK.card, 'padding:0 24px 20px 24px;', footerHtml, 'align="left"')}</tr>
</table></td></tr></table></body></html>`;

  return { subject, preheader, text, html };
}
