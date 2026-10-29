// Fixture test for lib/payoff (Strategy Builder maths, docs/strategy-builder.md).
//
//   node scripts/test-payoff.mjs
//
// (Node 24+ loads the .ts modules directly via built-in type stripping.)

import assert from 'node:assert/strict';
import { black76, impliedVol, intrinsic } from '../lib/payoff/bs.ts';
import { fitCarry, legCarry, midKey } from '../lib/payoff/carry.ts';
import { buildCtx, expiryCloseMs, priceLeg, repriceLegs, resolveTemplate, yearsTo } from '../lib/payoff/chain.ts';
import { analyze, entryValue, heatmap, valueAt } from '../lib/payoff/evaluate.ts';
import { STRATEGIES, STRATEGY_BY_ID } from '../lib/payoff/strategies.ts';

let passed = 0;
const t = (name, fn) => { fn(); passed++; };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b} ±${eps}, got ${a}`);

// --- Black-76 reference values -------------------------------------------------
t('BS zero carry ATM', () => {
  near(black76('C', 100, 100, 1, 0.2), 7.9656, 1e-3);
  near(black76('P', 100, 100, 1, 0.2), 7.9656, 1e-3);
});
t('BS with r=5% via carry', () => {
  const r = 0.05, basis = Math.exp(r), disc = Math.exp(-r);
  near(black76('C', 100, 100, 1, 0.2, basis, disc), 10.4506, 1e-3);
  near(black76('P', 100, 100, 1, 0.2, basis, disc), 5.5735, 1e-3);
});
t('put-call parity holds under carry', () => {
  const basis = 1.02, disc = 0.97;
  for (const K of [80, 100, 125]) {
    const c = black76('C', 100, K, 0.5, 0.3, basis, disc), p = black76('P', 100, K, 0.5, 0.3, basis, disc);
    near(c - p, disc * (100 * basis - K), 1e-9);
  }
});
t('expired / zero vol falls back to intrinsic', () => {
  assert.equal(black76('C', 110, 100, 0, 0.3), 10);
  assert.equal(black76('P', 90, 100, 0.5, 0), 10);
  assert.equal(intrinsic('P', 100, 120), 0);
});
t('IV round trip', () => {
  for (const sig of [0.1, 0.35, 1.2]) {
    const px = black76('P', 50, 55, 0.25, sig, 1.01, 0.99);
    near(impliedVol('P', 50, 55, 0.25, px, 1.01, 0.99), sig, 1e-6);
  }
  assert.equal(impliedVol('C', 100, 100, 0.5, 0), null);
  assert.equal(impliedVol('C', 100, 100, 0.5, 150), null); // above the max-vol price
});

// --- Carry fit ---------------------------------------------------------------
t('fitCarry recovers basis/disc from parity', () => {
  const S0 = 100, T = 0.3, basis = 1.012, disc = 0.985;
  const mids = new Map(), ks = [];
  for (let K = 88; K <= 112; K += 2) {
    ks.push(K);
    mids.set(midKey('C', K), black76('C', S0, K, T, 0.25, basis, disc));
    mids.set(midKey('P', K), black76('P', S0, K, T, 0.25, basis, disc));
  }
  const c = fitCarry(mids, ks, ks, S0, T);
  near(c.basis, basis, 1e-6); near(c.disc, disc, 1e-6);
});
t('fitCarry refuses thin chains', () => {
  const mids = new Map([[midKey('C', 100), 5], [midKey('P', 100), 5]]);
  assert.deepEqual(fitCarry(mids, [100], [100], 100, 0.3), { basis: 1, disc: 1 });
});
t('legCarry rescales exponentially', () => {
  const c = legCarry(Math.exp(0.04), Math.exp(-0.05), 1, 0.5);
  near(c.basis, Math.exp(0.02), 1e-12); near(c.disc, Math.exp(-0.025), 1e-12);
  assert.deepEqual(legCarry(1.1, 0.9, 0, 0.5), { basis: 1, disc: 1 });
});

// --- Expiry time ---------------------------------------------------------------
t('expiry close is 16:00 ET across DST', () => {
  assert.equal(new Date(expiryCloseMs('2026-07-17')).toISOString(), '2026-07-17T20:00:00.000Z');
  assert.equal(new Date(expiryCloseMs('2026-12-18')).toISOString(), '2026-12-18T21:00:00.000Z');
  assert.equal(yearsTo('2026-01-01', Date.parse('2026-06-01T00:00:00Z')), 0);
});

// --- Synthetic chain -------------------------------------------------------------
const NOW = Date.parse('2026-10-28T15:00:00Z');
function chain(expiry, { spot = 100, sigma = 0.3, r = 0.04, step = 5, lo = 50, hi = 150 } = {}) {
  const T = yearsTo(expiry, NOW), basis = Math.exp(r * T), disc = Math.exp(-r * T);
  const rows = [];
  for (let K = lo; K <= hi; K += step) {
    const q = right => {
      const mid = black76(right, spot, K, T, sigma, basis, disc);
      if (mid < 0.001) return undefined;
      return { bid: mid * 0.98, ask: mid * 1.02, mid, last: mid, iv: sigma, delta: right === 'C' ? 0.5 : -0.5, gamma: 0.02, theta: -0.05, vega: 0.1, vol: 10 };
    };
    rows.push({ strike: K, call: q('C'), put: q('P') });
  }
  return { symbol: 'XYZ', root: 'XYZ', expiry, spot, asOf: new Date(NOW).toISOString(), rows };
}
const nearCtx = buildCtx(chain('2026-11-20'), NOW);
const farCtx = buildCtx(chain('2026-12-18'), NOW);
const levels = { call_high: 115, put_low: 85 };

t('ctx: carry fitted, ATM IV found', () => {
  near(nearCtx.carry.disc, Math.exp(-0.04 * nearCtx.T), 1e-6);
  near(nearCtx.atmIv, 0.3, 1e-12);
  assert.ok(nearCtx.calls.includes(100) && nearCtx.puts.includes(100));
});

t('every template resolves', () => {
  assert.equal(STRATEGIES.length, 45);
  assert.equal(new Set(STRATEGIES.map(s => s.id)).size, 45);
  for (const s of STRATEGIES) {
    const r = resolveTemplate(s, nearCtx, farCtx, levels);
    assert.ok(r.legs, `${s.name}: ${r.error}`);
    assert.equal(r.legs.length, s.legs.length, s.name);
    const a = analyze(r.legs, 100, nearCtx.atmIv);
    assert.ok(a, s.name);
    assert.ok(Number.isFinite(a.maxProfit) && Number.isFinite(a.maxLoss), s.name);
  }
});
t('far leg needs a far chain', () => {
  assert.ok(resolveTemplate(STRATEGY_BY_ID.get('calendar_spread'), nearCtx, null).error);
});

t('calibrated legs mark at entry (no phantom P&L)', () => {
  for (const id of ['collar', 'married_put', 'covered_call', 'iron_condor', 'calendar_spread']) {
    const { legs } = resolveTemplate(STRATEGY_BY_ID.get(id), nearCtx, farCtx, levels);
    near(valueAt(legs, 100, { day: 0 }) - entryValue(legs), 0, 0.01, id);
  }
});

const get = id => resolveTemplate(STRATEGY_BY_ID.get(id), nearCtx, farCtx, levels).legs;

t('bull call spread: max P/L = width − debit', () => {
  const legs = get('bull_call_spread');
  const a = analyze(legs, 100, 0.3);
  const debit = a.netPremium;
  assert.ok(debit > 0);
  near(a.maxProfit, 500 - debit, 0.02);
  near(a.maxLoss, -debit, 0.02);
  assert.equal(a.unboundedProfit, false); assert.equal(a.unboundedLoss, false);
  assert.equal(a.breakevens.length, 1);
  near(a.breakevens[0], 100 + debit / 100, 0.02);
  near(a.rewardRisk, (500 - debit) / debit, 0.01);
});
t('long call unbounded profit, short call unbounded loss', () => {
  assert.equal(analyze(get('long_call'), 100, 0.3).unboundedProfit, true);
  const sc = analyze([{ ...get('long_call')[0], qty: -1 }], 100, 0.3);
  assert.equal(sc.unboundedLoss, true);
  assert.equal(sc.margin.floor, true);
});
// Levels whose options carry premium (90 put ≈ $0.25, 110 call ≈ $0.42), so the anchors stay put.
const pricedLevels = { call_high: 110, put_low: 90 };
t('iron condor: two breakevens outside the short strikes, credit', () => {
  const r = resolveTemplate(STRATEGY_BY_ID.get('iron_condor'), nearCtx, farCtx, pricedLevels);
  const legs = r.legs;
  assert.equal(r.notes, undefined);
  assert.deepEqual(legs.map(l => l.strike), [85, 90, 110, 115]);
  const a = analyze(legs, 100, 0.3);
  assert.ok(a.netPremium < 0);
  const credit = -a.netPremium;
  assert.equal(a.breakevens.length, 2);
  near(a.breakevens[0], 90 - credit / 100, 0.02);
  near(a.breakevens[1], 110 + credit / 100, 0.02);
  near(a.maxProfit, credit, 0.02);
  near(a.maxLoss, -(500 - credit), 0.02);
  assert.ok(a.pop > 0.3 && a.pop < 1);
});
t('level anchors fall back toward the money when their options are worthless', () => {
  // 2 days to expiry: the 85 put / 115 call levels are ~$0, so the condor's shorts move in.
  const short = buildCtx(chain('2026-10-30', { step: 1, lo: 80, hi: 120 }), NOW);
  const r = resolveTemplate(STRATEGY_BY_ID.get('iron_condor'), short, null, levels);
  assert.ok(r.legs, r.error);
  const [pWing, pShort, cShort, cWing] = r.legs.map(l => l.strike);
  assert.ok(pShort > 85 && pShort < 100 && cShort < 115 && cShort > 100, `${pShort} / ${cShort}`);
  assert.equal(pShort - pWing, 1); assert.equal(cWing - cShort, 1);
  assert.ok(r.legs[1].premium >= 0.1 && r.legs[2].premium >= 0.1);
  assert.equal(r.notes?.length, 2);
  const a = analyze(r.legs, 100, short.atmIv);
  assert.ok(a.netPremium < 0 && a.maxProfit > 0 && a.pop > 0);
  // Same 23-day chain as the other tests: the 85 put is worth $0.036, so it moves in too.
  const n = resolveTemplate(STRATEGY_BY_ID.get('iron_condor'), nearCtx, null, levels);
  assert.equal(n.legs[1].strike, 90); assert.equal(n.legs[2].strike, 115); assert.equal(n.notes?.length, 1);
});
t('covered call: capped upside, loss to zero bounded', () => {
  const a = analyze(get('covered_call'), 100, 0.3);
  assert.equal(a.unboundedProfit, false);
  assert.equal(a.unboundedLoss, false);
  assert.ok(a.maxLoss < -9000); // stock to ~0
  assert.equal(a.greeks.delta, 100 - 50);
});
t('calendar: far leg keeps time value at the near expiry', () => {
  const legs = get('calendar_spread');
  const a = analyze(legs, 100, 0.3);
  assert.ok(a.maxProfit > 0, 'calendar can profit');
  assert.ok(a.maxLoss < 0 && a.maxLoss >= -a.netPremium - 1, 'loss limited to about the debit');
  const dte = a.dte;
  assert.ok(valueAt(legs, 100, { day: dte }) > 0, 'long far call still has value at the near expiry');
});
t('IV shift raises a long straddle today', () => {
  const legs = get('long_straddle');
  assert.ok(valueAt(legs, 100, { day: 0, ivShift: 10 }) > valueAt(legs, 100, { day: 0 }));
});
t('heatmap: shape and expiry column', () => {
  const legs = get('bull_call_spread');
  const h = heatmap(legs, 100, { range: 0.2 });
  assert.equal(h.prices.length, 21);
  assert.ok(h.prices[0] > h.prices[20]);
  const last = h.days.length - 1;
  near(h.pnl[0][last], analyze(legs, 100, 0.3).maxProfit, 0.05);
});
t('repriceLegs keeps the old premium when it moved', () => {
  const legs = get('long_call');
  const moved = buildCtx(chain('2026-11-20', { spot: 103 }), NOW);
  const re = repriceLegs(legs, new Map([[moved.expiry, moved]]), 103);
  assert.equal(re[0].prevPremium, legs[0].premium);
  assert.ok(re[0].premium > legs[0].premium);
  const same = repriceLegs(re, new Map([[moved.expiry, moved]]), 103);
  assert.equal(same[0].prevPremium, undefined);
});
t('missing quote is flagged, not priced', () => {
  const l = priceLeg({ id: 'x', kind: 'option', right: 'C', qty: 1, strike: 101, premium: 0 }, nearCtx, 100);
  assert.equal(l.missing, true);
  assert.equal(analyze([l], 100, 0.3), null);
});

console.log(`test-payoff: ${passed} passed`);
