import { requireFeaturePage } from '@/lib/routeGuards';
import { FEATURE_SCAN_ALERTS_LATEST } from '@/lib/features';

export const dynamic = 'force-dynamic';

export default async function ScanAlertsLatestLayout({ children }: { children: React.ReactNode }) {
  await requireFeaturePage(FEATURE_SCAN_ALERTS_LATEST);
  return <>{children}</>;
}
