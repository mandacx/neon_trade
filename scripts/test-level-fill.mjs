// Fixtures for lib/levelFill.ts (carry-forward of levels the loader failed to calculate).
// Rows are real SOXL / expiry 2026-12-18 values from eod_usmkts_price, captured 2026-11-20; no database is used.
// Run: node scripts/test-level-fill.mjs
import assert from 'node:assert/strict';
import { fillLevelRows, isFailedLevelRow, hasEmptyLevel } from '../lib/levelFill.ts';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const row = (date, pl, pi, ci, cin, ch, cl, ph, expiry = '2026-12-18') =>
  ({ EXPIRY_DT: expiry, TRADE_DATE: date, put_LOW: pl, PUT_INT: pi, PUT_CALL_INT: ci, CALL_INT: cin, call_HIGH: ch, call_low: cl, put_HIGH: ph });

const d17 = row('2026-11-17', 39.53, 54.83, 64.78, 95.51, 165.48, 60.55, 85.48);
const d18 = row('2026-11-18', 0, 425, 425, 425, 0, 0, 0); // the failed day in the screenshot
const d19 = row('2026-11-19', 39.53, 54.40, 64.80, 90.64, 165.48, 60.54, 85.48);

ok('failed-row detection: collapsed placeholder with empty outer levels; all-zero day; good rows are not', () => {
  assert.equal(isFailedLevelRow(d18), true);
  assert.equal(isFailedLevelRow(row('x', 0, 0, 0, 0, 0, 0, 0)), true);
  assert.equal(isFailedLevelRow(d17), false);
  assert.equal(isFailedLevelRow(d19), false);
  assert.equal(isFailedLevelRow(row('x', 39, 54, 54, 54, 165, 60, 85)), false); // collapsed but outer levels present: a real chain
  assert.equal(isFailedLevelRow(row('x', 39, 0, 64, 95, 165, 60, 85)), true);    // a middle level missing
});

ok('the SOXL day continues from the previous day; the next good day is untouched', () => {
  const [a, b, c] = fillLevelRows([d17, d18, d19]);
  assert.equal(a.carriedFrom, null);
  assert.equal(b.carriedFrom, '2026-11-17');
  for (const k of ['put_LOW', 'PUT_INT', 'PUT_CALL_INT', 'CALL_INT', 'call_HIGH', 'call_low', 'put_HIGH']) assert.equal(b[k], d17[k], k);
  assert.equal(b.TRADE_DATE, '2026-11-18'); // only the levels move, never the date
  assert.equal(c.carriedFrom, null);
  assert.equal(c.PUT_INT, 54.40);
});

ok('two failed days in a row both continue from the last good day', () => {
  const out = fillLevelRows([d17, d18, { ...d18, TRADE_DATE: '2026-11-19' }]);
  assert.equal(out[2].carriedFrom, '2026-11-17');
  assert.equal(out[2].PUT_INT, 54.83);
});

ok('the first row of a window uses the seed (latest good row before the window)', () => {
  const out = fillLevelRows([d18], new Map([['2026-12-18', d17]]));
  assert.equal(out[0].carriedFrom, '2026-11-17');
  assert.equal(out[0].call_HIGH, 165.48);
});

ok('with no earlier good row the failed row is left as stored', () => {
  const out = fillLevelRows([d18]);
  assert.equal(out[0].carriedFrom, null);
  assert.equal(out[0].PUT_INT, 425);
  assert.equal(fillLevelRows([d18], new Map([['2026-12-18', d18]]))[0].carriedFrom, null); // a failed seed is not used
});

ok('single empty levels fill one by one and keep the row\'s own good levels', () => {
  const partial = row('2026-11-18', 0, 55, 65, 91, 166, 0, 86);
  assert.equal(isFailedLevelRow(partial), false);
  assert.equal(hasEmptyLevel(partial), true);
  const [, b] = fillLevelRows([d17, partial]);
  assert.equal(b.put_LOW, 39.53);   // filled
  assert.equal(b.call_low, 60.55);  // filled
  assert.equal(b.PUT_INT, 55);      // own value kept
  assert.equal(b.call_HIGH, 166);
  assert.equal(b.carriedFrom, '2026-11-17');
});

ok('expiries are tracked separately and a clean row reports no carry', () => {
  const other17 = row('2026-11-17', 30, 38, 45, 74, 80, 40, 60, '2026-12-24');
  const otherBad = row('2026-11-18', 0, 0, 0, 0, 0, 0, 0, '2026-12-24');
  const out = fillLevelRows([d17, other17, d18, otherBad]);
  assert.equal(out[2].PUT_INT, 54.83);
  assert.equal(out[3].PUT_INT, 38);
  assert.equal(out[3].carriedFrom, '2026-11-17');
  const clean = fillLevelRows([d17, d19]);
  assert.deepEqual(clean.map(r => r.carriedFrom), [null, null]);
});

ok('inputs are not mutated', () => {
  const before = JSON.stringify(d18);
  fillLevelRows([d17, d18]);
  assert.equal(JSON.stringify(d18), before);
});

ok('multi-symbol readers: groups keyed by symbol + expiry never borrow from each other', () => {
  const keyOf = r => `${r.SYMBOL}|${r.EXPIRY_DT}`;
  const soxl = { SYMBOL: 'SOXL', ...d18 };
  const wm = { SYMBOL: 'WM', ...row('2026-11-18', 0, 330, 330, 330, 0, 0, 0) };
  const seeds = new Map([['SOXL|2026-12-18', { SYMBOL: 'SOXL', ...d17 }]]);
  const out = fillLevelRows([soxl, wm], seeds, keyOf);
  assert.equal(out[0].PUT_INT, 54.83); // SOXL continues
  assert.equal(out[0].carriedFrom, '2026-11-17');
  assert.equal(out[1].PUT_INT, 330); // WM has no earlier good row: left as stored, nothing borrowed from SOXL
  assert.equal(out[1].carriedFrom, null);
});

console.log(`\n${n} groups passed`);
