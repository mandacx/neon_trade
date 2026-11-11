// Offline server-render checks of app/unsubscribe/page.tsx and components/email/UnsubscribeView.tsx: which state each
// URL shows, the copy, the no-JavaScript form, metadata (noindex, no-referrer), and that the token is only in the one
// hidden input. Rendered with react-dom/server; nothing is fetched, no database is touched (the root layout is not
// rendered here). The client-side fetch flow (JS submit, Undo, focus) is NOT covered here: it needs a browser.
//
//   node scripts/test-unsubscribe-page.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./fixtures/loader/hooks.mjs', import.meta.url));

const SECRET = ['QA_ONLY', 'secret', '0123456789', 'abcdefghijklmnop'].join('_');
process.env.IDEA_UNSUB_SECRET = SECRET;

const { default: UnsubscribePage, metadata, dynamic } = await import('../app/unsubscribe/page.tsx');
const { default: ReactDOMServer } = await import('react-dom/server');
const { signToken } = await import('../lib/signedToken.ts');
const { SUPPORT_EMAIL } = await import('../lib/site.ts');

const USER = '6f1c2a52-8c3e-4f0b-9b0e-0d6f6d6c2a11';
const TOKEN = signToken(SECRET, 'idea-email-unsub', USER, 0);

const render = async (sp) => {
  const el = await UnsubscribePage({ searchParams: Promise.resolve(sp) });
  return ReactDOMServer.renderToStaticMarkup(el);
};
const h1 = (html) => (html.match(/<h1[^>]*>(.*?)<\/h1>/) ?? [])[1];

let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { console.error(`FAIL: ${name}`); throw e; }
};

await t('metadata: noindex, no-referrer, the agreed title; route is dynamic', async () => {
  assert.equal(dynamic, 'force-dynamic');
  assert.equal(metadata.title, 'Unsubscribe from Trade Ideas emails - StocksTrendz');
  assert.equal(metadata.robots.index, false);
  assert.equal(metadata.robots.follow, false);
  assert.equal(metadata.referrer, 'no-referrer');
});

await t('valid token: State A (confirm) with a real POST form that carries the token only in the hidden input', async () => {
  const html = await render({ t: TOKEN });
  assert.equal(h1(html), 'Unsubscribe from Trade Ideas emails?');
  const formTag = (html.match(/<form[^>]*>/) ?? [''])[0];
  assert.ok(formTag.includes('method="post"') && formTag.includes('action="/api/email/unsubscribe"'), `no-JS form posts to the API: ${formTag}`);
  assert.ok(html.includes('name="op" value="unsubscribe"'));
  assert.equal(html.split(TOKEN).length - 1, 1, 'token appears exactly once (the hidden input)');
  assert.ok(html.includes(`name="t" value="${TOKEN}"`));
  assert.ok(!/href="[^"]*t=/.test(html), 'no link carries the token');
  assert.ok(html.includes('>Unsubscribe</button>') && html.includes('This takes effect straight away.'));
  assert.ok(html.includes('No, keep my emails'));
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes('tabindex="-1"'), 'h1 can take focus');
  assert.ok(html.includes('Sign-in and other account emails, Telegram and browser notifications are not changed.'));
});

await t('invalid, tampered, wrong-purpose and missing tokens: State D, no form, no token echoed', async () => {
  const bad = [undefined, '', 'x', `${TOKEN.slice(0, -3)}abc`, signToken(SECRET, 'idea-email-resub', USER, Math.floor(Date.now() / 1000) + 900), '"><script>alert(1)</script>'];
  for (const tok of bad) {
    const html = await render(tok === undefined ? {} : { t: tok });
    assert.equal(h1(html), 'This unsubscribe link does not work', String(tok).slice(0, 20));
    assert.ok(!html.includes('<form'), 'no form on State D');
    assert.ok(!html.includes('<script>'), 'hostile token not reflected');
    if (tok && tok.length > 8) assert.ok(!html.includes(tok), 'a submitted token is not echoed back');
    assert.ok(html.includes('<ol'), 'numbered manual steps');
    assert.ok(html.includes('Sign in to StocksTrendz.') && html.includes('Untick Email.'));
  }
});

await t('the array form of a repeated t parameter is handled (first value)', async () => {
  const html = await render({ t: [TOKEN, 'zzz'] });
  assert.equal(h1(html), 'Unsubscribe from Trade Ideas emails?');
});

const RESULTS = [
  ['done', 'You are unsubscribed from Trade Ideas emails'],
  ['already', 'Trade Ideas emails are off'],
  ['invalid', 'This unsubscribe link does not work'],
  ['error', 'We could not unsubscribe you just now'],
  ['limited', 'Too many attempts'],
];
for (const [s, title] of RESULTS) {
  await t(`?s=${s} shows the result state without a form or token`, async () => {
    const html = await render({ s, t: TOKEN });
    assert.equal(h1(html), title);
    assert.ok(!html.includes('<form'), 'no form after a result');
    assert.ok(!html.includes(TOKEN), 'token not shown even when present in the URL');
  });
}

await t('?s=done shows the copy from the designer (State B) and the way back; no Undo button without JavaScript', async () => {
  const html = await render({ s: 'done' });
  assert.ok(html.includes('We will not send you Trade Ideas alert emails any more. This can take a moment to apply to an email that is already on its way.'));
  assert.ok(html.includes('Changed your mind later? Sign in to StocksTrendz, open Trade Ideas, choose Alerts and tick Email.'));
  assert.ok(html.includes('Go to Trade Ideas'));
  assert.ok(!html.includes('Undo, turn emails back on'), 'Undo is offered only after the JS POST');
});

await t('State E (error) is an alert, offers a retry path, and makes no unverified "settings were not changed" claim', async () => {
  const html = await render({ s: 'error' });
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes('Something went wrong on our side. Please try again.'));
  assert.ok(!html.includes('Your settings were not changed'), 'the architect dropped this claim');
  assert.ok(html.includes(`contact ${SUPPORT_EMAIL}`));
});

await t('State F (limited) is an alert with a wait message and the manual path', async () => {
  const html = await render({ s: 'limited' });
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes('Please wait a few minutes and try again.'));
  assert.ok(html.includes('Sign in and open Trade Ideas'));
});

await t('?s=error without JavaScript tells the reader how to try again (no token in the URL)', async () => {
  const html = await render({ s: 'error' });
  assert.ok(html.includes('Try again:') && html.includes('open the unsubscribe link in your email'));
});

await t('?s=undone shows the emails-back-on state, no form', async () => {
  const html = await render({ s: 'undone' });
  assert.equal(h1(html), 'Trade Ideas emails are back on');
  assert.ok(!html.includes('<form'));
});

await t('an unknown ?s= value is ignored: it falls back to the token check (invalid here)', async () => {
  assert.equal(h1(await render({ s: 'resubscribed' })), 'This unsubscribe link does not work');
  assert.equal(h1(await render({ s: '<b>x</b>' })), 'This unsubscribe link does not work');
  assert.equal(h1(await render({ s: 'undone' })), 'Trade Ideas emails are back on', 'undone is the no-JS Undo result');
  assert.equal(h1(await render({ s: 'done', t: TOKEN })), 'You are unsubscribed from Trade Ideas emails', 's wins over t');
});

await t('no state shows an email address (other than the support contact), a user id, or a plan', async () => {
  const pages = await Promise.all([
    render({ t: TOKEN }), render({ s: 'done' }), render({ s: 'already' }), render({ s: 'invalid' }), render({ s: 'error' }), render({ s: 'limited' }),
  ]);
  for (const html of pages) {
    assert.ok(!html.includes(USER), 'no user id');
    const emails = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) ?? [];
    assert.ok(emails.every(e => e === SUPPORT_EMAIL), `only the support address: ${emails}`);
  }
});

await t('page chrome: brand link to home, Contact / Terms / Privacy footer, no site Header or navigation', async () => {
  const html = await render({ s: 'done' });
  assert.ok(html.includes('href="/"') && html.includes('>StocksTrendz</a>'));
  assert.ok(html.includes('href="/contact"') && html.includes('href="/terms"') && html.includes('href="/privacy"'));
  assert.ok(!html.includes('indices') && !/Watchlists|Scanner|Quadrant/.test(html), 'no nav');
});

console.log(`unsubscribe page (server render): ${passed} tests passed`);
