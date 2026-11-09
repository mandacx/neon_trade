import { redirect } from 'next/navigation';
import IdeasFrame from '@/components/ideas/IdeasFrame';
import { getCurrentUserContext } from '@/lib/appUsers';
import { FEATURE_IDEAS_SHORT_TERM } from '@/lib/features';
import { ideaAccess } from '@/lib/ideas';

export const dynamic = 'force-dynamic';

/** Trade Ideas needs at least one idea term on the plan (short or long), or the publisher entitlement. */
export default async function IdeasLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn) redirect('/login');
  const access = ideaAccess(ctx);
  if (access.terms.length === 0) redirect(`/upgrade?feature=${FEATURE_IDEAS_SHORT_TERM}`);
  return <IdeasFrame canPublish={access.canPublish}>{children}</IdeasFrame>;
}
