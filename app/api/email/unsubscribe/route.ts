import { NextRequest, NextResponse } from 'next/server';
import { turnOffIdeaEmails, turnOnIdeaEmails } from '@/lib/ideas';
import { issueResubToken, verifyResubToken, verifyUnsubToken } from '@/lib/ideaUnsubscribe';
import { checkRateLimit, rateLimitHeaders, rateLimitKey } from '@/lib/rateLimit';
import { resolveLimit } from '@/lib/rateLimitConfig';
import { parseUnsubRequest, type ResultState } from '@/lib/unsubscribeRequest';

export const dynamic = 'force-dynamic';

/**
 * Public (outside the middleware matcher on purpose): Trade Ideas email unsubscribe, docs/trade-ideas.md "Unsubscribe".
 * GET never touches the DB (link scanners and some clients open the List-Unsubscribe URL). POST writes:
 *   - RFC 8058 one-click (form body `List-Unsubscribe=One-Click`, token in the query),
 *   - the /unsubscribe page (no-JS form post, or JSON `{ op, t }`), including a 15-minute Undo.
 * Never logs tokens or URLs. Invalid tokens all answer the same.
 */
const NO_STORE = { 'Cache-Control': 'no-store' };
const TOKEN_SHAPE = /^[A-Za-z0-9_.-]{1,300}$/;

const redirect = (request: NextRequest, path: string) =>
  new NextResponse(null, { status: 303, headers: { ...NO_STORE, Location: new URL(path, request.nextUrl.origin).toString() } });

export async function GET(request: NextRequest) {
  const t = request.nextUrl.searchParams.get('t');
  return redirect(request, t && TOKEN_SHAPE.test(t) ? `/unsubscribe?t=${t}` : '/unsubscribe');
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  const ct = (request.headers.get('content-type') ?? '').toLowerCase();
  try {
    if (ct.includes('application/json')) {
      const j = await request.json();
      return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
    }
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const f = await request.formData();
      const o: Record<string, unknown> = {};
      f.forEach((v, k) => { if (typeof v === 'string') o[k] = v; });
      return o;
    }
  } catch { /* unreadable body */ }
  return null;
}

export async function POST(request: NextRequest) {
  const parsed = parseUnsubRequest(request.headers.get('content-type'), request.nextUrl.searchParams.get('t'), await readBody(request));
  if (!parsed) return NextResponse.json({ success: false, error: 'invalid' }, { status: 400, headers: NO_STORE });
  const { mode, op, token } = parsed;
  const userId = op === 'undo' ? verifyResubToken(token) : verifyUnsubToken(token);

  const respond = (state: ResultState, extra: { undoToken?: string | null; resubscribed?: boolean } = {}, rl?: Parameters<typeof rateLimitHeaders>[0]) => {
    const headers = { ...NO_STORE, ...(rl ? rateLimitHeaders(rl) : {}) };
    if (mode === 'one-click') {
      if (state === 'done' || state === 'already') return new NextResponse('OK', { status: 200, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
      return new NextResponse(state, { status: state === 'invalid' ? 400 : state === 'limited' ? 429 : 500, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (mode === 'form') return redirect(request, `/unsubscribe?s=${extra.resubscribed && state === 'done' ? 'undone' : state}`);
    if (state === 'done' || state === 'already') {
      const data = extra.resubscribed ? { state: 'resubscribed' } : state === 'done' ? { state: 'done', undoToken: extra.undoToken ?? null } : { state: 'already' };
      return NextResponse.json({ success: true, data }, { headers });
    }
    return NextResponse.json({ success: false, error: state }, { status: state === 'invalid' ? 400 : state === 'limited' ? 429 : 500, headers });
  };

  // A valid token is counted per user (mail providers' one-click POSTs share IPs); anything else per IP.
  const key = userId ? `user:${userId}` : rateLimitKey(request.headers, null);
  const { limit: cap, windowSeconds } = await resolveLimit('email_unsubscribe', false);
  const rl = await checkRateLimit('email_unsubscribe', key, cap, windowSeconds);
  if (!rl.allowed) return respond('limited', {}, rl);
  if (!userId) return respond('invalid');

  try {
    if (op === 'undo') {
      await turnOnIdeaEmails(userId);
      return respond('done', { resubscribed: true });
    }
    const r = await turnOffIdeaEmails(userId);
    return respond(r, { undoToken: r === 'done' ? issueResubToken(userId) : null });
  } catch (error) {
    console.error('[email-unsubscribe] write failed', error instanceof Error ? error.message : 'error');
    return respond('error');
  }
}
