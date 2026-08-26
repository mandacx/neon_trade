import { NextResponse } from 'next/server';
import { getCurrentUserContext } from '@/lib/appUsers';
import { startFreeTrial } from '@/lib/trial';

// Self-serve 1-month Pro trial — any logged-in Free-plan user, not
// feature-gated (there'd be nothing to gate: this route is what GRANTS
// features). See lib/trial.ts for the plan-reuse/abuse-guard rationale.
export async function POST() {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn || !ctx.userId) {
    return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 });
  }

  const result = await startFreeTrial(ctx.userId, ctx.planCode);
  if (!result.ok) {
    const message = result.error === 'already_used'
      ? 'You have already used your free trial.'
      : 'Trials are only available on the Free plan.';
    return NextResponse.json({ success: false, error: message }, { status: 409 });
  }

  return NextResponse.json({ success: true });
}
