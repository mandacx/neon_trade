// Offline tests of lib/email.ts sendEmail(): the From name, the custom headers and the 400/422 resend-without-headers
// guard. fetch is replaced by an injected fake, so nothing reaches Resend. The API key and the unsubscribe token used
// here are throwaway values; the test checks that neither appears in any console output.
//
//   node scripts/test-email-send.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./fixtures/loader/hooks.mjs', import.meta.url));

const KEY = 're_TESTKEY_not_real_0000';
const TOKEN = ['TOKENMARK', '0123456789'].join('_');
process.env.EMAIL_PROVIDER = 'resend';
process.env.EMAIL_API_KEY = KEY;
process.env.EMAIL_FROM = 'Stocks Trendz <support@stockstrendz.com>';
process.env.EMAIL_REPLY_TO = 'reply@stockstrendz.com';

const { sendEmail } = await import('../lib/email.ts');

// Capture console output so the secret checks below can look at everything the module logged.
const realError = console.error;
const realLog = console.log;
const logged = [];
for (const k of ['log', 'warn', 'error']) console[k] = (...a) => { logged.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(' ')); };

let fake = [];
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init, body: JSON.parse(init.body) });
  const r = fake.shift();
  if (!r) throw new Error('unexpected extra fetch');
  if (r instanceof Error) throw r;
  return new Response(r.raw ?? JSON.stringify(r.body ?? {}), { status: r.status });
};

const reply = (status, body) => ({ status, body });
const HEADERS = {
  'List-Unsubscribe': `<https://stockstrendz.com/api/email/unsubscribe?t=${TOKEN}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
};
const MAIL = { to: 'reader@example.com', subject: 'AAPL long: entered', text: 'plain body', html: '<p>html body</p>' };

let passed = 0;
const t = async (name, fn) => {
  fake = []; calls.length = 0; logged.length = 0;
  try { await fn(); passed++; } catch (e) { realError(`FAIL: ${name}`); throw e; }
};

await t('success: From built from the address part, headers and reply-to sent, one request', async () => {
  fake = [reply(200, { id: 'em_1' })];
  const r = await sendEmail({ ...MAIL, fromName: 'StocksTrendz Trade Ideas', headers: HEADERS });
  assert.deepEqual(r, { ok: true, id: 'em_1' });
  assert.equal(calls.length, 1);
  const b = calls[0].body;
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(b.from, 'StocksTrendz Trade Ideas <support@stockstrendz.com>');
  assert.deepEqual(b.to, ['reader@example.com']);
  assert.equal(b.subject, MAIL.subject);
  assert.equal(b.text, MAIL.text);
  assert.equal(b.html, MAIL.html);
  assert.equal(b.reply_to, 'reply@stockstrendz.com');
  assert.deepEqual(b.headers, HEADERS);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.ok(calls[0].init.signal, 'request has a timeout signal');
});

await t('no fromName: From is EMAIL_FROM verbatim; no headers key when none are given', async () => {
  fake = [reply(200, { id: 'em_2' })];
  await sendEmail(MAIL);
  assert.equal(calls[0].body.from, 'Stocks Trendz <support@stockstrendz.com>');
  assert.ok(!('headers' in calls[0].body));
});

await t('422 with headers: resent once without headers, identical otherwise, warning has the status only', async () => {
  fake = [reply(422, { message: 'headers not supported' }), reply(200, { id: 'em_3' })];
  const r = await sendEmail({ ...MAIL, fromName: 'StocksTrendz Trade Ideas', headers: HEADERS });
  assert.deepEqual(r, { ok: true, id: 'em_3' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.headers, HEADERS);
  assert.ok(!('headers' in calls[1].body), 'second attempt has no headers');
  const { headers: _h, ...rest } = calls[0].body;
  assert.deepEqual(calls[1].body, rest, 'same from, to, subject, text and html');
  assert.ok(logged.some(l => l.includes('resending without them') && l.includes('422')));
});

await t('400 with headers: retried; a second failure is returned as the result (no third attempt)', async () => {
  fake = [reply(400, { message: 'bad header' }), reply(400, { message: 'invalid from' })];
  const r = await sendEmail({ ...MAIL, headers: HEADERS });
  assert.deepEqual(r, { ok: false, error: 'invalid from' });
  assert.equal(calls.length, 2);
});

await t('400 with a non-JSON body: error falls back to the HTTP status', async () => {
  fake = [reply(400, { raw: '<html>' }), reply(400, { raw: 'nope' })];
  const r = await sendEmail({ ...MAIL, headers: HEADERS });
  assert.deepEqual(r, { ok: false, error: 'HTTP 400' });
});

for (const status of [500, 429, 503]) {
  await t(`${status} with headers: no retry (not a validation error, so the send may have happened)`, async () => {
    fake = [reply(status, { message: 'provider down' })];
    const r = await sendEmail({ ...MAIL, headers: HEADERS });
    assert.deepEqual(r, { ok: false, error: 'provider down' });
    assert.equal(calls.length, 1);
  });
}

await t('400 without headers: no retry', async () => {
  fake = [reply(400, { message: 'bad to' })];
  const r = await sendEmail(MAIL);
  assert.deepEqual(r, { ok: false, error: 'bad to' });
  assert.equal(calls.length, 1);
});

await t('network error: resolves to ok:false, never throws', async () => {
  fake = [new Error('socket hang up')];
  const r = await sendEmail({ ...MAIL, headers: HEADERS });
  assert.deepEqual(r, { ok: false, error: 'socket hang up' });
});

await t('not configured: no request at all', async () => {
  const saved = process.env.EMAIL_API_KEY;
  delete process.env.EMAIL_API_KEY;
  try {
    const r = await sendEmail({ ...MAIL, headers: HEADERS });
    assert.deepEqual(r, { ok: false, error: 'email not configured' });
    assert.equal(calls.length, 0);
  } finally { process.env.EMAIL_API_KEY = saved; }
});

await t('hostile fromName and header values: no CR/LF reaches the request, bad header entries are dropped', async () => {
  fake = [reply(200, { id: 'em_4' })];
  await sendEmail({ ...MAIL, fromName: 'Evil\r\nBcc: x@y.co', headers: { 'List-Unsubscribe': '<https://a.co/x>\r\nBcc: z@y.co', 'Bad Name': 'x', 'X-OK': 'fine' } });
  const b = calls[0].body;
  assert.deepEqual(b.headers, { 'X-OK': 'fine' }, 'CRLF value and bad name removed');
  assert.ok(!/[\r\n]/.test(b.from), 'no CR/LF in From');
  assert.equal(b.from.split('<').length - 1, 1, 'exactly one < in From');
  assert.ok(b.from.endsWith(' <support@stockstrendz.com>'), 'address part is the configured one');
  assert.ok(!/[\r\n]/.test(JSON.stringify(b).replace(/\\r\\n/g, '')), 'no raw CR/LF in the request body');
});

await t('a header set that is all invalid is omitted entirely (no empty headers object)', async () => {
  fake = [reply(200, { id: 'em_5' })];
  await sendEmail({ ...MAIL, headers: { 'List-Unsubscribe': '<https://a.co>\r\n' } });
  assert.ok(!('headers' in calls[0].body));
});

await t('secrets and unsubscribe tokens never reach the logs (success, retry and failure paths)', async () => {
  // Provider and network messages are logged as received; the module itself must not log the request (key, headers, body).
  fake = [reply(422, { message: 'headers not supported' }), reply(500, { message: 'down' })];
  await sendEmail({ ...MAIL, headers: HEADERS });
  fake = [new Error('socket hang up')];
  await sendEmail({ ...MAIL, headers: HEADERS });
  assert.ok(logged.length >= 2, 'the failure paths did log something');
  const all = logged.join('\n');
  assert.ok(!all.includes(KEY), 'API key not logged');
  assert.ok(!all.includes(TOKEN), 'token not logged');
  assert.ok(!all.includes('stockstrendz.com/api/email'), 'unsubscribe URL not logged');
});

realLog(`email send: ${passed} tests passed (offline, injected fetch)`);
