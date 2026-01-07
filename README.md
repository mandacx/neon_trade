# Neon Trade - Stock Analysis Platform

A modern stock analysis platform featuring interactive K-line charts with put/call level indicators and 5-quadrant visualization for identifying trading opportunities.

## Features

- **K-Line Charts**: Interactive candlestick charts with real-time OHLC data from Alpaca API
- **Dynamic Tooltips**: Shows Open, High, Low, Close prices with color-coded display
- **Level Indicators**: Visual display of 5 price levels (put_low, put_int, put_call_int, call_int, call_high)
- **Date-Specific Levels**: Historical level values shown for each trading date based on expiry selection
- **Colored Y-Axis Markers**: Level prices displayed with color-coded labels on the Y-axis
- **Expiry Filtering**: Dynamic dropdown to view levels for different option expiry dates
- **Quadrant Analysis**: Scatter plot showing stocks positioned by proximity to critical levels
- **Real-time Search**: Fast stock symbol search with autocomplete
- **Responsive Design**: Works on desktop, tablet, and mobile devices

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Charts**: Lightweight Charts (TradingView), Recharts
- **Database**: Neon DB (PostgreSQL)
- **Market Data API**: Alpaca Markets (free tier with IEX feed)
- **Deployment**: Vercel-ready

## Getting Started

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
│   ├── api/               # API routes
│   ├── stock/[symbol]/    # Stock detail page
│   ├── quadrant/          # Quadrant analysis page
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
└── PROJECT_MASTER_PLAN.md # Detailed project documentation
```

## API Endpoints

- `GET /api/stocks/search?q={query}` - Search stocks
- `GET /api/stocks/{symbol}` - Get stock details with latest levels
- `GET /api/stocks/{symbol}/ohlc?from={date}&to={date}` - Get OHLC data from Alpaca
- `GET /api/stocks/{symbol}/levels?expiry={date}&range=true` - Get levels with historical data
- `GET /api/stocks/{symbol}/expiry-dates` - Get available expiry dates
- `GET /api/quadrant/data` - Get all stocks for quadrant chart
- `GET /api/test-alpaca` - Test Alpaca API connection

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

See [PROJECT_MASTER_PLAN.md](PROJECT_MASTER_PLAN.md) for full schema details.

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
