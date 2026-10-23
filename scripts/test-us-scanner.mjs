// Fixture tests for the US Market Scanner's pure modules:
//   lib/referenceData/listings.ts, lib/referenceData/indexHoldings.ts (parsing only), lib/splitCheck.ts,
//   lib/usUniverseRules.ts, lib/marketdata/provider/primary.ts (sipEnd), and the scan engine
//   lib/scanner/{config,indicators,scans,liveBar}.ts.
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
import { normalizeParams, toQuery, rankAscending, DEFAULT_PARAMS, ALLOWED_N } from '../lib/scanner/config.ts';
import { streak, volumeRatio, findJump, sma, roc, atrPct, crossWithin, insideDay, rangeBreakout, percentileRank } from '../lib/scanner/indicators.ts';
import { SCANNERS, jumpFlag } from '../lib/scanner/scans.ts';
import { liveBarFrom, premarketFrom, todayNeedsRefresh, etDate } from '../lib/scanner/liveBar.ts';

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

// ================================================================ scan engine

// Trading days around Thanksgiving 2026 (11-26 closed, 11-27 closes 13:00) and the DST change (11-01).
const bar = (date, c, extra = {}) => ({ date, o: c, h: c, l: c, c, v: 1000, ...extra });
const mkSeries = (bars, ext = null, hasLive = false) => ({
  bars, closes: bars.map(b => b.c), highs: bars.map(b => b.h), lows: bars.map(b => b.l), ext, hasLive,
});
const ctx = (s, over = {}) => ({ symbol: 'XYZ', s, p: { ...DEFAULT_PARAMS, ...over }, spyRoc: 0 });

test('streak: counts across a market holiday (bars, not calendar days)', () => {
  const b = [bar('2026-11-23', 10), bar('2026-11-24', 11), bar('2026-11-25', 12), bar('2026-11-27', 13)]; // no 11-26 bar
  assert.deepEqual(streak(b, 1), { len: 3, from: 0 });
  const m = SCANNERS.streak_up(ctx(mkSeries(b), { n: 3 }));
  assert.equal(m.metric, 3);
  assert.match(m.detail, /3 closes higher in a row, \+30\.00%/);
  assert.equal(SCANNERS.streak_up(ctx(mkSeries(b), { n: 5 })), null);
  assert.equal(streak([bar('a', 10), bar('b', 11), bar('c', 11)], 1).len, 0); // an unchanged close breaks it
});

test('gap: filled vs open', () => {
  const prev = bar('2026-10-22', 100);
  const open = SCANNERS.gap_up(ctx(mkSeries([prev, { date: '2026-10-23', o: 104, h: 106, l: 103, c: 105, v: 1 }]), { minGapPct: 2 }));
  assert.equal(Math.round(open.metric), 4);
  assert.match(open.detail, /gap open/);
  const filled = SCANNERS.gap_up(ctx(mkSeries([prev, { date: '2026-10-23', o: 104, h: 106, l: 99.5, c: 101, v: 1 }]), { minGapPct: 2 }));
  assert.match(filled.detail, /gap filled/);
  assert.equal(SCANNERS.gap_up(ctx(mkSeries([prev, bar('2026-10-23', 101)]), { minGapPct: 2 })), null);
  const down = SCANNERS.gap_down(ctx(mkSeries([prev, { date: '2026-10-23', o: 95, h: 99, l: 94, c: 96, v: 1 }]), { minGapPct: 2 }));
  assert.equal(Math.round(down.metric), 5);
});

test('52-week high: set today vs 3 sessions ago, and the 200-session minimum', () => {
  const dates = ['2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'];
  const b = dates.map((d, i) => bar(d, 100 + i, { h: 101 + i }));
  b[1].h = 120; // stored high set on 10-19: 3 sessions before 10-22
  const ext = { sessions: 250, high: 120, highDate: '2026-10-19', low: 50, lowDate: '2026-03-02' };
  assert.equal(SCANNERS.high52(ctx(mkSeries(b, ext), { n: 3 })), null); // 3 ago is not within the last 3
  assert.ok(SCANNERS.high52(ctx(mkSeries(b, ext), { n: 5 })));
  const live = [...b, { date: '2026-10-23', o: 119, h: 125, l: 118, c: 124, v: 1 }];
  assert.match(SCANNERS.high52(ctx(mkSeries(live, ext, true), { n: 1 })).detail, /set in the latest session/);
  assert.equal(SCANNERS.high52(ctx(mkSeries(live, { ...ext, sessions: 150 }, true), { n: 1 })), null); // short history
});

test('volume ratio: short baseline', () => {
  const mk = (n, v) => Array.from({ length: n }, (_, i) => bar(`d${String(i).padStart(3, '0')}`, 10, { v }));
  assert.equal(volumeRatio([...mk(9, 100), ...mk(1, 300)], 1), null); // 9 baseline bars < 10
  assert.equal(volumeRatio([...mk(10, 100), ...mk(1, 300)], 1), 3);
  assert.equal(volumeRatio([...mk(25, 100), ...mk(3, 200)], 3), 2); // baseline = the 20 before the window
  assert.equal(volumeRatio([...mk(20, 0), ...mk(1, 300)], 1), null); // zero-volume baseline
});

test('corporate-action flag: >30% one-session move', () => {
  const b = [bar('2026-10-20', 100), bar('2026-10-21', 50), bar('2026-10-22', 51)];
  assert.deepEqual(findJump(b, 3), { date: '2026-10-21', pct: -50 });
  assert.match(jumpFlag({ metric: 1, detail: '', lookback: 3 }, mkSeries(b), null), /-50% in one session on 2026-10-21/);
  assert.equal(jumpFlag({ metric: 1, detail: '' }, mkSeries(b), null), null); // single-day scans: no flag
  assert.match(jumpFlag({ metric: 1, detail: '', use52: true }, mkSeries(b), { date: '2026-05-01', pct: 120 }), /\+120%/);
});

test('indicators: sma, roc, atr, cross, inside day, range breakout, percentile', () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(sma([1, 2], 3), null);
  assert.equal(roc([100, 105, 110], 2).toFixed(9), '10.000000000');
  assert.equal(roc([110], 1), null);
  const b = Array.from({ length: 15 }, (_, i) => ({ date: `d${i}`, o: 100, h: 102, l: 98, c: 100, v: 1 }));
  assert.equal(atrPct(b, 14).toFixed(9), '4.000000000');
  // A long decline then a sharp rise: the 50 crosses above the 200 at some bar k.
  const closes = [...Array.from({ length: 200 }, (_, i) => 200 - i * 0.5), ...Array.from({ length: 60 }, (_, i) => 100 + i * 4)];
  let found = null;
  for (let k = 1; k <= 60 && !found; k++) { const x = crossWithin(closes.slice(0, 200 + k), 50, 200, 1); if (x) found = { k, ...x }; }
  assert.equal(found.type, 'golden');
  assert.equal(crossWithin(closes.slice(0, 200 + found.k + 3), 50, 200, 5).ago, 3);
  assert.equal(crossWithin(closes.slice(0, 200 + found.k + 3), 50, 200, 3), null);
  assert.deepEqual(insideDay([{ h: 10, l: 5 }, { h: 9, l: 6 }]), { ratio: 0.6 });
  assert.equal(insideDay([{ h: 10, l: 5 }, { h: 11, l: 6 }]), null);
  assert.equal(insideDay([{ h: 10, l: 5 }, { h: 10, l: 5 }]), null);
  assert.deepEqual(rangeBreakout([10, 12, 11, 13], [5, 6, 5, 6], 13, 3, 'up'), { level: 12, beyondPct: (13 / 12 - 1) * 100 });
  assert.equal(rangeBreakout([10, 12, 11, 12], [5, 6, 5, 6], 12, 3, 'up'), null); // equal is not beyond
  assert.equal(percentileRank([1, 2, 3, 4], 3), 50);
});

test('relative strength vs SPY and ranking direction', () => {
  const s = mkSeries(Array.from({ length: 30 }, (_, i) => bar(`d${i}`, 100 + i)));
  const m = SCANNERS.rs_spy({ ...ctx(s, { period: '1M', dir: 'up' }), spyRoc: 5 });
  assert.equal(m.metric.toFixed(6), ((129 / 108 - 1) * 100 - 5).toFixed(6));
  assert.equal(SCANNERS.rs_spy({ ...ctx(s, { period: '1M', dir: 'down' }), spyRoc: 5 }), null);
  assert.equal(rankAscending({ scan: 'high52', dir: 'up' }), true);
  assert.equal(rankAscending({ scan: 'roc', dir: 'down' }), true);
  assert.equal(rankAscending({ scan: 'roc', dir: 'up' }), false);
  assert.equal(rankAscending({ scan: 'volume', dir: 'up' }), false);
});

test('normalizeParams: clamps and never trusts the query string', () => {
  const p = normalizeParams({ scan: 'bogus', n: '9999', minPrice: '-5', maxPrice: '1', limit: '7', volX: '0', universe: 'sp500', exchange: 'nyse,LSE,nasdaq', sector: "x'; DROP TABLE", type: 'etf', cap: 'giant' });
  assert.equal(p.scan, 'streak_up');
  assert.equal(p.n, ALLOWED_N.streak_up[0]);
  assert.equal(p.minPrice, 0);
  assert.equal(p.maxPrice, 1);
  assert.equal(p.limit, 100);
  assert.equal(p.volX, 1);
  assert.equal(p.universe, 'SP500');
  assert.deepEqual(p.exchanges, ['NYSE', 'NASDAQ']);
  assert.equal(p.sector, null);
  assert.equal(p.type, 'etf');
  assert.equal(p.capTier, 'any');
  assert.equal(normalizeParams({ scan: 'high52', n: '5' }).n, 5);
  assert.equal(normalizeParams({ minPrice: '50', maxPrice: '10' }).maxPrice, 50); // max < min -> min
  assert.equal(normalizeParams({ industry: 'Semiconductors' }).industry, null); // industry needs a sector
  const once = normalizeParams({ scan: 'range_breakout', n: '55', dir: 'down', universe: 'NDX100', minDollarVolM: '25', sector: 'Information Technology', industry: 'Semiconductors' });
  assert.deepEqual(normalizeParams(Object.fromEntries(new URLSearchParams(toQuery(once)))), once); // URL round trip
});

// ---------------------------------------------------------------- live bar / sessions
const snap = (t, extra = {}) => ({
  dailyBar: { o: 50, h: 52, l: 49, c: 51, v: 1000, t },
  prevDailyBar: { o: 48, h: 50, l: 47, c: 49.5, v: 900, t: extra.prevT },
  latestTrade: extra.trade,
});
const state = (session, lastSessionDate, lastCloseAt) => ({ session, lastSessionDate, lastCloseAt });

test('etDate: DST-safe ET dates', () => {
  assert.equal(etDate('2026-10-30T04:00:00Z'), '2026-10-30'); // EDT midnight
  assert.equal(etDate('2026-11-02T05:00:00Z'), '2026-11-02'); // EST midnight (after 11-01)
  assert.equal(etDate('2026-11-02T04:30:00Z'), '2026-11-01'); // 23:30 ET on the 1st
});

test('liveBarFrom: new session across the DST change', () => {
  const r = liveBarFrom(snap('2026-11-02T05:00:00Z', { prevT: '2026-10-30T04:00:00Z' }),
    { lastDate: '2026-10-30', lastClose: 49.5 }, state('regular', '2026-11-02', '2026-11-02T21:00:00Z'), null);
  assert.equal(r.bar.date, '2026-11-02');
  assert.equal(r.missing, null);
  assert.equal(r.volumePartial, true);
  assert.equal(r.splitSuspect, false);
});

test('liveBarFrom: NYSE holiday (Thanksgiving) gives no new bar', () => {
  const r = liveBarFrom(snap('2026-11-25T05:00:00Z', { prevT: '2026-11-24T05:00:00Z' }),
    { lastDate: '2026-11-25', lastClose: 51 }, state('closed', '2026-11-25', '2026-11-25T21:00:00Z'), null);
  assert.equal(r.bar, null);
});

test('liveBarFrom: half day (13:00 close), merged with the delayed consolidated bar', () => {
  const delayed = { date: '2026-11-27', o: 50.1, h: 51.5, l: 48.8, c: 50.9, v: 250000 };
  const r = liveBarFrom(snap('2026-11-27T05:00:00Z', { prevT: '2026-11-25T05:00:00Z' }),
    { lastDate: '2026-11-25', lastClose: 49.5 }, state('post', '2026-11-27', '2026-11-27T18:00:00Z'), delayed);
  assert.deepEqual(r.bar, { date: '2026-11-27', o: 50.1, h: 51.5, l: 48.8, c: 51, v: 250000 });
  assert.equal(r.volumePartial, false);
});

test('liveBarFrom: missing settled session, split suspicion, stale snapshot', () => {
  const r = liveBarFrom(snap('2026-11-02T05:00:00Z', { prevT: '2026-10-30T04:00:00Z' }),
    { lastDate: '2026-10-29', lastClose: 48 }, state('regular', '2026-11-02', '2026-11-02T21:00:00Z'), null);
  assert.equal(r.missing.date, '2026-10-30');
  assert.equal(r.bar.date, '2026-11-02');
  const s2 = liveBarFrom(snap('2026-11-02T05:00:00Z', { prevT: '2026-10-30T04:00:00Z' }),
    { lastDate: '2026-10-30', lastClose: 99 }, state('regular', '2026-11-02', '2026-11-02T21:00:00Z'), null);
  assert.equal(s2.splitSuspect, true);
  assert.equal(liveBarFrom(snap('2026-10-30T04:00:00Z'), { lastDate: '2026-10-29', lastClose: 48 },
    state('regular', '2026-11-02', '2026-11-02T21:00:00Z'), null).bar, null);
});

test("premarketFrom: only today's pre-market trades", () => {
  const st = state('pre', '2026-10-22', '2026-10-22T20:00:00Z');
  const now = Date.parse('2026-10-23T12:00:00Z'); // 08:00 ET
  assert.deepEqual(premarketFrom({ latestTrade: { p: 105, t: '2026-10-23T11:55:00Z' } }, st, 100, now), { price: 105, prevClose: 100 });
  assert.equal(premarketFrom({ latestTrade: { p: 105, t: '2026-10-22T21:00:00Z' } }, st, 100, now), null); // yesterday's after-hours
  assert.equal(premarketFrom({ latestTrade: { p: 105, t: '2026-10-23T11:55:00Z' } }, { ...st, session: 'regular' }, 100, now), null);
});

test('todayNeedsRefresh: every 3 min in session, once after the close settles', () => {
  const st = state('regular', '2026-10-23', '2026-10-23T20:00:00Z');
  const t = (iso) => ({ fetchedAt: iso, bars: { size: iso ? 1900 : 0 } });
  const now = Date.parse('2026-10-23T16:00:00Z');
  assert.equal(todayNeedsRefresh(t(null), st, now), true);
  assert.equal(todayNeedsRefresh(t('2026-10-23T15:58:00Z'), st, now), false);
  assert.equal(todayNeedsRefresh(t('2026-10-23T15:56:00Z'), st, now), true);
  const post = { ...st, session: 'post' };
  assert.equal(todayNeedsRefresh(t('2026-10-23T19:58:00Z'), post, Date.parse('2026-10-23T20:10:00Z')), false); // not settled yet
  assert.equal(todayNeedsRefresh(t('2026-10-23T19:58:00Z'), post, Date.parse('2026-10-23T20:20:00Z')), true); // settled: final refresh
  assert.equal(todayNeedsRefresh(t('2026-10-23T20:21:00Z'), post, Date.parse('2026-10-23T22:00:00Z')), false); // final
});

console.log(`test-us-scanner: ${passed} tests passed`);
