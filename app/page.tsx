import Header from "@/components/layout/Header";
import StockSearch from "@/components/ui/StockSearch";

export default function Home() {
  return (
    <>
      <Header />
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <main className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-green-600">
            Neon Trade
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 mb-8">
            Advanced Stock Analysis Platform
          </p>
          <p className="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto mb-8">
            Professional stock analysis with put/call level indicators and 5-quadrant visualization for identifying trading opportunities
          </p>
          
          <div className="flex justify-center mb-8">
            <StockSearch />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          <a href="/quadrant" className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 border border-gray-200 dark:border-gray-700 hover:shadow-xl hover:border-blue-400 dark:hover:border-blue-500 transition-all cursor-pointer">
            <div className="text-3xl mb-4">🎯</div>
            <h2 className="text-2xl font-bold mb-3">Quadrant Analysis</h2>
            <p className="text-gray-600 dark:text-gray-300">
              5-quadrant scatter plot visualization showing stocks positioned by their proximity to critical price levels
            </p>
          </a>

          <a href="/stock/AAPL" className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 border border-gray-200 dark:border-gray-700 hover:shadow-xl hover:border-green-400 dark:hover:border-green-500 transition-all cursor-pointer">
            <div className="text-3xl mb-4">📊</div>
            <h2 className="text-2xl font-bold mb-3">Stock Analysis</h2>
            <p className="text-gray-600 dark:text-gray-300">
              Interactive candlestick charts with real-time data from Alpaca API, featuring put/call level indicators and proximity alerts
            </p>
          </a>
        </div>

        <div className="mt-16 text-center">
          <div className="inline-flex gap-4">
            <a
              href="/quadrant"
              className="px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              Explore Quadrant
            </a>
            <a
              href="/stock/AAPL"
              className="px-8 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors"
            >
              View Stock Chart
            </a>
          </div>
        </div>
      </main>
      </div>
    </>
  );
}
