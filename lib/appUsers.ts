import { sql } from '@/lib/db';
import { auth } from '@/lib/auth/server';

export interface CurrentUserContext {
  loggedIn: boolean;
  userId: string | null;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
  isAdmin: boolean;
  planCode: string;
  features: string[];
  planExpiresAt: string | null;
  telegramLinked: boolean;
  /** True if this user has a credential (email+password) account linked — false for Google-only signups, who have nothing to change a password on. */
  hasPassword: boolean;
}

const FALLBACK_PLAN_CODE = 'FREE';

/**
 * Neon Auth's session-data cache cookie (~5 min TTL) expires between
 * requests, and refreshing it means writing a cookie — which Next.js only
 * allows from a Server Action or Route Handler. This function is called from
 * plain Server Components (every layout/page, via the root layout), so once
 * the cache goes stale a hard refresh throws "Cookies can only be modified in
 * a Server Action or Route Handler" instead of returning session data. Treat
 * that specific error as a cache-refresh miss rather than a crash — the
 * cookie gets refreshed next time any Route Handler runs (any /api/* call),
 * so this self-heals within a request or two.
 */
async function withCookieWriteFallback<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cookies can only be modified')) {
      console.warn('[appUsers] Neon Auth session refresh skipped (not in a Server Action/Route Handler):', error.message);
      return fallback;
    }
    throw error;
  }
}

async function freePlanContext(): Promise<Pick<CurrentUserContext, 'planCode' | 'features'>> {
  const rows = await sql`SELECT code, features FROM public.nt_plans WHERE code = ${FALLBACK_PLAN_CODE}`;
  const row = rows[0] as { code: string; features: string[] } | undefined;
  return { planCode: row?.code ?? FALLBACK_PLAN_CODE, features: row?.features ?? [] };
}

/**
 * Applies per-user overrides on top of a plan's feature list: granted=true
 * adds the feature even if the plan lacks it, granted=false removes it even
 * if the plan has it (lib/admin.ts is what writes these rows).
 */
function applyOverrides(planFeatures: string[], overrides: Array<{ feature: string; granted: boolean }>): string[] {
  const set = new Set(planFeatures);
  for (const o of overrides) {
    if (o.granted) set.add(o.feature);
    else set.delete(o.feature);
  }
  return Array.from(set);
}

/**
 * Resolves identity (Neon Auth) + plan/feature entitlement (our own
 * nt_app_user_profiles/nt_plans/nt_user_feature_overrides tables — `nt_`
 * prefixed because this Neon database is shared with the sister neon_nifty
 * app, which owns unprefixed tables of the same names) for the current
 * request. Call only from Server Components / Route Handlers —
 * auth.getSession() reads cookies via Next.js's request-scoped context, and
 * this hits the DB (a few small indexed queries), so it's not meant for
 * every Edge middleware invocation (middleware.ts does the login-required
 * check itself; feature/admin checks happen at the page/route level via
 * this).
 *
 * isAdmin reads `neon_auth."user".role` directly rather than trusting the
 * session payload's `user` shape — the base getSession()/signIn.email()
 * responses don't reliably echo the admin plugin's role/banned fields, so
 * this is the more reliable source.
 *
 * Known limitation: Neon Auth caches session+user data in a signed cookie
 * for ~5 minutes, so a name change may not be reflected here immediately —
 * accepted as a minor, cosmetic, bounded staleness.
 */
export async function getCurrentUserContext(): Promise<CurrentUserContext> {
  const { data } = await withCookieWriteFallback(() => auth.getSession(), { data: null, error: null });
  if (!data?.user) {
    const { planCode, features } = await freePlanContext();
    return {
      loggedIn: false, userId: null, email: null, name: null, emailVerified: false, isAdmin: false,
      planCode, features, planExpiresAt: null, telegramLinked: false, hasPassword: false,
    };
  }

  const { user } = data;

  type ProfileRow = { plan_expires_at: string | null; telegram_chat_id: string | null; plan_code: string; features: string[] };
  const selectProfile = () => sql`
    SELECT u.plan_expires_at, u.telegram_chat_id, p.code AS plan_code, p.features
    FROM public.nt_app_user_profiles u
    JOIN public.nt_plans p ON p.id = u.plan_id
    WHERE u.user_id = ${user.id}
  ` as unknown as Promise<ProfileRow[]>;

  const [profileRows, overrideRows, roleRows, accountsResult] = await Promise.all([
    selectProfile(),
    sql`SELECT feature, granted FROM public.nt_user_feature_overrides WHERE user_id = ${user.id}`,
    sql`SELECT role FROM neon_auth."user" WHERE id = ${user.id}`,
    withCookieWriteFallback(() => auth.listAccounts(), { data: [], error: null }),
  ]);
  const hasPassword = (accountsResult.data ?? []).some(a => a.providerId === 'credential');

  let profile = profileRows[0];
  if (!profile) {
    // First time we've seen this authenticated user — bootstrap onto Free.
    await sql`
      INSERT INTO public.nt_app_user_profiles (user_id, plan_id)
      SELECT ${user.id}, id FROM public.nt_plans WHERE code = ${FALLBACK_PLAN_CODE}
      ON CONFLICT (user_id) DO NOTHING
    `;
    profile = (await selectProfile())[0];
  }

  const expired = profile?.plan_expires_at ? new Date(profile.plan_expires_at).getTime() < Date.now() : false;
  const { planCode, features: planFeatures } = expired ? await freePlanContext() : { planCode: profile?.plan_code ?? FALLBACK_PLAN_CODE, features: profile?.features ?? [] };
  const features = applyOverrides(planFeatures, overrideRows as Array<{ feature: string; granted: boolean }>);
  const isAdmin = (roleRows[0] as { role: string | null } | undefined)?.role === 'admin';

  return {
    loggedIn: true,
    userId: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    isAdmin,
    planCode,
    features,
    planExpiresAt: profile?.plan_expires_at ?? null,
    telegramLinked: !!profile?.telegram_chat_id,
    hasPassword,
  };
}
