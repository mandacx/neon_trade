import { NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import {
  getDashboardStats, getTodaysLogins, getUsersByPlan, listPlans,
  getRecentSignups, getTelegramLinkedUsers, getAllUsers,
} from '@/lib/admin';
import { getActivitySummary, getBehaviorStats } from '@/lib/activity';
import { getHeavyApiUsers } from '@/lib/apiUsage';

// Bundles everything the dashboard's tiles AND their drill-downs need into one
// response — same call, same fetch, no per-click round-trip. Every list here
// is capped (see each lib function) so this stays a bounded, cheap admin-only
// read regardless of traffic growth.
export async function GET() {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.isAdmin) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const [stats, todaysLogins, recentSignups, telegramLinked, allUsers, plans, activity, heavyUsers, behavior] =
    await Promise.all([
      getDashboardStats(),
      getTodaysLogins(),
      getRecentSignups(7),
      getTelegramLinkedUsers(),
      getAllUsers(),
      listPlans(),
      getActivitySummary(),
      getHeavyApiUsers(20),
      getBehaviorStats(14),
    ]);

  // Per-plan user lists for the plan-distribution bars — fetched only for
  // plans that actually have members, to avoid empty queries.
  const codeToId = new Map(plans.map(p => [p.code, p.id]));
  const plansWithUsers = stats.planDistribution.filter(p => p.count > 0);
  const usersByPlanEntries = await Promise.all(
    plansWithUsers.map(async (p) => {
      const planId = codeToId.get(p.code);
      return [p.code, planId ? await getUsersByPlan(planId) : []] as const;
    })
  );

  return NextResponse.json({
    success: true,
    data: {
      stats,
      todaysLogins,
      recentSignups,
      telegramLinked,
      allUsers,
      activity,
      heavyUsers,
      behavior,
      usersByPlan: Object.fromEntries(usersByPlanEntries),
    },
  });
}
