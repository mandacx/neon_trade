'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (path: string) => pathname === path;

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="container mx-auto px-4">
        <div className="flex items-center h-14 gap-6">
          {/* Logo */}
          <Link href="/" className="flex items-center shrink-0">
            <Image src="/logo.svg" alt="Neon Trade" width={140} height={34} priority />
          </Link>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-6 flex-1">
            <Link href="/" className={`text-sm font-medium transition-colors ${isActive('/') ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'}`}>
              Home
            </Link>
            <Link href="/quadrant" className={`text-sm font-medium transition-colors ${isActive('/quadrant') ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'}`}>
              Quadrant Analysis
            </Link>
            <Link href="/stock/AAPL" className={`text-sm font-medium transition-colors ${pathname?.startsWith('/stock') ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'}`}>
              Stock Charts
            </Link>
          </nav>

          {/* Action buttons — top right */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <button
              onClick={() => router.push('/quadrant')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors"
            >
              📊 Quadrant Analysis
            </button>
            <button
              onClick={() => router.push('/stock/SPY')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors"
            >
              📈 Stock Analysis
            </button>
          </div>

          {/* Mobile menu */}
          <button className="md:hidden ml-auto p-2 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
