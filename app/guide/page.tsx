import Header from '@/components/layout/Header';
import { getLevelColor, getLevelDisplayName } from '@/lib/utils';
import { LEVEL_DELAY_DAYS } from '@/lib/levelAccess';
import Link from 'next/link';

// Fully static content, no per-request data — safe to prerender at build time.

interface LevelDoc { name: string; blurb: string }

const CORE_LEVELS: LevelDoc[] = [
  { name: 'call_high', blurb: 'The strongest resistance zone from Call option positioning. A decisive close above it often reads as bullish continuation rather than a reversal at the ceiling.' },
  { name: 'call_int', blurb: 'An intermediate resistance below Call High — usually the first hurdle price meets on the way up.' },
  { name: 'put_call_int', blurb: "The balance point between combined Put and Call positioning. Price often oscillates around this level when the trend is undecided." },
  { name: 'put_int', blurb: 'An intermediate support above Put Low — usually the first cushion price meets on the way down.' },
  { name: 'put_low', blurb: 'The strongest support zone from Put option positioning. A decisive close below it often reads as bearish continuation rather than a bounce at the floor.' },
];

const EXTRA_LEVELS: LevelDoc[] = [
  { name: 'put_high', blurb: 'A secondary support inside the main range, between Put Low and Put/Call Int. Shown in the stock chart’s crosshair tooltip under "Extended Levels," not in scan alerts or the quadrant view.' },
  { name: 'call_low', blurb: 'A secondary resistance inside the main range, between Put/Call Int and Call High. Shown in the stock chart’s crosshair tooltip under "Extended Levels," not in scan alerts or the quadrant view.' },
];

function LevelRow({ level }: { level: LevelDoc }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="w-3 h-3 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: getLevelColor(level.name) }} />
      <div>
        <div className="text-sm font-semibold text-gray-800">{getLevelDisplayName(level.name)}</div>
        <p className="text-xs text-gray-500 mt-0.5">{level.blurb}</p>
      </div>
    </div>
  );
}

export default function GuidePage() {
  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-10 max-w-3xl">
          <h1 className="text-xl font-bold text-gray-900">How to read price levels</h1>
          <p className="text-sm text-gray-500 mt-2">
            Every symbol on StocksTrendz carries five (or seven, on the stock chart) price levels derived from
            Put and Call option positioning near the current expiry. They act as reference zones —
            support underneath, resistance overhead — around which price tends to react.
          </p>

          <section className="mt-8 bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-1">The core ladder</h2>
            <p className="text-xs text-gray-400 mb-2">Highest price at top, lowest at bottom — matches the order shown on every chart and table.</p>
            <div className="divide-y divide-gray-100">
              {CORE_LEVELS.map(l => <LevelRow key={l.name} level={l} />)}
            </div>
          </section>

          <section className="mt-5 bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-1">Extended levels</h2>
            <p className="text-xs text-gray-400 mb-2">Finer reference points inside the main range — shown as a separate group in the chart&apos;s crosshair tooltip and the historical levels table.</p>
            <div className="divide-y divide-gray-100">
              {EXTRA_LEVELS.map(l => <LevelRow key={l.name} level={l} />)}
            </div>
          </section>

          <section className="mt-5 bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-2">Reading the numbers</h2>
            <p className="text-xs text-gray-600 leading-relaxed">
              Each level shows a price, a $ <strong>distance</strong>, and a <strong>percentage</strong> — how far the
              current close sits from that level: <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">(Close − Level) / Close</code>.
            </p>
            <div className="mt-3 bg-gray-50 rounded-lg p-3 text-xs text-gray-600 leading-relaxed">
              <strong className="text-gray-700">Worked example.</strong> AAPL closes at $230.00. Call High sits at $242.00 (above the close),
              so the app shows <strong>−5.26%</strong>. Put Low sits at $216.00 (below the close), so it shows <strong>+6.09%</strong>.
              <br className="hidden sm:block" />
              <span className="text-gray-500">Negative % → the level is still ahead, overhead (resistance). Positive % → the level is already beneath price (support).</span>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed mt-3">
              Whichever level has the <strong>smallest</strong> percentage right now — closest to 0% either
              way — is highlighted as the <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold text-[11px]">Closest Level</span>,
              the zone price is currently sitting on or reacting to.
            </p>
          </section>

          <section className="mt-5 bg-white rounded-xl border border-amber-200 bg-amber-50/40 p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-2">Level quality depends on open interest</h2>
            <ul className="space-y-2.5 text-xs text-gray-600 leading-relaxed list-disc list-inside">
              <li><strong className="text-gray-700">More OI, more accurate.</strong> Levels come from where Put and Call open interest is concentrated at specific strikes for the current expiry. The more Call and Put OI sitting behind a level, the more capital and positioning is actually defending that zone — and the more likely it is to matter. A level built on thin OI is more of a mathematical artifact than a real wall of positioning.</li>
              <li><strong className="text-gray-700">Levels move daily.</strong> Open interest changes every trading day — new positions get added, existing ones get rolled or closed — both at the strike level and in aggregate for that stock&apos;s expiry. Because levels are recalculated from current OI, the same level can sit at a meaningfully different price today than it did yesterday, especially as expiry approaches.</li>
              <li><strong className="text-gray-700">Be cautious on low-OI stocks.</strong> For symbols with thin overall open interest, treat the levels as indicative at best — expect more day-to-day noise and less reliable reactions at the printed price. Check the Call OI / Put OI figures on the stock page before leaning on a low-liquidity symbol&apos;s levels.</li>
            </ul>
          </section>

          <section className="mt-5 bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-2">Using levels for trading</h2>
            <ul className="space-y-2.5 text-xs text-gray-600 leading-relaxed list-disc list-inside">
              <li><strong className="text-gray-700">Support / resistance.</strong> Treat Put levels as potential floors and Call levels as potential ceilings for the current expiry. Put/Call Int is the middle ground — where price often chops when there&apos;s no clear trend.</li>
              <li><strong className="text-gray-700">Breakout / breakdown.</strong> A strong close through Call High or Put Low — not just a brief touch — is often read as a continuation signal rather than a level that will hold. Weigh this more heavily when the level was backed by meaningful OI in the first place; a break of a thin-OI level is less informative.</li>
              <li><strong className="text-gray-700">Range-bound setups.</strong> Between Put Int and Call Int, some traders look to fade moves back toward Put/Call Int rather than chase a breakout.</li>
              <li><strong className="text-gray-700">Timing with Scan Alerts.</strong> The levels above are static reference points for the day; <em>Scan Alerts</em> are the trigger — a <span className="text-green-600 font-semibold">▲ Buy Above</span> or <span className="text-red-600 font-semibold">▼ Sell Below</span> badge fires the moment price actually crosses a level intraday, on real quote data.</li>
              <li><strong className="text-gray-700">Check, don&apos;t assume.</strong> Not every level behaves the same way — some act as launchpads (price keeps moving away, a <em>continuation</em>), others as magnets that pull price back (a <em>reversion</em>), and which one depends on the level, the symbol, and market conditions at the time. The <Link href="/performance" className="text-blue-600 hover:underline font-semibold">Performance</Link> page reports both a continuation rate and a reversion rate — by level and by symbol — computed only from alerts whose expiry has actually passed. Check it before assuming either.</li>
            </ul>
          </section>

          <section className="mt-5 bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-2">Free vs. Pro</h2>
            <p className="text-xs text-gray-600 leading-relaxed">
              The Free plan still shows levels — just for data older than {LEVEL_DELAY_DAYS} days — while Pro shows
              them live, the moment they&apos;re computed. Charts, candles and live quotes stay free on every plan; the
              premium gate is the levels themselves, plus Scan Alerts, Quadrant, Watchlists, Performance, and
              Telegram Alerts. See <a href="/upgrade" className="text-blue-600 hover:underline font-semibold">Plans</a> for details.
            </p>
          </section>

          <section id="trade-ideas" className="mt-5 bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-1">Trade ideas: Short term, Long term, Premium and Platinum</h2>
            <p className="text-xs text-gray-600 leading-relaxed">
              The <Link href="/ideas" className="text-blue-600 hover:underline font-semibold">Trade Ideas</Link> desk publishes
              structured calls: a symbol and direction, an <strong>entry zone</strong>, a ladder of <strong>targets</strong>, a
              <strong> stop</strong>, a time horizon and the reasoning behind it. An idea is a published thesis and a plan,
              not a recommendation made for you personally, and nothing is traded on your behalf.
            </p>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
              <div className="rounded-lg border border-gray-200 p-3">
                <h3 className="text-xs font-bold text-gray-900">Short term</h3>
                <p className="text-[11px] text-gray-600 leading-relaxed mt-1">
                  <strong>Intraday</strong> (opened and closed within a day or two) and <strong>swing</strong> ideas
                  (days to a few weeks). For people who trade actively and want the next setup.
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <h3 className="text-xs font-bold text-gray-900">Long term</h3>
                <p className="text-[11px] text-gray-600 leading-relaxed mt-1">
                  <strong>Positional</strong> (weeks to a few months) and <strong>long-term</strong> ideas (months to
                  years). For people who hold through the noise and check in less often.
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <h3 className="text-xs font-bold text-gray-900">Premium</h3>
                <p className="text-[11px] text-gray-600 leading-relaxed mt-1">
                  Both the short term and the long term ideas, plus charts, price levels, watchlists and Telegram
                  alerts. Platinum adds the full analysis toolset.
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <h3 className="text-xs font-bold text-gray-900">Platinum</h3>
                <p className="text-[11px] text-gray-600 leading-relaxed mt-1">
                  Everything in both: the short term and the long term ideas, in one plan.
                </p>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Which other tools each plan includes (price levels, open interest, scanners, quadrant and so on) is
              shown on the <Link href="/upgrade" className="text-blue-600 hover:underline font-semibold">Plans</Link> page.
              Ideas outside your plan are not shown; the board only tells you how many are locked.
            </p>

            <h3 className="text-xs font-bold text-gray-900 mt-5 mb-1.5">Reading an idea</h3>
            <ul className="space-y-2 text-xs text-gray-600 leading-relaxed list-disc list-inside">
              <li><strong className="text-gray-700">Entry zone.</strong> The price range the idea expects to be entered in. If price runs to the first target, or through the stop, without ever touching the zone, the idea is recorded as <em>not triggered</em>, never as a win.</li>
              <li><strong className="text-gray-700">Targets and stop.</strong> The position is split equally across the targets, and the stop is the level where the idea is wrong. The original entry, targets and stop are what get scored.</li>
              <li><strong className="text-gray-700">Published ideas don&apos;t change.</strong> Once live, the plan can&apos;t be edited. Anything new (a note, a moved stop, a partial profit, an early close) is added to a dated timeline on the idea and alerted, so the record can&apos;t be rewritten after the fact.</li>
              <li><strong className="text-gray-700">Risk rating and reward : risk.</strong> Each idea shows how risky the desk judges it to be and the reward-to-risk ratio of its own plan.</li>
            </ul>

            <h3 className="text-xs font-bold text-gray-900 mt-5 mb-1.5">How results are scored</h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              Results come from the daily price bars, never from anyone&apos;s say-so, and the rules lean against flattering the desk:
            </p>
            <ul className="space-y-2 text-xs text-gray-600 leading-relaxed list-disc list-inside mt-2">
              <li>Entry is taken at the <strong>worst price in the zone</strong>, not the best.</li>
              <li>When one daily bar touches both the stop and a target, <strong>the stop counts first</strong>. A gap through the stop fills at the open, which is worse than the stop.</li>
              <li>Results are shown as <strong>R-multiples</strong> (profit divided by the risk to the stop), so a ten-dollar stock and a thousand-dollar stock compare fairly. Ideas that are still open show an unrealised figure and are left out of the desk statistics.</li>
              <li>The <Link href="/ideas/performance" className="text-blue-600 hover:underline font-semibold">Performance</Link> page shows hit rate, average R and the other desk statistics together with what they cover. Intraday ideas are also scored on daily bars, so treat their results as approximate.</li>
            </ul>

            <h3 className="text-xs font-bold text-gray-900 mt-5 mb-1.5">Alerts and your own trades</h3>
            <ul className="space-y-2 text-xs text-gray-600 leading-relaxed list-disc list-inside">
              <li><strong className="text-gray-700">In-app feed</strong> is always on for the ideas in your plan. <strong className="text-gray-700">Email</strong>, <strong className="text-gray-700">Telegram</strong> and <strong className="text-gray-700">browser push</strong> are opt-in from the Alerts menu on the Trade Ideas page. Telegram also needs your chat linked in your profile and a plan that includes Telegram alerts.</li>
              <li><strong className="text-gray-700">I took this.</strong> If you act on an idea, record your own quantity and price. It is a private journal: nothing is sent to a broker. <em>My trades</em> then shows your result next to the desk&apos;s, and how ideas you followed compare with ones you didn&apos;t.</li>
            </ul>

            <p className="text-[11px] text-gray-500 leading-relaxed mt-4 bg-amber-50/60 border border-amber-200 rounded-lg px-3 py-2">
              Trade ideas are information, not personal advice. Entries may not fill, stops can slip in fast markets, and
              past results do not predict future ones. You are responsible for your own decisions and for how much you risk.
            </p>
          </section>

          <footer className="mt-10 pt-4 border-t border-gray-200 text-[10px] text-gray-400 leading-relaxed">
            <strong>Disclaimer:</strong> This page is for educational and informational purposes only and does not
            constitute investment advice, a recommendation, or a solicitation to buy or sell any security or
            derivative instrument. StocksTrendz is not a registered investment adviser or broker-dealer and does not
            provide personalized investment advice. Price levels, scan alerts, and performance statistics shown on
            this platform are derived from historical and intraday market data and do not guarantee any future
            outcome. Trading and investing in securities — especially derivatives and options-derived signals —
            carries a high degree of risk, including the risk of loss of principal, and may not be suitable for all
            investors. Past performance is not indicative of future results. You are solely responsible for your own
            investment decisions; please consult a qualified, licensed financial professional before trading or
            investing.
          </footer>
        </div>
      </div>
    </>
  );
}
