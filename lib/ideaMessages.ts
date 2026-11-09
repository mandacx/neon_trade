/**
 * Alert message builders for the non-email channels (Telegram, web push). Pure; fixtures in
 * scripts/test-idea-scoring.mjs. Every message carries the compact disclaimer line (docs/trade-ideas.md, rule 9);
 * the full text stays on the pages and in email. The wording comes from lib/ideaDisclaimer.ts, never from here.
 */
import { IDEA_DISCLAIMER } from './ideaDisclaimer.ts';

/** Telegram plain text (no parse mode): the event, a link, the disclaimer line. Telegram caps messages at 4096 chars. */
export function telegramText(summary: string, link: string): string {
  return `${summary.slice(0, 600)}\n${link}\n\n⚠ ${IDEA_DISCLAIMER.short}`.slice(0, 4000);
}

export interface PushPayload { title: string; body: string; url: string; tag: string }

/** Web push payload: kept short (push services cap the encrypted body near 4 KB). The tag collapses repeats per idea. */
export function pushPayload(summary: string, ideaId: string | number, eventType: string): PushPayload {
  return {
    title: 'Trade Ideas',
    body: `${summary.slice(0, 160)}\nFor information only, not advice.`,
    url: `/ideas/${ideaId}`,
    tag: `idea-${ideaId}-${eventType}`,
  };
}
