'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import StockSearch from '@/components/ui/StockSearch';

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (path: string) => pathname === path;

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="container mx-auto px-4">
        <div className="flex items-center h-14 gap-4">
          {/* Logo — links home */}
          <Link href="/" className="flex items-center shrink-0">
            <Image src="/logo.svg" alt="Neon Trade" width={140} height={34} priority />
          </Link>

          {/* Action buttons */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <button
              onClick={() => router.push('/quadrant')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                isActive('/quadrant') ? 'bg-blue-700 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              📊 Quadrant Analysis
            </button>
            <button
              onClick={() => router.push('/stock/SPY')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                pathname?.startsWith('/stock') ? 'bg-green-700 text-white' : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              📈 Stock Analysis
            </button>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Search — top right */}
          <div className="hidden md:block shrink-0 w-56">
            <StockSearch compact />
          </div>

          {/* Mobile menu */}
          <button
            className="md:hidden p-2 rounded-lg hover:bg-gray-100"
            onClick={() => {
              const menu = document.getElementById('mobile-menu');
              if (menu) menu.classList.toggle('hidden');
            }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        {/* Mobile dropdown */}
        <div id="mobile-menu" className="hidden md:hidden border-t border-gray-100 py-3 space-y-1">
          <Link href="/" className="block px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg">
            🏠 Home
          </Link>
          <button
            onClick={() => router.push('/quadrant')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 rounded-lg"
          >
            📊 Quadrant Analysis
          </button>
          <button
            onClick={() => router.push('/stock/SPY')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-50 rounded-lg"
          >
            📈 Stock Analysis
          </button>
          <div className="px-3 pt-1">
            <StockSearch compact />
          </div>
        </div>
      </div>
    </header>
  );
}
