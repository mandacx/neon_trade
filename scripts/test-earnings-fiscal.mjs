// Fixture test for parseFiscalSummary (lib/earningsParse.ts): the fallback that reads actuals from the feed's
// short results summaries when the results-headline source is absent. Texts are real items from 2026-11-16/17.
//   node scripts/test-earnings-fiscal.mjs
import assert from 'node:assert/strict';
import { parseFiscalSummary } from '../lib/earningsParse.ts';

const HD1 = ['The Home Depot Reports Third Quarter Fiscal 2026 Results and Updates Guidance', 'The Home Depot reported sales of $43.4 billion for the third quarter of fiscal 2026, representing a 4.9% increase compared to the same period in 2025. Comparable sales grew by 2.2% overall, with U.S. comparable sales also increasing by 2.2%. Net earnings for the quarter were $3.7 billion, or $3.72 per diluted share, up from $3.6 billion, or $3.62 per diluted share, in the prior year. The company also updated its fiscal 2026 guidance, projecting total sales growth of approximately 4.5% and diluted earnings-per-share growth of approximately 1.5% compared to fiscal 2025.'];
const HD2 = ['The Home Depot Reports Third Quarter 2026 Financial Results', 'The Home Depot reported sales of $43.4 billion for the third quarter of fiscal 2026, an increase of $2.0 billion or 4.9% compared to the third quarter of fiscal 2025. Comparable sales for the quarter grew by 2.2%, with U.S. comparable sales also showing growth. The company scheduled a conference call for 9 a.m. ET on November 17, 2026, to discuss these results.'];
const TSN = ['Tyson Foods Reports Fourth Quarter 2026 Financial Results', "Tyson Foods, Inc. reported a net loss of $74 million, or $0.22 per share, for the fourth quarter of fiscal 2026, compared to a net income of $47 million, or $0.13 per share, in the same period last year. Adjusted net income per share was $0.61, down from $1.15 in the prior year's fourth quarter. Quarterly sales reached $14.585 billion, compared to $13.860 billion a year ago. Looking ahead to fiscal 2027, the company projects an adjusted operating income between $1.7 billion and $2.15 billion and anticipates a sales decline of 3.5% to 5.5% compared to fiscal 2026. Management attributed the expected decline to lower volumes in the Beef segment, driven by network restructuring and tight cattle supplies."];
const ARMK = ['Aramark Reports Fiscal Fourth-Quarter Results and Announces Capital Allocation Updates', 'Aramark reported its fiscal fourth-quarter 2026 results, showing an increase in both profit and revenue compared to the previous year. The company achieved GAAP earnings of $137.94 million, or $0.51 per share, up from $87.14 million, or $0.33 per share, in the prior year. Adjusted earnings for the period were $191.40 million, or $0.71 per share, on revenue of $5.293 billion, representing a 4.9% increase from the $5.048 billion reported in the same period last year. Alongside the financial results, the company announced a dividend increase and authorized a new $1 billion share repurchase program. Aramark also provided an outlook for fiscal year 2027, projecting continued growth.'];
const XPEV = ['XPeng Inc. Reports Third Quarter 2026 Financial Results', 'XPeng Inc. reported total revenue of RMB 24.28 billion for the third quarter of 2026, marking a 19.1% increase compared to the same period in 2025. Net loss for the period was RMB 0.87 billion.'];
const BIDU = ['Baidu Announces Third Quarter 2026 Results', 'Baidu, Inc. released its financial results for the third quarter of 2026. The company reported quarterly revenue of 30.81 billion Renminbi, slightly below the FactSet consensus estimate of 30.91 billion Renminbi. Adjusted earnings were reported at 6.78 Renminbi per ADS, exceeding the FactSet estimate of 6.03 Renminbi per ADS.'];

const cases = [
  // GAAP only (the first current-period per-share figure; the prior-year $3.62 is skipped), sales from the first sentence.
  [HD1, { period: 'Q3', epsActual: 3.72, epsAdjusted: false, salesActual: 43.4e9 }],
  // Sales only, no EPS in the text.
  [HD2, { period: 'Q3', epsActual: null, epsAdjusted: null, salesActual: 43.4e9 }],
  // Adjusted preferred over the GAAP loss; prior-year and guidance figures ignored.
  [TSN, { period: 'Q4', epsActual: 0.61, epsAdjusted: true, salesActual: 14.585e9 }],
  [ARMK, { period: 'Q4', epsActual: 0.71, epsAdjusted: true, salesActual: 5.293e9 }],
  // Foreign currency: reported, but no figures.
  [XPEV, { period: 'Q3', epsActual: null, epsAdjusted: null, salesActual: null }],
  [BIDU, { period: 'Q3', epsActual: null, epsAdjusted: null, salesActual: null }],
];
for (const [[headline, content], want] of cases) {
  assert.deepEqual(parseFiscalSummary(headline, content), want, headline);
}

// GAAP loss alone is negative.
assert.equal(parseFiscalSummary('Acme Reports Second Quarter 2026 Results', 'Acme reported a net loss of $5 million, or $0.12 per share, for the second quarter.').epsActual, -0.12);
// "EPS of $x" wording, comma amounts and a million-dollar sales figure.
const eps = parseFiscalSummary('Acme Announces Q1 Results', 'Acme posted EPS of $1.25 on revenue of $1,250 million.');
assert.equal(eps.epsActual, 1.25); assert.equal(eps.salesActual, 1250e6); assert.equal(eps.period, 'Q1');
// A sales figure with no unit is ambiguous and is not taken.
assert.equal(parseFiscalSummary('Acme Reports Q1 Results', 'Acme reported sales of $43.4 for the quarter.').salesActual, null);
// HTML in content is stripped.
assert.equal(parseFiscalSummary('Acme Reports Q2 Results', '<p>Acme reported sales of <b>$2.5 billion</b>.</p>').salesActual, 2.5e9);


// Real items that exposed bugs in the first version (dry run against the live feed, 2026-11-17).
const NVDA = ['NVIDIA Reports Financial Results for Third Quarter Fiscal 2027', 'NVIDIA reported revenue of $115.8 billion for the third quarter ended October 25, 2026, representing a 103% increase from the same period last year and a 20% increase from the previous quarter. Data Center revenue reached $107.6 billion, up 110% year-over-year. The company reported GAAP and non-GAAP earnings per diluted share of $2.70 and $2.68, respectively. Additionally, NVIDIA announced that its Board of Directors previously approved a $150 billion increase to its share repurchase authorization in September 2026, with $227.3 billion remaining as of the end of the third quarter. The company also declared a quarterly cash dividend of $0.25 per share, payable on December 23, 2026.'];
const HTFL = ['HeartFlow Reports Third Quarter 2026 Financial Results and Raises Full Year 2026 Guidance', "HeartFlow, Inc. announced its financial results for the third quarter ended September 30, 2026, reporting total revenue of $72.9 million, which represents a 57% increase compared to the same period in the previous year. The company also reported a gross margin of 83.6% and a net operating loss of $13.8 million. Alongside these results, HeartFlow raised its full-year 2026 revenue guidance to a range of $262 million to $264 million, surpassing the FactSet consensus estimate of $248.6 million. The company's quarterly adjusted loss was reported at $0.03 per share, performing better than the FactSet estimate of a $0.10 loss per share."];
const MBGL = ['Mobility Global Inc. Reports Third Quarter 2026 Financial Results and Announces Share Repurchase Program', "Mobility Global Inc. announced its financial results for the third quarter of 2026, reporting revenue of $478 million, a 7.4% increase. The company's adjusted earnings per share of $0.40 exceeded analyst expectations of $0.38. Alongside the earnings report, management raised the company's EBITDA guidance for the full fiscal year 2026. The board of directors also authorized a new $800 million share repurchase program, with plans to buy back between $350 million and $450 million in shares through the end of 2027. Additionally, the company declared a quarterly dividend of $0.06 per share as part of its ongoing capital return strategy."];
const AS2 = ['Amer Sports Reports Third Quarter 2026 Financial Results and Raises Full-Year Guidance', 'Amer Sports, Inc. announced its third-quarter 2026 financial results, reporting revenue of $2.169 billion, a 24% increase year-over-year. The company saw double-digit growth across all three segments: Technical Apparel grew 26% to $861 million. Net income rose 67% to $240 million, with adjusted diluted EPS reaching $0.42. Following these results, the company raised its full-year 2026 guidance, now projecting revenue growth of 25-26% and adjusted diluted EPS of $1.32-$1.35.'];
for (const [[headline, content], want] of [
  // Paired GAAP / non-GAAP figures are not guessed, and the $0.25 dividend is not EPS.
  [NVDA, { period: 'Q3', epsActual: null, epsAdjusted: null, salesActual: 115.8e9 }],
  // An adjusted loss is negative; dividend and guidance figures are not taken.
  [HTFL, { period: 'Q3', epsActual: -0.03, epsAdjusted: true, salesActual: 72.9e6 }],
  [MBGL, { period: 'Q3', epsActual: 0.4, epsAdjusted: true, salesActual: 478e6 }],
  [AS2, { period: 'Q3', epsActual: 0.42, epsAdjusted: true, salesActual: 2.169e9 }],
]) assert.deepEqual(parseFiscalSummary(headline, content), want, headline);
// A dividend alone is never EPS.
assert.equal(parseFiscalSummary('Acme Reports Q2 Results', 'Acme declared a quarterly dividend of $0.25 per share.').epsActual, null);
// Segment revenue earlier in the text does not replace the (larger) total.
assert.equal(parseFiscalSummary('Acme Reports Q2 Results', 'Cloud revenue reached $9.0 billion. Total revenue was $20.0 billion.').salesActual, 20e9);

// A year total in a quarterly release is not the quarter's figure (real item, Applied Materials 2026-11-12).
const AMAT = ['Applied Materials Reports Fourth Quarter and Fiscal Year 2026 Financial Results', 'Applied Materials reported record quarterly revenue of $10.41 billion, a 53% increase year-over-year, and record annual revenue of $34.45 billion, up 21% from the previous year. The company achieved a quarterly non-GAAP EPS of $4.16 and an annual non-GAAP EPS of $12.89. Additionally, Applied Materials unveiled its EPIC Center in Silicon Valley.'];
assert.deepEqual(parseFiscalSummary(...AMAT), { period: 'Q4', epsActual: 4.16, epsAdjusted: true, salesActual: 10.41e9 });

// Not results releases.
for (const h of [
  'Analysts Adjust Price Targets and Ratings for Tyson Foods Following Fiscal Q4 Earnings',
  'Goldman Sachs Adjusts Price Target on Tyson Foods to $70 From $62',
  'The Home Depot Announces Executive Leadership Changes',
  'Aramark Adopts DeepL Voice Technology for Multilingual Communication',
  'Acme to Report Third Quarter Results on November 20',
  'Acme Announces Conference Call to Discuss Third Quarter Results',
  'Acme Announces Voting Results of Annual Meeting',
  'Bernstein Estimates $345 Million Industry Impact from FAA Ground Stop',
]) assert.equal(parseFiscalSummary(h, 'Text with sales of $1.0 billion.'), null, h);

// Forward-looking sentences never supply a figure.
assert.equal(parseFiscalSummary('Acme Reports Q3 Results', 'Acme expects sales of $9.0 billion next year.').salesActual, null);

console.log('earnings fiscal-summary fixtures: all passed');
