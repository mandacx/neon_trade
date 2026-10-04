// Fixture test for lib/earningsParse.ts — real Benzinga headlines collected
// from the Alpaca News API. Run:
//
//   node scripts/test-earnings-parse.mjs
//
// (Node 24+ loads the .ts module directly via built-in type stripping.)

import assert from 'node:assert/strict';
import { parseEarningsHeadline, parseAmount, symbolsForResult, easternDateAndSession } from '../lib/earningsParse.ts';

const accept = [
  ['IBM Q2 Adj. EPS $2.93 Beats $2.86 Estimate, Sales $17.162B Beat $16.860B Estimate',
    { period: 'Q2', epsActual: 2.93, epsEstimate: 2.86, epsOutcome: 'beat', epsAdjusted: true, salesActual: 17.162e9, salesEstimate: 16.86e9, salesOutcome: 'beat', correction: false }],
  ['Brown & Brown Q2 Adj. EPS $1.07 Misses $1.08 Estimate, Sales $1.676B Miss $1.715B Estimate',
    { epsOutcome: 'miss', epsEstimate: 1.08, salesOutcome: 'miss' }],
  ['IDEAYA Biosciences Q2 EPS $(1.22) Misses $(1.09) Estimate, Sales $8.857M Beat $5.015M Estimate',
    { epsActual: -1.22, epsEstimate: -1.09, epsOutcome: 'miss', epsAdjusted: false, salesActual: 8.857e6 }],
  ['Eve Holding Q2 EPS $(0.10) Beats $(0.18) Estimate',
    { epsActual: -0.1, epsEstimate: -0.18, epsOutcome: 'beat', salesActual: null }],
  ['Hilton Worldwide Holdings Q2 Adj. EPS $2.29, Inline, Sales $3.341B Beat $3.327B Estimate',
    { epsActual: 2.29, epsEstimate: 2.29, epsOutcome: 'inline', salesOutcome: 'beat' }],
  ['CORRECTION: Enphase Energy Q2 Adj. EPS $0.46, Inline, Sales $291.854M Beat $289.917M Estimate',
    { epsOutcome: 'inline', correction: true }],
  ['Rio Tinto H1 Adj. EPS $4.21, Inline, Sales $31.028B Miss $32.030B Estimate',
    { period: 'H1', epsOutcome: 'inline', salesOutcome: 'miss' }],
  ['Lemonade Q2 EPS $(0.56), Inline, Sales $294.400M Beat $290.876M Estimate',
    { epsActual: -0.56, epsOutcome: 'inline' }],
  ['Reported Earlier, Grab Hldgs Q2 EPS $0.06 Beats $0.02 Estimate, Sales $997.000M Beat $990.826M Estimate',
    { epsActual: 0.06, epsOutcome: 'beat' }],
  ['Mitsui & Co Q1 EPS $13.00 Up From $9.22 YoY, Sales $27.280B Up From $22.829B YoY',
    { period: 'Q1', epsActual: 13, epsEstimate: null, epsOutcome: null, salesActual: 27.28e9, salesEstimate: null, salesOutcome: null }],
  ['Upstart Hldgs Q2 EPS $0.16, Sales $364.708M Beat $351.517M Estimate',
    { epsActual: 0.16, epsOutcome: null, salesOutcome: 'beat' }],
  ['Kubota Q2 EPS $2.78 Beats $1.79 Estimate, Sales $5.524B Up From $5.136B YoY',
    { epsOutcome: 'beat', salesActual: 5.524e9, salesOutcome: null }],
  ['Devon Energy Q2 Adj. EPS $1.57 Beats $1.39 Estimate',
    { epsOutcome: 'beat', salesActual: null }],
  ['Amprius Technologies Q2 Adj. EPS $(0.02), Inline, Sales $34.032M Beat $29.300M Estimate',
    { epsActual: -0.02, epsOutcome: 'inline' }],
];

const reject = [
  'Waters Sees Q3 Adj EPS $3.95-$4.05 vs $3.99 Est; Sees Sales $1.745B-$1.762B vs $1.753B Est',
  'Leidos Holdings Raises FY2026 Adj EPS Guidance from $12.10-$12.50 to $12.20-$12.50 vs $12.33 Est',
  'Ingredion Lowers FY2026 GAAP EPS Guidance from $9.60-$10.30 to $9.15-$9.75 vs $10.22 Est',
  'Aptiv Sees Q3 GAAP EPS $0.86-$0.96 vs $1.20 Est',
  'Duke Energy Affirms FY2026 Adj EPS Guidance of $6.55-$6.80 vs $6.71 Est',
  'Ball FY2026  Adj EPS expected to be more than $3.93 vs $4.00 Est',
  'Needham Raises Lam Research EPS Estimates After Company Boosts Chip Equipment Market Outlook',
  'Transcript: IBM Q2 2026 Earnings Conference Call',
  "IBM's Q2 Deal Slippage Is a 'Temporary Speed Bump,' Says Michael Lee as CEO Arvind Krishna Says Delayed Deals Are Closing",
];

let passed = 0;
for (const [headline, expected] of accept) {
  const got = parseEarningsHeadline(headline);
  assert.ok(got, `should parse: ${headline}`);
  for (const [k, v] of Object.entries(expected)) {
    if (typeof v === 'number') assert.ok(Math.abs(got[k] - v) < 1e-6 * Math.max(1, Math.abs(v)), `${k} for "${headline}": got ${got[k]}, want ${v}`);
    else assert.equal(got[k], v, `${k} for "${headline}"`);
  }
  passed++;
}
for (const headline of reject) {
  assert.equal(parseEarningsHeadline(headline), null, `should reject: ${headline}`);
  passed++;
}

assert.equal(parseAmount('$(1.22)'), -1.22);
assert.equal(parseAmount('-$0.05'), -0.05);
assert.equal(parseAmount('$1,234.5M'), 1234.5e6);
const tracked = new Set(['IBM', 'GOOG', 'GOOGL', 'META']);
assert.deepEqual(symbolsForResult(['IBM'], tracked), ['IBM']);
assert.deepEqual(symbolsForResult(['GOOG', 'GOOGL'], tracked), ['GOOG', 'GOOGL']);
assert.deepEqual(symbolsForResult(['GOOG', 'IBM', 'META'], tracked), []);
assert.deepEqual(easternDateAndSession('2026-07-22T20:09:23Z'), { date: '2026-07-22', session: 'post-market' });
assert.deepEqual(easternDateAndSession('2026-07-23T11:00:00Z'), { date: '2026-07-23', session: 'pre-market' });
passed += 8;

console.log(`earningsParse: ${passed} checks passed`);
