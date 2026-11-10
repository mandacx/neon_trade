/**
 * The Trade Ideas risk disclaimer, in ONE place (docs/trade-ideas.md, rule 9). Every surface gets it from the
 * server (API payloads, pages, emails); no component hardcodes the wording. Change the text here and bump
 * `version` to ask every subscriber to acknowledge it again.
 *
 * There is no compliance module: this is the whole mechanism. It must stay plain-language.
 */
export const DISCLAIMER_VERSION = '2026-11-08';

export interface IdeaDisclaimer {
  version: string;
  title: string;
  /** One line for the board, alerts and compact banners. */
  short: string;
  bullets: string[];
}

export const IDEA_DISCLAIMER: IdeaDisclaimer = {
  version: DISCLAIMER_VERSION,
  title: 'For information only',
  short: 'Ideas are for information and education only, not investment advice. Trading involves risk of loss.',
  bullets: [
    'The publisher is not a registered investment adviser or research analyst.',
    'Ideas are for information and education only. They are not trading or investment advice, and not a recommendation to buy or sell anything.',
    'Trading and investing involve risk of loss, including loss of principal. Past performance, including the desk\'s tracked results, does not guarantee future results.',
    'Trade or invest only as your own investment adviser advises, and do your own research.',
  ],
};

/**
 * Ultra-short line for web push notifications (title + body are tiny). Moved here from lib/ideaMessages.ts with the
 * user's approval (2026-11-10); the text is character-identical to what push shipped before. Kept OUT of `IDEA_DISCLAIMER`
 * so the object sent to clients (/api/ideas/disclaimer, publish preview) keeps its shape. Same version as above.
 */
export const IDEA_DISCLAIMER_MICRO = 'For information only, not advice.';

/** Plain-text footer for alert emails. */
export function disclaimerText(d: IdeaDisclaimer = IDEA_DISCLAIMER): string {
  return `${d.title.toUpperCase()}\n${d.bullets.map(b => `- ${b}`).join('\n')}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Styled footer block for alert emails (inline styles only, light background so it reads in both modes). */
export function disclaimerHtml(d: IdeaDisclaimer = IDEA_DISCLAIMER): string {
  return `<div style="margin-top:24px;padding:14px 16px;border:1px solid #fcd34d;background:#fffbeb;border-radius:10px;font-family:Arial,Helvetica,sans-serif;color:#78350f">
<div style="font-weight:700;font-size:13px;margin-bottom:6px">&#9888; ${esc(d.title)}</div>
<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5">${d.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
</div>`;
}

/**
 * Quieter footer block for the Trade Ideas alert emails (lib/ideaEmail.ts): same title and bullets as `disclaimerHtml`,
 * neutral gray instead of amber so the alert's own banner leads. Table based with bgcolor for mail clients. The look of
 * `disclaimerHtml` above is unchanged.
 */
export function disclaimerHtmlQuiet(d: IdeaDisclaimer = IDEA_DISCLAIMER): string {
  const font = 'font-family:Arial,Helvetica,sans-serif;color:#4B5563;';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#F9FAFB" style="background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:12px 14px;${font}">`
    + `<div style="${font}font-size:12px;line-height:18px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin:0 0 6px 0"><span aria-hidden="true">&#9888;</span> ${esc(d.title)}</div>`
    + `<ul style="${font}margin:0;padding-left:18px;font-size:12px;line-height:18px">${d.bullets.map(b => `<li style="margin:0 0 3px 0">${esc(b)}</li>`).join('')}</ul>`
    + `</td></tr></table>`;
}
