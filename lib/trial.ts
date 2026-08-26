import { sql } from '@/lib/db';

export interface StartTrialResult {
  ok: boolean;
  error?: 'already_used' | 'not_free_plan';
}

/**
 * Self-serve 1-month Pro trial. Reuses the existing PRO plan row (no
 * separate "TRIAL" plan/code) — a user is considered "on trial" purely by
 * `trial_started_at` being set while their plan is PRO and unexpired (see
 * `isTrialing` in lib/appUsers.ts). `trial_started_at` is never cleared, so
 * it also serves as the permanent "already used their trial" flag.
 */
export async function startFreeTrial(userId: string, currentPlanCode: string): Promise<StartTrialResult> {
  if (currentPlanCode !== 'FREE') {
    // No resetting/extending an existing paid or admin-granted Pro period.
    return { ok: false, error: 'not_free_plan' };
  }

  // Single atomic UPDATE guarded in the WHERE clause — a double-click or
  // retry can't grant a second trial, no separate read-then-write race.
  const rows = await sql`
    UPDATE public.nt_app_user_profiles
    SET plan_id = (SELECT id FROM public.nt_plans WHERE code = 'PRO'),
        plan_expires_at = now() + interval '30 days',
        trial_started_at = now(),
        updated_at = now()
    WHERE user_id = ${userId} AND trial_started_at IS NULL
    RETURNING user_id
  `;

  if (rows.length === 0) {
    return { ok: false, error: 'already_used' };
  }
  return { ok: true };
}
