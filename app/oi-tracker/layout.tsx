import { requireFeaturePage } from '@/lib/routeGuards';
import { FEATURE_OI_TRACKER } from '@/lib/features';

export const dynamic = 'force-dynamic';

export default async function OiTrackerLayout({ children }: { children: React.ReactNode }) {
  await requireFeaturePage(FEATURE_OI_TRACKER);
  return <>{children}</>;
}
