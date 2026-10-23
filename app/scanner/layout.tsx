import { requireFeaturePage } from '@/lib/routeGuards';
import { FEATURE_US_MARKET_SCANNER } from '@/lib/features';

export const dynamic = 'force-dynamic';

export default async function ScannerLayout({ children }: { children: React.ReactNode }) {
  await requireFeaturePage(FEATURE_US_MARKET_SCANNER);
  return <>{children}</>;
}
