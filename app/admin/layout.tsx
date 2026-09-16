import { redirect } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { getCurrentUserContext } from '@/lib/appUsers';

// getCurrentUserContext() reads cookies, so this can't be statically rendered.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn) redirect('/login');
  if (!ctx.isAdmin) redirect('/');

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-4 mb-6">
            <h1 className="text-lg font-bold text-gray-900">Admin</h1>
            <nav className="flex gap-1">
              <Link href="/admin" className="px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-600 hover:bg-gray-100">Dashboard</Link>
              <Link href="/admin/plans" className="px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-600 hover:bg-gray-100">Plans</Link>
              <Link href="/admin/users" className="px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-600 hover:bg-gray-100">Users</Link>
            </nav>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}
