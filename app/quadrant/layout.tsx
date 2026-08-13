import { requireFeaturePage } from '@/lib/routeGuards';
import { FEATURE_QUADRANT } from '@/lib/features';

export const dynamic = 'force-dynamic';

export default async function QuadrantLayout({ children }: { children: React.ReactNode }) {
  await requireFeaturePage(FEATURE_QUADRANT);
  return <>{children}</>;
}
