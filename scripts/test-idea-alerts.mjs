// Fixture test for the Trade Ideas alert builders: lib/ideaAlertModel.ts, lib/ideaEmail.ts, lib/ideaMessages.ts and the
// disclaimer helpers in lib/ideaDisclaimer.ts. No database, no network.
//
//   node scripts/test-idea-alerts.mjs
//
// (Node 24+ loads the .ts modules directly via built-in type stripping.)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreIdea } from '../lib/ideaScoring.ts';
import { riskReward } from '../lib/ideaTypes.ts';
import {
  alertKind, allTargetsFacts, clampWords, escapeHtml, fmtDate, fmtPrice, fmtR, fmtRange, ideaLink, parseFacts, scoreEventFacts, toAlertIdea,
} from '../lib/ideaAlertModel.ts';
import { buildEmail, EMAIL_PALETTE, FOOTER_FALLBACK, FOOTER_SCOPE, FOOTER_WHY, UNSUB_LINK_TEXT } from '../lib/ideaEmail.ts';
import { buildPush, buildTelegram, pushUrgency } from '../lib/ideaMessages.ts';
import { IDEA_DISCLAIMER, IDEA_DISCLAIMER_MICRO, disclaimerHtml, disclaimerText } from '../lib/ideaDisclaimer.ts';

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error(`FAIL: ${name}`); throw e; } };

import { ALL, D, LONG, LONG_ROW, SHORT, SHORT_ROW, SPECS, TODAY, mk } from './fixtures/ideaAlertFixtures.mjs';

const PHRASE = {
  published: 'New idea', triggered: 'entered its zone', 'target': 'reached', all_targets: 'all targets reached', stopped: 'stopped out', expired: 'idea expired',
  not_triggered: 'never triggered', note: 'update from the desk', stop_moved: 'stop moved', partial_booked: 'partial profit booked', closed: 'closed early', cancelled: 'cancelled',
};
const HEADLINE = {
  published: 'New idea', triggered: 'Entered its zone', target: 'reached', all_targets: 'All targets reached', stopped: 'Stopped out', expired: 'Expired',
  not_triggered: 'Never triggered', note: 'Update from the desk', stop_moved: 'Stop moved', partial_booked: 'Partial profit booked', closed: 'Closed early', cancelled: 'Cancelled',
};
const BAD = /\bNaN\b|\bnull\b|\bundefined\b|Infinity|—|\[object/;
const TG_TAGS = /<\/?([a-z]+)(\s[^>]*)?>/g;
const unescapedEntity = /&(?!(amp|lt|gt|quot|#39|zwnj|nbsp|middot|#9888|#9650|#9660);)/;
const outputs = (input) => { const e = buildEmail(input); const g = buildTelegram(input); const p = buildPush(input); return { e, g, p }; };

// --- 1. every kind x channel -----------------------------------------------------------------------
t('every kind on every channel: non-empty, symbol, side, headline, links', () => {
  assert.equal(ALL.length, 28);
  for (const { name, kind, input } of ALL) {
    const { e, g, p } = outputs(input);
    const k = alertKind(input.eventType, input.eventKey);
    const key = k === 'target' ? 'target' : kind === 'stopped' ? 'stopped' : k;
    for (const s of [e.subject, e.preheader, e.text, e.html, g.html, g.plain, p.title, p.body]) assert.ok(typeof s === 'string' && s.length > 0, name);
    assert.ok(e.subject.includes('AAPL') && e.subject.includes(input.idea.direction), `${name}: subject ${e.subject}`);
    assert.ok(e.subject.toLowerCase().includes(PHRASE[key].toLowerCase()), `${name}: subject phrase ${e.subject}`);
    assert.ok(e.html.includes('lang="en"'), name);
    assert.ok(e.html.includes('href="https://stockstrendz.com/ideas/42"'), name);
    assert.ok(e.html.includes('https://stockstrendz.com/ideas"'), `${name}: manage link`);
    assert.ok(e.html.includes(HEADLINE[key]), `${name}: banner headline ${HEADLINE[key]}`);
    assert.ok(e.text.startsWith(`${HEADLINE[key].toUpperCase()}  |  AAPL  ${input.idea.direction.toUpperCase()}`) || k === 'target', `${name}: text first line ${e.text.split('\n')[0]}`);
    assert.ok(e.text.includes('Manage alerts (sign in, then Alerts, then Email): https://stockstrendz.com/ideas'), name);
    const first = g.html.split('\n')[0];
    assert.ok(first.includes('AAPL') && first.includes(HEADLINE[key]), `${name}: telegram first line ${first}`);
    assert.equal(g.button.url, 'https://stockstrendz.com/ideas/42');
    assert.ok(g.html.includes('href="https://stockstrendz.com/ideas/42"') && g.plain.includes('Open idea: https://stockstrendz.com/ideas/42'), name);
    assert.ok(p.title.includes('AAPL') && p.title.toLowerCase().includes(PHRASE[key].toLowerCase()), `${name}: push title ${p.title}`);
  }
});

t('designer sample subjects, push titles and Telegram lines (AAPL long)', () => {
  const by = (n) => outputs(ALL.find(a => a.name === `${n} long`).input);
  assert.equal(by('published').e.subject, 'New idea: AAPL long, entry 100.00 - 102.00');
  assert.equal(by('published').p.title, 'New idea: AAPL long');
  assert.equal(by('published').p.body.split('\n')[0], 'Entry 100.00 - 102.00 . Stop 95.00 . T1 110.00');
  assert.equal(by('triggered').e.subject, 'AAPL long: entered its zone');
  assert.equal(by('target T1').e.subject, 'AAPL long: T1 reached at 110.00 (+1.14R)');
  assert.equal(by('target T1').p.title, 'AAPL long: T1 reached at 110.00');
  assert.equal(by('target T1').p.body.split('\n')[0], '+1.14R . Next T2 120.00 . Stop 95.00');
  assert.equal(by('stopped').e.subject, 'AAPL long: stopped out at 95.00 (-1.00R)');
  assert.equal(by('stop_moved').e.subject, 'AAPL long: stop moved to 102.00');
  assert.equal(by('target T1').e.preheader, '1 of 2 targets hit. Next: T2 at 120.00. Stop 95.00.');
  assert.equal(by('published').e.preheader, 'Stop 95.00. Targets 110.00 and 120.00. Swing idea, medium risk.');
  const tg = by('target T1').g.plain;
  assert.ok(tg.includes('T1 was reached at 110.00 on Nov 9. 1 of 2 targets hit; T2 at 120.00 is next.'), tg);
  assert.ok(tg.includes('▲ LONG . Short term . Swing . Medium risk'), tg);
  assert.ok(tg.includes('T1  ') && /T1\s+110\.00\s+✓ hit/.test(tg), tg);
  assert.ok(by('stopped').e.text.includes('Price hit the stop at 95.00 on Nov 9. The idea is closed at a loss of 1.00R.'));
  assert.ok(buildTelegram(ALL.find(a => a.name === 'published short').input).plain.includes('▼ SHORT'));
});

// --- 2. disclaimer, exact wording ------------------------------------------------------------------
t('disclaimer wording is exact on every surface', () => {
  assert.equal(IDEA_DISCLAIMER_MICRO, 'For information only, not advice.');
  assert.equal(IDEA_DISCLAIMER.short, 'Ideas are for information and education only, not investment advice. Trading involves risk of loss.');
  assert.ok(disclaimerHtml().includes('#fcd34d'), 'existing disclaimerHtml look unchanged');
  const fallbackInputs = [mk(null, 'stopped', 'stopped', null), mk(LONG, 'stopped', 'stopped', null), mk(LONG, 'weird', 'x', { v: 1 })];
  for (const input of [...ALL.map(a => a.input), ...fallbackInputs]) {
    const { e, g, p } = outputs(input);
    assert.ok(e.text.includes(disclaimerText()), 'email text');
    assert.ok(e.html.includes(escapeHtml(IDEA_DISCLAIMER.title)), 'email html title');
    for (const b of IDEA_DISCLAIMER.bullets) assert.ok(e.html.includes(escapeHtml(b).replace(/&#39;/g, '&#39;')) || e.html.includes(b.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')), `bullet: ${b}`);
    assert.ok(g.html.includes(IDEA_DISCLAIMER.short) && g.plain.includes(IDEA_DISCLAIMER.short), 'telegram');
    assert.ok(p.body.endsWith(`\n${IDEA_DISCLAIMER_MICRO}`), 'push');
  }
});

// --- 3. escaping ----------------------------------------------------------------------------------
t('escaping: title and note cannot inject markup (email and Telegram)', () => {
  const evil = toAlertIdea({ ...LONG_ROW, title: 'A<b>&"\'*_[x]', rationale: '<script>alert(1)</script>', option_strategy: { name: '<i>Spread</i>' } });
  const note = '</pre><a href="x">click</a> & <b>bold';
  for (const [type, key, facts] of [['published', 'published', { v: 1 }], ['note', 'update:5', { v: 1, note }], ['closed', 'update:8', { v: 1, note }]]) {
    const input = mk(evil, type, key, facts);
    const { e, g } = outputs(input);
    for (const out of [e.html, g.html]) {
      assert.ok(!out.includes('A<b>&"'), 'raw title');
      assert.ok(!out.includes('</pre><a href="x">'), 'raw note');
      assert.ok(!out.includes('<script>') && !out.includes('<i>Spread</i>'), 'raw rationale / option');
      assert.ok(out.includes('A&lt;b&gt;&amp;&quot;&#39;*_[x]'), 'escaped title');
      assert.ok(!unescapedEntity.test(out.replace(/<[^>]*>/g, '')), 'bare ampersand');
    }
    const tags = [...g.html.matchAll(TG_TAGS)].map(m => m[1]);
    assert.ok(tags.every(x => ['b', 'i', 'pre', 'a'].includes(x)), `telegram tags ${tags}`);
    for (const tag of ['b', 'i', 'pre', 'a']) {
      assert.equal([...g.html.matchAll(new RegExp(`<${tag}[\\s>]`, 'g'))].length, [...g.html.matchAll(new RegExp(`</${tag}>`, 'g'))].length, `balanced <${tag}>`);
    }
    assert.ok(!g.plain.includes('<pre>') && !g.plain.includes('<i>') && !g.plain.includes('<a href="https'), 'plain carries no markup of ours');
    assert.ok(g.plain.includes('A<b>&"\'*_[x]'), 'plain keeps the raw title');
    assert.ok(e.html.includes('title="') === false, 'no attribute injection point');
  }
});

t('plain Telegram text has no tags for ordinary content', () => {
  for (const { name, input } of ALL) assert.ok(!/<[^>]+>/.test(buildTelegram(input).plain), name);
});

// --- 4. limits ------------------------------------------------------------------------------------
t('limits: huge title, note and summary stay within every cap', () => {
  const big = 'word & <x> '.repeat(900);
  const hugeIdea = toAlertIdea({ ...LONG_ROW, title: big, rationale: big, option_strategy: { name: big } });
  const cases = [
    mk(hugeIdea, 'note', 'update:5', { v: 1, note: big }),
    mk(hugeIdea, 'closed', 'update:8', { v: 1, note: big }),
    mk(hugeIdea, 'published', 'published', { v: 1 }),
    mk(null, 'stopped', 'stopped', null, { summary: big }),
    mk(hugeIdea, 'stopped', 'stopped', null, { summary: big }),
    mk(hugeIdea, 'target_hit', 'target:T1', { v: 1, target: 'T1', price: 110, targetsHit: 1, targetsTotal: 2 }),
  ];
  for (const input of cases) {
    const { e, g, p } = outputs(input);
    assert.ok(g.html.length <= 4000 && g.plain.length <= 4000, `telegram ${g.html.length}/${g.plain.length}`);
    assert.ok(g.html.includes(IDEA_DISCLAIMER.short) && g.plain.includes(IDEA_DISCLAIMER.short) && g.plain.includes('stockstrendz.com/ideas/42'));
    for (const out of [e.html, g.html]) assert.ok(!unescapedEntity.test(out.replace(/<[^>]*>/g, '')), 'dangling entity');
    assert.ok(e.subject.length <= 78 && e.preheader.length <= 110, `subject ${e.subject.length} preheader ${e.preheader.length}`);
    assert.ok(p.title.length <= 60, p.title);
    assert.ok(p.body.split('\n')[0].length <= 80);
    assert.ok(JSON.stringify(p).length < 1000, `push json ${JSON.stringify(p).length}`);
    assert.ok(e.html.length < 30_000, `email html ${e.html.length}`);
    assert.ok(!/\n/.test(e.subject) && !/\n/.test(p.title));
  }
  const cut = clampWords('alpha beta gamma delta '.repeat(50), 40);
  assert.ok(cut.length <= 40 && cut.endsWith('...'));
  assert.ok(clampWords('x'.repeat(20), 40) === 'x'.repeat(20));
  assert.ok(clampWords('a\n\n\n\n\nb   c', 40, '...', true) === 'a\n\nb c');
});

// --- 5. numbers -----------------------------------------------------------------------------------
t('numbers and dates', () => {
  assert.equal(fmtPrice(100), '100.00');
  assert.equal(fmtPrice(120.5), '120.50');
  assert.ok(/^0\.\d{4}$/.test(fmtPrice(0.12345)));
  assert.equal(fmtPrice(NaN), null); assert.equal(fmtPrice(null), null); assert.equal(fmtPrice(Infinity), null);
  assert.equal(fmtR(1.14), '+1.14R'); assert.equal(fmtR(-1), '-1.00R'); assert.equal(fmtR(0), '0.00R'); assert.equal(fmtR(undefined), null);
  assert.equal(fmtRange(100, 102), '100.00 - 102.00');
  assert.equal(fmtDate('2026-11-10', TODAY), 'Nov 10');
  assert.equal(fmtDate('2025-11-10', TODAY), 'Nov 10, 2025');
  assert.equal(fmtDate('2026-13-10', TODAY), null); assert.equal(fmtDate('nope', TODAY), null);
  // Garbage facts never leak into any output.
  const junk = [
    { v: 1, price: NaN, date: 'xx', targetsHit: NaN, r: Infinity, newStop: null, pct: undefined },
    { v: 1 },
  ];
  for (const f of junk) for (const [, type, key] of SPECS('long')) {
    const { e, g, p } = outputs(mk(LONG, type, key, parseFacts(f)));
    for (const s of [e.subject, e.preheader, e.text, e.html.replace(/<style>[\s\S]*?<\/style>/, ''), g.html, g.plain, p.title, p.body]) assert.ok(!BAD.test(s), `${type}: ${s.match(BAD)} in ${s.slice(0, 200)}`);
  }
  // Even with the plan's own numbers missing from facts, no placeholder appears.
  for (const input of ALL) { const { e, g, p } = outputs(input); for (const s of [e.subject, e.text, g.plain, p.title, p.body]) assert.ok(!BAD.test(s), `${input.eventKey}: ${s}`); }
});

// --- 6. push tags ---------------------------------------------------------------------------------
t('push: one tag per event, url, extra fields', () => {
  const a = buildPush(mk(LONG, 'target_hit', 'target:T1', { v: 1, target: 'T1' }, { eventId: 101 }));
  const b = buildPush(mk(LONG, 'target_hit', 'target:T2', { v: 1, target: 'T2' }, { eventId: 102 }));
  assert.equal(a.tag, 'idea-42-101');
  assert.notEqual(a.tag, b.tag);
  assert.equal(a.url, '/ideas/42');
  assert.equal(buildPush(mk(LONG, 'published', 'published', { v: 1 }, { ideaId: 'abc' })).url, '/ideas');
  assert.equal(buildPush(mk(LONG, 'published', 'published', { v: 1 }, { ideaId: '12; DROP' })).url, '/ideas');
  assert.equal(ideaLink('abc'), 'https://stockstrendz.com/ideas');
  assert.equal(a.icon, '/idea-alert-icon.svg'); assert.equal(a.badge, '/idea-alert-badge.svg');
  assert.ok(!/[\u{1F000}-\u{1FFFF}]/u.test(a.title + a.body), 'no emoji in push');
});

// --- 7. facts from the scorer -----------------------------------------------------------------------
const bar = (date, o, h, l, c) => ({ date, open: o, high: h, low: l, close: c });
const PLAN = { direction: 'long', entryLow: 100, entryHigh: 102, targets: [110, 120], stop: 95, publishedOn: '2026-01-05', validUntil: '2026-02-27' };

t('facts come from the scorer events (T1 then stop, gap, all targets)', () => {
  const s = scoreIdea(PLAN, [bar('2026-01-06', 101, 103, 100, 102), bar('2026-01-07', 102, 111, 101, 109), bar('2026-01-08', 108, 109, 94, 95)], null, '2026-03-31');
  const f = scoreEventFacts(s);
  assert.equal(f.length, s.events.length);
  assert.deepEqual(s.events.map(e => e.type), ['triggered', 'target_hit', 'stopped']);
  assert.equal(f[0].price, 102); assert.equal(f[0].date, '2026-01-06');
  assert.equal(f[1].target, 'T1'); assert.equal(f[1].targetsHit, 1); assert.equal(f[1].targetsTotal, 2); assert.equal(f[1].price, 110);
  assert.equal(f[2].targetsHit, 1); assert.equal(f[2].r, s.r); assert.equal(f[2].gapped, false);
  const gap = scoreIdea(PLAN, [bar('2026-01-06', 101, 103, 100, 102), bar('2026-01-07', 92, 93, 90, 91)], null, '2026-03-31');
  const g = scoreEventFacts(gap);
  assert.equal(g[1].gapped, true); assert.equal(g[1].price, 92);
  const all = scoreIdea(PLAN, [bar('2026-01-06', 101, 103, 100, 102), bar('2026-01-07', 102, 121, 101, 120)], null, '2026-03-31');
  assert.equal(all.outcome, 'target_hit');
  assert.equal(allTargetsFacts(all).r, all.r);
  assert.equal(scoreEventFacts(all)[2].targetsHit, 2);
  // facts survive the JSON round trip into parseFacts
  assert.deepEqual(parseFacts(JSON.parse(JSON.stringify(f[2]))), f[2]);
});

t('parseFacts rejects non-objects and old versions, drops non-finite numbers', () => {
  for (const bad of [null, undefined, 5, 'x', [], { v: 2 }, {}, '{"v":2}', '[1]']) assert.equal(parseFacts(bad), null);
  const p = parseFacts({ v: 1, price: NaN, r: 'x', date: '2026-11-09', target: 'T1', targetsHit: 1.7, gapped: 'yes', extra: 1, note: '  ' });
  assert.deepEqual(p, { v: 1, date: '2026-11-09', target: 'T1', targetsHit: 1 });
  assert.deepEqual(parseFacts('{"v":1,"price":5}'), { v: 1, price: 5 });
  assert.equal(toAlertIdea({ ...LONG_ROW, symbol: '<x>' }), null);
  assert.equal(toAlertIdea({ ...LONG_ROW, targets: [] }), null);
  assert.equal(toAlertIdea(null), null);
});

// --- 8. R rules -----------------------------------------------------------------------------------
t('R rules: per-target R on target alerts, scorer R on terminal alerts', () => {
  const rr = riskReward({ direction: 'long', entryLow: 100, entryHigh: 102, stop: 95, targets: LONG.targets });
  const T1 = outputs(ALL.find(a => a.name === 'target T1 long').input);
  assert.ok(T1.e.subject.includes(fmtR(rr.perTarget[0])) && T1.e.text.includes(fmtR(rr.perTarget[0])));
  const T2 = outputs(ALL.find(a => a.name === 'target T2 long').input);
  assert.ok(T2.e.subject.includes(fmtR(rr.perTarget[1])));
  const AT = outputs(ALL.find(a => a.name === 'all_targets long').input);
  assert.ok(AT.e.subject.includes('+1.86R') && AT.e.text.includes('Result: +1.86R') && AT.g.plain.includes('Result: +1.86R'));
  const ST = outputs(ALL.find(a => a.name === 'stopped gap long').input);
  assert.ok(ST.e.subject.includes('-1.21R') && ST.e.text.includes('gapped through the stop and closed at 93.40'), ST.e.text);
  const noR = outputs(mk(LONG, 'stopped', 'stopped', { v: 1, date: D, price: 95 }));
  assert.ok(!/R\)?\b/.test(noR.e.subject.replace('AAPL', '')), noR.e.subject);
});

// --- 9. fallback ----------------------------------------------------------------------------------
t('fallback: no facts, no plan or unknown type use the summary layout', () => {
  for (const input of [mk(LONG, 'stopped', 'stopped', null), mk(null, 'stopped', 'stopped', { v: 1, price: 95 })]) {
    const { e, g, p } = outputs(input);
    assert.ok(e.subject.startsWith('Trade Ideas: ') && e.subject.includes('Stopped'), e.subject);
    assert.ok(p.title.startsWith('Trade Ideas: '), p.title);
    assert.ok(g.plain.includes(input.summary) && !g.html.includes('<pre>'), g.plain);
    assert.ok(!e.html.includes('<thead>') && !e.html.includes('Level</th>'), 'no levels table');
    assert.ok(e.html.includes('Stopped out'), 'banner from event type');
  }
  const u = outputs(mk(LONG, 'weird_event', 'k', { v: 1 }));
  assert.ok(u.e.html.includes('Idea update') && u.g.html.split('\n')[0].includes('Idea update') && u.p.title.includes('Idea update'));
  assert.equal(alertKind('weird_event', 'k'), 'unknown');
  const pre = buildEmail(mk(null, 'published', 'published', null, { eventId: 7 }));
  assert.ok(pre.html.includes('stockstrendz.com/ideas/42'));
});

// --- 10. masking ----------------------------------------------------------------------------------
t('no vendor names in any output', () => {
  for (const input of ALL) { const { e, g, p } = outputs(input); for (const s of [e.subject, e.preheader, e.text, e.html, g.html, g.plain, JSON.stringify(p)]) assert.ok(!/alpaca|tradier|apca/i.test(s)); }
});

// --- extras: structure ------------------------------------------------------------------------------
t('email html structure: layout tables, th scope, aria-hidden glyphs, fixed light scheme, no images', () => {
  const e = buildEmail(ALL.find(a => a.name === 'published long').input);
  assert.ok(e.html.startsWith('<!doctype html>'));
  assert.ok(e.html.includes('<meta name="color-scheme" content="light">'));
  assert.ok(e.html.includes('<th scope="col"'));
  assert.ok(e.html.includes('role="presentation"'));
  assert.ok(e.html.includes('aria-hidden="true"'));
  assert.ok(!/<img\b|<script|url\(|@import|<link\b/i.test(e.html), 'no images or remote assets');
  assert.ok(e.html.includes('View the full plan') && e.html.includes('Option idea:') && e.html.includes('Bull call spread') && e.html.includes('Why:'));
  const other = buildEmail(ALL.find(a => a.name === 'triggered long').input);
  assert.ok(other.html.includes('View idea') && !other.html.includes('Option idea:') && !other.html.includes('Why:'));
  assert.ok(e.html.includes('+1.14R') && e.html.includes('+2.57R') && e.html.includes('Dec 12'));
  const tg = buildTelegram(ALL.find(a => a.name === 'published long').input);
  assert.ok(/<pre>[\s\S]*Entry\s+100\.00 - 102\.00[\s\S]*<\/pre>/.test(tg.html));
  assert.ok(!tg.plain.includes('Option idea') && !tg.plain.includes('Bull call'), 'option strategy only in the published email');
});

// --- QA additions (run 20261110-1500-ideas-alert-formatting) -----------------------------------------

t('telegram HTML uses only the entities Telegram accepts (&amp; &lt; &gt; &quot; and numeric)', () => {
  // Bot API: "All numerical HTML entities are supported. ... only the following named HTML entities: &lt;, &gt;, &amp; and &quot;."
  const bareAmp = /&(?!(amp|lt|gt|quot);|#\d+;)/;
  for (const { name, input } of ALL) assert.ok(!bareAmp.test(buildTelegram(input).html), `${name}: named entity outside Telegram's set`);
  const hostile = mk(evilIdea(), 'note', 'update:5', { v: 1, note: `it's "x" & <y> &middot; &nbsp;` });
  const html = buildTelegram(hostile).html;
  assert.ok(!bareAmp.test(html), 'hostile note: entity outside Telegram set');
  assert.ok(html.includes('&#39;') && html.includes('&quot;') && html.includes('&amp;middot;'), 'hostile note escaped');
});
function evilIdea() { return toAlertIdea({ ...LONG_ROW, title: 'Q&A <x>' }); }

t('every kind falls back to the summary layout when facts are missing (all 13 event types)', () => {
  for (const [, type, key] of SPECS('long')) {
    const input = mk(LONG, type, key, null, { summary: 'Summary sentence for fallback.' });
    const { e, g, p } = outputs(input);
    assert.ok(e.subject.startsWith('Trade Ideas: ') && e.subject.length <= 78, `${key}: ${e.subject}`);
    assert.ok(p.title.startsWith('Trade Ideas: '), `${key}: ${p.title}`);
    assert.ok(g.plain.includes('Summary sentence for fallback.') && !g.html.includes('<pre>'), `${key}: telegram`);
    assert.ok(!e.html.includes('Level</th>') && !e.text.includes('LEVELS'), `${key}: no levels table`);
    assert.ok(e.text.includes(disclaimerText()) && g.plain.includes(IDEA_DISCLAIMER.short) && p.body.endsWith(IDEA_DISCLAIMER_MICRO), `${key}: disclaimer`);
    assert.ok(e.html.includes('href="https://stockstrendz.com/ideas/42"') && g.plain.includes('https://stockstrendz.com/ideas/42'), `${key}: link`);
    assert.ok(!BAD.test(e.text + g.plain + p.title + p.body), `${key}: placeholder text`);
  }
});

t('push tags are unique per event across every kind and both sides', () => {
  const tags = ALL.map(({ input }, i) => buildPush({ ...input, eventId: 1000 + i }).tag);
  assert.equal(new Set(tags).size, ALL.length, 'duplicate tag');
  for (const tag of tags) assert.match(tag, /^idea-42-\d+$/);
  // Same event id re-sent (retry) keeps the same tag, so the OS replaces it rather than stacking a copy.
  assert.equal(buildPush(mk(LONG, 'stopped', 'stopped', null, { eventId: 5 })).tag, buildPush(mk(SHORT, 'stopped', 'stopped', null, { eventId: 5 })).tag);
});

t('Telegram stays within 4000 for a 9000-char title, note and summary on every kind and side', () => {
  const big = 'alpha & beta <gamma> "delta" '.repeat(300);
  const idea = toAlertIdea({ ...LONG_ROW, title: big, rationale: big, option_strategy: null });
  const idea2 = toAlertIdea({ ...SHORT_ROW, title: big });
  for (const [ix, ideaX] of [[0, idea], [1, idea2]]) {
    for (const [, type, key, facts] of SPECS(ix ? 'short' : 'long')) {
      const input = mk(ideaX, type, key, facts ? { ...facts, note: big } : null, { summary: big });
      const g = buildTelegram(input);
      assert.ok(g.html.length <= 4000 && g.plain.length <= 4000, `${key}: ${g.html.length}/${g.plain.length}`);
      assert.ok(g.html.includes(escapeHtml(IDEA_DISCLAIMER.short)) && g.plain.includes('https://stockstrendz.com/ideas/42'), `${key}: tail present`);
      assert.ok(!/&(?!(amp|lt|gt|quot|#\d+);)/.test(g.html), `${key}: bare & after cut`);
      assert.ok(!/&(amp|lt|gt|quot|#\d*)?$/.test(g.html) && !/&#?[a-z0-9]{0,6}$/i.test(g.plain.split('\n').slice(-1)[0]), `${key}: dangling entity`);
    }
  }
});

t('Telegram level blocks: never more than 8 rows, and rows are readable (width reported, not asserted)', () => {
  const five = toAlertIdea({ ...LONG_ROW, targets: [{ price: 110 }, { price: 115 }, { price: 120 }, { price: 125 }, { price: 130 }] });
  const rows = buildTelegram(mk(five, 'published', 'published', { v: 1 })).html.match(/<pre>([\s\S]*?)<\/pre>/)[1].split('\n');
  assert.ok(rows.length <= 8, `rows ${rows.length}`);
  assert.ok(rows.length === 8, 'entry, five targets, stop and valid-until all present');
  const widest = Math.max(...[...ALL.map(({ input }) => buildTelegram(input).html.match(/<pre>([\s\S]*?)<\/pre>/))].filter(Boolean).flatMap(m => m[1].split('\n')).map(l => l.length));
  console.log(`info: widest Telegram <pre> row across fixtures = ${widest} chars (designer target about 34)`);
});

t('a note with CRLF and 3+ blank lines keeps structure and never leaks raw markup', () => {
  const note = 'line one\r\n\r\n\r\n\r\nline <two>\n\n\nline three';
  const { e, g } = outputs(mk(LONG, 'note', 'update:5', { v: 1, note }));
  assert.ok(!g.html.includes('\r') && !e.html.includes('\r'), 'no CR');
  assert.ok(g.html.includes('line &lt;two&gt;') && !g.html.includes('\n\n\n'), 'escaped, collapsed');
  assert.ok(e.html.includes('line three') && e.text.includes('line one'), 'content kept');
});

t('sw.js safePath: same-origin paths only (backslash, protocol-relative, absolute and script URLs fall back)', () => {
  const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const m = src.match(/SAFE-PATH-START[^\n]*\n([\s\S]*?)\/\/ SAFE-PATH-END/);
  assert.ok(m, 'safePath block found in sw.js');
  const safePath = new Function('self', `${m[1]}; return safePath;`)({ location: { origin: 'https://us.niftytrendz.com' } });
  const hostile = ['/\\evil.example/x', '//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\\\evil.example', '/ok\nx', '\t//evil.example', '', null, 5, '/.//evil.example', '/%2e//evil.example', '/%2e%2e//evil.example',
    '/%2e%2e/%2e%2e//evil.example', '/ideas/..//evil.example', '/ideas/%2e%2e//evil.example'];
  for (const bad of hostile) {
    assert.equal(safePath(bad, '/ideas'), '/ideas', `rejects ${JSON.stringify(bad)}`);
  }
  for (const bad of hostile) {
    const out = safePath(bad, '/ideas');
    assert.equal(new URL(out, 'https://app.example').origin, 'https://app.example', `stays on origin: ${JSON.stringify(bad)}`);
  }
  assert.equal(safePath('/ideas', '/x'), '/ideas');
  assert.equal(safePath('/ideas/42', '/x'), '/ideas/42');
  assert.equal(safePath('/ideas/42?a=1#b', '/x'), '/ideas/42?a=1#b');
});

// --- Run 20261110-1730 (ideas-alert-followups): footer, palette, urgency ---------------------------------------

const UNSUB = 'https://stockstrendz.com/unsubscribe?t=SAMPLE.abc-_';
const FALLBACKS = [mk(null, 'stopped', 'stopped', null), mk(LONG, 'stopped', 'stopped', null), mk(LONG, 'weird', 'x', { v: 1 })];
const EVERY = [...ALL.map(a => a.input), ...FALLBACKS];

t('footer with an unsubscribe URL: link, scope sentence, contact, sender, URL alone on a text line', () => {
  for (const input of EVERY) {
    const e = buildEmail(input, { unsubscribeUrl: UNSUB });
    assert.ok(e.html.includes(`href="${UNSUB}"`) && e.html.includes(`>${UNSUB_LINK_TEXT}</a>`), 'link');
    assert.ok(e.html.includes('>Manage alerts</a>') && e.html.includes('href="https://stockstrendz.com/ideas"'), 'manage');
    assert.ok(e.html.includes('href="mailto:support@stockstrendz.com"') && e.html.includes('StocksTrendz Trade Ideas'), 'contact and sender');
    assert.ok(e.html.includes(FOOTER_WHY) && e.html.includes(FOOTER_SCOPE), 'sentences');
    assert.ok(!e.html.includes(FOOTER_FALLBACK), 'no fallback sentence');
    assert.ok(e.text.split('\n').includes(UNSUB), 'text: URL alone on its own line');
    assert.ok(e.text.includes(`${UNSUB_LINK_TEXT}:`) && e.text.includes('This turns off Trade Ideas email alerts only.'), 'text sentences');
    assert.ok(e.text.includes('Questions? Contact support@stockstrendz.com') && e.text.trimEnd().endsWith('StocksTrendz Trade Ideas'), 'text tail');
    assert.ok(!/display:\s*none/.test(e.html.slice(e.html.indexOf(FOOTER_WHY) - 400)), 'nothing hidden in the footer');
  }
});

t('footer without a usable URL: sign-in fallback, no unsubscribe link, same subject and preheader', () => {
  const bad = [undefined, null, '', 'http://evil.example/x', 'https://evil.example/unsubscribe?t=x', `${UNSUB}"onmouseover="x`, `${UNSUB} x`, `${UNSUB}<b>`, 'https://stockstrendz.com/unsubscribe?t=', 'https://stockstrendz.com/unsubscribe', 5];
  for (const input of EVERY) {
    const withUrl = buildEmail(input, { unsubscribeUrl: UNSUB });
    for (const u of bad) {
      const e = buildEmail(input, u === undefined ? undefined : { unsubscribeUrl: u });
      assert.ok(!e.html.includes(UNSUB_LINK_TEXT) && !e.text.includes(UNSUB_LINK_TEXT) && !e.html.includes('/unsubscribe') && !e.text.includes('/unsubscribe'), `no link for ${String(u)}`);
      assert.ok(e.html.includes(FOOTER_FALLBACK) && e.text.includes(FOOTER_FALLBACK), 'fallback sentence in html and text');
      assert.ok(e.html.includes('>Manage alerts</a>') && e.html.includes('mailto:support@stockstrendz.com'));
      assert.equal(e.subject, withUrl.subject); assert.equal(e.preheader, withUrl.preheader);
    }
  }
  assert.equal(FOOTER_FALLBACK, 'To stop these emails, sign in, open Trade Ideas, choose Alerts and untick Email.');
});

t('footer escapes the URL in HTML', () => {
  const e = buildEmail(EVERY[0], { unsubscribeUrl: 'https://stockstrendz.com/unsubscribe?t=a&b=1' });
  assert.ok(e.html.includes('href="https://stockstrendz.com/unsubscribe?t=a&amp;b=1"'), 'ampersand escaped in href and text');
  assert.ok(!e.html.includes('t=a&b=1'));
});

// WCAG relative luminance contrast
const lum = (hex) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

t('palette contrast: every text/background pair the builder uses is at least 4.5:1', () => {
  const { FILL, TINT, INK } = EMAIL_PALETTE;
  const pairs = [];
  for (const k of ['primary', 'body', 'footnote', 'secondary', 'muted', 'link']) pairs.push([`${k} on card`, INK[k], INK.card]);
  pairs.push(['cta label', INK.white, INK.cta], ['quiet disclaimer', '#4B5563', '#F9FAFB']);
  for (const tone of Object.keys(FILL)) {
    pairs.push([`white on FILL.${tone}`, INK.white, FILL[tone]], [`FILL.${tone} chip on white`, FILL[tone], INK.card],
      [`body on TINT.${tone}`, INK.body, TINT[tone]], [`secondary on TINT.${tone}`, INK.secondary, TINT[tone]]);
  }
  for (const [name, fg, bg] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${name}: ${ratio(fg, bg).toFixed(2)}`);
  assert.ok(Math.abs(ratio('#000000', '#FFFFFF') - 21) < 0.01, 'helper sanity: black on white is 21');
});

t('palette scan: every hex colour in every generated email is in the exported palette or the quiet disclaimer', () => {
  const { FILL, TINT, INK } = EMAIL_PALETTE;
  const allowed = new Set([...Object.values(FILL), ...Object.values(TINT), ...Object.values(INK), '#F9FAFB', '#4B5563', '#E5E7EB'].map(h => h.toUpperCase()));
  for (const input of EVERY) for (const opts of [{}, { unsubscribeUrl: UNSUB }]) {
    const html = buildEmail(input, opts).html;
    for (const m of html.matchAll(/#[0-9a-fA-F]{6}\b/g)) assert.ok(allowed.has(m[0].toUpperCase()), `colour ${m[0]} outside the palette`);
  }
});

t('pushUrgency: high for triggered, target, all_targets, stopped; normal for the other nine (all 13 kinds)', () => {
  const kinds = ['published', 'triggered', 'target', 'all_targets', 'stopped', 'expired', 'not_triggered', 'note', 'stop_moved', 'partial_booked', 'closed', 'cancelled', 'unknown'];
  const high = new Set(['triggered', 'target', 'all_targets', 'stopped']);
  assert.equal(kinds.length, 13);
  for (const k of kinds) assert.equal(pushUrgency(k), high.has(k) ? 'high' : 'normal', k);
  assert.equal(kinds.filter(k => pushUrgency(k) === 'normal').length, 9);
  assert.equal(pushUrgency(alertKind('stopped', 'stopped')), 'high');
  assert.equal(pushUrgency(alertKind('target_hit', 'target:T1')), 'high');
  assert.equal(pushUrgency(alertKind('note', 'update:5')), 'normal');
});

t('disclaimer wording unchanged by the footer change', () => {
  assert.equal(IDEA_DISCLAIMER.short, 'Ideas are for information and education only, not investment advice. Trading involves risk of loss.');
  assert.equal(IDEA_DISCLAIMER_MICRO, 'For information only, not advice.');
  for (const input of EVERY) for (const opts of [{}, { unsubscribeUrl: UNSUB }]) { assert.ok(buildEmail(input, opts).text.includes(disclaimerText())); }
});


// QA (run 20261110-1730): the <style> block of the email must be balanced CSS. Every { needs its }.
t('email <style> block has balanced braces (every @media and rule is closed)', () => {
  for (const input of EVERY) for (const opts of [{}, { unsubscribeUrl: UNSUB }]) {
    const css = buildEmail(input, opts).html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    let depth = 0, minDepth = 0;
    for (const c of css) { if (c === '{') depth++; else if (c === '}') { depth--; minDepth = Math.min(minDepth, depth); } }
    assert.equal(depth, 0, `unclosed block in the email <style>: ${css}`);
    assert.equal(minDepth, 0, 'no stray closing brace');
  }
});

console.log(`ok: ${passed} idea-alert tests passed`);
