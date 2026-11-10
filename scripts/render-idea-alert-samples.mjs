// Offline sample renderer for the Trade Ideas alerts. NEVER SENDS ANYTHING: it imports only pure builders, and the first
// thing it does is replace fetch with a function that throws. Do not import lib/email.ts, lib/ideaChannels.ts, lib/db.ts,
// lib/telegram.ts or web-push here.
//
//   node scripts/render-idea-alert-samples.mjs [--out .tmp/idea-alert-samples] [--screenshots]
//
// Writes, per sample: .html .txt .eml (open in Apple Mail / Outlook desktop), .tg.html .tg.txt, .push.json; plus index.html and
// report.json (subject / preheader lengths, HTML size, widest Telegram <pre> row per kind). With --screenshots it renders
// each email in headless Chromium at 600 / 360 / 320 px, light and dark colour-scheme emulation, with all network blocked,
// checks no horizontal overflow, that the preheader is hidden and that the unsubscribe link is present, and saves PNGs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildEmail } from '../lib/ideaEmail.ts';
import { buildPush, buildTelegram, pushUrgency } from '../lib/ideaMessages.ts';
import { alertKind } from '../lib/ideaAlertModel.ts';
import { listUnsubscribeHeaders, formatFrom } from '../lib/emailFormat.ts';
import { IDEA_SENDER_NAME, SITE_URL } from '../lib/site.ts';
import { ALL, LONG, mk } from './fixtures/ideaAlertFixtures.mjs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = resolve(outIdx >= 0 ? args[outIdx + 1] : '.tmp/idea-alert-samples');
const SHOTS = args.includes('--screenshots');

const SAMPLE_PAGE = `${SITE_URL}/unsubscribe?t=SAMPLE`; // invalid on purpose: opening it shows the "link does not work" state
const SAMPLE_ONE_CLICK = `${SITE_URL}/api/email/unsubscribe?t=SAMPLE`;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

function eml(name, m) {
  const h = listUnsubscribeHeaders(SAMPLE_ONE_CLICK);
  const boundary = `=_sample_${slug(name)}`;
  const lines = [
    'MIME-Version: 1.0',
    `From: ${formatFrom('support@stockstrendz.com', IDEA_SENDER_NAME)}`,
    'To: owner@example.invalid',
    `Subject: ${encWord(m.subject)}`,
    'Date: Tue, 10 Nov 2026 14:30:00 +0000',
    `Message-ID: <sample-${slug(name)}@example.invalid>`,
    ...(m.withLink ? Object.entries(h).map(([k, v]) => `${k}: ${v}`) : []),
    'X-Sample: not-sent',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(m.text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(m.html),
    `--${boundary}--`, '',
  ];
  return lines.join('\r\n');
}

async function main() {
  globalThis.fetch = () => { throw new Error('network disabled in render-idea-alert-samples'); };
  mkdirSync(OUT, { recursive: true });

  const fallbackInputs = [
    ['fallback no facts', mk(LONG, 'stopped', 'stopped', null)],
    ['fallback no plan', mk(null, 'stopped', 'stopped', { v: 1, price: 95 })],
    ['fallback unknown type', mk(LONG, 'weird_event', 'k', { v: 1 })],
  ];
  const samples = [
    ...ALL.map(a => ({ name: a.name, input: a.input, link: true })),
    ...fallbackInputs.map(([name, input]) => ({ name, input, link: true })),
    ...['published long', 'stopped long'].map(n => ({ name: `${n} (no unsubscribe link)`, input: ALL.find(a => a.name === n).input, link: false })),
  ];

  const report = [];
  const files = [];
  for (const s of samples) {
    const base = slug(s.name);
    const m = buildEmail(s.input, { unsubscribeUrl: s.link ? SAMPLE_PAGE : null });
    const tg = buildTelegram(s.input);
    const push = buildPush(s.input);
    const kind = alertKind(s.input.eventType, s.input.eventKey);
    writeFileSync(join(OUT, `${base}.html`), m.html);
    writeFileSync(join(OUT, `${base}.txt`), m.text);
    writeFileSync(join(OUT, `${base}.eml`), eml(s.name, { ...m, withLink: s.link }));
    writeFileSync(join(OUT, `${base}.tg.html`), tg.html);
    writeFileSync(join(OUT, `${base}.tg.txt`), tg.plain);
    writeFileSync(join(OUT, `${base}.push.json`), JSON.stringify({ payload: push, options: { TTL: 3600, urgency: pushUrgency(kind) } }, null, 2));
    const pre = tg.html.match(/<pre>([\s\S]*?)<\/pre>/);
    const widest = pre ? Math.max(...pre[1].split('\n').map(l => l.length)) : 0;
    report.push({ name: s.name, kind, base, link: s.link, subject: m.subject, preheader: m.preheader, subjectLen: m.subject.length, preheaderLen: m.preheader.length, htmlBytes: Buffer.byteLength(m.html), textBytes: Buffer.byteLength(m.text), widestTelegramPreRow: widest, pushUrgency: pushUrgency(kind) });
    files.push(base);
  }
  const widestByKind = {};
  for (const r of report) widestByKind[r.kind] = Math.max(widestByKind[r.kind] ?? 0, r.widestTelegramPreRow);
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ widestTelegramPreRowByKind: widestByKind, samples: report }, null, 2));
  writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Trade Ideas alert samples</title><h1>Samples (never sent)</h1><ul>${report.map(r => `<li><b>${r.name}</b>: <a href="${r.base}.html">html</a> <a href="${r.base}.txt">text</a> <a href="${r.base}.eml">eml</a> <a href="${r.base}.tg.txt">telegram</a> <a href="${r.base}.push.json">push</a></li>`).join('')}</ul>`);
  console.log(`rendered ${samples.length} samples to ${OUT}`);
  console.log(`widest Telegram <pre> row by kind: ${JSON.stringify(widestByKind)}`);
  console.log(`subjects <= 78: ${report.every(r => r.subjectLen <= 78)}; preheaders <= 110: ${report.every(r => r.preheaderLen <= 110)}; max html bytes: ${Math.max(...report.map(r => r.htmlBytes))}`);

  if (!SHOTS) return 0;
  let chromium;
  try { ({ chromium } = await import('@playwright/test')); } catch (e) { console.error('screenshots need @playwright/test and a Chromium install (npx playwright install chromium)'); return 1; }
  const browser = await chromium.launch();
  let failures = 0;
  const rows = [];
  try {
    for (const r of report) {
      const html = (await import('node:fs')).readFileSync(join(OUT, `${r.base}.html`), 'utf8');
      for (const width of [600, 360, 320]) for (const scheme of ['light', 'dark']) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
        await ctx.route('**/*', route => route.abort());
        const page = await ctx.newPage();
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        const res = await page.evaluate(({ expectLink, preheader }) => {
          // The preheader is the hidden div whose text starts with the preheader itself (not any hidden div).
          const pre = [...document.querySelectorAll('div')].find(d => getComputedStyle(d).display === 'none' && d.textContent.startsWith(preheader.slice(0, 40)));
          return {
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            preheaderHidden: !!pre,
            unsub: !!document.querySelector('a[href^="https://stockstrendz.com/unsubscribe?t="]'),
            expectLink,
          };
        }, { expectLink: r.link, preheader: r.preheader });
        const problems = [];
        if (res.overflow > 0) problems.push(`overflow ${res.overflow}px`);
        if (!res.preheaderHidden) problems.push('preheader visible');
        if (r.link && !res.unsub) problems.push('unsubscribe link missing');
        if (!r.link && res.unsub) problems.push('unexpected unsubscribe link');
        if (problems.length) failures++;
        rows.push(`${r.base.padEnd(40)} ${String(width).padStart(3)} ${scheme.padEnd(5)} ${problems.length ? 'FAIL ' + problems.join(', ') : 'ok'}`);
        // PNGs only for a representative subset to keep the folder small: published, stopped, note, fallback, no-link.
        if (/^(published-long|stopped-long|note-long|fallback-no-facts)/.test(r.base)) await page.screenshot({ path: join(OUT, `${r.base}.${width}.${scheme}.png`), fullPage: true });
        await ctx.close();
      }
    }
  } finally { await browser.close(); }
  console.log(rows.filter(x => /FAIL/.test(x)).join('\n') || `screenshots: ${rows.length} renders (600/360/320 x light/dark) all ok`);
  return failures ? 1 : 0;
}

process.exit(await main());
