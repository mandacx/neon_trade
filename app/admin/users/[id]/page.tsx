import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getUserDetail, listPlans } from '@/lib/admin';
import { getCurrentUserContext } from '@/lib/appUsers';
import { ALL_FEATURES } from '@/lib/features';
import UserDetailEditor from '@/components/admin/UserDetailEditor';

export const dynamic = 'force-dynamic';

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, plans, ctx] = await Promise.all([getUserDetail(id), listPlans(), getCurrentUserContext()]);
  if (!user) notFound();

  return (
    <div className="space-y-3">
      <Link href="/admin/users" className="text-xs text-blue-600 font-semibold">← Back to users</Link>
      <h2 className="text-base font-bold text-gray-900">{user.email}</h2>
      <UserDetailEditor user={user} plans={plans} allFeatures={ALL_FEATURES} currentAdminId={ctx.userId} />
    </div>
  );
}
