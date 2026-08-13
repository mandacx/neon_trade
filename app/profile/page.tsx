import Link from 'next/link';
import { redirect } from 'next/navigation';
import Header from '@/components/layout/Header';
import SignOutButton from '@/components/auth/SignOutButton';
import AccountEditor from '@/components/profile/AccountEditor';
import { getCurrentUserContext } from '@/lib/appUsers';
import { ALL_FEATURES, FEATURE_TELEGRAM_ALERTS } from '@/lib/features';

// getCurrentUserContext() reads cookies, so this page can't be statically rendered.
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const ctx = await getCurrentUserContext();
  if (!ctx.loggedIn) redirect('/login');

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-lg font-bold text-gray-900">Profile</h1>
            <SignOutButton />
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-5">
              <AccountEditor name={ctx.name ?? ''} email={ctx.email ?? ''} emailVerified={ctx.emailVerified} hasPassword={ctx.hasPassword} />

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <div className="flex items-start gap-3">
                  <span className="text-lg">🔒</span>
                  <div>
                    <h3 className="text-xs font-semibold text-gray-700">Active session</h3>
                    <p className="text-[11px] text-gray-500 mt-1">
                      Only one session stays signed in at a time. Logging in elsewhere makes this
                      session's access token stop refreshing — you'll just be asked to log in again here.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-sm font-semibold text-gray-700">Your plan</h2>
                  <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{ctx.planCode}</span>
                </div>
                {ctx.planExpiresAt && (
                  <p className="text-[11px] text-gray-400 mb-2">Renews/expires {new Date(ctx.planExpiresAt).toLocaleDateString()}</p>
                )}
                <ul className="text-xs space-y-1 mt-2">
                  {ALL_FEATURES.map(f => {
                    const on = ctx.features.includes(f.code);
                    return (
                      <li key={f.code} className="flex items-center gap-2">
                        <span className={on ? 'text-green-600' : 'text-gray-300'}>{on ? '✓' : '–'}</span>
                        <span className={on ? 'text-gray-700' : 'text-gray-400'}>{f.label}</span>
                      </li>
                    );
                  })}
                </ul>
                <Link href="/upgrade" className="inline-block mt-3 text-xs font-semibold text-blue-600">View plans →</Link>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-1">📨 Telegram alerts</h3>
                <p className="text-xs text-gray-500 mb-3">Get scan alerts pushed straight to Telegram for any watchlist, the moment they fire. Coming soon.</p>
                <Link
                  href={`/upgrade?feature=${FEATURE_TELEGRAM_ALERTS}`}
                  className="inline-block px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                >
                  View plans
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
