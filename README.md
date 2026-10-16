# StocksTrendz - Stock Analysis Platform

A modern stock analysis platform featuring interactive candlestick charts with put/call level indicators and 5-quadrant visualization for identifying trading opportunities.

## Features

- **Candlestick Charts**: Interactive candlestick charts with real-time OHLC data from Alpaca API
- **Dynamic Tooltips**: Shows Open, High, Low, Close prices with color-coded display
- **Level Indicators**: Visual display of 5 price levels (put_low, put_int, put_call_int, call_int, call_high)
- **Date-Specific Levels**: Historical level values shown for each trading date based on expiry selection
- **Colored Y-Axis Markers**: Level prices displayed with color-coded labels on the Y-axis
- **Expiry Filtering**: Dynamic dropdown to view levels for different option expiry dates
- **Quadrant Analysis**: Scatter plot showing stocks positioned by proximity to critical levels
- **Real-time Search**: Fast stock symbol search with autocomplete
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Accounts and plans**: sign-in, a free tier (charts) and a Pro plan; features are switched per plan in the database
- **Watchlists**: your own lists plus curated sector/index lists, with live quotes, level proximity and earnings, and a split view with the chart beside the list
- **Scan alerts, Performance and Quadrant**: latest and historical alerts for stocks crossing the OI-derived levels, how those alerts played out by expiry, and the quadrant view
- **Earnings tracker**: upcoming and reported earnings (EPS and sales vs consensus, price reaction, levels at a chosen expiry)
- **Options OI tracker**: where option open interest is being opened and closed (by contract, stock, expiry, strike and day), with volume, dollar size, possible multi-leg strategies and private tracked positions with P&L
- **Your columns**: every table has a Columns menu; the choice is saved to your account (or the browser when signed out)
- **Session-aware quotes**: live, pre-market, after-hours and closed states from the market calendar

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Charts**: Lightweight Charts (TradingView), Recharts
- **Database**: Neon DB (PostgreSQL)
- **Market Data API**: Alpaca Markets (free tier with IEX feed)
- **Deployment**: Vercel-ready

## Getting Started

> This README gives an overview. [CLAUDE.md](CLAUDE.md) is the maintained architecture guide (data sources, crons, gating), and [docs/CHANGES.md](docs/CHANGES.md) records every change with what was and wasn't verified.

### Prerequisites

- Node.js 18+ installed
- Neon DB database with `public.eod_usmkts_price` table
- Alpaca API credentials (get from https://alpaca.markets/ - free tier available)

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd neon_trade
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials:
```env
# Neon Database
DATABASE_URL=postgresql://user:password@host/database?sslmode=require

# Alpaca API (for market data - OHLC, quotes, trades)
ALPACA_API_KEY=your_alpaca_api_key
ALPACA_SECRET_KEY=your_alpaca_secret_key
ALPACA_BASE_URL=https://data.alpaca.markets
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

```
neon_trade/
├── app/                    # Next.js app router
│   ├── api/               # API routes (stocks, watchlists, earnings, oi-tracker, prefs, cron, admin, ...)
│   ├── stock/[symbol]/    # Stock detail page
│   ├── quadrant/          # Quadrant analysis page
│   ├── watchlists/        # Watchlists and the chart + list split view
│   ├── scan-alerts/       # Latest and historical scan alerts
│   ├── performance/       # How alerts played out by expiry
│   ├── earnings/          # Earnings tracker (Pro)
│   ├── oi-tracker/        # Options OI tracker (Pro)
│   ├── admin/, profile/, upgrade/, login/, guide/, diagnostics/
│   └── page.tsx           # Home page
├── components/            # React components
│   ├── charts/           # Chart component with sanitization
│   ├── alpaca.ts         # Alpacacomponents
│   └── ui/               # UI components
├── lib/                   # Utilities and services
│   ├── db.ts             # Database client
│   ├── tradier.ts        # Tradier API client
│   ├── calculations.ts   # Level calculations
│   └── utils.ts          # Helper functions
├── types/                 # TypeScript types
├── scripts/               # One-off DDL (bootstrap-*.mjs), backfills and fixture tests
├── docs/                  # CHANGES.md (running change log), earnings.md, oi-tracker.md
├── CLAUDE.md              # Working rules and an up-to-date architecture guide
└── PROJECT_MASTER_PLAN.md # Original project plan (predates the current code)
```

## API Endpoints

- `GET /api/stocks/search?q={query}` - Search stocks
- `GET /api/stocks/{symbol}` - Get stock details with latest levels
- `GET /api/stocks/{symbol}/ohlc?from={date}&to={date}` - Get OHLC data from Alpaca
- `GET /api/stocks/{symbol}/levels?expiry={date}&range=true` - Get levels with historical data
- `GET /api/stocks/{symbol}/expiry-dates` - Get available expiry dates
- `GET /api/quadrant/data` - Get all stocks for quadrant chart
- `GET /api/test-alpaca` - Test Alpaca API connection

Signed-in routes (each checks the feature for the user's plan):

- `/api/watchlists/*` - watchlists, items, quotes, levels, alerts, performance
- `/api/scan-alerts/*` - latest, historical and recent alerts
- `/api/earnings/*` - earnings list and levels
- `/api/oi-tracker/*` - meta, screen, strategies, per-stock OI, tracked positions (private to the user)
- `/api/prefs/[key]` - the user's saved UI preferences (table columns)
- `/api/cron/*` - protected jobs run by Railway (market catalog + option volume capture, earnings, Telegram alerts)

## Level Calculation Formula

For each stock, we calculate 5 levels based on the formula:

```
Level Value = (CLOSE - LEVEL_PRICE) / CLOSE
```

The level with the value closest to 0 is the "closest level" - indicating the price is near that level.

**Level Types:**
- `put_LOW` - Lowest put support level
- `put_INT` - Intermediate put support
- `comb_INT` - Combined put/call level (critical zone)
- `call_INT` - Intermediate call resistance
- `call_HIGH` - Highest call resistance level

## Database Schema

Required table: `public.eod_usmkts_price`

**Key columns:**
- `symbol` - Stock ticker symbol
- `trade_date` - Trading date
- `expiry_date` - Option expiry date
- `close` - Closing price
- `put_low`, `put_int`, `comb_int`, `call_int`, `call_high` - Level prices
- `put_oi`, `call_oi` - Open interest values
- Calculated field: `OI_DIFF = put_oi - call_oi`

Other tables:

- `public.us_opt_chg_rpt` - the daily options OI change report (per contract; no volume column)
- `public.securities` - name, sector, industry, market cap, indices
- App tables, all `nt_`-prefixed because the database is shared with another app: plans, user profiles, watchlists, earnings, the market date catalog, `nt_opt_daily_bars` (option volume), `nt_oi_tracked`, `nt_user_prefs`, ...
- The app's tables are created by the idempotent `scripts/bootstrap-*.mjs` (run with `node --env-file=.env.local scripts/<name>.mjs`); `docs/oi-tracker.md` and `docs/earnings.md` list the ones each feature needs.
- Missing data in `eod_usmkts_price` is stored as zeros, not null; see CLAUDE.md.

See [PROJECT_MASTER_PLAN.md](PROJECT_MASTER_PLAN.md) for the original schema notes (they predate the current tables) and [CLAUDE.md](CLAUDE.md) for the current architecture.

## Key Implementation Details

### Data Sanitization
All numeric values from the database are sanitized to prevent NaN/NULL errors:
- `COALESCE(column, 0)` in SQL queries
- JavaScript sanitization for additional safety
- String-to-number conversion for price values

### Historical Levels
- Levels are fetched for entire date range when expiry is selected
- Stored in `Map<date, {levels, closestLevel}>` for date-specific tooltips
- Tooltip shows actual level values for the hovered date

### Alpaca API Integration
- Uses `/v2/stocks/bars` endpoint with `symbols` parameter
- IEX feed for free tier compatibility
- Automatic stock split adjustments
- Supports multiple timeframes: 1Day, 1Week, 1Month

## Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint code
npm run lint
```

## Deployment

This project is optimized for Vercel:

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy

## License

MIT

## Support

For detailed documentation, see [PROJECT_MASTER_PLAN.md](PROJECT_MASTER_PLAN.md)
