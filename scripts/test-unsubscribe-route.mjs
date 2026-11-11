// Offline tests of app/api/email/unsubscribe/route.ts (GET and POST) with the database, the settings store and the
// Trade Ideas writes replaced by in-memory stubs (scripts/fixtures/loader). No network, no database, no email.
// The secret and the user ids are throwaway values.
//
//   node scripts/test-unsubscribe-route.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./fixtures/loader/hooks.mjs', import.meta.url));

const SECRET = ['QA_ONLY', 'secret', '0123456789', 'abcdefghijklmnop'].join('_');
process.env.IDEA_UNSUB_SECRET = SECRET;

const { GET, POST, dynamic } = await import('../app/api/email/unsubscribe/route.ts');
const { NextRequest } = await import('next/server');
const { signToken, verifyToken } = await import('../lib/signedToken.ts');
const ideas = await import('./fixtures/loader/stubs/ideas.mjs');
const db = await import('./fixtures/loader/stubs/db.mjs');

const UNSUB = 'idea-email-unsub';
const RESUB = 'idea-email-resub';
const USER = '6f1c2a52-8c3e-4f0b-9b0e-0d6f6d6c2a11';
const OTHER = '11111111-2222-4333-8444-555555555555';
const unsubTok = (uid = USER) => signToken(SECRET, UNSUB, uid, 0);
const resubTok = (uid = USER, exp = Math.floor(Date.now() / 1000) + 900) => signToken(SECRET, RESUB, uid, exp);
const ORIGIN = 'https://stockstrendz.com';

// Everything the route or its dependencies log, so the no-secret / no-token-in-logs checks can read it.
const realError = console.error;
const realWarn = console.warn;
const realLog = console.log;
const logged = [];
const allLogged = [];
for (const k of ['log', 'warn', 'error']) console[k] = (...a) => { const line = a.map(x => (x instanceof Error ? x.message : String(x))).join(' '); logged.push(line); allLogged.push(line); };

let rateHits = 1;
db.state.handler = (strings) => {
  const q = Array.isArray(strings) ? strings.join('?') : String(strings);
  if (q.includes('INSERT INTO public.nt_rate_limit_hits')) return [{ hits: rateHits, window_epoch: '1700000000' }];
  return [];
};

const reset = () => {
  ideas.state.calls.length = 0;
  db.state.calls.length = 0;
  ideas.state.turnOff = async () => 'done';
  ideas.state.turnOn = async () => {};
  rateHits = 1;
  logged.length = 0;
};

const form = (fields) => new URLSearchParams(fields).toString();
const post = (url, { ct = 'application/x-www-form-urlencoded', body, headers = {} } = {}) =>
  POST(new NextRequest(url, { method: 'POST', headers: { 'content-type': ct, ...headers }, body }));
const get = (url) => GET(new NextRequest(url, { method: 'GET' }));

let passed = 0;
const t = async (name, fn) => {
  reset();
  try { await fn(); passed++; } catch (e) { realError(`FAIL: ${name}`); throw e; }
};

await t('module exports: force-dynamic (no static caching of the route)', async () => {
  assert.equal(dynamic, 'force-dynamic');
});

await t('GET never mutates: valid, invalid and empty tokens all redirect and touch no database or write', async () => {
  for (const url of [
    `${ORIGIN}/api/email/unsubscribe?t=${unsubTok()}`,
    `${ORIGIN}/api/email/unsubscribe?t=not-a-token`,
    `${ORIGIN}/api/email/unsubscribe`,
  ]) {
    const r = await get(url);
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal(ideas.state.calls.length, 0, 'no Trade Ideas write on GET');
  assert.equal(db.state.calls.length, 0, 'no database query on GET (not even the rate limiter)');
});

await t('GET redirects only to our own page; a token-shaped value is passed through, anything else is dropped', async () => {
  const tok = unsubTok();
  const ok = await get(`${ORIGIN}/api/email/unsubscribe?t=${tok}`);
  assert.equal(new URL(ok.headers.get('location')).pathname, '/unsubscribe');
  assert.equal(new URL(ok.headers.get('location')).searchParams.get('t'), tok);
  for (const bad of ['<script>x</script>', 'https://evil.example', 'a%20b', 'x'.repeat(301)]) {
    const r = await get(`${ORIGIN}/api/email/unsubscribe?t=${encodeURIComponent(bad)}`);
    const loc = new URL(r.headers.get('location'));
    assert.equal(loc.pathname, '/unsubscribe');
    assert.equal(loc.search, '', `no token reflected for ${bad.slice(0, 20)}`);
    assert.equal(loc.origin, ORIGIN);
  }
});

await t('RFC 8058 one-click: valid token answers 200 OK, writes only for that user, no-store, no token in the response', async () => {
  ideas.state.turnOff = async () => 'done';
  const r = await post(`${ORIGIN}/api/email/unsubscribe?t=${unsubTok()}`, { body: form({ 'List-Unsubscribe': 'One-Click' }) });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'OK');
  assert.equal(r.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(ideas.state.calls, [['turnOff', USER]], 'exactly one write, for that user');
});

await t('one-click twice is a no-op with the same answer (already off on the second call)', async () => {
  const answers = ['done', 'already'];
  ideas.state.turnOff = async () => answers.shift();
  const url = `${ORIGIN}/api/email/unsubscribe?t=${unsubTok()}`;
  const a = await post(url, { body: form({ 'List-Unsubscribe': 'One-Click' }) });
  const b = await post(url, { body: form({ 'List-Unsubscribe': 'One-Click' }) });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const ta = await a.text();
  assert.equal(ta, await b.text());
  assert.equal(ta, 'OK');
});

await t('unknown user and already-off user get byte-identical answers (no enumeration), in one-click and JSON modes', async () => {
  ideas.state.turnOff = async () => 'already';
  const unknown = await post(`${ORIGIN}/api/email/unsubscribe?t=${unsubTok(OTHER)}`, { body: form({ 'List-Unsubscribe': 'One-Click' }) });
  const off = await post(`${ORIGIN}/api/email/unsubscribe?t=${unsubTok(USER)}`, { body: form({ 'List-Unsubscribe': 'One-Click' }) });
  assert.equal(unknown.status, off.status);
  const tUnknown = await unknown.text();
  assert.equal(tUnknown, await off.text());
  const jU = await post(`${ORIGIN}/api/email/unsubscribe`, { ct: 'application/json', body: JSON.stringify({ op: 'unsubscribe', t: unsubTok(OTHER) }) });
  const jO = await post(`${ORIGIN}/api/email/unsubscribe`, { ct: 'application/json', body: JSON.stringify({ op: 'unsubscribe', t: unsubTok(USER) }) });
  assert.equal(jU.status, 200); assert.equal(jO.status, 200);
  const tU = await jU.text();
  assert.equal(tU, await jO.text());
  assert.deepEqual(JSON.parse(tU), { success: true, data: { state: 'already' } }, 'no Undo token for an already-off or unknown user');
});

await t('invalid tokens (tampered, wrong purpose, malformed, missing, short secret) all get the same 400 and no write', async () => {
  const good = unsubTok();
  const [v, s, e, m] = good.split('.');
  const bad = [
    `${v}.${s}.${e}.${m.slice(0, -2)}xx`,
    `${v}.${Buffer.from('someone').toString('base64url')}.${e}.${m}`,
    resubTok(),
    'garbage',
    '',
  ];
  for (const tok of bad) {
    const r = await post(`${ORIGIN}/api/email/unsubscribe?t=${tok}`, { body: form({ 'List-Unsubscribe': 'One-Click' }) });
    assert.equal(r.status, 400, `status for ${tok.slice(0, 12)}`);
    assert.equal(await r.text(), 'invalid');
  }
  assert.equal(ideas.state.calls.length, 0);
});

await t('a missing or short secret fails closed: a token signed with the real secret is rejected and nothing is written', async () => {
  const tok = unsubTok();
  for (const sec of [undefined, '', 'short-secret']) {
    if (sec === undefined) delete process.env.IDEA_UNSUB_SECRET; else process.env.IDEA_UNSUB_SECRET = sec;
    const r = await post(`${ORIGIN}/api/email/unsubscribe?t=${tok}`, { body: form({ 'List-Unsubscribe': 'One-Click' }) });
    assert.equal(r.status, 400, String(sec));
  }
  process.env.IDEA_UNSUB_SECRET = SECRET;
  assert.equal(ideas.state.calls.length, 0);
});

await t('JSON unsubscribe: done returns an Undo token that verifies only as a resubscribe token for that user', async () => {
  ideas.state.turnOff = async () => 'done';
  const r = await post(`${ORIGIN}/api/email/unsubscribe`, { ct: 'application/json', body: JSON.stringify({ op: 'unsubscribe', t: unsubTok() }) });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.success, true);
  assert.equal(j.data.state, 'done');
  assert.equal(typeof j.data.undoToken, 'string');
  assert.equal(verifyToken(SECRET, RESUB, j.data.undoToken, Math.floor(Date.now() / 1000)), USER);
  assert.equal(verifyToken(SECRET, UNSUB, j.data.undoToken, Math.floor(Date.now() / 1000)), null, 'Undo token is not an unsubscribe token');
  assert.deepEqual(ideas.state.calls, [['turnOff', USER]]);
});

await t('JSON undo with a fresh resubscribe token re-enables for that user only', async () => {
  const r = await post(`${ORIGIN}/api/email/unsubscribe`, { ct: 'application/json', body: JSON.stringify({ op: 'undo', t: resubTok() }) });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, data: { state: 'resubscribed' } });
  assert.deepEqual(ideas.state.calls, [['turnOn', USER]]);
});

await t('undo is purpose bound: the unsubscribe token cannot re-subscribe; an expired resubscribe token is refused', async () => {
  const wrong = await post(`${ORIGIN}/api/email/unsubscribe`, { ct: 'application/json', body: JSON.stringify({ op: 'undo', t: unsubTok() }) });
  assert.equal(wrong.status, 400);
  const expired = await post(`${ORIGIN}/api/email/unsubscribe`, { ct: 'application/json', body: JSON.stringify({ op: 'undo', t: resubTok(USER, Math.floor(Date.now() / 1000) - 1) }) });
  assert.equal(expired.status, 400);
  assert.equal((await expired.json()).error, 'invalid');
  assert.equal(ideas.state.calls.length, 0, 'no turnOn for either');
});

await t('the no-JS form post redirects with a result state only: no token and no undo in the Location', async () => {
  ideas.state.turnOff = async () => 'done';
  const r = await post(`${ORIGIN}/api/email/unsubscribe`, { body: form({ op: 'unsubscribe', t: unsubTok() }) });
  assert.equal(r.status, 303);
  const loc = r.headers.get('location');
  assert.equal(new URL(loc).pathname, '/unsubscribe');
  assert.equal(new URL(loc).searchParams.get('s'), 'done');
  assert.ok(!loc.includes('t=') && !loc.includes('undo'), 'no token in the redirect');
  ideas.state.turnOff = async () => 'already';
  const again = await post(`${ORIGIN}/api/email/unsubscribe`, { body: form({ op: 'unsubscribe', t: unsubTok() }) });
  assert.equal(new URL(again.headers.get('location')).searchParams.get('s'), 'already');
  const bad = await post(`${ORIGIN}/api/email/unsubscribe`, { body: form({ op: 'unsubscribe', t: 'bad.token' }) });
  assert.equal(new URL(bad.headers.get('location')).searchParams.get('s'), 'invalid');
});

await t('malformed bodies: unknown op, wrong content type, bad JSON, no body all answer 400', async () => {
  const cases = [
    { ct: 'application/json', body: JSON.stringify({ op: 'delete', t: unsubTok() }) },
    { ct: 'text/plain', body: unsubTok() },
    { ct: 'application/json', body: '{not json' },
    { ct: 'application/x-www-form-urlencoded', body: undefined },
  ];
  for (const c of cases) {
    const r = await post(`${ORIGIN}/api/email/unsubscribe`, c);
    assert.equal(r.status, 400, c.ct);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal(ideas.state.calls.length, 0);
});

await t('rate limit: a valid token is counted per user (limiter email_unsubscribe), an invalid one per IP; over the limit is 429 and no write', async () => {
  rateHits = 1;
  await post(`${ORIGIN}/api/email/unsubscribe?t=${unsubTok()}`, { body: form({ 'List-Unsubscribe': 'One-Click' }) });
  assert.ok(db.state.calls.some(c => c.slice(1).some(v => v === `email_unsubscribe:user:${USER}`)), 'counted under the user key');
  reset();
  await post(`${ORIGIN}/api/email/unsubscribe?t=garbage`, { body: form({ 'List-Unsubscribe': 'One-Click' }), headers: { 'x-forwarded-for': '203.0.113.9' } });
  assert.ok(db.state.calls.some(c => c.slice(1).some(v => v === 'email_unsubscribe:ip:203.0.113.9')), 'invalid token counted under the IP key');
  reset();
  rateHits = 21;
  const one = await post(`${ORIGIN}/api/email/unsubscribe?t=${unsubTok()}`, { body: form({ 'List-Unsubscribe': 'One-Click' }) });
  assert.equal(one.status, 429);
  assert.equal(await one.text(), 'limited');
  assert.ok(one.headers.get('retry-after'), 'Retry-After set');
  assert.equal(one.headers.get('x-ratelimit-limit'), '20', 'default standard limit of 20 per minute');
  const j = await post(`${ORIGIN}/api/email/unsubscribe`, { ct: 'application/json', body: JSON.stringify({ op: 'unsubscribe', t: unsubTok() }) });
  assert.equal(j.status, 429);
  assert.deepEqual(await j.json(), { success: false, error: 'limited' });
  assert.equal(ideas.state.calls.length, 0, 'a limited request writes nothing');
});

await t('a database failure on the write answers 500 error with no Undo token, and the log has no token', async () => {
  ideas.state.turnOff = async () => { throw new Error('connection reset'); };
  const r = await post(`${ORIGIN}/api/email/unsubscribe`, { ct: 'application/json', body: JSON.stringify({ op: 'unsubscribe', t: unsubTok() }) });
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { success: false, error: 'error' });
  const one = await post(`${ORIGIN}/api/email/unsubscribe?t=${unsubTok()}`, { body: form({ 'List-Unsubscribe': 'One-Click' }) });
  assert.equal(one.status, 500);
  assert.equal(await one.text(), 'error');
  const all = logged.join('\n');
  assert.ok(all.includes('[email-unsubscribe] write failed'));
  assert.ok(!all.includes(unsubTok()) && !all.includes(SECRET) && !all.includes(USER), 'no token, secret or user id in the log');
});

await t('no response body ever contains the secret, and the Undo token is only in the JSON done answer', async () => {
  const tok = unsubTok();
  const bodies = [];
  bodies.push(await (await post(`${ORIGIN}/api/email/unsubscribe?t=${tok}`, { body: form({ 'List-Unsubscribe': 'One-Click' }) })).text());
  bodies.push(await (await post(`${ORIGIN}/api/email/unsubscribe`, { body: form({ op: 'unsubscribe', t: tok }) })).text());
  bodies.push(await (await post(`${ORIGIN}/api/email/unsubscribe`, { ct: 'application/json', body: JSON.stringify({ op: 'unsubscribe', t: 'bad' }) })).text());
  for (const b of bodies) assert.ok(!b.includes(SECRET) && !b.includes(USER), 'secret / user id absent');
  assert.ok(!bodies[0].includes(tok) && bodies[0] === 'OK');
});

await t('the real writes (lib/ideas.ts) are parameterised and touch only nt_idea_prefs.email_alerts for that user_id', async () => {
  const real = await import('../lib/ideas.ts');
  const seen = [];
  db.state.handler = (q, params) => { seen.push({ q: typeof q === 'string' ? q : q.join('?'), params }); return params && params.length ? [{ user_id: params[0] }] : []; };
  assert.equal(await real.turnOffIdeaEmails(USER), 'done');
  db.state.handler = (q, params) => { seen.push({ q: typeof q === 'string' ? q : q.join('?'), params }); return []; };
  assert.equal(await real.turnOffIdeaEmails(OTHER), 'already', 'no row or already off');
  await real.turnOnIdeaEmails(USER);
  assert.equal(seen.length, 3);
  const [off1, off2, on] = seen;
  for (const s of [off1, off2, on]) {
    assert.deepEqual(s.params, [s.params[0]], 'one parameter: the user id');
    assert.match(s.q, /WHERE user_id = \$1/, 'user id is bound, not interpolated');
    assert.match(s.q, /^UPDATE public\.nt_idea_prefs SET /, 'only an UPDATE of nt_idea_prefs');
    assert.ok(!/INSERT|DELETE|telegram|push_alerts|feed_seen/i.test(s.q), 'no other column, no insert or delete');
  }
  assert.match(off1.q, /SET email_alerts = false, updated_at = now\(\)/);
  assert.match(off1.q, /AND email_alerts RETURNING user_id/, 'turn-off reports whether it changed a row');
  assert.match(on.q, /SET email_alerts = true, updated_at = now\(\)/);
  assert.equal(off1.params[0], USER);
  assert.equal(on.params[0], USER);
  assert.equal(off2.params[0], OTHER, 'the other user id is the one bound');
  assert.ok(!seen.some(s => s.q.includes(USER) || s.q.includes(OTHER)), 'no id interpolated into the SQL text');
});

await t('middleware matcher does not gate the public paths (approximation of Next matching: a pattern "/x/:path*" covers /x and /x/...)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('matcher: ['), src.indexOf(']', src.indexOf('matcher: [')) + 1);
  const patterns = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(patterns.length >= 10, 'matcher list parsed');
  const matches = (path) => patterns.some(p => { const base = p.replace(/\/:path\*$/, ''); return path === base || path.startsWith(`${base}/`); });
  for (const p of ['/unsubscribe', '/api/email/unsubscribe', '/contact', '/terms', '/privacy']) assert.equal(matches(p), false, `${p} must not be gated`);
  assert.equal(matches('/ideas/42'), true, 'sanity: the ideas gate does match');
});

// No-JS form undo: redirects with s=undone (the page shows the 'undone' copy, not the unsubscribed one).
await t('no-JS form undo redirects with s=undone', async () => {
  const r = await post(`${ORIGIN}/api/email/unsubscribe`, { body: form({ op: 'undo', t: resubTok() }) });
  assert.equal(r.status, 303);
  assert.notEqual(new URL(r.headers.get('location')).searchParams.get('s'), 'done');
  assert.equal(new URL(r.headers.get('location')).searchParams.get('s'), 'undone');
});

// Restore the console before reporting, and fail if any secret leaked into the captured output.
const everything = logged.join('\n');
for (const k of ['log', 'warn', 'error']) console[k] = { log: realLog, warn: realWarn, error: realError }[k];
assert.ok(!everything.includes(SECRET), 'secret never logged');
realLog(`unsubscribe route: ${passed} tests passed (offline; DB, settings and Trade Ideas writes stubbed)`);
