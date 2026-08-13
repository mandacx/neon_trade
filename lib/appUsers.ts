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

async function freePlanContext(): Promise<Pick<CurrentUserContext, 'planCode' | 'features'>> {
  const rows = await sql`SELECT code, features FROM public.plans WHERE code = ${FALLBACK_PLAN_CODE}`;
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
 * app_user_profiles/plans/user_feature_overrides tables) for the current
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
  const { data } = await auth.getSession();
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
    FROM public.app_user_profiles u
    JOIN public.plans p ON p.id = u.plan_id
    WHERE u.user_id = ${user.id}
  ` as unknown as Promise<ProfileRow[]>;

  const [profileRows, overrideRows, roleRows, accountsResult] = await Promise.all([
    selectProfile(),
    sql`SELECT feature, granted FROM public.user_feature_overrides WHERE user_id = ${user.id}`,
    sql`SELECT role FROM neon_auth."user" WHERE id = ${user.id}`,
    auth.listAccounts(),
  ]);
  const hasPassword = (accountsResult.data ?? []).some(a => a.providerId === 'credential');

  let profile = profileRows[0];
  if (!profile) {
    // First time we've seen this authenticated user — bootstrap onto Free.
    await sql`
      INSERT INTO public.app_user_profiles (user_id, plan_id)
      SELECT ${user.id}, id FROM public.plans WHERE code = ${FALLBACK_PLAN_CODE}
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
