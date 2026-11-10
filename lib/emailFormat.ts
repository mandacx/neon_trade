/**
 * Pure email helpers (no server-only, no env): sender formatting and header sanitising. Fixtures in
 * scripts/test-unsubscribe.mjs.
 */

const ADDR_IN_BRACKETS = /<\s*([^<>\s@]+@[^<>\s@]+)\s*>\s*$/;
const BARE_ADDR = /^[^<>\s"@,;]+@[^<>\s"@,;]+$/;
const SPECIALS = /[()[\]:;@,.]/;

/**
 * "Name <addr>" built from the address part of the configured From value and a display name set in code.
 * Anything that cannot be parsed safely returns the configured value unchanged.
 */
export function formatFrom(envFrom: string | undefined, displayName: string): string | undefined {
  if (!envFrom) return envFrom;
  const trimmed = envFrom.trim();
  let addr: string | null = null;
  const m = ADDR_IN_BRACKETS.exec(trimmed);
  if (m) addr = m[1];
  else if (BARE_ADDR.test(trimmed)) addr = trimmed;
  if (!addr) return envFrom;
  let name = String(displayName ?? '')
    .replace(/[\u0000-\u001F\u007F<>"\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
    .trim();
  if (!name) return envFrom;
  if (SPECIALS.test(name)) name = `"${name}"`;
  return `${name} <${addr}>`;
}

/** RFC 8058 one-click headers; only for an https URL with no characters that could break the header. */
export function listUnsubscribeHeaders(oneClickUrl: string | null | undefined): Record<string, string> {
  if (typeof oneClickUrl !== 'string' || !/^https:\/\/[^\s<>,"]+$/.test(oneClickUrl)) return {};
  return { 'List-Unsubscribe': `<${oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

/** Keep only well-formed header names and single-line values; undefined when nothing is left. */
export function cleanHeaders(h: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!h || typeof h !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (!/^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(k)) continue;
    if (typeof v !== 'string' || v.length > 2000 || /[\r\n\0]/.test(v)) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
