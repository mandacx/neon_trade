import { requireFeaturePage } from '@/lib/routeGuards';
import { FEATURE_EARNINGS } from '@/lib/features';

export const dynamic = 'force-dynamic';

export default async function EarningsLayout({ children }: { children: React.ReactNode }) {
  await requireFeaturePage(FEATURE_EARNINGS);
  return <>{children}</>;
}
