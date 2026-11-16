import { redirect } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { getCurrentUserContext } from '@/lib/appUsers';
import { countPendingRequests } from '@/lib/levelRequests';

// getCurrentUserContext() reads cookies, so this can't be statically rendered.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn) redirect('/login');
  if (!ctx.isAdmin) redirect('/');
  const pending = await countPendingRequests();

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
              <Link href="/admin/level-symbols" className="px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-600 hover:bg-gray-100">
                Level symbols
                {pending > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold" aria-label={`${pending} pending requests`}>{pending}</span>
                )}
              </Link>
              <Link href="/admin/settings" className="px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-600 hover:bg-gray-100">Settings</Link>
            </nav>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}
