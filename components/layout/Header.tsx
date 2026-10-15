'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import StockSearch from '@/components/ui/StockSearch';
import { useAuthContext } from '@/components/providers/AuthContextProvider';
import SignOutButton from '@/components/auth/SignOutButton';
import IndicesStrip from '@/components/layout/IndicesStrip';
import {
  hasFeature, FEATURE_QUADRANT, FEATURE_SCAN_ALERTS_LATEST, FEATURE_SCAN_ALERTS_HISTORY,
  FEATURE_WATCHLISTS, FEATURE_PERFORMANCE, FEATURE_EARNINGS, FEATURE_OI_TRACKER,
} from '@/lib/features';

// Small "needs upgrade" flag for nav entries — shown before a click, not just
// after a redirect to /upgrade, so Free users know upfront what's gated.
function ProBadge() {
  return (
    <span className="text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-white/25 leading-none">
      PRO
    </span>
  );
}

// Same signal, styled for the mobile dropdown's light-background buttons
// (ProBadge's white/25 tint needs a solid colored button to read against).
function MobileProBadge() {
  return (
    <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-amber-100 text-amber-700 leading-none">
      PRO
    </span>
  );
}

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [scanMenuOpen, setScanMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [watchMenuOpen, setWatchMenuOpen] = useState(false);
  const [trackersMenuOpen, setTrackersMenuOpen] = useState(false);
  const scanMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const watchMenuRef = useRef<HTMLDivElement>(null);
  const trackersMenuRef = useRef<HTMLDivElement>(null);
  const authCtx = useAuthContext();

  const isActive = (path: string) => pathname === path;
  const isScanAlertsPath = pathname?.startsWith('/scan-alerts');

  const needsQuadrant = !hasFeature(authCtx.features, FEATURE_QUADRANT);
  const needsScanAlerts = !hasFeature(authCtx.features, FEATURE_SCAN_ALERTS_LATEST) || !hasFeature(authCtx.features, FEATURE_SCAN_ALERTS_HISTORY);
  const needsWatchlists = !hasFeature(authCtx.features, FEATURE_WATCHLISTS);
  const needsPerformance = !hasFeature(authCtx.features, FEATURE_PERFORMANCE);
  const needsEarnings = !hasFeature(authCtx.features, FEATURE_EARNINGS);
  const needsOiTracker = !hasFeature(authCtx.features, FEATURE_OI_TRACKER);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (scanMenuRef.current && !scanMenuRef.current.contains(e.target as Node)) {
        setScanMenuOpen(false);
      }
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
      if (watchMenuRef.current && !watchMenuRef.current.contains(e.target as Node)) {
        setWatchMenuOpen(false);
      }
      if (trackersMenuRef.current && !trackersMenuRef.current.contains(e.target as Node)) {
        setTrackersMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="container mx-auto px-4">
        <div className="flex items-center h-14 gap-2 sm:gap-4">
          {/* Logo — links home */}
          <Link href="/" className="flex items-center shrink-0 min-w-0">
            <Image src="/logo.svg" alt="StocksTrendz" width={161} height={34} priority />
          </Link>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Action buttons — right */}
          <div className="hidden xl:flex items-center gap-2 shrink-0">
            <button
              onClick={() => router.push('/quadrant')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                isActive('/quadrant') ? 'bg-blue-700 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              📊 Quadrant Analysis
              {needsQuadrant && <ProBadge />}
            </button>
            <div className="relative" ref={scanMenuRef}>
              <button
                onClick={() => setScanMenuOpen(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  isScanAlertsPath ? 'bg-purple-700 text-white' : 'bg-purple-600 text-white hover:bg-purple-700'
                }`}
              >
                🔔 Scan Alerts
                {needsScanAlerts && <ProBadge />}
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
            <div className="relative" ref={watchMenuRef}>
              <button
                onClick={() => setWatchMenuOpen(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  pathname?.startsWith('/watchlists') ? 'bg-amber-700 text-white' : 'bg-amber-600 text-white hover:bg-amber-700'
                }`}
              >
                ⭐ Watchlists
                {needsWatchlists && <ProBadge />}
                <svg className={`w-3 h-3 transition-transform ${watchMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {watchMenuOpen && (
                <div className="absolute right-0 mt-1 w-44 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-30">
                  <button
                    onClick={() => { setWatchMenuOpen(false); router.push('/watchlists'); }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-amber-50 ${
                      isActive('/watchlists') ? 'text-amber-700 bg-amber-50' : 'text-gray-700'
                    }`}
                  >
                    📋 My Watchlists
                  </button>
                  <button
                    onClick={() => { setWatchMenuOpen(false); router.push('/watchlists/view'); }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-amber-50 border-t border-gray-100 ${
                      isActive('/watchlists/view') ? 'text-amber-700 bg-amber-50' : 'text-gray-700'
                    }`}
                  >
                    🪟 Watchlist W Chart
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => router.push('/performance')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                pathname?.startsWith('/performance') ? 'bg-teal-700 text-white' : 'bg-teal-600 text-white hover:bg-teal-700'
              }`}
            >
              🏆 Performance
              {needsPerformance && <ProBadge />}
            </button>
            {/* Earnings + OI Tracker share one dropdown: a separate OI button overflowed the
                nav at 1280-1366px (measured), see docs/CHANGES.md. PRO tags are on the items. */}
            <div className="relative" ref={trackersMenuRef}>
              <button
                onClick={() => setTrackersMenuOpen(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  pathname?.startsWith('/earnings') || pathname?.startsWith('/oi-tracker') ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
              >
                📊 Trackers
                <svg className={`w-3 h-3 transition-transform ${trackersMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {trackersMenuOpen && (
                <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-30">
                  <button
                    onClick={() => { setTrackersMenuOpen(false); router.push('/earnings'); }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-indigo-50 ${
                      pathname?.startsWith('/earnings') ? 'text-indigo-700 bg-indigo-50' : 'text-gray-700'
                    }`}
                  >
                    🗓️ Earnings
                    {needsEarnings && <MobileProBadge />}
                  </button>
                  <button
                    onClick={() => { setTrackersMenuOpen(false); router.push('/oi-tracker'); }}
                    className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-indigo-50 border-t border-gray-100 ${
                      pathname?.startsWith('/oi-tracker') ? 'text-indigo-700 bg-indigo-50' : 'text-gray-700'
                    }`}
                  >
                    📊 Options OI Tracker
                    {needsOiTracker && <MobileProBadge />}
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => router.push('/guide')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                pathname?.startsWith('/guide') ? 'bg-slate-700 text-white' : 'bg-slate-600 text-white hover:bg-slate-700'
              }`}
            >
              📘 Guide
            </button>

            {authCtx.loggedIn ? (
              <div className="relative" ref={accountMenuRef}>
                <button
                  onClick={() => setAccountMenuOpen(v => !v)}
                  className="flex items-center gap-1.5 w-8 h-8 rounded-full bg-gray-700 text-white text-xs font-bold justify-center hover:bg-gray-800"
                >
                  {(authCtx.name ?? authCtx.email ?? '?').slice(0, 1).toUpperCase()}
                </button>
                {accountMenuOpen && (
                  <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-30">
                    <Link
                      href="/profile"
                      onClick={() => setAccountMenuOpen(false)}
                      className="block px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      👤 Profile
                    </Link>
                    {authCtx.isAdmin && (
                      <Link
                        href="/admin"
                        onClick={() => setAccountMenuOpen(false)}
                        className="block px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 border-t border-gray-100"
                      >
                        🛠️ Admin
                      </Link>
                    )}
                    <div className="px-3 py-2 border-t border-gray-100">
                      <SignOutButton />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => router.push('/login')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                Sign in
              </button>
            )}
          </div>

          {/* Logged-out phones get Sign in without opening the menu */}
          {!authCtx.loggedIn && (
            <button
              onClick={() => router.push('/login')}
              className="xl:hidden shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Sign in
            </button>
          )}

          {/* Mobile menu */}
          <button
            aria-label="Open menu"
            className="xl:hidden shrink-0 p-2 rounded-lg hover:bg-gray-100"
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

        {/* Search — its own full-width row at every size. The 7 nav buttons need
            ~830px plus the logo, so an inline search was squeezed to a sliver
            on laptops (and still at 1920px, where the container caps at 1536). */}
        <div className="pb-3 w-full md:max-w-xl">
          <StockSearch compact />
        </div>

        {/* Mobile dropdown */}
        <div id="mobile-menu" className="hidden xl:!hidden border-t border-gray-100 py-3 space-y-1">
          <Link href="/" className="block px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg">
            🏠 Home
          </Link>
          <button
            onClick={() => router.push('/quadrant')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 rounded-lg"
          >
            📊 Quadrant Analysis
            {needsQuadrant && <MobileProBadge />}
          </button>
          <button
            onClick={() => router.push('/scan-alerts/latest')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-purple-700 hover:bg-purple-50 rounded-lg"
          >
            🆕 Scan Alerts — Latest
            {needsScanAlerts && <MobileProBadge />}
          </button>
          <button
            onClick={() => router.push('/scan-alerts/historical')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-purple-700 hover:bg-purple-50 rounded-lg"
          >
            🕓 Scan Alerts — Historical
            {needsScanAlerts && <MobileProBadge />}
          </button>
          <button
            onClick={() => router.push('/stock/SPY')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-50 rounded-lg"
          >
            📈 Stock Analysis
          </button>
          <button
            onClick={() => router.push('/watchlists')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 rounded-lg"
          >
            ⭐ Watchlists
            {needsWatchlists && <MobileProBadge />}
          </button>
          <button
            onClick={() => router.push('/watchlists/view')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 rounded-lg"
          >
            🪟 Watchlist W Chart
            {needsWatchlists && <MobileProBadge />}
          </button>
          <button
            onClick={() => router.push('/performance')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg"
          >
            🏆 Performance
            {needsPerformance && <MobileProBadge />}
          </button>
          <button
            onClick={() => router.push('/earnings')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 rounded-lg"
          >
            🗓️ Earnings
            {needsEarnings && <MobileProBadge />}
          </button>
          <button
            onClick={() => router.push('/oi-tracker')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-50 rounded-lg"
          >
            📊 OI Tracker
            {needsOiTracker && <MobileProBadge />}
          </button>
          <button
            onClick={() => router.push('/guide')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 rounded-lg"
          >
            📘 Guide
          </button>
          <div className="px-3 pt-2 border-t border-gray-100 mt-2">
            {authCtx.loggedIn ? (
              <div className="space-y-1">
                <Link href="/profile" className="block px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg">
                  👤 Profile
                </Link>
                {authCtx.isAdmin && (
                  <Link href="/admin" className="block px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg">
                    🛠️ Admin
                  </Link>
                )}
                <SignOutButton />
              </div>
            ) : (
              <button
                onClick={() => router.push('/login')}
                className="w-full text-left px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-lg border border-gray-200"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </div>
      <IndicesStrip />
    </header>
  );
}
