import 'server-only';
import { signToken, verifyToken } from '@/lib/signedToken';
import { SITE_URL } from '@/lib/site';

/**
 * Trade Ideas email unsubscribe links. The only env read for this feature is here: IDEA_UNSUB_SECRET (HMAC key, at
 * least 32 characters). Without it nothing is signed and nothing verifies (fail closed): emails carry no link or headers.
 * Never log tokens or URLs.
 */
export const IDEA_UNSUB_PURPOSE = 'idea-email-unsub';
export const IDEA_RESUB_PURPOSE = 'idea-email-resub';
export const RESUB_TTL_SECONDS = 15 * 60;

const secret = (): string => (process.env.IDEA_UNSUB_SECRET ?? '').trim();
const nowSec = (): number => Math.floor(Date.now() / 1000);

export function unsubscribeConfigured(): boolean {
  return secret().length >= 32;
}

export function ideaUnsubscribeLinks(userId: string): { page: string; oneClick: string } | null {
  if (!unsubscribeConfigured()) return null;
  const t = signToken(secret(), IDEA_UNSUB_PURPOSE, userId, 0);
  return { page: `${SITE_URL}/unsubscribe?t=${t}`, oneClick: `${SITE_URL}/api/email/unsubscribe?t=${t}` };
}

export const verifyUnsubToken = (t: unknown): string | null => verifyToken(secret(), IDEA_UNSUB_PURPOSE, t, nowSec());

export function issueResubToken(userId: string): string | null {
  if (!unsubscribeConfigured()) return null;
  return signToken(secret(), IDEA_RESUB_PURPOSE, userId, nowSec() + RESUB_TTL_SECONDS);
}

export const verifyResubToken = (t: unknown): string | null => verifyToken(secret(), IDEA_RESUB_PURPOSE, t, nowSec());
