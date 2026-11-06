// Create the "Long investors" plan (code LONG_INVESTORS). It has the same features as the live PRO
// plan plus `quarterly_expiry_only` (lib/features.ts: only quarterly + January expiries, no weeklies
// or other monthlies). Insert-only: never touches an existing LONG_INVESTORS row, so it is safe to
// re-run. Users are moved onto it afterwards from /admin/users.
//
//   node --env-file=.env.local scripts/add-long-investors-plan.mjs [--dry-run]
//
// The plan is created inactive (is_active = false) so it does not show on the public /upgrade page;
// admins still see it in /admin/plans and can assign it. Flip is_active in the DB to list it.

import { neon } from '@neondatabase/serverless';

const CODE = 'LONG_INVESTORS';
const NAME = 'Long investors';
const SORT_ORDER = 15; // between Pro (10) and Pro Plus (20)
const RESTRICTION = 'quarterly_expiry_only';
// A user on a stricter plan should not also carry the looser restriction.
const DROP = ['standard_expiry_only'];
const DRY = process.argv.includes('--dry-run');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const plans = await sql`SELECT id, code, name, features, sort_order, is_active FROM public.nt_plans ORDER BY sort_order, id`;
for (const p of plans) console.log(`  ${p.code} (${p.name}) active=${p.is_active} order=${p.sort_order}: ${p.features.join(', ')}`);

const pro = plans.find(p => p.code === 'PRO');
if (!pro) {
  console.error('No PRO plan found to copy features from.');
  process.exit(1);
}
const features = [...new Set([...pro.features.filter(f => !DROP.includes(f)), RESTRICTION])];
console.log(`\n${CODE} would get: ${features.join(', ')}`);

if (plans.some(p => p.code === CODE)) {
  console.log(`${CODE} already exists — left unchanged.`);
  process.exit(0);
}
if (DRY) {
  console.log('[dry-run] nothing written');
  process.exit(0);
}
const rows = await sql`
  INSERT INTO public.nt_plans (code, name, features, sort_order, is_active)
  VALUES (${CODE}, ${NAME}, ${JSON.stringify(features)}::jsonb, ${SORT_ORDER}, false)
  ON CONFLICT (code) DO NOTHING
  RETURNING id, code, name, features, is_active
`;
console.log('created:', rows[0] ?? 'nothing (already existed)');
