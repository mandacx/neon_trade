import { requireFeaturePage } from '@/lib/routeGuards';
import { FEATURE_SCAN_ALERTS_HISTORY } from '@/lib/features';

export const dynamic = 'force-dynamic';

// Scoped to just /scan-alerts/historical since it and the sibling
// /scan-alerts/latest gate on different features (see
// app/scan-alerts/latest/layout.tsx).
export default async function ScanAlertsHistoricalLayout({ children }: { children: React.ReactNode }) {
  await requireFeaturePage(FEATURE_SCAN_ALERTS_HISTORY);
  return <>{children}</>;
}
