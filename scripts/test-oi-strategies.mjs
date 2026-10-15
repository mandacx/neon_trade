// Fixture test for lib/oiStrategies.ts (strategy candidates from OI change).
//
//   node scripts/test-oi-strategies.mjs
//
// (Node 24+ loads the .ts module directly via built-in type stripping.)

import assert from 'node:assert/strict';
import { detectStrategies, qtyDiffPct, suggestSide, expiryKind } from '../lib/oiStrategies.ts';

const D = '2026-10-15';
let n = 0;
const leg = (strike, optType, oiChg, expiry = '2026-11-20', und = 'XYZ') => ({
  contract: `${und}${expiry}${optType[0]}${strike}#${n++}`, underlying: und, loadDate: D, expiry, optType, strike, oiChg, ltp: 2, close: 100,
});
const kinds = rows => detectStrategies(rows).map(c => c.kind).sort();
const one = (rows, tol = 3) => {
  const c = detectStrategies(rows, tol);
  assert.equal(c.length, 1, `expected one candidate, got ${JSON.stringify(c.map(x => x.label))}`);
  return c[0];
};

// qtyDiffPct
assert.equal(qtyDiffPct(1000, 970), 3);
assert.equal(qtyDiffPct(-1000, 1000), 0);

// Vertical: same type/expiry, two strikes, same sign, within 3%
let c = one([leg(100, 'call', 5000), leg(110, 'call', 4900)]);
assert.equal(c.kind, 'vertical');
assert.equal(c.status, 'opened');
assert.equal(c.qtyDiffPct, 2);

// Near miss: 3.5% apart -> nothing at 3%, found at 4%
assert.deepEqual(kinds([leg(100, 'call', 5000), leg(110, 'call', 4825)]), []);
assert.equal(one([leg(100, 'call', 5000), leg(110, 'call', 4825)], 4).kind, 'vertical');

// Strike roll: one strike closed, another opened
c = one([leg(115, 'call', -6000), leg(120, 'call', 5900)]);
assert.equal(c.kind, 'strike_roll');
assert.equal(c.status, 'rolled');
assert.match(c.label, /roll up \(115 → 120\)/);

// Straddle and strangle
assert.equal(one([leg(100, 'call', 3000), leg(100, 'put', 3050)]).kind, 'straddle');
c = one([leg(90, 'put', 3000), leg(110, 'call', 2990)]);
assert.equal(c.kind, 'strangle');
assert.match(c.label, /risk reversal/);

// Calendar and expiry roll
assert.equal(one([leg(100, 'put', 2000, '2026-11-20'), leg(100, 'put', 2010, '2026-12-18')]).kind, 'calendar');
c = one([leg(100, 'put', -2000, '2026-11-20'), leg(100, 'put', 2020, '2026-12-18')]);
assert.equal(c.kind, 'expiry_roll');
assert.match(c.label, /roll out/);

// Diagonal
assert.equal(one([leg(100, 'call', 2000, '2026-11-20'), leg(110, 'call', 2000, '2026-12-18')]).kind, 'diagonal');

// Iron condor: put spread below call spread, all ~same size
c = one([leg(80, 'put', 1000), leg(90, 'put', 1010), leg(110, 'call', 990), leg(120, 'call', 1000)]);
assert.equal(c.kind, 'iron_condor');
assert.equal(c.legs.length, 4);

// Iron butterfly: inner strikes equal
assert.equal(one([leg(90, 'put', 1000), leg(100, 'put', 1000), leg(100, 'call', 1000), leg(110, 'call', 1000)]).kind, 'iron_butterfly');

// Butterfly 1:2:1
c = one([leg(95, 'call', 1000), leg(100, 'call', 2000), leg(105, 'call', 1000)]);
assert.equal(c.kind, 'butterfly');
assert.doesNotMatch(c.label, /broken/);
assert.match(one([leg(95, 'call', 1000), leg(100, 'call', 2000), leg(110, 'call', 1000)]).label, /broken-wing/);

// Ratio 1x2
assert.equal(one([leg(100, 'put', 1000), leg(90, 'put', 2030)]).kind, 'ratio');

// minLeg filter (default 500) and per-underlying grouping
assert.deepEqual(kinds([leg(100, 'call', 400), leg(110, 'call', 400)]), []);
assert.deepEqual(kinds([leg(100, 'call', 5000, '2026-11-20', 'AAA'), leg(110, 'call', 5000, '2026-11-20', 'BBB')]), []);

// Call + put on different expiries are not paired
assert.deepEqual(kinds([leg(100, 'call', 5000, '2026-11-20'), leg(100, 'put', 5000, '2026-12-18')]), []);

// A leg is used once: the condor wins over the verticals inside it
assert.deepEqual(kinds([leg(80, 'put', 1000), leg(90, 'put', 1000), leg(110, 'call', 1000), leg(120, 'call', 1000)]), ['iron_condor']);

// suggestSide
assert.equal(suggestSide(5000, 1.0, 1.2).side, 'BTO');
assert.equal(suggestSide(5000, 1.0, 0.8).side, 'STO');
assert.equal(suggestSide(5000, 1.0, 1.01).side, null);
assert.equal(suggestSide(-5000, 1.0, 1.5).side, null);
assert.equal(suggestSide(5000, null, null), null);

// expiryKind
assert.equal(expiryKind('2026-10-16'), 'monthly');
assert.equal(expiryKind('2026-12-18'), 'quarterly');
assert.equal(expiryKind('2026-10-23'), 'weekly');

console.log('oi strategy fixtures: all passed');
