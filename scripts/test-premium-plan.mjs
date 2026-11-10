// node scripts/test-premium-plan.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PREMIUM_PLAN as P } from './premium-plan-def.mjs';
import { ALL_FEATURES, planLabel, hasFeature } from '../lib/features.ts';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.equal(a, b, m); n++; };
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

eq(P.code, 'PREMIUM'); eq(P.name, 'Premium'); eq(P.sort, 60);
ok(P.sort > 50, 'after PLATINUM');
ok(![0, 10, 15, 20, 30, 40, 50].includes(P.sort), 'unique sort');

ok(P.features.includes('ideas_short_term') && P.features.includes('ideas_long_term'), 'both terms');
for (const c of ['publish_ideas', 'quarterly_expiry_only', 'standard_expiry_only']) ok(!P.features.includes(c), 'no ' + c);
eq(new Set(P.features).size, P.features.length, 'no duplicates');
const known = new Set(ALL_FEATURES.map(f => f.code));
for (const f of P.features) ok(known.has(f), 'known feature ' + f);
ok(P.features.includes('telegram_alerts'), 'telegram');
for (const c of ['oi_tracker', 'option_chain', 'strategy_builder']) ok(!P.features.includes(c), 'no ' + c);

eq(planLabel('PREMIUM'), 'Premium');
eq(planLabel('PLATINUM'), 'Platinum'); eq(planLabel('SHORT_TERM'), 'Short term'); eq(planLabel('LONG_TERM'), 'Long term');
eq(planLabel('EXPERT'), 'Pro Plus'); eq(planLabel('LONG_INVESTORS'), 'Self learners');

ok(/PREMIUM:\s*\{/.test(read('components/layout/Header.tsx')), 'Header PLAN_TAGS');
ok(/'PREMIUM'/.test(read('lib/ideas.ts')), 'ideas tier');
const s = read('scripts/add-premium-plan.mjs');
ok(s.includes('ON CONFLICT (code) DO NOTHING'), 'conflict clause');
ok(!/\b(UPDATE|DELETE)\b/i.test(s.replace(/^\/\/.*$/gm, '')), 'no update/delete');

ok(read('docs/CHANGES.md').startsWith('# Change log and design notes'), 'CHANGES.md title intact (QA guard)');
ok(hasFeature(P.features, 'ideas_short_term') && hasFeature(P.features, 'ideas_long_term'), 'gate sim');
console.log(`premium plan: ${n} checks passed`);
