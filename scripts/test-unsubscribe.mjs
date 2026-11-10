// Fixtures for the Trade Ideas unsubscribe pieces: sender formatting, List-Unsubscribe headers, signed tokens and request
// parsing. Pure modules only: no database, no network, no email sent.
//
//   node scripts/test-unsubscribe.mjs
//
// Not covered here (needs the app, a database or a mail provider): the route handler, the page, the real send. The
// constant-time MAC comparison is by code inspection (lib/signedToken.ts uses crypto.timingSafeEqual after a length
// check); there is deliberately no timing test.
import assert from 'node:assert/strict';
import { cleanHeaders, formatFrom, listUnsubscribeHeaders } from '../lib/emailFormat.ts';
import { signToken, verifyToken } from '../lib/signedToken.ts';
import { parseUnsubRequest, resultState } from '../lib/unsubscribeRequest.ts';

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error(`FAIL: ${name}`); throw e; } };

const NAME = 'StocksTrendz Trade Ideas';

t('formatFrom builds the name from code and keeps only the address', () => {
  assert.equal(formatFrom('Stocks Trendz <support@stockstrendz.com>', NAME), `${NAME} <support@stockstrendz.com>`);
  assert.equal(formatFrom('support@stockstrendz.com', NAME), `${NAME} <support@stockstrendz.com>`);
  assert.equal(formatFrom('  support@stockstrendz.com  ', NAME), `${NAME} <support@stockstrendz.com>`);
  assert.equal(formatFrom('"Quoted, Name" <a@b.co>', NAME), `${NAME} <a@b.co>`);
  assert.equal(formatFrom('<a@b.co>', NAME), `${NAME} <a@b.co>`);
});

t('formatFrom returns unparseable or empty values unchanged', () => {
  for (const v of ['garbage', 'a@b <', '', undefined, 'a@b.co, c@d.co', 'Name <not an address>']) assert.equal(formatFrom(v, NAME), v, String(v));
  assert.equal(formatFrom('a@b.co', ''), 'a@b.co', 'empty name leaves the configured value');
  assert.equal(formatFrom('a@b.co', ' \r\n<>"\\ '), 'a@b.co', 'name that sanitises to empty');
});

t('formatFrom neutralises hostile names and quotes names with specials', () => {
  const evil = formatFrom('a@b.co', 'Evil\r\nBcc: x@y <z>');
  assert.ok(!/[\r\n]/.test(evil), 'no CR/LF');
  assert.equal(evil.split('<').length - 1, 1, 'exactly one <');
  assert.equal(evil.split('>').length - 1, 1, 'exactly one >');
  assert.ok(evil.endsWith(' <a@b.co>'));
  assert.equal(formatFrom('a@b.co', 'Stocks.Trendz'), '"Stocks.Trendz" <a@b.co>');
  assert.ok(formatFrom('a@b.co', 'x'.repeat(200)).length <= 64 + ' <a@b.co>'.length);
});

t('listUnsubscribeHeaders only for a clean https URL', () => {
  const u = 'https://stockstrendz.com/api/email/unsubscribe?t=1.abc.0.def';
  assert.deepEqual(listUnsubscribeHeaders(u), { 'List-Unsubscribe': `<${u}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
  for (const bad of ['http://stockstrendz.com/x', 'javascript:alert(1)', 'https://a.co/x y', 'https://a.co/x>y', 'https://a.co/x,y', 'https://a.co/"x', '', null, undefined, 5, 'https://']) {
    assert.deepEqual(listUnsubscribeHeaders(bad), {}, String(bad));
  }
});

t('cleanHeaders drops CR/LF values, bad names and non-strings', () => {
  assert.deepEqual(cleanHeaders({ 'List-Unsubscribe': '<https://a.co/x>', 'X-A': 'ok' }), { 'List-Unsubscribe': '<https://a.co/x>', 'X-A': 'ok' });
  assert.equal(cleanHeaders({ 'X-A': 'a\r\nBcc: x@y' }), undefined);
  assert.equal(cleanHeaders({ 'X-A': 'a\nb' }), undefined);
  assert.equal(cleanHeaders({ 'X-A': 'a\0b' }), undefined);
  assert.equal(cleanHeaders({ 'Bad Name': 'x', '1bad': 'x', 'a:b': 'x', '': 'x' }), undefined);
  assert.equal(cleanHeaders({ 'X-A': 5, 'X-B': null }), undefined);
  assert.equal(cleanHeaders({ 'X-A': 'x'.repeat(2001) }), undefined);
  assert.deepEqual(cleanHeaders({ 'X-A': 'x'.repeat(2000), 'X B': 'y' }), { 'X-A': 'x'.repeat(2000) });
  assert.equal(cleanHeaders({}), undefined); assert.equal(cleanHeaders(undefined), undefined);
});

const SECRET = 'k'.repeat(40);
const UNSUB = 'idea-email-unsub';
const RESUB = 'idea-email-resub';
const NOW = 1_800_000_000;
const USER = '6f1c2a52-8c3e-4f0b-9b0e-0d6f6d6c2a11';

t('token round trip and shape', () => {
  const tok = signToken(SECRET, UNSUB, USER, 0);
  assert.match(tok, /^1\.[A-Za-z0-9_-]+\.0\.[A-Za-z0-9_-]{43}$/);
  assert.equal(verifyToken(SECRET, UNSUB, tok, NOW), USER);
  assert.ok(tok.length < 300);
  assert.equal(signToken(SECRET, UNSUB, USER), tok, 'deterministic');
});

t('tampering any part fails', () => {
  const tok = signToken(SECRET, UNSUB, USER, 0);
  const [v, s, e, m] = tok.split('.');
  const flip = (x) => (x[0] === 'A' ? 'B' : 'A') + x.slice(1);
  const otherSubject = Buffer.from('someone-else').toString('base64url');
  for (const bad of [`${v}.${otherSubject}.${e}.${m}`, `${v}.${s}.${Number(e) + 1}.${m}`, `${v}.${s}.${e}.${flip(m)}`, `2.${s}.${e}.${m}`, `${v}.${flip(s)}.${e}.${m}`, `${v}.${s}.${e}.${m.slice(0, -2)}`, `${v}.${s}.${e}.${m}x`]) {
    assert.equal(verifyToken(SECRET, UNSUB, bad, NOW), null, bad);
  }
});

t('wrong purpose, wrong secret, and unsub vs resub tokens are not interchangeable', () => {
  const tok = signToken(SECRET, UNSUB, USER, 0);
  assert.equal(verifyToken(SECRET, 'other', tok, NOW), null);
  assert.equal(verifyToken('z'.repeat(40), UNSUB, tok, NOW), null);
  assert.equal(verifyToken(SECRET, RESUB, tok, NOW), null, 'unsub token is not a resub token');
  const re = signToken(SECRET, RESUB, USER, NOW + 900);
  assert.equal(verifyToken(SECRET, RESUB, re, NOW), USER);
  assert.equal(verifyToken(SECRET, UNSUB, re, NOW), null, 'resub token is not an unsub token');
});

t('malformed input all returns null', () => {
  const tok = signToken(SECRET, UNSUB, USER, 0);
  for (const bad of ['', '1.2.3', tok.slice(0, 30), `${tok}.extra`, 'x'.repeat(301), `${'a'.repeat(250)}.${'b'.repeat(60)}`, '1.!!!.0.!!!', '1..0.' + 'A'.repeat(43), null, undefined, 5, {}, [tok]]) {
    assert.equal(verifyToken(SECRET, UNSUB, bad, NOW), null, String(bad).slice(0, 40));
  }
  assert.equal(verifyToken(SECRET, UNSUB, '1.' + Buffer.from('a\u0001b').toString('base64url') + '.0.' + 'A'.repeat(43), NOW), null);
});

t('expiry: unexpired ok, expired and boundary fail', () => {
  const re = signToken(SECRET, RESUB, USER, NOW + 900);
  assert.equal(verifyToken(SECRET, RESUB, re, NOW), USER);
  assert.equal(verifyToken(SECRET, RESUB, re, NOW + 899), USER);
  assert.equal(verifyToken(SECRET, RESUB, re, NOW + 900), null);
  assert.equal(verifyToken(SECRET, RESUB, re, NOW + 10_000), null);
  assert.equal(verifyToken(SECRET, UNSUB, signToken(SECRET, UNSUB, USER, 0), NOW + 10 ** 9), USER, 'no-expiry token never expires');
});

t('missing or short secret fails closed', () => {
  assert.throws(() => signToken('short', UNSUB, USER, 0));
  assert.throws(() => signToken('', UNSUB, USER, 0));
  const tok = signToken(SECRET, UNSUB, USER, 0);
  assert.equal(verifyToken('', UNSUB, tok, NOW), null);
  assert.equal(verifyToken('k'.repeat(31), UNSUB, tok, NOW), null);
  assert.equal(verifyToken(undefined, UNSUB, tok, NOW), null);
});

t('parseUnsubRequest: one-click, no-JS form, JSON, and rejects', () => {
  const FORM = 'application/x-www-form-urlencoded';
  assert.deepEqual(parseUnsubRequest(FORM, 'tok', { 'List-Unsubscribe': 'One-Click' }), { mode: 'one-click', op: 'unsubscribe', token: 'tok' });
  assert.deepEqual(parseUnsubRequest(FORM + '; charset=UTF-8', null, { 'List-Unsubscribe': 'One-Click' }), { mode: 'one-click', op: 'unsubscribe', token: null });
  assert.deepEqual(parseUnsubRequest('multipart/form-data; boundary=x', null, { op: 'unsubscribe', t: 'abc' }), { mode: 'form', op: 'unsubscribe', token: 'abc' });
  assert.deepEqual(parseUnsubRequest(FORM, 'q', { op: 'unsubscribe' }), { mode: 'form', op: 'unsubscribe', token: 'q' });
  assert.deepEqual(parseUnsubRequest('application/json', null, { op: 'unsubscribe', t: 'abc' }), { mode: 'json', op: 'unsubscribe', token: 'abc' });
  assert.deepEqual(parseUnsubRequest('application/json', 'ignored', { op: 'undo', t: 'abc' }), { mode: 'json', op: 'undo', token: 'abc' });
  assert.equal(parseUnsubRequest('application/json', null, { op: 'delete', t: 'abc' }), null);
  assert.equal(parseUnsubRequest(FORM, 'tok', { 'List-Unsubscribe': 'Nope' }), null);
  assert.equal(parseUnsubRequest('text/plain', 'tok', { 'List-Unsubscribe': 'One-Click' }), null);
  assert.equal(parseUnsubRequest(null, 'tok', {}), null);
  assert.equal(parseUnsubRequest(FORM, 'tok', null), null);
  assert.equal(parseUnsubRequest('application/json', null, { op: 'unsubscribe', t: 'x'.repeat(301) }).token, null, 'over-long token becomes null');
  assert.equal(parseUnsubRequest('application/json', null, { op: 'unsubscribe', t: 5 }).token, null);
});

t('resultState accepts only the known states', () => {
  for (const s of ['done', 'already', 'undone', 'invalid', 'error', 'limited']) assert.equal(resultState(s), s);
  for (const s of ['confirm', '', null, undefined, 5, '<script>', ['done']]) assert.equal(resultState(s), null);
});

// --- Edge cases added by QA (run 20261110-1730): encoding strictness, subject bounds, config gating -----------------

t('signature and expiry encodings are strict (wrong lengths, leading zeros, exponent forms, non-base64url)', () => {
  const tok = signToken(SECRET, UNSUB, USER, 0);
  const [v, s, , m] = tok.split('.');
  assert.equal(verifyToken(SECRET, UNSUB, `${v}.${s}.00.${m}`, NOW), null, 'leading zero exp');
  assert.equal(verifyToken(SECRET, UNSUB, `${v}.${s}.1e3.${m}`, NOW), null, 'exponent exp');
  assert.equal(verifyToken(SECRET, UNSUB, `${v}.${s}.-1.${m}`, NOW), null, 'negative exp');
  assert.equal(verifyToken(SECRET, UNSUB, `${v}.${s}.0.${m}A`, NOW), null, '44-char signature (33 bytes)');
  assert.equal(verifyToken(SECRET, UNSUB, `${v}.${s}.0.${m.slice(0, -1)}`, NOW), null, '42-char signature (31 bytes)');
  assert.equal(verifyToken(SECRET, UNSUB, `${v}.${s}.0.${m.replace(/[A-Za-z0-9]/, '+')}`, NOW), null, 'standard base64 alphabet');
  assert.equal(verifyToken(SECRET, UNSUB, `${v}.${s}.0.${m.replace(/[A-Za-z0-9]/, '=')}`, NOW), null, 'padding character');
  assert.equal(verifyToken(SECRET, UNSUB, ` ${tok}`, NOW), null, 'leading space');
  assert.equal(verifyToken(SECRET, UNSUB, tok.toUpperCase(), NOW), null, 'case-changed token');
});

t('subject bounds: a 129-byte subject is refused on verify; a 128-byte one round-trips', () => {
  const ok = 'a'.repeat(128);
  assert.equal(verifyToken(SECRET, UNSUB, signToken(SECRET, UNSUB, ok, 0), NOW), ok);
  assert.equal(verifyToken(SECRET, UNSUB, signToken(SECRET, UNSUB, 'a'.repeat(129), 0), NOW), null);
  assert.equal(verifyToken(SECRET, UNSUB, signToken(SECRET, UNSUB, 'x\u0001y', 0), NOW), null, 'control character in subject');
  assert.equal(verifyToken(SECRET, UNSUB, signToken(SECRET, UNSUB, '', 0), NOW), null, 'empty subject');
});

t('a valid signature over an expiry in the far future still verifies only with that purpose, and exp=0 never expires', () => {
  const far = signToken(SECRET, RESUB, USER, 4_000_000_000);
  assert.equal(verifyToken(SECRET, RESUB, far, NOW), USER);
  assert.equal(verifyToken(SECRET, UNSUB, far, NOW), null);
});

t('signing binds the exact subject string: a different case or whitespace is a different user', () => {
  const tok = signToken(SECRET, UNSUB, USER, 0);
  const [v, , e, m] = tok.split('.');
  const upper = Buffer.from(USER.toUpperCase()).toString('base64url');
  assert.equal(verifyToken(SECRET, UNSUB, `${v}.${upper}.${e}.${m}`, NOW), null);
});

{
  // lib/ideaUnsubscribe.ts is server-only and reads the env per call: load it through the test loader.
  const { register } = await import('node:module');
  register(new URL('./fixtures/loader/hooks.mjs', import.meta.url));
  const saved = process.env.IDEA_UNSUB_SECRET;
  const S32 = 'k'.repeat(32);
  try {
    const mod = await import('../lib/ideaUnsubscribe.ts');
    t('config gating: no secret or a 31-character secret => no links, no resub token, nothing verifies', () => {
      for (const v of [undefined, '', 'k'.repeat(31), '   ']) {
        if (v === undefined) delete process.env.IDEA_UNSUB_SECRET; else process.env.IDEA_UNSUB_SECRET = v;
        assert.equal(mod.unsubscribeConfigured(), false, String(v));
        assert.equal(mod.ideaUnsubscribeLinks(USER), null);
        assert.equal(mod.issueResubToken(USER), null);
        assert.equal(mod.verifyUnsubToken(signToken(S32, mod.IDEA_UNSUB_PURPOSE, USER, 0)), null);
      }
    });
    t('config on: links carry one token in both URLs, on the site origin; the token verifies for that user', () => {
      process.env.IDEA_UNSUB_SECRET = S32;
      assert.equal(mod.unsubscribeConfigured(), true);
      const l = mod.ideaUnsubscribeLinks(USER);
      assert.ok(l.page.startsWith('https://stockstrendz.com/unsubscribe?t='));
      assert.ok(l.oneClick.startsWith('https://stockstrendz.com/api/email/unsubscribe?t='));
      const tokP = new URL(l.page).searchParams.get('t');
      const tokO = new URL(l.oneClick).searchParams.get('t');
      assert.equal(tokP, tokO, 'same token in both links');
      assert.equal(mod.verifyUnsubToken(tokP), USER);
      assert.match(tokP, /^[A-Za-z0-9_.-]+$/, 'URL-safe alphabet');
    });
    t('config on: the resubscribe token expires after 15 minutes and is purpose bound', () => {
      process.env.IDEA_UNSUB_SECRET = S32;
      const r = mod.issueResubToken(USER);
      const now = Math.floor(Date.now() / 1000);
      assert.equal(mod.verifyResubToken(r), USER);
      assert.equal(mod.verifyUnsubToken(r), null, 'resub token is not an unsubscribe token');
      const exp = Number(r.split('.')[2]);
      assert.ok(exp >= now + mod.RESUB_TTL_SECONDS - 5 && exp <= now + mod.RESUB_TTL_SECONDS + 5, 'exp about 15 minutes ahead');
      assert.equal(mod.RESUB_TTL_SECONDS, 15 * 60);
    });
    t('config rotation: a token minted under one secret does not verify under another', () => {
      process.env.IDEA_UNSUB_SECRET = S32;
      const tok = mod.ideaUnsubscribeLinks(USER).page.split('t=')[1];
      process.env.IDEA_UNSUB_SECRET = 'j'.repeat(32);
      assert.equal(mod.verifyUnsubToken(tok), null);
    });
  } finally {
    if (saved === undefined) delete process.env.IDEA_UNSUB_SECRET; else process.env.IDEA_UNSUB_SECRET = saved;
  }
}

console.log(`ok: ${passed} unsubscribe tests passed`);
