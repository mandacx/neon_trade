// Fixtures for the secondary news / earnings feed mapping and the structured-actuals rules.
// Items are real responses captured 2026-11-19 (INTU, WMT, TJX); no key is used.
// Run: node scripts/test-feed-map.mjs
import assert from 'node:assert/strict';
import { signedHeaders, mapNews, normalizeInstant, mapEarningsRows, mapReportedQuarters } from '../lib/marketdata/provider/feedMap.ts';
import { pickFeedActuals, pickFallbackEps } from '../lib/earningsFeed.ts';
import { parseEarningsHeadline, symbolsForResult, easternDateAndSession } from '../lib/earningsParse.ts';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok  ', name); };

// ---- signing ---------------------------------------------------------------------------------------------------
ok('signature is deterministic, base64, and the secret never appears in the headers', () => {
  const input = { host: 'api.webull.com', path: '/market-data/news/stock-news/list', query: { symbol: 'INTU' }, appKey: 'KEY123', appSecret: 'SECRET456', now: new Date('2026-11-19T21:30:00.123Z'), nonce: 'abc' };
  const a = signedHeaders(input);
  const b = signedHeaders(input);
  assert.equal(a['x-signature'], b['x-signature']);
  assert.match(a['x-signature'], /^[A-Za-z0-9+/]+=*$/);
  assert.equal(a['x-timestamp'], '2026-11-19T21:30:00Z'); // no milliseconds
  assert.equal(a['x-signature-algorithm'], 'HMAC-SHA1');
  assert.equal(a['x-version'], 'v3');
  assert.ok(!JSON.stringify(a).includes('SECRET456'));
  assert.notEqual(signedHeaders({ ...input, query: { symbol: 'WMT' } })['x-signature'], a['x-signature']);
  assert.notEqual(signedHeaders({ ...input, appSecret: 'other' })['x-signature'], a['x-signature']);
});

// ---- news mapping ----------------------------------------------------------------------------------------------
const intuResults = { news_id: '15952449449291776', title: 'Intuit Q1 Adj. EPS $2.91 Beats $2.70 Estimate, Sales $4.354B Beat $4.305B Estimate', source: 'Benzinga', url: 'https://example.test/a', publish_time: '2026-11-19T21:02:11.000+0000', sentiment: 'POSITIVE', related_symbols: ['INTU'] };
const intuGuidance = { news_id: '15952457312945152', title: 'Intuit Sees Q2 Adj EPS $3.17-$3.22 vs $3.98 Est; Sees Sales $4.931B-$4.954B vs $5.110B Est', source: 'Benzinga', publish_time: '2026-11-19T21:04:00.000+0000', related_symbols: ['INTU'] };
const roundup = { news_id: '15953424608183296', title: "Anthropic, Intuit, AMD, Insmed and GameStop: Why These 5 Stocks Are on Investors' Radars Today", source: 'Benzinga', publish_time: '2026-11-20T01:10:56.000+0000', related_symbols: [] };
const wmtCall = { news_id: '15950723228484608', title: 'Conference call:\nWalmart Sees Q4 Sales $199.236B-$201.142B vs $200.106B Est', source: 'Benzinga', publish_time: '2026-11-19T13:43:00.000+0000', related_symbols: ['WMT'] };
const tjxOdd = { news_id: '15944773923106817', title: 'TJX Companies Sees Q4 Adj EPS $1.42-$1.45 vs $1.49 Est', source: 'Benzinga', publish_time: '2026-11-18T12:30:00.000+0000', related_symbols: ['TJX'] };

ok('offset without a colon parses to the right instant', () => {
  assert.equal(normalizeInstant('2026-11-19T21:02:11.000+0000'), '2026-11-19T21:02:11.000Z');
  assert.equal(normalizeInstant('2026-11-19T16:02:11.000-0500'), '2026-11-19T21:02:11.000Z');
  assert.equal(normalizeInstant('not a date'), '');
  assert.equal(normalizeInstant(undefined), '');
});
ok('mapNews keeps the exact id text, tags symbols, drops line breaks', () => {
  const m = mapNews(tjxOdd);
  assert.equal(m.ref, '15944773923106817');
  assert.notEqual(String(m.id), m.ref); // the number is rounded: ids above 2^53 must be looked up by `ref`
  assert.deepEqual(m.symbols, ['TJX']);
  assert.equal(mapNews(wmtCall).headline, 'Conference call: Walmart Sees Q4 Sales $199.236B-$201.142B vs $200.106B Est');
  assert.deepEqual(mapNews(roundup).symbols, []);
});
ok('items without id, headline or time are dropped', () => {
  assert.equal(mapNews({ title: 'x', publish_time: '2026-11-19T21:02:11.000+0000' }), null);
  assert.equal(mapNews({ news_id: '1', title: '  ', publish_time: '2026-11-19T21:02:11.000+0000' }), null);
  assert.equal(mapNews({ news_id: '1', title: 'x', publish_time: 'junk' }), null);
});

// ---- through the existing headline parser ---------------------------------------------------------------------
const tracked = new Set(['INTU', 'WMT', 'TJX', 'AMD']);
const asArticle = raw => { const m = mapNews(raw); return { headline: m.headline, symbols: m.symbols, created_at: m.createdAt }; };
ok('results headline parses with its symbol; guidance and round-ups never become results', () => {
  const r = asArticle(intuResults);
  const p = parseEarningsHeadline(r.headline);
  assert.ok(p, 'results headline must parse');
  assert.equal(p.epsActual, 2.91);
  assert.equal(p.epsEstimate, 2.7);
  assert.equal(p.epsOutcome, 'beat');
  assert.equal(p.salesOutcome, 'beat');
  assert.deepEqual(symbolsForResult(r.symbols, tracked), ['INTU']);
  assert.equal(parseEarningsHeadline(asArticle(intuGuidance).headline), null);
  assert.equal(parseEarningsHeadline(asArticle(wmtCall).headline), null);
  assert.equal(parseEarningsHeadline(asArticle(tjxOdd).headline), null);
  assert.equal(parseEarningsHeadline(asArticle(roundup).headline), null);
  assert.deepEqual(symbolsForResult(asArticle(roundup).symbols, tracked), []); // untagged round-up: no symbol
});
ok('report date and session come from the Eastern time of the publish instant', () => {
  const e = easternDateAndSession(asArticle(intuResults).created_at); // 21:02Z = 16:02 ET
  assert.equal(e.date, '2026-11-19');
  assert.equal(e.session, 'post-market');
});

// ---- earnings calendar rows ------------------------------------------------------------------------------------
const intuCalendar = [
  { fiscal_year: 2026, fiscal_period: 3, currency: 'USD', expected_publish_date: '2026-05-20', eps_actual: '11.09', eps_est: '10.76209', rev_actual: '8558000000', rev_est: '8536409680' },
  { fiscal_year: 2026, fiscal_period: 4, currency: 'USD', expected_publish_date: '2026-08-25', eps_actual: '1.34', eps_est: '0.76526', rev_actual: '4354000000', rev_est: '4268872240' },
  { fiscal_year: 2027, fiscal_period: 1, currency: 'USD', expected_publish_date: '2026-11-19', eps_est: '1.78076', rev_est: '4305825900' },
];
ok('calendar rows map to numbers, missing actuals stay null', () => {
  const rows = mapEarningsRows(intuCalendar);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].epsActual, 1.34);
  assert.equal(rows[1].salesActual, 4354000000);
  assert.equal(rows[2].epsActual, null);
  assert.equal(rows[2].salesActual, null);
  assert.equal(rows[2].epsEstimate, 1.78076);
  assert.deepEqual(mapEarningsRows({ error: 'x' }), []);
});
ok('pickFeedActuals: report not filled in yet gives null (the INTU case 3 hours after the release)', () => {
  assert.equal(pickFeedActuals(mapEarningsRows(intuCalendar), '2026-11-19'), null);
});
ok('pickFeedActuals: a filled-in report within 3 days is used; USD only; closest wins', () => {
  const rows = mapEarningsRows(intuCalendar);
  const hit = pickFeedActuals(rows, '2026-08-26');
  assert.deepEqual(hit, { period: 'Q4', eps: 1.34, sales: 4354000000 });
  assert.equal(pickFeedActuals(rows, '2026-08-30'), null); // 5 days away: a different report
  const rmb = mapEarningsRows([{ ...intuCalendar[1], currency: 'CNY' }]);
  assert.equal(pickFeedActuals(rmb, '2026-08-25'), null);
  const two = mapEarningsRows([{ ...intuCalendar[1], expected_publish_date: '2026-08-27', eps_actual: '9' }, intuCalendar[1]]);
  assert.equal(pickFeedActuals(two, '2026-08-25').eps, 1.34);
  assert.equal(pickFeedActuals(mapEarningsRows([{ ...intuCalendar[1], fiscal_period: 7 }]), '2026-08-25').period, null);
});

// ---- fallback vendor EPS ---------------------------------------------------------------------------------------
const tradierFinancials = [{ request: 'INTU', type: 'Symbol', results: [
  { type: 'Company', id: 'c1', tables: { segmentation: null } },
  { type: 'Stock', id: 's1', tables: { earning_reports_a_o_r: null } },
  { type: 'Stock', id: 's2', tables: { earning_reports_a_o_r: [
    { period_12m: { as_of_date: '2026-07-31', basic_e_p_s: 16.53, diluted_e_p_s: 16.46 } },
    { period_3m: { as_of_date: '2026-07-31', basic_e_p_s: 1.34, diluted_e_p_s: 1.34 }, period_12m: { as_of_date: '2026-07-31' } },
    { period_3m: { as_of_date: '2026-07-31', basic_e_p_s: 1.34, diluted_e_p_s: 1.34 } },
  ] } },
] }, { request: 'ZZZZ', type: 'Symbol', results: [{ type: 'Stock', id: 'x', tables: { earning_reports_a_o_r: null } }] }];
ok('latest 3-month EPS per symbol; symbols without data are absent; a single object body works', () => {
  const m = mapReportedQuarters(tradierFinancials);
  assert.deepEqual(m.get('INTU'), { asOf: '2026-07-31', epsBasic: 1.34, epsDiluted: 1.34 });
  assert.equal(m.has('ZZZZ'), false);
  assert.equal(mapReportedQuarters(tradierFinancials[0]).size, 1);
  assert.equal(mapReportedQuarters(null).size, 0);
});
ok('pickFallbackEps: the quarter that just ended counts, last quarter does not (INTU reports 2026-11-19)', () => {
  assert.equal(pickFallbackEps({ asOf: '2026-10-31', epsDiluted: 2.1 }, '2026-11-19'), 2.1); // 19 days
  assert.equal(pickFallbackEps({ asOf: '2026-07-31', epsDiluted: 1.34 }, '2026-11-19'), null); // 111 days: the previous quarter
  assert.equal(pickFallbackEps({ asOf: '2026-11-15', epsDiluted: 2.1 }, '2026-11-19'), null); // 4 days: too close to a release
  assert.equal(pickFallbackEps({ asOf: '2026-10-31', epsDiluted: null }, '2026-11-19'), null);
});

console.log(`\n${n} groups passed`);
