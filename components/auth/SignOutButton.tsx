'use client';

import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';

export default function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => { await authClient.signOut(); router.push('/login'); router.refresh(); }}
      className="px-3 py-1.5 text-xs font-medium text-red-600 border border-gray-200 rounded-lg hover:bg-red-50"
    >
      Sign out
    </button>
  );
}
