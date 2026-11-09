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
