import { sql } from '@/lib/db';

// Admin data layer. Reads/writes neon_auth."user" directly (read for
// listing/search, write only for role) — everything else here is a table
// this app owns outright.

export interface AdminPlan {
  id: number;
  code: string;
  name: string;
  features: string[];
  is_active: boolean;
}

/**
 * All plans, retired ones included — admins still need to see (and edit) a
 * deactivated plan while any user remains on it. Customer-facing listings
 * filter on `is_active` instead (see app/upgrade/page.tsx).
 */
export async function listPlans(): Promise<AdminPlan[]> {
  const rows = await sql`
    SELECT id, code, name, features, is_active
    FROM public.nt_plans
    ORDER BY is_active DESC, sort_order, id
  `;
  return rows as unknown as AdminPlan[];
}

export async function updatePlanFeatures(planId: number, features: string[]): Promise<void> {
  await sql`UPDATE public.nt_plans SET features = ${JSON.stringify(features)}::jsonb WHERE id = ${planId}`;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string | null;
  email_verified: boolean;
  role: string | null;
  banned: boolean | null;
  created_at: string;
  plan_code: string | null;
  plan_expires_at: string | null;
  telegram_chat_id: string | null;
}

export async function listUsers(opts: { search?: string | null; limit?: number; offset?: number } = {}): Promise<{ users: AdminUserSummary[]; total: number }> {
  const { search = null, limit = 25, offset = 0 } = opts;
  const pattern = search ? `%${search}%` : null;

  const [users, totalRows] = await Promise.all([
    sql`
      SELECT u.id, u.email, u.name, u."emailVerified" AS email_verified, u.role, u.banned, u."createdAt" AS created_at,
             p.code AS plan_code, up.plan_expires_at, up.telegram_chat_id
      FROM neon_auth."user" u
      LEFT JOIN public.nt_app_user_profiles up ON up.user_id = u.id::text
      LEFT JOIN public.nt_plans p ON p.id = up.plan_id
      WHERE ${pattern}::text IS NULL OR u.email ILIKE ${pattern} OR u.name ILIKE ${pattern}
      ORDER BY u."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    sql`
      SELECT count(*) FROM neon_auth."user" u
      WHERE ${pattern}::text IS NULL OR u.email ILIKE ${pattern} OR u.name ILIKE ${pattern}
    `,
  ]);

  return { users: users as unknown as AdminUserSummary[], total: Number((totalRows[0] as { count: string }).count) };
}

export interface AdminUserDetail extends AdminUserSummary {
  plan_id: number | null;
  telegram_linked_at: string | null;
  overrides: Array<{ feature: string; granted: boolean }>;
}

export async function getUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const rows = await sql`
    SELECT u.id, u.email, u.name, u."emailVerified" AS email_verified, u.role, u.banned, u."createdAt" AS created_at,
           up.plan_id, p.code AS plan_code, up.plan_expires_at, up.telegram_chat_id, up.telegram_linked_at
    FROM neon_auth."user" u
    LEFT JOIN public.nt_app_user_profiles up ON up.user_id = u.id::text
    LEFT JOIN public.nt_plans p ON p.id = up.plan_id
    WHERE u.id = ${userId}
  `;
  const row = rows[0] as Omit<AdminUserDetail, 'overrides'> | undefined;
  if (!row) return null;

  const overrides = await sql`SELECT feature, granted FROM public.nt_user_feature_overrides WHERE user_id = ${userId} ORDER BY feature`;
  return { ...row, overrides: overrides as unknown as Array<{ feature: string; granted: boolean }> };
}

export async function updateUserPlan(userId: string, planId: number, planExpiresAt: string | null): Promise<void> {
  await sql`
    INSERT INTO public.nt_app_user_profiles (user_id, plan_id, plan_expires_at)
    VALUES (${userId}, ${planId}, ${planExpiresAt})
    ON CONFLICT (user_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, plan_expires_at = EXCLUDED.plan_expires_at, updated_at = now()
  `;
}

export async function setUserRole(userId: string, role: 'user' | 'admin'): Promise<void> {
  await sql`UPDATE neon_auth."user" SET role = ${role} WHERE id = ${userId}`;
}

export async function setFeatureOverride(userId: string, feature: string, granted: boolean, updatedBy: string): Promise<void> {
  await sql`
    INSERT INTO public.nt_user_feature_overrides (user_id, feature, granted, updated_by)
    VALUES (${userId}, ${feature}, ${granted}, ${updatedBy})
    ON CONFLICT (user_id, feature) DO UPDATE SET granted = EXCLUDED.granted, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
}

export async function removeFeatureOverride(userId: string, feature: string): Promise<void> {
  await sql`DELETE FROM public.nt_user_feature_overrides WHERE user_id = ${userId} AND feature = ${feature}`;
}

export interface TodaysLoginRow { userId: string; email: string; createdAt: string; ipAddress: string | null }

/** Backs the "Logins today" drill-down — straight from neon_auth.session. */
export async function getTodaysLogins(limit: number = 200): Promise<TodaysLoginRow[]> {
  const rows = await sql`
    SELECT s."userId"::text AS user_id, u.email, s."createdAt"::text AS created_at, s."ipAddress" AS ip_address
    FROM neon_auth."session" s
    JOIN neon_auth."user" u ON u.id = s."userId"
    WHERE s."createdAt" >= CURRENT_DATE
    ORDER BY s."createdAt" DESC
    LIMIT ${limit}
  `;
  return (rows as any[]).map(r => ({ userId: r.user_id, email: r.email, createdAt: r.created_at, ipAddress: r.ip_address }));
}

export interface RecentSignupRow { id: string; email: string; name: string | null; createdAt: string }

/** Backs the "Signups (7 days)" drill-down. */
export async function getRecentSignups(days: number = 7, limit: number = 200): Promise<RecentSignupRow[]> {
  const rows = await sql`
    SELECT id::text AS id, email, name, "createdAt"::text AS created_at
    FROM neon_auth."user"
    WHERE "createdAt" >= now() - (${days} || ' days')::interval
    ORDER BY "createdAt" DESC
    LIMIT ${limit}
  `;
  return (rows as any[]).map(r => ({ id: r.id, email: r.email, name: r.name, createdAt: r.created_at }));
}

export interface AllUserRow { id: string; email: string; createdAt: string }

/** Backs the "Total users" drill-down. */
export async function getAllUsers(limit: number = 500): Promise<AllUserRow[]> {
  const rows = await sql`
    SELECT id::text AS id, email, "createdAt"::text AS created_at
    FROM neon_auth."user"
    ORDER BY "createdAt" DESC
    LIMIT ${limit}
  `;
  return (rows as any[]).map(r => ({ id: r.id, email: r.email, createdAt: r.created_at }));
}

export interface TelegramLinkedRow { userId: string; email: string; telegramLinkedAt: string | null }

/** Backs the "Telegram linked" drill-down. */
export async function getTelegramLinkedUsers(limit: number = 500): Promise<TelegramLinkedRow[]> {
  const rows = await sql`
    SELECT up.user_id, u.email, up.telegram_linked_at::text AS telegram_linked_at
    FROM public.nt_app_user_profiles up
    JOIN neon_auth."user" u ON u.id::text = up.user_id
    WHERE up.telegram_chat_id IS NOT NULL
    ORDER BY up.telegram_linked_at DESC
    LIMIT ${limit}
  `;
  return (rows as any[]).map(r => ({ userId: r.user_id, email: r.email, telegramLinkedAt: r.telegram_linked_at }));
}

export interface PlanUserRow { userId: string; email: string; planExpiresAt: string | null }

/** Backs clicking a plan-distribution bar. */
export async function getUsersByPlan(planId: number, limit: number = 300): Promise<PlanUserRow[]> {
  const rows = await sql`
    SELECT up.user_id, u.email, up.plan_expires_at::text AS plan_expires_at
    FROM public.nt_app_user_profiles up
    JOIN neon_auth."user" u ON u.id::text = up.user_id
    WHERE up.plan_id = ${planId}
    ORDER BY u."createdAt" DESC
    LIMIT ${limit}
  `;
  return (rows as any[]).map(r => ({ userId: r.user_id, email: r.email, planExpiresAt: r.plan_expires_at }));
}

export interface AdminStats {
  totalUsers: number;
  planDistribution: Array<{ code: string; name: string; count: number }>;
  telegramLinkedCount: number;
  signupsLast7Days: number;
  loginsToday: number;
}

export async function getDashboardStats(): Promise<AdminStats> {
  const [totalUsersRows, planDistRows, telegramRows, signupsRows, loginsTodayRows] = await Promise.all([
    sql`SELECT count(*) FROM neon_auth."user"`,
    sql`
      SELECT p.code, p.name, count(up.user_id) AS count
      FROM public.nt_plans p
      LEFT JOIN public.nt_app_user_profiles up ON up.plan_id = p.id
      GROUP BY p.id, p.code, p.name
      ORDER BY p.id
    `,
    sql`SELECT count(*) FROM public.nt_app_user_profiles WHERE telegram_chat_id IS NOT NULL`,
    sql`SELECT count(*) FROM neon_auth."user" WHERE "createdAt" >= now() - interval '7 days'`,
    sql`SELECT count(*) FROM neon_auth."session" WHERE "createdAt" >= CURRENT_DATE`,
  ]);

  return {
    totalUsers: Number((totalUsersRows[0] as { count: string }).count),
    planDistribution: (planDistRows as unknown as Array<{ code: string; name: string; count: string }>)
      .map(r => ({ code: r.code, name: r.name, count: Number(r.count) })),
    telegramLinkedCount: Number((telegramRows[0] as { count: string }).count),
    signupsLast7Days: Number((signupsRows[0] as { count: string }).count),
    loginsToday: Number((loginsTodayRows[0] as { count: string }).count),
  };
}
