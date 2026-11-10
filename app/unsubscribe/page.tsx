import type { Metadata } from 'next';
import Link from 'next/link';
import UnsubscribeView from '@/components/email/UnsubscribeView';
import type { ViewState } from '@/components/email/unsubscribeCopy';
import { verifyUnsubToken } from '@/lib/ideaUnsubscribe';
import { resultState } from '@/lib/unsubscribeRequest';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Unsubscribe from Trade Ideas emails - StocksTrendz',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * Public confirm page for the unsubscribe link in Trade Ideas emails. The GET only checks the signature (CPU, no DB, no
 * write); the change happens on POST. `?s=` is the result of a no-JS form post (no token in that URL).
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const s = resultState(one(sp.s));
  const t = one(sp.t) ?? null;
  let initial: ViewState;
  let token: string | null = null;
  if (s) initial = s;
  else if (verifyUnsubToken(t)) { initial = 'confirm'; token = t; }
  else initial = 'invalid';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center px-4 pt-8 sm:pt-16 pb-8">
      <Link href="/" prefetch={false} className="text-lg font-bold text-blue-600 mb-4">StocksTrendz</Link>
      <UnsubscribeView key={initial} initial={initial} token={token} />
      <p className="mt-6 text-xs text-gray-600 text-center">
        <Link href="/contact" prefetch={false} className="underline">Contact</Link> &middot; <Link href="/terms" prefetch={false} className="underline">Terms</Link> &middot; <Link href="/privacy" prefetch={false} className="underline">Privacy</Link>
      </p>
    </div>
  );
}
