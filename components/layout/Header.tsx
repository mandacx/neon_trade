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
  hasFeature, planLabel, FEATURE_QUADRANT, FEATURE_SCAN_ALERTS_LATEST, FEATURE_SCAN_ALERTS_HISTORY,
  FEATURE_WATCHLISTS, FEATURE_PERFORMANCE, FEATURE_EARNINGS, FEATURE_OI_TRACKER, FEATURE_US_MARKET_SCANNER, FEATURE_CRYPTO_LEVELS,
  FEATURE_IDEAS_SHORT_TERM, FEATURE_IDEAS_LONG_TERM,
} from '@/lib/features';

// Plan tag for the avatar: Free / Pro / Pro Plus (EXPERT) from the signed-in user's plan code.
const PLAN_TAGS: Record<string, { label: string; cls: string }> = {
  FREE: { label: 'Free', cls: 'bg-gray-200 text-gray-700 ring-gray-400' },
  PRO: { label: 'Pro', cls: 'bg-amber-400 text-amber-950 ring-amber-600' },
  EXPERT: { label: 'Pro Plus', cls: 'bg-purple-600 text-white ring-purple-800' },
  LONG_INVESTORS: { label: 'Self learners', cls: 'bg-teal-600 text-white ring-teal-800' },
  SHORT_TERM: { label: 'Short term', cls: 'bg-sky-500 text-white ring-sky-700' },
  LONG_TERM: { label: 'Long term', cls: 'bg-emerald-600 text-white ring-emerald-800' },
  PLATINUM: { label: 'Platinum', cls: 'bg-slate-800 text-slate-100 ring-slate-500' },
};

function planTag(planCode: string) {
  return PLAN_TAGS[planCode] ?? { label: planLabel(planCode), cls: PLAN_TAGS.FREE.cls };
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

  // Menu entries the user's plan does not include are hidden, not badged. Signed-out visitors
  // resolve to the Free plan's features, so they see what Free includes. Stock Analysis and the
  // Guide are open to everyone (the stock page is not gated). /upgrade stays reachable through the
  // "Plans" button, which only appears when something is hidden.
  const has = (code: string) => hasFeature(authCtx.features, code);
  const showQuadrant = has(FEATURE_QUADRANT);
  const showScanLatest = has(FEATURE_SCAN_ALERTS_LATEST);
  const showScanHistory = has(FEATURE_SCAN_ALERTS_HISTORY);
  const showScanAlerts = showScanLatest || showScanHistory;
  const showWatchlists = has(FEATURE_WATCHLISTS);
  // Performance is hidden for signed-out users and for plans/users without the feature.
  const showPerformance = authCtx.loggedIn && has(FEATURE_PERFORMANCE);
  const showEarnings = has(FEATURE_EARNINGS);
  const showOiTracker = has(FEATURE_OI_TRACKER);
  const showScanner = has(FEATURE_US_MARKET_SCANNER);
  const showCrypto = has(FEATURE_CRYPTO_LEVELS);
  // Same rule as app/ideas/layout.tsx: at least one idea term (short or long), and signed in.
  const showIdeas = authCtx.loggedIn && (has(FEATURE_IDEAS_SHORT_TERM) || has(FEATURE_IDEAS_LONG_TERM));
  const showTrackers = showEarnings || showOiTracker || showScanner || showCrypto;
  const hasHidden = !showQuadrant || !showScanAlerts || !showWatchlists || !showEarnings || !showOiTracker
    || !showScanner || !showCrypto || !(has(FEATURE_IDEAS_SHORT_TERM) || has(FEATURE_IDEAS_LONG_TERM));
  const tag = planTag(authCtx.planCode);

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
            {showQuadrant && (
              <button
                onClick={() => router.push('/quadrant')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  isActive('/quadrant') ? 'bg-blue-700 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                📊 Quadrant Analysis
              </button>
            )}
            {showScanAlerts && (
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
                    {showScanLatest && (
                      <button
                        onClick={() => { setScanMenuOpen(false); router.push('/scan-alerts/latest'); }}
                        className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-purple-50 ${
                          isActive('/scan-alerts/latest') ? 'text-purple-700 bg-purple-50' : 'text-gray-700'
                        }`}
                      >
                        🆕 Latest
                      </button>
                    )}
                    {showScanHistory && (
                      <button
                        onClick={() => { setScanMenuOpen(false); router.push('/scan-alerts/historical'); }}
                        className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-purple-50 ${showScanLatest ? 'border-t border-gray-100' : ''} ${
                          isActive('/scan-alerts/historical') ? 'text-purple-700 bg-purple-50' : 'text-gray-700'
                        }`}
                      >
                        🕓 Historical
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => router.push('/stock/SPY')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                pathname?.startsWith('/stock') ? 'bg-green-700 text-white' : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              📈 Stock Analysis
            </button>
            {showIdeas && (
              <button
                onClick={() => router.push('/ideas')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  pathname?.startsWith('/ideas') ? 'bg-rose-700 text-white' : 'bg-rose-600 text-white hover:bg-rose-700'
                }`}
              >
                💡 Trade Ideas
              </button>
            )}
            {showWatchlists && (
              <div className="relative" ref={watchMenuRef}>
                <button
                  onClick={() => setWatchMenuOpen(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    pathname?.startsWith('/watchlists') ? 'bg-amber-700 text-white' : 'bg-amber-600 text-white hover:bg-amber-700'
                  }`}
                >
                  ⭐ Watchlists
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
            )}
            {showPerformance && (
              <button
                onClick={() => router.push('/performance')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  pathname?.startsWith('/performance') ? 'bg-teal-700 text-white' : 'bg-teal-600 text-white hover:bg-teal-700'
                }`}
              >
                🏆 Performance
              </button>
            )}
            {/* Earnings, OI Tracker, Scanner and Crypto share one dropdown: separate buttons overflowed the
                nav at 1280-1366px (measured), see docs/CHANGES.md. Items the plan lacks are hidden; the
                dropdown itself disappears when none are left. */}
            {showTrackers && (
              <div className="relative" ref={trackersMenuRef}>
                <button
                  onClick={() => setTrackersMenuOpen(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    pathname?.startsWith('/earnings') || pathname?.startsWith('/oi-tracker') || pathname?.startsWith('/scanner') || pathname?.startsWith('/crypto') ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  📊 Trackers
                  <svg className={`w-3 h-3 transition-transform ${trackersMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {trackersMenuOpen && (
                  <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-30 divide-y divide-gray-100">
                    {showEarnings && (
                      <button
                        onClick={() => { setTrackersMenuOpen(false); router.push('/earnings'); }}
                        className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-indigo-50 ${
                          pathname?.startsWith('/earnings') ? 'text-indigo-700 bg-indigo-50' : 'text-gray-700'
                        }`}
                      >
                        🗓️ Earnings
                      </button>
                    )}
                    {showOiTracker && (
                      <button
                        onClick={() => { setTrackersMenuOpen(false); router.push('/oi-tracker'); }}
                        className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-indigo-50 ${
                          pathname?.startsWith('/oi-tracker') ? 'text-indigo-700 bg-indigo-50' : 'text-gray-700'
                        }`}
                      >
                        📊 Options OI Tracker
                      </button>
                    )}
                    {showScanner && (
                      <button
                        onClick={() => { setTrackersMenuOpen(false); router.push('/scanner'); }}
                        className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-indigo-50 ${
                          pathname?.startsWith('/scanner') ? 'text-indigo-700 bg-indigo-50' : 'text-gray-700'
                        }`}
                      >
                        🔎 US Market Scanner
                      </button>
                    )}
                    {showCrypto && (
                      <button
                        onClick={() => { setTrackersMenuOpen(false); router.push('/crypto'); }}
                        className={`w-full text-left px-3 py-2 text-xs font-medium hover:bg-indigo-50 ${
                          pathname?.startsWith('/crypto') ? 'text-indigo-700 bg-indigo-50' : 'text-gray-700'
                        }`}
                      >
                        ₿ Crypto Levels
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => router.push('/guide')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                pathname?.startsWith('/guide') ? 'bg-slate-700 text-white' : 'bg-slate-600 text-white hover:bg-slate-700'
              }`}
            >
              📘 Guide
            </button>
            {hasHidden && (
              <button
                onClick={() => router.push('/upgrade')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  pathname?.startsWith('/upgrade') ? 'border-gray-700 text-gray-900 bg-gray-100' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                ⬆ Plans
              </button>
            )}

            {authCtx.loggedIn ? (
              <div className="relative" ref={accountMenuRef}>
                <button
                  onClick={() => setAccountMenuOpen(v => !v)}
                  aria-label={`Account menu, ${tag.label} plan`}
                  title={`${tag.label} plan`}
                  className="relative flex items-center gap-1.5 w-10 h-10 rounded-full bg-gray-700 text-white text-sm font-bold justify-center hover:bg-gray-800"
                >
                  {(authCtx.name ?? authCtx.email ?? '?').slice(0, 1).toUpperCase()}
                  <span className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1 rounded-full ring-1 text-[8px] font-bold uppercase leading-[11px] tracking-wide ${tag.cls}`}>
                    {tag.label}
                  </span>
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

        {/* Mobile dropdown — same visibility rules as the desktop nav */}
        <div id="mobile-menu" className="hidden xl:!hidden border-t border-gray-100 py-3 space-y-1">
          <Link href="/" className="block px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg">
            🏠 Home
          </Link>
          {showQuadrant && (
            <button
              onClick={() => router.push('/quadrant')}
              className="w-full text-left px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 rounded-lg"
            >
              📊 Quadrant Analysis
            </button>
          )}
          {showScanLatest && (
            <button
              onClick={() => router.push('/scan-alerts/latest')}
              className="w-full text-left px-3 py-2 text-sm font-semibold text-purple-700 hover:bg-purple-50 rounded-lg"
            >
              🆕 Scan Alerts — Latest
            </button>
          )}
          {showScanHistory && (
            <button
              onClick={() => router.push('/scan-alerts/historical')}
              className="w-full text-left px-3 py-2 text-sm font-semibold text-purple-700 hover:bg-purple-50 rounded-lg"
            >
              🕓 Scan Alerts — Historical
            </button>
          )}
          <button
            onClick={() => router.push('/stock/SPY')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-50 rounded-lg"
          >
            📈 Stock Analysis
          </button>
          {showIdeas && (
            <button
              onClick={() => router.push('/ideas')}
              className="w-full text-left px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 rounded-lg"
            >
              💡 Trade Ideas
            </button>
          )}
          {showWatchlists && (
            <>
              <button
                onClick={() => router.push('/watchlists')}
                className="w-full text-left px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 rounded-lg"
              >
                ⭐ Watchlists
              </button>
              <button
                onClick={() => router.push('/watchlists/view')}
                className="w-full text-left px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 rounded-lg"
              >
                🪟 Watchlist W Chart
              </button>
            </>
          )}
          {showPerformance && (
            <button
              onClick={() => router.push('/performance')}
              className="w-full text-left px-3 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 rounded-lg"
            >
              🏆 Performance
            </button>
          )}
          {showEarnings && (
            <button
              onClick={() => router.push('/earnings')}
              className="w-full text-left px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 rounded-lg"
            >
              🗓️ Earnings
            </button>
          )}
          {showOiTracker && (
            <button
              onClick={() => router.push('/oi-tracker')}
              className="w-full text-left px-3 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-50 rounded-lg"
            >
              📊 OI Tracker
            </button>
          )}
          {showScanner && (
            <button
              onClick={() => router.push('/scanner')}
              className="w-full text-left px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 rounded-lg"
            >
              🔎 US Market Scanner
            </button>
          )}
          {showCrypto && (
            <button
              onClick={() => router.push('/crypto')}
              className="w-full text-left px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 rounded-lg"
            >
              ₿ Crypto Levels
            </button>
          )}
          <button
            onClick={() => router.push('/guide')}
            className="w-full text-left px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 rounded-lg"
          >
            📘 Guide
          </button>
          {hasHidden && (
            <button
              onClick={() => router.push('/upgrade')}
              className="w-full text-left px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-lg"
            >
              ⬆ Plans
            </button>
          )}
          <div className="px-3 pt-2 border-t border-gray-100 mt-2">
            {authCtx.loggedIn ? (
              <div className="space-y-1">
                <Link href="/profile" className="block px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg">
                  👤 Profile
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase leading-none ${tag.cls}`}>{tag.label}</span>
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
