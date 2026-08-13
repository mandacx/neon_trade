import { requireFeaturePage } from '@/lib/routeGuards';
import { FEATURE_PERFORMANCE } from '@/lib/features';

export const dynamic = 'force-dynamic';

export default async function PerformanceLayout({ children }: { children: React.ReactNode }) {
  await requireFeaturePage(FEATURE_PERFORMANCE);
  return <>{children}</>;
}
