// Fixture test for lib/ideaScoring.ts, lib/ideaStats.ts and the plan validation in lib/ideaTypes.ts
// (Trade Ideas Desk, docs/trade-ideas.md).
//
//   node scripts/test-idea-scoring.mjs
//
// (Node 24+ loads the .ts modules directly via built-in type stripping.)

import assert from 'node:assert/strict';
import { scoreIdea } from '../lib/ideaScoring.ts';
import { computeStats, breakdownBy } from '../lib/ideaStats.ts';
import { validatePlan, riskReward, validateScheduleTime } from '../lib/ideaTypes.ts';
import { validateTaken, previewTaken, tradeResult, compareFollowed } from '../lib/ideaTakenMath.ts';
import { buildTelegram, buildPush } from '../lib/ideaMessages.ts';
import { IDEA_DISCLAIMER } from '../lib/ideaDisclaimer.ts';
import { liveMark, pointsFromR } from '../lib/ideaLiveMath.ts';
import { occSymbol, midOf, positionValue, expiryProfile, summarizeOption, intrinsicPrices } from '../lib/ideaOptionMath.ts';

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error(`FAIL: ${name}`); throw e; } };
const near = (a, b, eps = 1e-3, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b} +-${eps}, got ${a}`);

// Long: zone 100-102 (entry priced at 102, the worst fill), stop 98 (risk 4), targets 106 (1R) and 110 (2R).
const long = { direction: 'long', entryLow: 100, entryHigh: 102, targets: [106, 110], stop: 98, publishedOn: '2026-01-05', validUntil: '2026-02-27' };
const bar = (date, o, h, l, c) => ({ date, open: o, high: h, low: l, close: c });
const ASOF = '2026-03-31';

t('publish-day bar is ignored', () => {
  const r = scoreIdea(long, [bar('2026-01-05', 101, 111, 97, 105)], null, ASOF);
  assert.equal(r.outcome, 'not_triggered'); // no session after publishing, valid-until passed
});

t('pending: not entered, still valid', () => {
  const r = scoreIdea(long, [bar('2026-01-06', 108, 110, 107, 109)], null, '2026-01-07');
  // ran to 110 >= T1 without touching the zone -> never entered
  assert.equal(r.outcome, 'not_triggered');
  const p = scoreIdea(long, [bar('2026-01-06', 104, 105, 103, 104)], null, '2026-01-07');
  assert.equal(p.outcome, 'pending');
  assert.equal(p.final, false);
});

t('all targets hit, R is the average of the ladder', () => {
  const r = scoreIdea(long, [
    bar('2026-01-06', 103, 104, 101, 103), // enters (low 101 inside zone)
    bar('2026-01-07', 103, 107, 102, 106), // T1
    bar('2026-01-08', 106, 111, 105, 110), // T2
  ], null, ASOF);
  assert.equal(r.outcome, 'target_hit');
  assert.equal(r.targetsHit, 2);
  near(r.r, 1.5, 1e-9, 'R = (1R + 2R) / 2');
  assert.equal(r.enteredOn, '2026-01-06');
  assert.equal(r.exitOn, '2026-01-08');
  assert.equal(r.daysToT1, 1);
  assert.equal(r.final, true);
  assert.equal(r.entryPrice, 102);
});

t('stop first when one bar touches stop and target', () => {
  const r = scoreIdea(long, [
    bar('2026-01-06', 103, 104, 101, 103),
    bar('2026-01-07', 103, 107, 97, 100), // T1 and the stop on one bar
  ], null, ASOF);
  assert.equal(r.outcome, 'stopped');
  assert.equal(r.targetsHit, 0);
  near(r.r, -1, 1e-9);
});

t('entry bar that also hits the stop is a stop (stop first on the entry bar)', () => {
  const r = scoreIdea(long, [bar('2026-01-06', 103, 107, 97, 99)], null, ASOF);
  assert.equal(r.outcome, 'stopped');
  near(r.r, -1, 1e-9);
});

t('gap through the stop after entry fills at the open', () => {
  const r = scoreIdea(long, [
    bar('2026-01-06', 103, 104, 101, 103),
    bar('2026-01-07', 95, 96, 94, 95),
  ], null, ASOF);
  assert.equal(r.outcome, 'stopped');
  assert.equal(r.exitPrice, 95);
  near(r.r, (95 - 102) / 4, 1e-9); // -1.75R
});

t('T1 booked then stopped: half at +1R, half at -1R', () => {
  const r = scoreIdea(long, [
    bar('2026-01-06', 103, 104, 101, 103),
    bar('2026-01-07', 103, 107, 102, 106),
    bar('2026-01-08', 105, 106, 97, 98),
  ], null, ASOF);
  assert.equal(r.outcome, 'stopped');
  assert.equal(r.targetsHit, 1);
  near(r.r, 0.5 * 1 + 0.5 * -1, 1e-9);
});

t('valid-until passes without entering: not triggered', () => {
  const r = scoreIdea(long, [bar('2026-01-06', 105, 106, 104, 105), bar('2026-02-27', 105, 106, 104, 105)], null, ASOF);
  assert.equal(r.outcome, 'not_triggered');
  assert.equal(r.r, null);
  assert.equal(r.final, true);
});

t('broke below the stop without touching the zone: not triggered', () => {
  const r = scoreIdea(long, [bar('2026-01-06', 99, 99.5, 96, 97)], null, ASOF);
  // high 99.5 is inside the zone (100-102)? no: high < entryLow, so no touch; low <= stop
  assert.equal(r.outcome, 'not_triggered');
});

t('expired while in trade: marked to the last close', () => {
  const r = scoreIdea(long, [
    bar('2026-01-06', 103, 104, 101, 103),
    bar('2026-02-27', 104, 105, 103, 105),
  ], null, ASOF);
  assert.equal(r.outcome, 'expired');
  assert.equal(r.exitPrice, 105);
  near(r.r, (105 - 102) / 4, 1e-9);
});

t('open: unrealised R marked to the last close, not final', () => {
  const r = scoreIdea(long, [
    bar('2026-01-06', 103, 104, 101, 103),
    bar('2026-01-07', 103, 105, 102, 104),
  ], null, '2026-01-08');
  assert.equal(r.outcome, 'open');
  assert.equal(r.final, false);
  near(r.r, (104 - 102) / 4, 1e-9);
});

t('early close scores at that session close', () => {
  const r = scoreIdea(long, [
    bar('2026-01-06', 103, 104, 101, 103),
    bar('2026-01-07', 103, 105, 102, 104),
    bar('2026-01-08', 104, 109, 103, 108),
  ], { kind: 'closed', effectiveOn: '2026-01-07' }, ASOF);
  assert.equal(r.outcome, 'closed_by_publisher');
  assert.equal(r.exitOn, '2026-01-07');
  assert.equal(r.exitPrice, 104);
});

t('early close waits for the session to complete', () => {
  const r = scoreIdea(long, [bar('2026-01-06', 103, 104, 101, 103)], { kind: 'closed', effectiveOn: '2026-01-07' }, '2026-01-06');
  assert.equal(r.outcome, 'open');
});

t('cancelled before entry', () => {
  const r = scoreIdea(long, [bar('2026-01-06', 105, 105.5, 104, 105)], { kind: 'cancelled', effectiveOn: '2026-01-06' }, ASOF);
  assert.equal(r.outcome, 'cancelled');
  assert.equal(r.r, null);
});

t('short mirrors long', () => {
  // Short: zone 100-102 (entry priced at 100, the worst fill), stop 104 (risk 4), targets 96 (1R), 92 (2R).
  const short = { direction: 'short', entryLow: 100, entryHigh: 102, targets: [96, 92], stop: 104, publishedOn: '2026-01-05', validUntil: '2026-02-27' };
  const win = scoreIdea(short, [
    bar('2026-01-06', 99, 101, 98, 99),
    bar('2026-01-07', 99, 99, 95, 96),
    bar('2026-01-08', 96, 96, 91, 92),
  ], null, ASOF);
  assert.equal(win.outcome, 'target_hit');
  assert.equal(win.entryPrice, 100);
  near(win.r, 1.5, 1e-9);
  const loss = scoreIdea(short, [bar('2026-01-06', 99, 101, 98, 99), bar('2026-01-07', 100, 105, 99, 104)], null, ASOF);
  assert.equal(loss.outcome, 'stopped');
  near(loss.r, -1, 1e-9);
});

t('MAE / MFE track the excursion from entry', () => {
  const r = scoreIdea(long, [
    bar('2026-01-06', 103, 104, 100, 103),
    bar('2026-01-07', 103, 105, 99, 104),
  ], null, '2026-01-08');
  near(r.maePct, ((102 - 99) / 102) * 100, 0.01);
  near(r.mfePct, ((105 - 102) / 102) * 100, 0.01);
});

// --- stats ---------------------------------------------------------------------
const row = (id, outcome, r, extra = {}) => ({
  id, symbol: 'AAA', horizon: 'swing', direction: 'long', publisherId: 'p1', hasOption: false, outcome, r, pctReturn: r * 2,
  exitOn: `2026-02-${String(10 + id).padStart(2, '0')}`, daysToT1: null, maePct: 1, targetsHit: r > 0 ? 1 : 0, ...extra,
});

t('stats: counts only finished, entered ideas and lists exclusions', () => {
  const rows = [
    row(1, 'target_hit', 1.5), row(2, 'stopped', -1), row(3, 'stopped', -1), row(4, 'target_hit', 2),
    row(5, 'not_triggered', null), row(6, 'cancelled', null), row(7, 'open', 0.3), row(8, 'pending', null),
    row(9, 'closed_by_publisher', 0.2),
  ];
  const s = computeStats(rows);
  assert.equal(s.n, 5);
  assert.equal(s.wins, 3);
  assert.equal(s.losses, 2);
  near(s.hitRate, 0.6);
  near(s.totalR, 1.5 - 1 - 1 + 2 + 0.2);
  near(s.avgR, 1.7 / 5);
  near(s.avgWinR, (1.5 + 2 + 0.2) / 3);
  near(s.avgLossR, -1);
  near(s.expectancyR, 0.6 * ((1.5 + 2 + 0.2) / 3) + 0.4 * -1);
  near(s.profitFactor, 3.7 / 2);
  assert.equal(s.coverage.counted, 5);
  assert.equal(s.coverage.excluded.not_triggered, 1);
  assert.equal(s.coverage.excluded.cancelled, 1);
  assert.equal(s.coverage.excluded.open, 1);
  assert.equal(s.coverage.excluded.pending, 1);
  assert.equal(s.coverage.total, 9);
  assert.equal(s.curve.length, 5);
  near(s.curve[s.curve.length - 1].cumR, 1.7);
});

t('stats: streaks follow exit order', () => {
  const rows = [row(1, 'target_hit', 1), row(2, 'target_hit', 1), row(3, 'stopped', -1), row(4, 'stopped', -1), row(5, 'stopped', -1), row(6, 'target_hit', 1)];
  const s = computeStats(rows);
  assert.equal(s.maxWinStreak, 2);
  assert.equal(s.maxLossStreak, 3);
});

t('stats: empty input is zeroes, not NaN', () => {
  const s = computeStats([]);
  assert.equal(s.n, 0);
  assert.equal(s.hitRate, null);
  assert.equal(s.avgR, null);
  assert.equal(s.profitFactor, null);
});

t('stats: breakdown by horizon', () => {
  const rows = [row(1, 'target_hit', 1, { horizon: 'swing' }), row(2, 'stopped', -1, { horizon: 'swing' }), row(3, 'target_hit', 2, { horizon: 'long_term' })];
  const b = breakdownBy(rows, 'horizon');
  assert.equal(b.length, 2);
  assert.equal(b.find(x => x.key === 'swing').stats.n, 2);
  assert.equal(b.find(x => x.key === 'long_term').stats.avgR, 2);
});

// --- plan validation -----------------------------------------------------------
const goodPlan = { symbol: 'aapl', direction: 'long', horizon: 'swing', title: 'AAPL breakout', rationale: 'why', entryLow: 100, entryHigh: 102, targets: [{ price: 106 }, { price: 110 }], stop: 98, validUntil: '2026-03-01', riskRating: 'medium' };
t('validate: good plan normalises the symbol', () => {
  const v = validatePlan(goodPlan, '2026-01-05');
  assert.equal(v.ok, true);
  assert.equal(v.plan.symbol, 'AAPL');
});
t('validate: long stop above the zone is rejected', () => {
  const v = validatePlan({ ...goodPlan, stop: 101 }, '2026-01-05');
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /stop must be below/.test(e)));
});
t('validate: short targets must descend', () => {
  const v = validatePlan({ ...goodPlan, direction: 'short', stop: 104, targets: [{ price: 96 }, { price: 98 }] }, '2026-01-05');
  assert.equal(v.ok, false);
});
t('validate: past valid-until and empty targets rejected', () => {
  assert.equal(validatePlan({ ...goodPlan, validUntil: '2026-01-01' }, '2026-01-05').ok, false);
  assert.equal(validatePlan({ ...goodPlan, targets: [] }, '2026-01-05').ok, false);
});
t('validate: option strategy legs are checked', () => {
  const bad = validatePlan({ ...goodPlan, optionStrategy: { name: 'Bull call', legs: [{ side: 'buy', type: 'call', strike: 100, qty: 0 }] } }, '2026-01-05');
  assert.equal(bad.ok, false);
  const ok = validatePlan({ ...goodPlan, optionStrategy: { name: 'Bull call', expiry: '2026-06-19', legs: [{ side: 'buy', type: 'call', strike: 100, qty: 1 }, { side: 'sell', type: 'call', strike: 110, qty: 1 }] } }, '2026-01-05');
  assert.equal(ok.ok, true);
});
t('risk/reward uses the worst fill in the zone', () => {
  const rr = riskReward({ direction: 'long', entryLow: 100, entryHigh: 102, stop: 98, targets: [{ price: 106 }, { price: 110 }] });
  near(rr.risk, 4);
  near(rr.blended, 1.5);
});

// --- scheduled publishing -------------------------------------------------------
t('schedule: needs a real future instant within 90 days', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  assert.equal(validateScheduleTime('2026-11-09T14:30:00Z', now).ok, true);
  assert.equal(validateScheduleTime('2026-11-08T12:01:00Z', now).ok, false, 'too soon');
  assert.equal(validateScheduleTime('2027-06-01T00:00:00Z', now).ok, false, 'too far');
  assert.equal(validateScheduleTime('tomorrow', now).ok, false);
  assert.equal(validateScheduleTime(undefined, now).ok, false);
});

// --- "I took this" ---------------------------------------------------------------
t('taken: quantity and price are required, never defaulted', () => {
  assert.equal(validateTaken({}).ok, false);
  assert.equal(validateTaken({ qty: 10 }).ok, false);
  assert.equal(validateTaken({ entryPrice: 100 }).ok, false);
  assert.equal(validateTaken({ qty: 0, entryPrice: 100 }).ok, false);
  const ok = validateTaken({ qty: '25', entryPrice: '101.5', note: ' hi ' });
  assert.equal(ok.ok, true);
  assert.equal(ok.input.qty, 25);
  assert.equal(ok.note, 'hi');
});
t('taken: preview uses the subscribers own price and quantity', () => {
  const p = previewTaken({ direction: 'long', entryLow: 100, entryHigh: 102, stop: 98, targets: [106, 110] }, { qty: 50, entryPrice: 101 });
  near(p.positionValue, 5050);
  near(p.riskAmount, 150); // (101 - 98) x 50
  near(p.atTarget[0].profit, 250);
  near(p.atTarget[1].profit, 450);
  near(p.atTarget[1].r, 3);
  assert.equal(p.warnings.length, 0);
});
t('taken: warns when outside the zone, and when already beyond the stop', () => {
  const plan = { direction: 'long', entryLow: 100, entryHigh: 102, stop: 98, targets: [106] };
  assert.equal(previewTaken(plan, { qty: 1, entryPrice: 104 }).warnings.length, 1);
  const dead = previewTaken(plan, { qty: 1, entryPrice: 97 });
  assert.ok(/beyond the stop/.test(dead.warnings[0]));
  assert.equal(dead.riskAmount, 0);
});
t('taken: short mirrors long', () => {
  const p = previewTaken({ direction: 'short', entryLow: 100, entryHigh: 102, stop: 104, targets: [96] }, { qty: 10, entryPrice: 101 });
  near(p.riskAmount, 30);
  near(p.atTarget[0].profit, 50);
  const r = tradeResult('short', { qty: 10, entryPrice: 101 }, 99);
  near(r.profit, 20);
  near(r.pct, (2 / 101) * 100, 0.01);
});
t('followed vs not followed compares the same ideas', () => {
  const rows = [
    { ideaId: 1, taken: true, ideaPct: 4, myPct: 2 },
    { ideaId: 2, taken: true, ideaPct: -2, myPct: -3 },
    { ideaId: 3, taken: true, ideaPct: 5, myPct: null }, // taken, not closed by me: not in the comparison
    { ideaId: 4, taken: false, ideaPct: 6, myPct: null },
    { ideaId: 5, taken: false, ideaPct: -1, myPct: null },
  ];
  const c = compareFollowed(rows, { stillOpenForMe: 1, ideaNotFinished: 0 });
  assert.equal(c.followed.n, 2);
  near(c.followed.myAvgPct, -0.5);
  near(c.followed.deskAvgPct, 1);
  assert.equal(c.notFollowed.n, 2);
  near(c.notFollowed.deskAvgPct, 2.5);
  assert.equal(compareFollowed([], { stillOpenForMe: 0, ideaNotFinished: 0 }).followed.myAvgPct, null);
});

// --- channel messages --------------------------------------------------------------
t('telegram and push messages carry the disclaimer line and a link', () => {
  const input = { eventId: 9, ideaId: 7, eventType: 'published', eventKey: 'published', summary: 'New idea: AAPL long, breakout.', idea: null, facts: null, today: '2026-11-10' };
  const tg = buildTelegram(input);
  assert.ok(tg.plain.includes('https://stockstrendz.com/ideas/7') && tg.html.includes('https://stockstrendz.com/ideas/7'));
  assert.ok(tg.plain.includes(IDEA_DISCLAIMER.short) && tg.html.includes(IDEA_DISCLAIMER.short));
  const push = buildPush(input);
  assert.equal(push.url, '/ideas/7');
  assert.ok(/not advice/.test(push.body));
  assert.ok(JSON.stringify(push).length < 1000);
  const long = buildTelegram({ ...input, summary: 'x'.repeat(9000) });
  assert.ok(long.plain.length <= 4096 && long.html.length <= 4096);
});

// --- provisional live mark (lib/ideaLiveMath.ts) ----------------------------------------
const short = { direction: 'short', entryLow: 100, entryHigh: 102, targets: [96, 92], stop: 106, publishedOn: '2026-01-05', validUntil: '2026-02-27' };
const off = (r) => ({ outcome: r.outcome, enteredOn: r.enteredOn, entryPrice: r.entryPrice, targetsHit: r.targetsHit, evaluatedThrough: r.evaluatedThrough });
const finiteOrNull = (o) => { for (const v of Object.values(o ?? {})) { if (typeof v === 'number') assert.ok(Number.isFinite(v)); else if (v && typeof v === 'object') finiteOrNull(v); } };

t('live: R and % match the scorer (open long, after T1, open short)', () => {
  const a = scoreIdea(long, [bar('2026-01-06', 103, 104, 101, 103), bar('2026-01-07', 103, 105, 102, 104)], null, '2026-01-07');
  assert.equal(a.outcome, 'open');
  const la = liveMark(long, off(a), 104);
  near(la.r, a.r, 1e-9); near(la.pct, a.pctReturn, 1e-9);
  assert.equal(la.state, 'in_trade'); assert.equal(la.entered, true);
  const b = scoreIdea(long, [bar('2026-01-06', 103, 104, 101, 103), bar('2026-01-07', 103, 107, 102, 108)], null, '2026-01-07');
  assert.equal(b.targetsHit, 1);
  const lb = liveMark(long, off(b), 108);
  near(lb.r, b.r, 1e-9); near(lb.pct, b.pctReturn, 1e-9);
  const c = scoreIdea(short, [bar('2026-01-06', 100, 101, 99, 99), bar('2026-01-07', 99, 99.5, 97, 98)], null, '2026-01-07');
  assert.equal(c.outcome, 'open');
  const lc = liveMark(short, off(c), 98);
  near(lc.r, c.r, 1e-9); near(lc.pct, c.pctReturn, 1e-9);
  const d = scoreIdea(short, [bar('2026-01-06', 100, 101, 99, 99), bar('2026-01-07', 99, 99.5, 95, 95)], null, '2026-01-07');
  assert.equal(d.targetsHit, 1);
  const ld = liveMark(short, off(d), 95);
  near(ld.r, d.r, 1e-9); near(ld.pct, d.pctReturn, 1e-9);
});

t('live: points are the blended per-share P&L (long and short), consistent with R, null before entry', () => {
  // long, entry 102 (zone high), stop 98 (risk 4), targets 106 / 110
  const o = { outcome: 'open', enteredOn: '2026-01-06', entryPrice: 102, targetsHit: 0, evaluatedThrough: '2026-01-06' };
  near(liveMark(long, o, 104).points, 2, 1e-9);            // 104 - 102
  near(liveMark(long, o, 104).r, 0.5, 1e-9);               // 2 / 4
  near(liveMark(long, o, 100).points, -2, 1e-9);           // under water
  const hit1 = { ...o, targetsHit: 1 };
  near(liveMark(long, hit1, 108).points, 0.5 * 4 + 0.5 * 6, 1e-9); // T1 booked (4 pts on half) + half at 108 (6 pts)
  near(liveMark(long, hit1, 108).points / 4, liveMark(long, hit1, 108).r, 1e-9);
  const so = { outcome: 'open', enteredOn: '2026-01-06', entryPrice: 100, targetsHit: 0, evaluatedThrough: '2026-01-06' };
  near(liveMark(short, so, 98).points, 2, 1e-9);           // short gains when price falls
  near(liveMark(short, so, 103).points, -3, 1e-9);
  assert.equal(liveMark(long, null, 104).points, null);    // not entered: no P&L
  assert.equal(liveMark(long, o, null).points, null);
  assert.equal(liveMark(long, { ...o, outcome: 'target_hit' }, 104).points, null);
  finiteOrNull(liveMark(long, o, 104));
  // distances in points
  const l = liveMark(long, o, 104);
  near(l.stop.distancePts, -6, 1e-9); near(l.targets[0].distancePts, 2, 1e-9);
  const away = liveMark(long, null, 110); assert.equal(away.zone.side, 'above'); near(away.zone.distancePts, 8, 1e-9);
  const inzone = liveMark(long, null, 101); assert.equal(inzone.zone.distancePts, 0);
});

t('pointsFromR: closed result in points = R x risk per share; null on missing input', () => {
  near(pointsFromR(1.5, 102, 98), 6, 1e-9);
  near(pointsFromR(-1, 102, 98), -4, 1e-9);
  assert.equal(pointsFromR(null, 102, 98), null);
  assert.equal(pointsFromR(1, null, 98), null);
  assert.equal(pointsFromR(NaN, 102, 98), null);
});

t('live: not entered gives no R (no outcome row, pending row)', () => {
  const pend = { outcome: 'pending', enteredOn: null, entryPrice: null, targetsHit: 0, evaluatedThrough: null };
  for (const o of [null, pend]) {
    const hi = liveMark(long, o, 108);
    assert.equal(hi.state, 'ran_past_target'); assert.equal(hi.r, null); assert.equal(hi.pct, null); assert.equal(hi.entered, false);
    const above = liveMark(long, o, 105);
    assert.equal(above.state, 'awaiting_entry'); assert.equal(above.zone.side, 'above');
    near(above.zone.distancePct, (105 - 102) / 105 * 100, 1e-9);
    const inz = liveMark(long, o, 101);
    assert.equal(inz.state, 'in_zone'); assert.equal(inz.zone.distancePct, 0); assert.equal(inz.r, null);
    const below = liveMark(long, o, 99);
    assert.equal(below.zone.side, 'below'); near(below.zone.distancePct, (100 - 99) / 99 * 100, 1e-9);
    const bs = liveMark(long, o, 97);
    assert.equal(bs.state, 'beyond_stop'); assert.equal(bs.r, null);
  }
});

t('live: a price past a target since the last scoring counts it; the official count is never lowered', () => {
  const o0 = { outcome: 'open', enteredOn: '2026-01-06', entryPrice: 102, targetsHit: 0, evaluatedThrough: '2026-01-06' };
  const x = liveMark(long, o0, 107);
  assert.equal(x.targetsReached, 1);
  near(x.r, 1 / 2 + 0.5 * (5 / 4), 1e-9);
  const y = liveMark(long, { ...o0, targetsHit: 1 }, 104);
  assert.equal(y.targetsReached, 1);
  near(y.r, 0.5 * 1 + 0.5 * (2 / 4), 1e-9);
});

t('live: beyond the stop is not clamped', () => {
  const o = { outcome: 'open', enteredOn: '2026-01-06', entryPrice: 102, targetsHit: 0, evaluatedThrough: '2026-01-06' };
  const l = liveMark(long, o, 95);
  assert.equal(l.state, 'beyond_stop'); near(l.r, (95 - 102) / 4, 1e-9);
  const so = { outcome: 'open', enteredOn: '2026-01-06', entryPrice: 100, targetsHit: 0, evaluatedThrough: '2026-01-06' };
  const s = liveMark(short, so, 109);
  assert.equal(s.state, 'beyond_stop'); near(s.r, (100 - 109) / 6, 1e-9);
});

t('live: unavailable price and invalid plans never throw and carry no NaN', () => {
  const o = { outcome: 'open', enteredOn: '2026-01-06', entryPrice: 102, targetsHit: 1, evaluatedThrough: '2026-01-06' };
  for (const p of [null, 0, NaN, undefined]) {
    const l = liveMark(long, o, p);
    assert.equal(l.state, 'unavailable'); assert.equal(l.r, null); assert.equal(l.pct, null); assert.equal(l.price, null);
    assert.equal(l.targetsReached, 1);
    finiteOrNull(l);
  }
  const noRisk = liveMark({ ...long, stop: 102 }, o, 104);
  assert.equal(noRisk.state, 'unavailable'); assert.equal(noRisk.r, null); finiteOrNull(noRisk);
  const noTargets = liveMark({ ...long, targets: [] }, o, 104);
  assert.equal(noTargets.state, 'unavailable'); assert.deepEqual(noTargets.targets, []); finiteOrNull(noTargets);
});

t('live: range hint only for a session after publish day and after the last scored session', () => {
  const o = { outcome: 'open', enteredOn: '2026-01-06', entryPrice: 102, targetsHit: 0, evaluatedThrough: '2026-01-06' };
  const range = { high: 107, low: 97, date: '2026-01-07' };
  assert.deepEqual(liveMark(long, o, 100, range).rangeHint, { stop: true, targetsTouched: 1 });
  assert.equal(liveMark(long, o, 100, { ...range, date: '2026-01-05' }).rangeHint, null);
  assert.equal(liveMark(long, o, 100, { ...range, date: '2026-01-06' }).rangeHint, null);
  assert.equal(liveMark(long, o, 100).rangeHint, null);
  assert.equal(liveMark(long, o, 100, { high: null, low: null, date: '2026-01-07' }).rangeHint, null);
  near(liveMark(long, o, 100, range).r, liveMark(long, o, 100).r, 1e-12); // the hint never changes R
  const so = { outcome: 'open', enteredOn: '2026-01-06', entryPrice: 100, targetsHit: 0, evaluatedThrough: '2026-01-06' };
  assert.deepEqual(liveMark(short, so, 99, { high: 107, low: 95, date: '2026-01-07' }).rangeHint, { stop: true, targetsTouched: 1 });
});

t('live: distances and signs (long and short)', () => {
  const o = { outcome: 'open', enteredOn: '2026-01-06', entryPrice: 102, targetsHit: 0, evaluatedThrough: '2026-01-06' };
  const l = liveMark(long, o, 104);
  near(l.stop.distancePct, (98 - 104) / 104 * 100, 1e-9); assert.ok(l.stop.distancePct < 0);
  near(l.stop.distanceR, 1.5, 1e-9);
  near(l.targets[0].distancePct, (106 - 104) / 104 * 100, 1e-9); assert.equal(l.targets[0].reached, false);
  const so = { outcome: 'open', enteredOn: '2026-01-06', entryPrice: 100, targetsHit: 0, evaluatedThrough: '2026-01-06' };
  const s = liveMark(short, so, 98);
  near(s.stop.distancePct, (106 - 98) / 98 * 100, 1e-9); assert.ok(s.stop.distancePct > 0);
  near(s.stop.distanceR, (106 - 98) / 6, 1e-9);
  near(s.targets[0].distancePct, (96 - 98) / 98 * 100, 1e-9); assert.ok(s.targets[0].distancePct < 0);
  assert.equal(s.targets[0].reached, false);
});

t('live: a finished official outcome is never marked as entered; JSON has no vendor words', () => {
  const done = { outcome: 'stopped', enteredOn: '2026-01-06', entryPrice: 102, targetsHit: 0, evaluatedThrough: '2026-01-07' };
  assert.equal(liveMark(long, done, 104).entered, false);
  const json = JSON.stringify(liveMark(long, { outcome: 'open', enteredOn: '2026-01-06', entryPrice: 102, targetsHit: 0, evaluatedThrough: '2026-01-06' }, 104, { high: 105, low: 99, date: '2026-01-07' }));
  assert.ok(!/alpaca|tradier|iex|sip/i.test(json));
});


// ---------------------------------------------------------------------------------------------------
// 15-minute entry basis ('m15'): entered when a COMPLETED 15-minute bar CLOSES inside the zone
// ---------------------------------------------------------------------------------------------------
const M = { ...long, entryBasis: 'm15', publishedAt: '2026-01-05T15:00:00Z' };           // long 100-102, stop 98, T 106/110
const MS = { direction: 'short', entryLow: 100, entryHigh: 102, targets: [96, 92], stop: 104, publishedOn: '2026-01-05', validUntil: '2026-02-27', entryBasis: 'm15', publishedAt: '2026-01-05T15:00:00Z' };
const ib = (date, hhmm, o, h, l, c) => ({ date, t: `${date}T${hhmm}:00Z`, open: o, high: h, low: l, close: c });

t('m15: label and default basis', () => {
  assert.equal(scoreIdea(M, [], null, ASOF, []).basis, 'm15_entry_daily_stop_first');
  assert.equal(scoreIdea(long, [], null, ASOF).basis, 'daily_bars_stop_first');
});

t('m15: a wick into the zone that closes outside does NOT enter (the daily rule would)', () => {
  const day = '2026-01-06';
  const wick = [ib(day, '15:00', 104, 104.5, 101, 103.5)]; // low 101 is inside 100-102, close 103.5 is not
  const r = scoreIdea(M, [bar(day, 104, 104.5, 101, 103.5)], null, '2026-01-06', wick);
  assert.equal(r.outcome, 'pending');
  assert.equal(r.enteredOn, null);
  assert.equal(scoreIdea({ ...M, entryBasis: 'daily' }, [bar(day, 104, 104.5, 101, 103.5)], null, '2026-01-06').outcome, 'open'); // same data, daily rule enters
});

t('m15: a close inside the zone enters at once, same session, entry = worst fill, event carries the bar time', () => {
  const day = '2026-01-06';
  const bars = [ib(day, '15:00', 104, 105, 103, 103.5), ib(day, '15:15', 103.5, 103.8, 100.5, 101)];
  const r = scoreIdea(M, [], null, '2026-01-05', bars); // asOf = yesterday: no daily bar exists yet
  assert.equal(r.outcome, 'open');
  assert.equal(r.final, false);
  assert.equal(r.enteredOn, day);
  assert.equal(r.entryPrice, 102);
  const ev = r.events.find(e => e.type === 'triggered');
  assert.equal(Date.parse(ev.at), Date.parse(`${day}T15:30:00Z`)); // the 15:15 candle closes at 15:30: that is when the fill happens
  assert.equal(r.evaluatedThrough, day);
  near(r.r, (101 - 102) / 4, 1e-9, 'no bar after the entry bar yet: marked at the entry bar close (101) against the worst-fill entry (102)');
});

t('m15: moves BEFORE the entry bar (and inside it) never stop or target the position', () => {
  const day = '2026-01-06';
  const bars = [ib(day, '15:00', 100, 107, 97, 103.5), ib(day, '15:15', 103, 103.5, 96, 101)]; // spike to 107, dip to 96, then closes in the zone
  const r = scoreIdea(M, [bar(day, 100, 107, 96, 101)], null, '2026-01-05', bars);
  assert.equal(r.outcome, 'open');
  assert.equal(r.targetsHit, 0);
  assert.equal(r.mfePct, null);
});

t('m15: after entry the same day, 15-minute bars decide the stop (stop first) and fill at the stop', () => {
  const day = '2026-01-06';
  const bars = [ib(day, '15:00', 103, 103.5, 102.5, 101), ib(day, '15:15', 101, 107, 97.5, 100)]; // next bar tags T1 and the stop
  const r = scoreIdea(M, [], null, '2026-01-05', bars);
  assert.equal(r.outcome, 'stopped');
  near(r.r, -1, 1e-9);
  assert.equal(r.exitPrice, 98);
  assert.equal(Date.parse(r.events.find(e => e.type === 'stopped').at), Date.parse(`${day}T15:30:00Z`)); // intraday exits carry the closing time of their bar
});

t('m15: a 15-minute bar that opens through the stop fills at the open (gap)', () => {
  const day = '2026-01-06';
  const bars = [ib(day, '15:00', 103, 103.5, 100.5, 101), ib(day, '15:15', 96, 97, 95, 96.5)];
  const r = scoreIdea(M, [], null, '2026-01-05', bars);
  assert.equal(r.outcome, 'stopped');
  assert.equal(r.exitPrice, 96);
  near(r.r, (96 - 102) / 4, 1e-9);
});

t('m15: targets on the entry day come from 15-minute bars; later days from daily bars', () => {
  const d1 = '2026-01-06', d2 = '2026-01-07';
  const i = [ib(d1, '15:00', 103, 103.5, 100.5, 101), ib(d1, '15:15', 101, 106.5, 100.8, 105)]; // T1 hit on the entry day
  // The entry day's daily bar has low 97 (before the entry) and must not be used; day 2 hits T2.
  const r = scoreIdea(M, [bar(d1, 100, 107, 97, 105), bar(d2, 105, 111, 104, 110)], null, d2, i);
  assert.equal(r.outcome, 'target_hit');
  assert.equal(r.targetsHit, 2);
  near(r.r, 1.5, 1e-9);
  assert.equal(r.enteredOn, d1);
  assert.equal(r.exitOn, d2);
  assert.equal(r.daysHeld, 1);
  assert.equal(r.daysToT1, 0);
});

t('m15: bars that started before publishing are ignored', () => {
  const day = '2026-01-05'; // published at 15:00Z
  const r = scoreIdea(M, [], null, '2026-01-04', [ib(day, '14:45', 101, 101.5, 100.5, 101), ib(day, '15:30', 104, 104.5, 103, 104)]);
  assert.equal(r.outcome, 'pending');
  const r2 = scoreIdea(M, [], null, '2026-01-04', [ib(day, '14:45', 101, 101.5, 100.5, 101), ib(day, '15:30', 104, 104.5, 100.5, 101.5)]);
  assert.equal(r2.enteredOn, day); // a bar after the publish time that closes in the zone enters on the publish day
});

t('m15: closing at or past target 1 (or through the stop) without a close in the zone = never entered', () => {
  const a = scoreIdea(M, [], null, '2026-01-06', [ib('2026-01-06', '15:00', 107, 108, 106.5, 107.5)]);
  assert.equal(a.outcome, 'not_triggered');
  const b = scoreIdea(M, [], null, '2026-01-06', [ib('2026-01-06', '15:00', 99, 99.5, 97, 97.5)]);
  assert.equal(b.outcome, 'not_triggered');
});

t('m15: valid-until passing without a close in the zone = not_triggered; a publisher cancel before entry = cancelled', () => {
  const quiet = [ib('2026-01-06', '15:00', 104, 105, 103, 104)];
  assert.equal(scoreIdea({ ...M, validUntil: '2026-01-06' }, [bar('2026-01-06', 104, 105, 103, 104)], null, '2026-01-06', quiet).outcome, 'not_triggered');
  assert.equal(scoreIdea(M, [], { kind: 'cancelled', effectiveOn: '2026-01-06' }, '2026-01-06', quiet).outcome, 'cancelled');
});

t("m15: entered on the last valid day marks to that day's official close when the daily bar exists", () => {
  const day = '2026-01-06';
  const i = [ib(day, '15:00', 103, 103.5, 100.5, 101), ib(day, '15:15', 101, 104, 100.8, 104)];
  const r = scoreIdea({ ...M, validUntil: day }, [bar(day, 100, 104.5, 100, 104.2)], null, day, i);
  assert.equal(r.outcome, 'expired');
  assert.equal(r.exitPrice, 104.2);
});

t('m15: short mirrors long (entry = zone low, stop above, gap above the stop fills at the open)', () => {
  const day = '2026-01-06';
  const enter = [ib(day, '15:00', 98, 99, 97, 98.5), ib(day, '15:15', 99, 101.5, 98.8, 101)]; // closes 101 inside 100-102
  const e = scoreIdea(MS, [], null, '2026-01-05', enter);
  assert.equal(e.outcome, 'open');
  assert.equal(e.entryPrice, 100);
  const stopped = scoreIdea(MS, [], null, '2026-01-05', [...enter, ib(day, '15:30', 101, 104.5, 100.5, 104)]);
  assert.equal(stopped.outcome, 'stopped');
  near(stopped.r, -1, 1e-9);
  const gap = scoreIdea(MS, [], null, '2026-01-05', [...enter, ib(day, '15:30', 105, 106, 104.5, 105.5)]);
  assert.equal(gap.exitPrice, 105);
  const win = scoreIdea(MS, [], null, '2026-01-05', [...enter, ib(day, '15:30', 101, 101.5, 95.5, 96), ib(day, '15:45', 96, 96.5, 91.5, 92)]);
  assert.equal(win.outcome, 'target_hit');
  near(win.r, 1.5, 1e-9, 'T1 at 96 = 1R, T2 at 92 = 2R');
  // a short that closes at or below target 1 without ever closing in the zone never entered; one that closes above the stop likewise
  assert.equal(scoreIdea(MS, [], null, '2026-01-06', [ib(day, '15:00', 96, 97, 95, 95.5)]).outcome, 'not_triggered');
  assert.equal(scoreIdea(MS, [], null, '2026-01-06', [ib(day, '15:00', 105, 106, 104.5, 105)]).outcome, 'not_triggered');
});

t('m15: the idea in the field (ISRG short 440-445, stop 468): 450 = waiting, a 15-minute close of 444.95 enters', () => {
  const isrg = { direction: 'short', entryLow: 440, entryHigh: 445, targets: [425, 410], stop: 468, publishedOn: '2026-11-10', validUntil: '2026-12-10', entryBasis: 'm15', publishedAt: '2026-11-10T16:16:38Z' };
  const day = '2026-11-11';
  const w = scoreIdea(isrg, [], null, '2026-11-10', [ib(day, '14:30', 450, 451, 448, 449)]);
  assert.equal(w.outcome, 'pending');
  const e = scoreIdea(isrg, [], null, '2026-11-10', [ib(day, '14:30', 450, 451, 448, 449), ib(day, '15:15', 445.5, 445.6, 444.5, 444.95)]);
  assert.equal(e.outcome, 'open');
  assert.equal(e.entryPrice, 440);
});

t('m15: the daily path is untouched when no basis is given (extra intraday bars are ignored)', () => {
  const day = '2026-01-06';
  const r = scoreIdea(long, [bar(day, 103, 104, 101, 103)], null, day, [ib(day, '15:00', 150, 151, 149, 150)]);
  assert.equal(r.outcome, 'open');
  assert.equal(r.enteredOn, day);
});


// ---------------------------------------------------------------------------------------------------
// Option strategy P&L (lib/ideaOptionMath.ts): estimates from entry / target / exit prices, separate from the idea's R
// ---------------------------------------------------------------------------------------------------
// The idea in the field: ISRG bear call spread, buy the 450 call and sell the 420 call (a net CREDIT), expiring 2026-12-18.
const BCS = [{ side: 'buy', type: 'call', strike: 450, qty: 1 }, { side: 'sell', type: 'call', strike: 420, qty: 1 }];
const pt = (kind, key, at, prices, extra = {}) => ({ kind, key, at, underlying: null, prices, basis: 'quote_mid', ...extra });

t('options: OCC symbol and mid', () => {
  assert.equal(occSymbol('isrg', '2026-12-18', 'call', 450), 'ISRG261218C00450000');
  assert.equal(occSymbol('SPY', '2026-12-18', 'put', 412.5), 'SPY261218P00412500');
  assert.equal(midOf(17.97, 19.41), 18.69);
  assert.equal(midOf(0, 1), null);       // no bid: not a usable quote
  assert.equal(midOf(2, 1), null);       // crossed
  assert.equal(midOf(null, 1), null);
});

t('options: bear call spread = credit; value, max profit / loss and estimated capital', () => {
  const v0 = positionValue(BCS, [18.69, 37.4]);              // +100 x 18.69 (long 450c) - 100 x 37.4 (short 420c)
  near(v0, -1871, 1e-6);
  const prof = expiryProfile(BCS, v0);
  near(prof.maxProfit, 1871, 1e-6, 'keep the credit if both calls expire worthless');
  near(prof.maxLoss, -(3000 - 1871), 1e-6, 'a 30-wide spread minus the credit');
  assert.equal(prof.unboundedLoss, false);
  assert.equal(prof.unboundedProfit, false);
  near(prof.capital.value, 1129, 1e-6);
  assert.equal(prof.capital.floor, false);
});

t('options: P&L on closing is value now minus entry value; a falling stock profits a bear call spread', () => {
  const pts = [
    pt('entry', 'entry', '2026-11-11T15:30:00Z', [18.69, 37.4]),
    pt('target', 'target:T1', '2026-11-12T20:00:00Z', [9, 25]),   // info only
    pt('mark', 'latest', '2026-11-12T20:00:00Z', [12, 31]),
  ];
  const s = summarizeOption(BCS, pts, true);
  assert.equal(s.status, 'open');
  assert.equal(s.kind, 'credit');
  assert.equal(s.v0, -1871);
  // marked: long 450c 12 -> +1200, short 420c 31 -> -3100: value -1900; pnl = -1900 - (-1871) = -29
  near(s.latest.pnl, -29, 1e-6);
  near(s.targets[0].pnl, 271, 1e-6);                            // 900 - 2500 = -1600 value; -1600 + 1871
  assert.equal(s.current.key, 'latest');
  assert.equal(s.exit, null);
});

t('options: a closed strategy shows the exit, and the target marks stay information only', () => {
  const pts = [
    pt('entry', 'entry', '2026-11-11T15:30:00Z', [18.69, 37.4]),
    pt('target', 'target:T1', '2026-11-12T20:00:00Z', [8, 20]),
    pt('exit', 'exit', '2026-11-13T20:00:00Z', [3, 12], { basis: 'quote_mid_late' }),
  ];
  const s = summarizeOption(BCS, pts, true);
  assert.equal(s.status, 'closed');
  // exit value = +300 - 1200 = -900; pnl = -900 + 1871 = +971; return on estimated capital 971 / 1129
  near(s.exit.pnl, 971, 1e-6);
  near(s.exit.returnPct, 86.0, 0.05);
  assert.equal(s.current.key, 'exit');
  assert.equal(s.targets.length, 1);
  assert.equal(s.targets[0].kind, 'target');
});

t('options: not entered -> pending; entered but no usable entry price -> unpriced; a missing leg price leaves P&L null (never a guess)', () => {
  assert.equal(summarizeOption(BCS, [], false).status, 'pending');
  assert.equal(summarizeOption(BCS, [], true).status, 'unpriced');
  assert.equal(summarizeOption(BCS, [pt('entry', 'entry', '2026-11-11T15:30:00Z', [18.69, null])], true).status, 'unpriced');
  const s = summarizeOption(BCS, [pt('entry', 'entry', '2026-11-11T15:30:00Z', [18.69, 37.4]), pt('mark', 'latest', '2026-11-12T15:30:00Z', [null, 30])], true);
  assert.equal(s.latest.pnl, null);
  assert.equal(s.latest.returnPct, null);
});

t('options: expiry settles at intrinsic value of the stock price', () => {
  assert.deepEqual(intrinsicPrices(BCS, 410), [0, 0]);          // below both strikes: both worthless
  assert.deepEqual(intrinsicPrices(BCS, 435), [0, 15]);
  assert.deepEqual(intrinsicPrices(BCS, 470), [20, 50]);
  const v = positionValue(BCS, intrinsicPrices(BCS, 470));       // 450c worth 20, 420c worth 50: spread at its 30 max width
  near(v - positionValue(BCS, [18.69, 37.4]), -3000 + 1871, 1e-6);
});

t('options: debit spread, long call, naked short call (unlimited loss is a flagged floor), short put, iron condor', () => {
  const bull = [{ side: 'buy', type: 'call', strike: 100, qty: 1 }, { side: 'sell', type: 'call', strike: 110, qty: 1 }];
  const pb = expiryProfile(bull, positionValue(bull, [4, 1]));  // pay 300 net
  near(pb.maxLoss, -300); near(pb.maxProfit, 700); near(pb.capital.value, 300);
  const longCall = [{ side: 'buy', type: 'call', strike: 100, qty: 2 }];
  const pl = expiryProfile(longCall, positionValue(longCall, [3]));
  near(pl.maxLoss, -600); assert.equal(pl.unboundedProfit, true); assert.equal(pl.unboundedLoss, false);
  const naked = [{ side: 'sell', type: 'call', strike: 100, qty: 1 }];
  const pn = expiryProfile(naked, positionValue(naked, [3]));
  assert.equal(pn.unboundedLoss, true); assert.equal(pn.capital.floor, true); near(pn.maxProfit, 300);
  const shortPut = [{ side: 'sell', type: 'put', strike: 100, qty: 1 }];
  const ps = expiryProfile(shortPut, positionValue(shortPut, [2]));
  near(ps.maxProfit, 200); near(ps.maxLoss, -(10000 - 200)); assert.equal(ps.unboundedLoss, false);
  const condor = [
    { side: 'buy', type: 'put', strike: 90, qty: 1 }, { side: 'sell', type: 'put', strike: 95, qty: 1 },
    { side: 'sell', type: 'call', strike: 105, qty: 1 }, { side: 'buy', type: 'call', strike: 110, qty: 1 },
  ];
  const pc = expiryProfile(condor, positionValue(condor, [0.5, 1.5, 1.5, 0.5]));  // credit 200
  near(pc.maxProfit, 200); near(pc.maxLoss, -300); near(pc.capital.value, 300);
});

t('options: rejects missing or invalid prices instead of guessing', () => {
  assert.equal(positionValue(BCS, [18.69]), null);
  assert.equal(positionValue(BCS, [18.69, -1]), null);
  assert.equal(positionValue([], []), null);
  assert.equal(expiryProfile([], 0), null);
});

console.log(`ideas: ${passed} checks passed`);
