import Link from 'next/link';

// Plain, crawlable footer: About / Contact / Privacy / Terms links and the
// disclaimer. Web-filter vendors read these pages when categorizing the domain.
export default function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-gray-200 bg-white">
      <div className="max-w-7xl mx-auto px-4 py-6 text-xs text-gray-500">
        <nav className="flex flex-wrap gap-x-5 gap-y-1 mb-3 font-medium text-gray-600">
          <Link href="/about" className="hover:text-blue-600">About</Link>
          <Link href="/guide" className="hover:text-blue-600">Guide</Link>
          <Link href="/upgrade" className="hover:text-blue-600">Plans</Link>
          <Link href="/contact" className="hover:text-blue-600">Contact</Link>
          <Link href="/privacy" className="hover:text-blue-600">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-blue-600">Terms of Use</Link>
        </nav>
        <p className="leading-relaxed text-[11px] text-gray-400">
          StocksTrendz provides market data analysis for educational and informational purposes only. It is not a
          broker-dealer or registered investment adviser and does not give investment advice. Trading securities and
          options involves risk of loss. &copy; {new Date().getFullYear()} StocksTrendz.
        </p>
      </div>
    </footer>
  );
}
