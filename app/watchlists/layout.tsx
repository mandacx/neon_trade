import { requireFeaturePage } from '@/lib/routeGuards';
import { FEATURE_WATCHLISTS } from '@/lib/features';

export const dynamic = 'force-dynamic';

export default async function WatchlistsLayout({ children }: { children: React.ReactNode }) {
  await requireFeaturePage(FEATURE_WATCHLISTS);
  return <>{children}</>;
}
