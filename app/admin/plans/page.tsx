import { listPlans } from '@/lib/admin';
import { ALL_FEATURES } from '@/lib/features';
import PlansEditor from '@/components/admin/PlansEditor';

export const dynamic = 'force-dynamic';

export default async function AdminPlansPage() {
  const plans = await listPlans();
  return <PlansEditor plans={plans} allFeatures={ALL_FEATURES} />;
}
