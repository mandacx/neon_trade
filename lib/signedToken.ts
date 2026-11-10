/**
 * Stateless HMAC-signed link tokens (pure; node:crypto only). Format: `1.<b64url(subject)>.<exp>.<b64url(mac)>` where exp
 * is epoch seconds or 0 (no expiry). The purpose is inside the MAC, never carried in the token, so a token minted for one
 * purpose does not verify for another. Fixtures: scripts/test-unsubscribe.mjs.
 *
 * Verification compares MACs with crypto.timingSafeEqual after an explicit length check, and returns null for every
 * failure (no reason is exposed).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const MIN_SECRET = 32;
const B64URL = /^[A-Za-z0-9_-]+$/;

const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url');

function mac(secret: string, purpose: string, subjectB64: string, exp: number): Buffer {
  return createHmac('sha256', secret).update(`nt-link|1|${purpose}|${subjectB64}|${exp}`).digest();
}

export function signToken(secret: string, purpose: string, subject: string, expSec?: number | null): string {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET) throw new Error('signing secret too short');
  const exp = expSec && expSec > 0 ? Math.floor(expSec) : 0;
  const s = b64u(subject);
  return `1.${s}.${exp}.${b64u(mac(secret, purpose, s, exp))}`;
}

/** Subject, or null for any failure. */
export function verifyToken(secret: string, purpose: string, token: unknown, nowSec: number): string | null {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET) return null;
  if (typeof token !== 'string' || token.length > 300) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [ver, s, expStr, sig] = parts;
  if (ver !== '1') return null;
  if (!s || !B64URL.test(s)) return null;
  if (!/^(0|[1-9][0-9]{0,15})$/.test(expStr)) return null;
  const exp = Number(expStr);
  if (exp > 0 && exp <= nowSec) return null;
  if (!sig || !B64URL.test(sig)) return null;
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== 32) return null;
  const want = mac(secret, purpose, s, exp);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const subject = Buffer.from(s, 'base64url').toString('utf8');
  if (!subject.length || subject.length > 128 || /[\u0000-\u001F\u007F]/.test(subject)) return null;
  return subject;
}
