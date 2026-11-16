// Fixture test for lib/newsText.ts. The HTML shapes are modelled on what the news feed returned on
// 2026-11-16 (paragraphs with ticker links, a table inside a figure, a widget div, a script, an
// "Image:" credit, entity-encoded text). Run:
//
//   node scripts/test-news-text.mjs

import assert from 'node:assert/strict';
import { decodeEntities, htmlParagraphs, newsExcerpt, plainText } from '../lib/newsText.ts';

// --- entities
assert.equal(decodeEntities('CEO&#39;s exit &amp; Huang&#8216;s &#x2019;'), 'CEO\'s exit & Huang‘s ’');
assert.equal(decodeEntities('&unknown; &#99999999;'), '&unknown; &#99999999;');
assert.equal(plainText('10 banks <b>downgraded</b> Nvidia (NVDA) after CEO&#39;s exit'), "10 banks downgraded Nvidia (NVDA) after CEO's exit");
assert.equal(plainText(null), '');

// --- paragraphs: tables, figures, widgets and scripts are dropped; links and bold keep their text
const html = `
<p class="wp-block-paragraph">Ten banks downgraded <strong>Nvidia Corp.</strong> <a data-ticker="NVDA" href="https://x/quote/NVDA" class="ticker-link">(NASDAQ:NVDA)</a> after <strong>Jensen Huang</strong>&#8216;s exit.</p>
<figure class="wp-block-table"><table><thead><tr><th>Date</th><th>Firm</th></tr></thead><tbody><tr><td>Nov 10</td><td>Bank A</td></tr></tbody></table><figcaption>Source: data</figcaption></figure>
<h2>What to expect</h2>
<p>Second paragraph.<br/>Same paragraph, new line.</p>
<script>window.ads = 1;</script>
<div class="widget"><p>Ad: buy now</p></div>
<p class="wp-block-paragraph"><em>Image: Shutterstock</em></p>`;
assert.deepEqual(htmlParagraphs(html), [
  'Ten banks downgraded Nvidia Corp. (NASDAQ:NVDA) after Jensen Huang‘s exit.',
  'What to expect',
  'Second paragraph. Same paragraph, new line.',
  'Image: Shutterstock',
]);

// --- excerpt: boilerplate credits are skipped; a short article is returned whole and not truncated
const short = newsExcerpt(html, 200, 250);
assert.equal(short.truncated, false);
assert.ok(!short.text.includes('Image:') && !short.text.includes('Ad:') && !short.text.includes('Bank A'));

// --- excerpt: long article stops near the target on a paragraph or sentence boundary
const sentence = 'Analysts expect revenue growth to continue through the quarter. ';
const para = (n) => `<p>${sentence.repeat(n)}</p>`; // 9 words per sentence
const long = para(6) + para(6) + para(6) + para(6) + para(6); // 54 words per paragraph, 270 total
const ex = newsExcerpt(long, 150, 250);
assert.ok(ex.words >= 150 && ex.words <= 250, `words ${ex.words}`);
assert.equal(ex.truncated, true);
assert.ok(/[.!?]$/.test(ex.text), 'ends on a sentence end');

// --- excerpt: one giant paragraph is cut at a sentence end within max, never mid-sentence
const giant = `<p>${sentence.repeat(60)}</p>`;
const g = newsExcerpt(giant, 150, 250);
assert.ok(g.words <= 250 && g.words >= 150, `giant ${g.words}`);
assert.ok(/[.!?]$/.test(g.text));
assert.equal(g.truncated, true);

// --- excerpt: a paragraph with no sentence end is cut at max words with an ellipsis
const noEnd = newsExcerpt(`<p>${'word '.repeat(400)}</p>`, 150, 250);
assert.ok(noEnd.text.endsWith('…'));
assert.equal(noEnd.words, 250);

// --- excerpt never ends on a dangling section heading
const withHeading = para(10) + para(6) + '<h2>Neoclouds Face Potential Bankruptcies Amid Slower AI Spending</h2>' + para(6);
const wh = newsExcerpt(withHeading, 150, 250);
assert.ok(!wh.text.endsWith('Spending'), 'heading dropped');
assert.equal(wh.truncated, true);

// --- switched off / empty
assert.deepEqual(newsExcerpt(long, 0, 0), { text: '', words: 0, truncated: false });
assert.deepEqual(newsExcerpt('', 150, 250), { text: '', words: 0, truncated: false });

console.log('news text: all assertions passed');
