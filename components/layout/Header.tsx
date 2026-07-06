'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import StockSearch from '@/components/ui/StockSearch';

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [scanMenuOpen, setScanMenuOpen] = useState(false);
  const scanMenuRef = useRef<HTMLDivElement>(null);

  const isActive = (path: string) => pathname === path;
  const isScanAlertsPath = pathname?.startsWith('/scan-alerts');

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (scanMenuRef.current && !scanMenuRef.current.contains(e.target as Node)) {
        setScanMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="container mx-auto px-4">
        <div className="flex items-center h-14 gap-4">
          {/* Logo — links home */}
          <Link href="/" className="flex items-center shrink-0">
            <Image src="/logo.svg" alt="Neon Trade" width={140} height={34} priority />
          </Link>

          {/* Search — centre */}
          <div className="hidden md:block flex-1 max-w-sm mx-4">
            <StockSearch compact />
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Action buttons — right */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <button
              onClick={() => router.push('/quadrant')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                isActive('/quadrant') ? 'bg-blue-700 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              📊 Quadrant Analysis
            </button>
            <div className="relative" ref={scanMenuRef}>
              <button
                onClick={() => setScanMenuOpen(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  isScanAlertsPath ? 'bg-purple-700 text-white' : 'bg-purple-600 text-white hover:bg-purple-700'
                }`}
              >
                🔔 Scan Alerts
                <svg className={`w-3 h-3 transition-transform ${scanMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {scanMenuOpen && (
                <div className="absolute right-0 mt-1 w-44 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-30">
                  <button
                    onClick={() => { setScanMenuOpen(false); router.push('/scan-alerts/latest'); }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-purple-50 ${
                      isActive('/scan-alerts/latest') ? 'text-purple-700 bg-purple-50' : 'text-gray-700'
                    }`}
                  >
                    🆕 Latest
                  </button>
                  <button
                    onClick={() => { setScanMenuOpen(false); router.push('/scan-alerts/historical'); }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-purple-50 border-t border-gray-100 ${
                      isActive('/scan-alerts/historical') ? 'text-purple-700 bg-purple-50' : 'text-gray-700'
                    }`}
                  >
                    🕓 Historical
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => router.push('/stock/SPY')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                pathname?.startsWith('/stock') ? 'bg-green-700 text-white' : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              📈 Stock Analysis
            </button>
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
            onClick={() => router.push('/scan-alerts/latest')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-purple-700 hover:bg-purple-50 rounded-lg"
          >
            🆕 Scan Alerts — Latest
          </button>
          <button
            onClick={() => router.push('/scan-alerts/historical')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-purple-700 hover:bg-purple-50 rounded-lg"
          >
            🕓 Scan Alerts — Historical
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
