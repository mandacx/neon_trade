/** Pure parsing for POST /api/email/unsubscribe and the /unsubscribe page. Fixtures: scripts/test-unsubscribe.mjs. */

export type UnsubOp = 'unsubscribe' | 'undo';
export type UnsubMode = 'one-click' | 'form' | 'json';

const tok = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 300 ? v : null);

/**
 * RFC 8058 one-click: form body `List-Unsubscribe=One-Click`, token in the query. No-JS page submit: form body with `op`.
 * JSON: `{ op, t }`. Anything else is null (a 400).
 */
export function parseUnsubRequest(
  contentType: string | null,
  queryT: string | null,
  body: Record<string, unknown> | null,
): { mode: UnsubMode; op: UnsubOp; token: string | null } | null {
  const ct = (contentType ?? '').toLowerCase();
  const isForm = ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data');
  const isJson = ct.includes('application/json');
  if (!body || typeof body !== 'object') return null;
  if (isForm) {
    if (body['List-Unsubscribe'] === 'One-Click') return { mode: 'one-click', op: 'unsubscribe', token: tok(queryT) };
    const op = body.op;
    if (op === 'unsubscribe' || op === 'undo') return { mode: 'form', op, token: tok(body.t) ?? tok(queryT) };
    return null;
  }
  if (isJson) {
    const op = body.op;
    if (op === 'unsubscribe' || op === 'undo') return { mode: 'json', op, token: tok(body.t) };
    return null;
  }
  return null;
}

export const RESULT_STATES = ['done', 'already', 'undone', 'invalid', 'error', 'limited'] as const;
export type ResultState = typeof RESULT_STATES[number];

export function resultState(s: unknown): ResultState | null {
  return typeof s === 'string' && (RESULT_STATES as readonly string[]).includes(s) ? (s as ResultState) : null;
}
