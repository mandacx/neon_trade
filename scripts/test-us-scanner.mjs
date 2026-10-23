// Fixture tests for the US Market Scanner's pure modules:
//   lib/referenceData/listings.ts, lib/referenceData/indexHoldings.ts (parsing only), lib/splitCheck.ts,
//   lib/usUniverseRules.ts, lib/marketdata/provider/primary.ts (sipEnd).
//
//   node scripts/test-us-scanner.mjs
//
// (Node 24+ loads the .ts modules directly via built-in type stripping.)

import assert from 'node:assert/strict';
import { classify, parseNasdaqListed, parseOtherListed } from '../lib/referenceData/listings.ts';
import { normalizeTicker, tickersFromHoldingsRows } from '../lib/referenceData/indexHoldings.ts';
import { detectRebase } from '../lib/splitCheck.ts';
import { liquidityFrom } from '../lib/usUniverseRules.ts';
import { sipEnd } from '../lib/marketdata/provider/primary.ts';

let passed = 0;
const test = (name, fn) => { fn(); passed++; };

// ---------------------------------------------------------------- listings
test('listings: classify', () => {
  assert.deepEqual(classify('AAPL', 'Apple Inc. - Common Stock', false), { keep: true, isAdr: false });
  assert.deepEqual(classify('BRK.B', 'Berkshire Hathaway Inc. New Common Stock', false), { keep: true, isAdr: false });
  assert.equal(classify('BABA', 'Alibaba Group Holding Limited American Depositary Shares each representing eight Ordinary share', false).isAdr, true);
  assert.equal(classify('ABR$D', 'Arbor Realty Trust 6.375% Series D Preferred', false).keep, false); // $ = preferred
  assert.equal(classify('AAC.U', 'Ares Acquisition Corp Units', false).keep, false);
  assert.equal(classify('AMPX.W', 'Amprius Warrants', false).keep, false);
  assert.equal(classify('XYZW', 'Some Corp Warrant', false).keep, false); // name says warrant
  assert.equal(classify('ABCD', 'Some Bank 5.25% Fixed-to-Floating Notes due 2030', false).keep, false);
  // ETFs keep names that would look like non-common stock words ("Buffer 10%")
  assert.equal(classify('BUFR', 'FT Vest Laddered Buffer ETF 10% Buffer', true).keep, true);
});

test('listings: parse both files', () => {
  const nasdaq = [
    'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares',
    'AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N',
    'QQQ|Invesco QQQ Trust, Series 1|G|N|N|100|Y|N',
    'ZXZZT|NASDAQ TEST STOCK|G|Y|N|100|N|N',
    'File Creation Time: 1023202609:46|||||||',
  ].join('\r\n');
  const other = [
    'ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol',
    'BRK.B|Berkshire Hathaway Inc. New Common Stock|N|BRK.B|N|40|N|BRK.B',
    'SPY|State Street SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY',
    'XYZ|Some IEX listing|V|XYZ|N|100|N|XYZ',
    'ALL$B|Allstate Preferred B|N|ALL$B|N|100|N|ALL-B',
    'File Creation Time: 1023202609:46||||||',
  ].join('\n');
  const a = parseNasdaqListed(nasdaq);
  assert.deepEqual(a.map(l => [l.symbol, l.kind, l.exchange]), [['AAPL', 'stock', 'NASDAQ'], ['QQQ', 'etf', 'NASDAQ']]);
  const b = parseOtherListed(other);
  assert.deepEqual(b.map(l => [l.symbol, l.kind, l.exchange]), [['BRK.B', 'stock', 'NYSE'], ['SPY', 'etf', 'NYSE Arca']]);
});

// ---------------------------------------------------------------- index holdings
test('holdings: tickers under the header row', () => {
  const rows = [
    { A: 'Fund Name:', B: 'SPDR S&P 500 ETF Trust' },
    { A: 'Holdings:', B: 'As of 22-Oct-2026' },
    { A: 'Name', B: 'Ticker', C: 'Identifier', E: 'Weight' },
    { A: 'NVIDIA CORP', B: 'NVDA', E: '7.7' },
    { A: 'BERKSHIRE HATHAWAY INC CL B', B: 'BRK.B', E: '1.6' },
    { A: 'BROWN-FORMAN CORP CL B', B: 'BF/B', E: '0.01' },
    { A: 'US DOLLAR', B: '-', E: '0.1' },
    { A: '', B: '' },
  ];
  assert.deepEqual(tickersFromHoldingsRows(rows), { tickers: ['NVDA', 'BRK.B', 'BF.B'], asOf: '22-Oct-2026' });
  assert.equal(normalizeTicker('brk-b'), 'BRK.B');
  assert.equal(normalizeTicker('ESZ6 Index'), null);
});

// ---------------------------------------------------------------- split check
const days = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20'];
const series = (closes) => closes.map((close, i) => ({ date: days[i], close }));
test('split check: 2:1 split rebases', () => {
  const r = detectRebase(series([200, 202, 204, 206, 208]), series([100, 101, 102, 103, 104]));
  assert.ok(r);
  assert.equal(r.ratio, 0.5);
  assert.equal(r.days, 5);
});
test('split check: 1:10 reverse split rebases', () => {
  const r = detectRebase(series([1.0, 1.1, 1.2]), series([10, 11, 12]));
  assert.ok(r);
  assert.equal(Math.round(r.ratio), 10);
});
test('split check: noise and one revised print do not', () => {
  assert.equal(detectRebase(series([100, 101, 102]), series([100.2, 100.9, 102.1])), null); // < 0.5%
  assert.equal(detectRebase(series([100, 101, 102]), series([100, 101, 95])), null); // one day only
  assert.equal(detectRebase(series([100, 101, 102]), series([90, 101 * 0.8, 102 * 0.95])), null); // inconsistent ratios
  assert.equal(detectRebase(series([100]), series([50])), null); // too few overlap days
});

// ---------------------------------------------------------------- liquidity
test('liquidity: last 20 sessions, $50M and $5 rules', () => {
  const bars = Array.from({ length: 25 }, (_, i) => ({ c: 10, v: i < 5 ? 1 : 6_000_000 })); // last 20: $60M/day
  const l = liquidityFrom(bars);
  assert.equal(l.n, 20);
  assert.equal(l.avgDollarVol, 60_000_000);
  assert.equal(l.liquid, true);
  assert.equal(liquidityFrom(bars.map(b => ({ ...b, c: 4.99 }))).liquid, false); // under $5
  assert.equal(liquidityFrom(bars.map(b => ({ ...b, v: 1_000_000 }))).liquid, false); // $10M/day
  assert.equal(liquidityFrom(bars.slice(0, 8).map(b => ({ c: 100, v: 1e7 }))).liquid, false); // < 10 sessions
  assert.equal(liquidityFrom([]).lastClose, null);
});

// ---------------------------------------------------------------- consolidated-feed end cap
test('sipEnd: caps at now - 16 min, a date means through that ET day', () => {
  const now = Date.parse('2026-10-23T15:42:00Z'); // 11:42 ET
  assert.equal(sipEnd(undefined, now), '2026-10-23T15:26:00.000Z');
  assert.equal(sipEnd('2026-10-24', now), '2026-10-23T15:26:00.000Z'); // future date: capped
  assert.equal(sipEnd('2026-10-22', now), '2026-10-23T03:59:59.000Z'); // end of 10-22 ET (EDT)
  assert.equal(sipEnd('2026-12-01', Date.parse('2026-12-05T00:00:00Z')), '2026-12-02T04:59:59.000Z'); // EST
});

console.log(`test-us-scanner: ${passed} tests passed`);
