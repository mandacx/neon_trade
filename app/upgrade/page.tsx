import Header from '@/components/layout/Header';
import { sql } from '@/lib/db';
import { getCurrentUserContext } from '@/lib/appUsers';
import { ALL_FEATURES } from '@/lib/features';
import { LEVEL_DELAY_DAYS } from '@/lib/levelAccess';

export const dynamic = 'force-dynamic';

interface PlanRow { id: number; code: string; name: string; features: string[] }

export default async function UpgradePage({ searchParams }: { searchParams: Promise<{ feature?: string }> }) {
  const [{ feature }, plans, ctx] = await Promise.all([
    searchParams,
    // Only active plans — retired ones stay in the table for historical
    // plan_id references but must not be offered.
    sql`SELECT id, code, name, features FROM public.nt_plans WHERE is_active ORDER BY sort_order, id` as unknown as Promise<PlanRow[]>,
    getCurrentUserContext(),
  ]);

  const featureLabel = feature ? ALL_FEATURES.find(f => f.code === feature)?.label ?? feature : null;

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-10">
          <div className="text-center mb-8">
            <h1 className="text-xl font-bold text-gray-900">Plans</h1>
            {featureLabel ? (
              <p className="text-sm text-gray-500 mt-1">
                <span className="font-semibold text-gray-700">{featureLabel}</span> isn&apos;t included in your current plan.
              </p>
            ) : (
              <p className="text-sm text-gray-500 mt-1">Plan assignment is manual for now — reach out and we&apos;ll switch you over.</p>
            )}
            <p className="text-xs text-gray-400 mt-2 max-w-xl mx-auto">
              Charts, candles and live quotes are free on every plan — Pro unlocks <strong>live price levels</strong>,
              scan alerts, quadrant screening, watchlists and performance tracking. On Free, levels run {LEVEL_DELAY_DAYS} days behind.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {plans.map(plan => {
              const isCurrent = plan.code === ctx.planCode;
              return (
                <div key={plan.id} className={`relative bg-white rounded-xl border p-5 ${isCurrent ? 'border-blue-400 shadow-md' : 'border-gray-200'}`}>
                  {isCurrent && (
                    <span className="absolute -top-2.5 left-5 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-900 text-white">
                      Current plan
                    </span>
                  )}
                  <h2 className="text-base font-bold text-gray-900">{plan.name}</h2>

                  <ul className="mt-3 space-y-1 text-xs">
                    {ALL_FEATURES.map(f => {
                      const on = plan.features.includes(f.code);
                      return (
                        <li key={f.code} className="flex items-start gap-2">
                          <span className={on ? 'text-green-600' : 'text-gray-300'}>{on ? '✓' : '–'}</span>
                          <span className={on ? 'text-gray-700' : 'text-gray-400'}>{f.label}</span>
                        </li>
                      );
                    })}
                  </ul>

                  {!isCurrent && (
                    <a
                      href={`mailto:support@neontrade.app?subject=${encodeURIComponent(`Plan upgrade request: ${plan.name}`)}&body=${encodeURIComponent(
                        `Hi,\n\nI'd like to upgrade to the ${plan.name} plan.\n\nAccount email: ${ctx.email ?? '(not logged in — please reply to confirm)'}\nCurrent plan: ${ctx.planCode}\n`
                      )}`}
                      className="mt-4 block text-center py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                    >
                      Contact us to upgrade
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
