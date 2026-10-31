// Grant the Crypto Price Levels feature (`crypto_levels`, lib/features.ts) to plans.
// Insert-only: appends the code to nt_plans.features where it is missing and never removes or
// reorders anything, so it is safe to re-run.
//
//   node --env-file=.env.local scripts/add-crypto-levels-feature.mjs [--dry-run] [--plans=PRO,EXPERT]
//
// Admins can also tick/untick it per plan at /admin/plans instead (same effect).

import { neon } from '@neondatabase/serverless';

const CODE = 'crypto_levels';
const plansArg = process.argv.find(a => a.startsWith('--plans='));
const PLAN_CODES = plansArg ? plansArg.slice(8).split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : ['PRO', 'EXPERT'];
const DRY = process.argv.includes('--dry-run');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — run with --env-file=.env.local');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const before = await sql`SELECT code, features ? ${CODE} AS has FROM public.nt_plans WHERE code = ANY(${PLAN_CODES}) ORDER BY code`;
console.log('before:', before.map(r => `${r.code}=${r.has}`).join(', ') || 'no matching plans');
if (DRY) {
  console.log(`[dry-run] would add "${CODE}" to: ${before.filter(r => !r.has).map(r => r.code).join(', ') || 'none'}`);
  process.exit(0);
}
const changed = await sql`
  UPDATE public.nt_plans SET features = features || ${JSON.stringify([CODE])}::jsonb
  WHERE code = ANY(${PLAN_CODES}) AND NOT (features ? ${CODE})
  RETURNING code
`;
console.log(`added "${CODE}" to: ${changed.map(r => r.code).join(', ') || 'none (already present)'}`);
