# Quick Start Guide - Neon Trade

## 🎉 Project Successfully Implemented!

Your stock analysis platform is now running at **http://localhost:3000**

---

## ✅ What's Been Built

### Backend Infrastructure
- ✅ Neon DB client with connection pooling & sanitization
- ✅ Alpaca API client for market data (OHLC, quotes, trades)
- ✅ Level calculation engine (5 price levels with distance formulas)
- ✅ Historical data fetching with expiry filtering
- ✅ Complete API endpoints:
  - Stock search
  - Stock details & levels (with historical range support)
  - OHLC data from Alpaca with dynamic date ranges
  - Expiry dates listing
  - Quadrant analysis data
  - Test endpoints for API validation

### Frontend Components
- ✅ TVChart (Lightweight Charts) with interactive tooltips
- ✅ Date-specific level values from historical data Map
- ✅ OHLC values displayed in tooltips (Open, High, Low, Close)
- ✅ Colored Y-axis markers for price levels
- ✅ Expiry date dropdown with dynamic filtering
- ✅ 5-Quadrant Scatter Plot with Recharts
- ✅ Stock search with autocomplete
- ✅ Responsive header & navigation
- ✅ Loading states & error handling
- ✅ Graceful degradation when stock not in database

### Pages
- ✅ Home page with search
- ✅ Stock detail page (`/stock/[symbol]`) with full chart features
- ✅ Quadrant analysis dashboard (`/quadrant`)

---

## 🚀 Configuration

### 1. Environment Variables

Edit `.env.local` with your credentials:

```env
# Neon Database
DATABASE_URL=postgresql://[user]:[password]@[host]/[database]?sslmode=require

# Alpaca API (get from https://alpaca.markets/ - free tier available)
ALPACA_API_KEY=your_alpaca_api_key_here
ALPACA_SECRET_KEY=your_alpaca_secret_key_here
ALPACA_BASE_URL=https://data.alpaca.markets

# Environment
NODE_ENV=development
```

### 2. Database Setup

Ensure your Neon DB has the `public.eod_usmkts_price` table with lowercase column names:
- `symbol`, `trade_date`, `expiry_date`, `close`
- `put_low`, `put_int`, `comb_int`, `call_int`, `call_high`
- `put_oi`, `call_oi` (for OI_DIFF calculation)

### 3. Test the Application

**Try these URLs:**
- Home: http://localhost:3000
- Quadrant: http://localhost:3000/quadrant
- Stock Detail: http://localhost:3000/stock/AAPL

**Test the APIs:**
```bash
# Test Alpaca connection
curl http://localhost:3000/api/test-alpaca

# Test OHLC data
curl http://localhost:3000/api/stocks/AAPL/ohlc

# Test levels with historical data
curl "http://localhost:3000/api/stocks/AAPL/levels?expiry=2026-01-16&range=true"

# Test quadrant data
curl http://localhost:3000/api/quadrant/data
```

---

## 📊 How the System Works

### Level Calculation Formula

For each stock, we calculate 5 price levels using lowercase field names:

```typescript
put_low_dist  = (CLOSE - put_low) / CLOSE
put_int_dist  = (CLOSE - put_int) / CLOSE
comb_int_dist = (CLOSE - comb_int) / CLOSE
call_int_dist = (CLOSE - call_int) / CLOSE
call_high_dist= (CLOSE - call_high) / CLOSE
```

**The level with the value closest to 0 is highlighted in blue** - it indicates the price is near that level.

### Example (AAPL at $272):
- `put_low` = (272 - 153) / 272 = 0.4375 (43.75%)
- `put_int` = (272 - 197) / 272 = 0.2757 (27.57%)
- `comb_int` = (272 - 236) / 272 = 0.1324 (13.24%)
- **`call_int` = (272 - 264) / 272 = 0.0294 (2.94%)** ← **CLOSEST**
- `call_high` = (272 - 297) / 272 = -0.0919 (-9.19%)

Result: AAPL is 2.94% above the `call_int` level.

---

## 🎨 Features Overview

### TVChart (K-Line Chart)
- **Candlestick chart** from Alpaca API with dynamic date ranges
- **Volume bars** below the main chart
- **5 colored horizontal lines** for price levels
- **Closest level highlighted in blue** with solid line
- **Colored Y-axis markers** showing level prices
- **Interactive tooltip** showing:
  - Trading date
  - Open, High, Low, Close (color-coded)
  - All 5 support & resistance levels
  - Distance percentages from current price
- **Expiry date dropdown** to filter levels
- **Date-specific values** - levels change based on hovered date
- **Dynamic loading** - fetches more data when scrolling
- **Graceful degradation** - shows OHLC even without level data

### Quadrant Chart
- Scatter plot of all stocks
- Positioned by distance from close price
- Color-coded by closest level
- Click on any point to view that stock's chart
- Filters: search, proximity threshold

### Key Implementation Details
- **Data Sanitization**: All NULL/NaN values converted to 0
- **String Conversion**: Prices converted from strings to numbers
- **Historical Map**: Stores date → levels mapping for tooltips
- **Alpaca Integration**: Uses IEX feed for free tier compatibility

---

## 🔧 Development Commands

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Type checking
npx tsc --noEmit

# Lint code
npm run lint
```

---

## 📁 File Locations

### Need to modify something?

**API Endpoints:**
- `app/api/stocks/search/route.ts` - Stock search
- `app/api/stocks/[symbol]/route.ts` - Stock details
- `app/api/stocks/[symbol]/ohlc/route.ts` - OHLC data
- `app/api/stocks/[symbol]/levels/route.ts` - Level data
- `app/api/quadrant/data/route.ts` - Quadrant data

**Pages:**
- `app/page.tsx` - Home
- `app/stock/[symbol]/page.tsx` - Stock detail
- `app/quadrant/page.tsx` - Quadrant dashboard

**Charts:**
- `components/charts/TVChart.tsx` - Candlestick chart with level overlays (stock detail page)
- `components/charts/OptionContractChart.tsx` - Single option contract bars + OI history
- `components/charts/QuadrantChart.tsx` - Quadrant chart

**Services:**
- `lib/db.ts` - Database queries
- `lib/tradier.ts` - Tradier API calls
- `lib/calculations.ts` - Level calculations

---

## 🐛 Troubleshooting

### Database Connection Errors
- Check your `DATABASE_URL` in `.env.local`
- Verify the table `public.eod_usmkts_price` exists
- Test connection: `SELECT COUNT(*) FROM public.eod_usmkts_price;`

### Tradier API Errors
- Verify your `TRADIER_API_KEY` is valid
- Check rate limits (120 req/min for market data)
- Sandbox vs Production key?

### Chart Not Loading
- Check browser console for errors
- Verify data is being returned from API
- Try a different stock symbol

### No Data Showing
- Ensure your database has recent data
- Check the `TRADE_DATE` column values
- Verify data format matches the schema

---

## 📚 Additional Resources

- **Master Plan:** [PROJECT_MASTER_PLAN.md](PROJECT_MASTER_PLAN.md)
- **Next.js Docs:** https://nextjs.org/docs
- **Lightweight Charts:** https://tradingview.github.io/lightweight-charts/
- **Tradier API:** https://documentation.tradier.com/
- **Neon DB:** https://neon.tech/docs

---

## 🎯 Recommended Next Enhancements

1. **Add real-time updates** with WebSocket or polling
2. **User authentication** with NextAuth.js
3. **Watchlist feature** to save favorite stocks
4. **Export charts** as PNG/PDF
5. **Alert system** when stock near a level
6. **Historical comparison** view
7. **Mobile app** with React Native
8. **Dark mode** toggle
9. **Performance optimization** with Redis caching
10. **Backtesting** capabilities

---

## 💡 Tips

- The app uses Tailwind CSS for styling
- All calculations happen server-side in API routes
- Charts are client-side only (`'use client'`)
- TypeScript provides full type safety
- Error boundaries catch rendering errors

---

## 🚢 Ready to Deploy?

### Vercel (Recommended)
1. Push to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy!

### Other Platforms
- Netlify
- Railway
- Render
- AWS Amplify

---

**Happy Trading! 📈**
