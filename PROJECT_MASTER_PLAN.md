# Stock Analysis Website - Master Reference

**Project Name:** Neon Trade  
**Last Updated:** January 7, 2026  
**Status:** Implementation Complete - Active Development

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Core Features](#core-features)
3. [Tech Stack](#tech-stack)
4. [Architecture](#architecture)
5. [Database Schema](#database-schema)
6. [Calculation Formulas](#calculation-formulas)
7. [Development Phases](#development-phases)
8. [API Endpoints](#api-endpoints)
9. [Component Structure](#component-structure)
10. [File Structure](#file-structure)

---

## Project Overview

A modern stock analysis platform that combines real-time market data from Alpaca API with advanced options analytics stored in Neon DB. The platform features interactive K-line charts and a unique 5-quadrant visualization to identify stocks near critical price levels.

### Key Objectives

- Provide professional-grade charting with level indicators
- Visualize stock positions relative to put/call levels
- Enable quick identification of trading opportunities
- Deliver real-time and historical market data with dynamic date filtering

### Current Implementation Status

✅ **Completed:**
- Full Next.js application with 60+ files
- Alpaca API integration for OHLC data
- Neon DB queries with comprehensive sanitization
- Date-specific tooltip values with historical level data
- Expiry date filtering with dynamic data refresh
- Colored Y-axis markers for price levels
- Graceful degradation when stoAlpaca API)
- Volume bars
- 5 horizontal level lines:
  - `put_LOW` - Red (#EF4444)
  - `put_INT` - Orange (#F97316)
  - `comb_INT` - Yellow (#EAB308)
  - `call_INT` - Light Green (#84CC16)
  - `call_HIGH` - Green (#22C55E)
- Closest level highlighted with blue (#3B82F6) solid line
- Colored Y-axis labels for each level
- Interactive tooltip showing:
  - Trading date
  - Open, High, Low, Close prices (color-coded)
  - All 5 support & resistance levels with distances
  - Date-specific level values (from historical data Map)
- Expiry date dropdown for filtering
- Dynamic data loading on scroll
- Real-time price updates

**Data Sources:**
- OHLC Data: Alpaca API (`/v2/stocks/bars` endpoint)
- Level Data: Neon DB `public.eod_usmkts_price`
- Historical Levels: API endpoint with `range=true` parameter showing OHLC data with overlaid price levels from options data.

**Components:**
- Candlestick chart (OHLC from Tradier API)
- Volume bars
- 5 horizontal level lines:
  - `PUT_LOW` - Red (#EF4444)
  - `PUT_INT` - Orange (#F97316)
  - `PUT_CALL_INT` - Yellow (#EAB308)
  - `CALL_INT` - Light Green (#84CC16)
  - `CALL_HIGH` - Green (#22C55E)
- Closest level highlighted with bold line + label
- Interactive crosshair
- Date range selector
- Real-time price updates

**Data Sources:**
- OHLC Data: Tradier API
- Level Data: Neon DB `public.eod_usmkts_price`

### 2. 5-Quadrant Scatter Plot

**Description:** Scatter plot showing all stocks positioned based on their proximity to the 5 calculated levels.

**Quadrant Layout:**
```
         call_high (< 0)
               |
  call_int ----+---- put_call_int
               |
      put_int/put_low (> 0)
```

**Visual Elements:**
- Each stock = one point
- Color-coded by closest level
- Size optional (by market cap/volume)
- Hover tooltip with all 5 levels + close price
- Filters: sector, date range, symbol search
- Threshold slider

**Data Source:** Neon DB `public.eod_usmkts_price`

---

## Tech Stack

### Frontend
```json
{
  "framework": "Next.js 15 (App Router)",
  "language": "TypeScript",
  "styling": "Tailwind CSS",
  "charts": {
    "kline": "lightweight-charts 4.2.2",
    "quadrant": "recharts 2.15.0"
  },
  "state": "React hooks (useState, useEffect, useRef)",
  "http": "axios 1.7.9",
  "dates": "date-fns"
}
```

### Backend
```json
{
  "runtime": "Node.js (Next.js API Routes)",
  "database": "@neondatabase/serverless 0.10.4",
  "marketData": "Alpaca Markets API (data.alpaca.markets)",
  "dataFormat": {
    "dates": "YYYY-MM-DD",
    "prices": "Numbers (converted from strings)",
    "nullHandling": "COALESCE + sanitization"
  }
}
```

### Backend
```json
{
  "api": "Next.js API Routes",
  "database": "@neondatabase/serverless",
  "external": "Tradier API",
  "cache": "In-memory / Redis (optional)"
}
```

### DevOps
```json
{
  "hosting": "Vercel",
  "database": "Neon DB (PostgreSQL)",
  "monitoring": "Vercel Analytics",
  "ci_cd": "GitHub Actions"
}
```

---

## Architecture

### High-Level Architecture

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │
       ├─────────────────────────────┐
       │                             │
       v                             v
┌─────────────────┐          ┌─────────────┐
│   Next.js App   │          │  API Routes │
│   (Frontend)    │◄─────────┤  (Backend)  │
└─────────────────┘          └──────┬──────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    v               v               v
             ┌──────────┐    ┌──────────┐   ┌──────────────┐
             │ Neon DB  │    │  Alpaca  │   │ Historical   │
             │(Postgres)│    │   API    │   │ Levels Map   │
             └──────────┘    └──────────┘   └──────────────┘
```

### Data Flow

1. **User Request** → Frontend Component
2. **API Call** → Next.js API Route
3. **Data Fetch** → Neon DB (levels) + Alpaca API (OHLC)
4. **Calculation** → Compute 5 levels & determine closest
5. **Historical Data** → Fetch range of dates for selected expiry
6. **Map Storage** → Store date → {levels, closestLevel} mapping
7. **Response** → JSON data to frontend
8. **Render** → Charts display with data
9. **Tooltip Interaction** → Lookup date in Map for specific values

### Current Implementation Architecture

**Stock Detail Page Flow:**
```
1. Mount → Fetch OHLC (90 days default)
2. Parse expiry dates from OHLC
3. Fetch historical levels for first expiry
4. Store in Map<date, {levels, closestLevel}>
5. Find latest available date
6. Set current levels from latest date
7. User selects different expiry
8. Refetch historical levels
9. Update Map and current levels
10. Chart re-renders with new data
```

**Tooltip Logic:**
```
1. User hovers over candle
2. Get date string from time parameter
3. Check historicalLevels.get(dateStr)
4. If found: use date-specific levels
5. If not found: use default levels
6. Render OHLC + levels in tooltip
7. Highlight closest level in blue
```

**Data Sanitization Pipeline:**
```
Database → COALESCE(column, 0) → JavaScript sanitizeNumeric() 
→ parseFloat() for prices → Valid numbers guaranteed
```

---

## Database Schema

### Existing Table: `public.eod_usmkts_price`

```sql
CREATE TABLE public.eod_usmkts_price (
    SYMBOL VARCHAR(10),
    EXPIRY_DT DATE,
    TRADE_DATE DATE,
    OPEN DECIMAL(10,2),
    HIGH DECIMAL(10,2),
    LOW DECIMAL(10,2),
    CLOSE DECIMAL(10,2),
    PUT_INT DECIMAL(10,2),
    CALL_INT DECIMAL(10,2),
    PUT_CALL_INT DECIMAL(10,2),
    call_low DECIMAL(10,2),
    put_HIGH DECIMAL(10,2),
    call_HIGH DECIMAL(10,2),
    put_LOW DECIMAL(10,2),
    UNUSED_PC DECIMAL(10,4),
    UNUSED_PC_REV DECIMAL(10,4),
    CALL_OI INTEGER,
    PUT_OI INTEGER,
    OI_DIFF INTEGER
);

-- Recommended Indexes
CREATE INDEX idx_symbol_date ON public.eod_usmkts_price(SYMBOL, TRADE_DATE DESC);
CREATE INDEX idx_trade_date ON public.eod_usmkts_price(TRADE_DATE DESC);
CREATE INDEX idx_symbol_expiry ON public.eod_usmkts_price(SYMBOL, EXPIRY_DT);
```

### Sample Data

```
SYMBOL: AAPL
EXPIRY_DT: 2026-01-16
TRADE_DATE: 2025-12-19
OPEN: 274
HIGH: 274
LOW: 267
CLOSE: 272
PUT_INT: 197
CALL_INT: 264
PUT_CALL_INT: 236
call_low: 208
put_HIGH: 242
call_HIGH: 297
put_LOW: 153
UNUSED_PC: 0.0200
UNUSED_PC_REV: 41.4
CALL_OI: 1021857
PUT_OI: 735916
OI_DIFF: -285941
```

---

## Calculation Formulas

### Level Calculations

For a given stock record, calculate the percentage distance from CLOSE to each level:

```typescript
interface LevelCalculation {
  name: string;
  value: number;      // Percentage distance
  price: number;      // Actual price level
  distance: number;   // Absolute distance
}

function calculateLevels(data: StockData): LevelCalculation[] {
  const { CLOSE, PUT_LOW, PUT_INT, PUT_CALL_INT, CALL_INT, CALL_HIGH } = data;
  
  return [
    {
      name: 'put_low',
      value: (CLOSE - PUT_LOW) / CLOSE,
      price: PUT_LOW,
      distance: Math.abs(CLOSE - PUT_LOW)
    },
    {
      name: 'put_int',
      value: (CLOSE - PUT_INT) / CLOSE,
      price: PUT_INT,
      distance: Math.abs(CLOSE - PUT_INT)
    },
    {
      name: 'put_call_int',
      value: (CLOSE - PUT_CALL_INT) / CLOSE,
      price: PUT_CALL_INT,
      distance: Math.abs(CLOSE - PUT_CALL_INT)
    },
    {
      name: 'call_int',
      value: (CLOSE - CALL_INT) / CLOSE,
      price: CALL_INT,
      distance: Math.abs(CLOSE - CALL_INT)
    },
    {
      name: 'call_high',
      value: (CLOSE - CALL_HIGH) / CLOSE,
      price: CALL_HIGH,
      distance: Math.abs(CLOSE - CALL_HIGH)
    }
  ];
}
```

### Example Calculation (AAPL)

```
CLOSE = 272

put_low     = (272 - 153) / 272 = 0.4375  (43.75%)
put_int     = (272 - 197) / 272 = 0.2757  (27.57%)
put_call_int= (272 - 236) / 272 = 0.1324  (13.24%)
call_int    = (272 - 264) / 272 = 0.0294  (2.94%)   ← CLOSEST
call_high   = (272 - 297) / 272 = -0.0919 (-9.19%)
```

**Result:** AAPL is closest to `call_int` level (2.94% above)

### Finding Closest Level

```typescript
function findClosestLevel(levels: LevelCalculation[]): LevelCalculation {
  return levels.reduce((closest, current) => {
    return Math.abs(current.value) < Math.abs(closest.value) 
      ? current 
      : closest;
  });
}
```

---

## Development Phases

### Phase 1: Project Setup & Infrastructure (Week 1)

**Tasks:**
- [x] Create project plan
- [ ] Initialize Next.js project with TypeScript
- [ ] Install dependencies
- [ ] Configure Tailwind CSS
- [ ] Set up environment variables
- [ ] Configure Neon DB connection
- [ ] Set up Tradier API client
- [ ] Create database indexes

**Deliverables:**
- Working Next.js app
- Database connection established
- API client ready

---

### Phase 2: Backend Development (Week 2)

**Tasks:**
- [ ] Create API route structure
- [ ] Implement stock search endpoint
- [ ] Implement OHLC data endpoint (Tradier)
- [ ] Implement levels endpoint (Neon DB)
- [ ] Implement quadrant data endpoint
- [ ] Create calculation service
- [ ] Add error handling
- [ ] Implement caching layer

**Deliverables:**
- All API endpoints functional
- Data processing logic complete
- TypeScript types defined

---

### Phase 3: K-Line Chart Component (Week 3)

**Tasks:**
- [ ] Set up lightweight-charts library
- [ ] Create KLineChart component
- [ ] Integrate Tradier OHLC data
- [ ] Add volume bars
- [ ] Implement 5 level lines
- [ ] Highlight closest level
- [ ] Add interactive crosshair
- [ ] Create tooltip with level info
- [ ] Add date range selector
- [ ] Responsive design

**Deliverables:**
- Fully functional K-line chart
- Level indicators working
- Interactive features complete

---

### Phase 4: 5-Quadrant Scatter Chart (Week 4)

**Tasks:**
- [ ] Set up Recharts library
- [ ] Create QuadrantChart component
- [ ] Calculate quadrant positions
- [ ] Plot stocks as points
- [ ] Color-code by closest level
- [ ] Implement hover tooltip
- [ ] Add quadrant dividing lines
- [ ] Create filters (sector, date, symbol)
- [ ] Add threshold slider
- [ ] Responsive design

**Deliverables:**
- Quadrant chart functional
- All filters working
- Interactive features complete

---

### Phase 5: UI/UX Design (Week 5)

**Tasks:**
- [ ] Design layout structure
- [ ] Create home page
- [ ] Create stock detail page
- [ ] Create quadrant dashboard page
- [ ] Implement dark mode
- [ ] Add loading states
- [ ] Create error boundaries
- [ ] Mobile responsive design
- [ ] Add navigation
- [ ] Create search component

**Deliverables:**
- Complete UI/UX
- All pages functional
- Responsive across devices

---

### Phase 6: Optimization & Testing (Week 6)

**Tasks:**
- [ ] Implement caching strategy
- [ ] Optimize database queries
- [ ] Lazy load components
- [ ] Image optimization
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] E2E testing
- [ ] Performance testing
- [ ] Deploy to Vercel
- [ ] Set up CI/CD

**Deliverables:**
- Production-ready application
- All tests passing
- Deployed and monitored

---

## API Endpoints

### Stock Endpoints

#### GET `/api/stocks/search?q={query}`
Search for stocks by symbol or name.

**Response:**
```json
{
  "results": [
    {
      "symbol": "AAPL",
      "name": "Apple Inc.",
      "exchange": "NASDAQ"
    }
  ]
}
```

---

#### GET `/api/stocks/[symbol]`
Get stock details and latest levels.

**Response:**
```json
{
  "symbol": "AAPL",
  "close": 272.00,
  "tradeDate": "2025-12-19",
  "levels": [
    {
      "name": "put_low",
      "value": 0.4375,
      "price": 153.00,
      "distance": 119.00
    },
    // ... other levels
  ],
  "closestLevel": {
    "name": "call_int",
    "value": 0.0294,
    "price": 264.00
  }
}
```

---

#### GET `/api/stocks/[symbol]/ohlc?from={date}&to={date}`
Get OHLC data from Tradier API.

**Query Params:**
- `from`: Start date (YYYY-MM-DD)
- `to`: End date (YYYY-MM-DD)
- `interval`: daily|weekly|monthly (default: daily)

**Response:**
```json
{
  "symbol": "AAPL",
  "data": [
    {
      "date": "2025-12-19",
      "open": 274.00,
      "high": 274.00,
      "low": 267.00,
      "close": 272.00,
      "volume": 45000000
    }
    // ... more candles
  ]
}
```

---

#### GET `/api/stocks/[symbol]/levels?date={date}`
Get calculated levels from Neon DB.

**Response:**
```json
{
  "symbol": "AAPL",
  "date": "2025-12-19",
  "close": 272.00,
  "levels": {
    "put_low": 153.00,
    "put_int": 197.00,
    "put_call_int": 236.00,
    "call_int": 264.00,
    "call_high": 297.00
  },
  "calculated": [
    {
      "name": "put_low",
      "percentage": 43.75,
      "distance": 119.00
    }
    // ... other calculations
  ],
  "closestLevel": "call_int"
}
```

---

### Quadrant Endpoints

#### GET `/api/quadrant/data?date={date}&sector={sector}`
Get all stocks with quadrant positions.

**Query Params:**
- `date`: Trade date (YYYY-MM-DD) - defaults to latest
- `sector`: Filter by sector (optional)
- `threshold`: Only show stocks within X% of a level (optional)

**Response:**
```json
{
  "date": "2025-12-19",
  "stocks": [
    {
      "symbol": "AAPL",
      "close": 272.00,
      "levels": [
        { "name": "put_low", "value": 0.4375 },
        { "name": "put_int", "value": 0.2757 },
        { "name": "put_call_int", "value": 0.1324 },
        { "name": "call_int", "value": 0.0294 },
        { "name": "call_high", "value": -0.0919 }
      ],
      "closestLevel": "call_int",
      "closestValue": 0.0294
    }
    // ... more stocks
  ]
}
```

---

## Component Structure

### Pages

#### `app/page.tsx` - Home Page
- Featured stocks
- Market overview
- Quick search
- Navigation to main features

#### `app/stock/[symbol]/page.tsx` - Stock Detail
- K-line chart with levels
- Stock information card
- Levels table
- Historical data

#### `app/quadrant/page.tsx` - Quadrant Dashboard
- 5-quadrant scatter plot
- Filters panel
- Stock list
- Legend

---

### Components

#### `components/KLineChart.tsx`

> **As built:** this shipped as `components/charts/TVChart.tsx`, on
> `lightweight-charts` rather than the `klinecharts` library the name suggests.
> The sketch below is the original plan, kept for history — the real props are
> considerably wider (historical levels, OI series, scan-alert markers).

```typescript
interface KLineChartProps {
  symbol: string;
  ohlcData: OHLCData[];
  levels: LevelData;
  height?: number;
}

export default function KLineChart({ symbol, ohlcData, levels, height = 400 }: KLineChartProps) {
  // Implementation
}
```

**Features:**
- Candlestick series
- Volume histogram
- 5 level lines
- Crosshair
- Legend
- Zoom/pan

---

#### `components/QuadrantChart.tsx`
```typescript
interface QuadrantChartProps {
  data: QuadrantStock[];
  onStockClick?: (symbol: string) => void;
  filters?: QuadrantFilters;
}

export default function QuadrantChart({ data, onStockClick, filters }: QuadrantChartProps) {
  // Implementation
}
```

**Features:**
- Scatter plot
- Color-coded points
- Hover tooltip
- Quadrant lines
- Click to navigate

---

#### `components/LevelIndicators.tsx`
```typescript
interface LevelIndicatorsProps {
  levels: LevelCalculation[];
  closestLevel: string;
}

export default function LevelIndicators({ levels, closestLevel }: LevelIndicatorsProps) {
  // Implementation
}
```

**Features:**
- List of all 5 levels
- Highlight closest
- Show percentages
- Color-coded

---

#### `components/StockSearch.tsx`
```typescript
interface StockSearchProps {
  onSelect: (symbol: string) => void;
}

export default function StockSearch({ onSelect }: StockSearchProps) {
  // Implementation
}
```

**Features:**
- Autocomplete
- Search by symbol/name
- Recent searches
- Keyboard navigation

---

## File Structure

```
neon_trade/
├── .env.local                    # Environment variables
├── .gitignore
├── next.config.js
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── PROJECT_MASTER_PLAN.md        # This file
│
├── app/
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Home page
│   │
│   ├── api/
│   │   ├── stocks/
│   │   │   ├── search/
│   │   │   │   └── route.ts      # Stock search
│   │   │   └── [symbol]/
│   │   │       ├── route.ts      # Stock details
│   │   │       ├── ohlc/
│   │   │       │   └── route.ts  # OHLC data
│   │   │       └── levels/
│   │   │           └── route.ts  # Level data
│   │   └── quadrant/
│   │       └── data/
│   │           └── route.ts      # Quadrant data
│   │
│   ├── stock/
│   │   └── [symbol]/
│   │       └── page.tsx          # Stock detail page
│   │
│   └── quadrant/
│       └── page.tsx              # Quadrant dashboard
│
├── components/
│   ├── charts/
│   │   ├── KLineChart.tsx        # K-line chart component (shipped as TVChart.tsx)
│   │   ├── QuadrantChart.tsx     # Quadrant chart component
│   │   └── LevelIndicators.tsx   # Level display component
│   │
│   ├── ui/
│   │   ├── StockSearch.tsx       # Search component
│   │   ├── DateRangePicker.tsx   # Date picker
│   │   ├── FilterPanel.tsx       # Filters
│   │   ├── LoadingSpinner.tsx    # Loading state
│   │   └── ErrorBoundary.tsx     # Error handling
│   │
│   └── layout/
│       ├── Header.tsx            # Site header
│       ├── Navigation.tsx        # Navigation menu
│       └── Footer.tsx            # Site footer
│
├── lib/
│   ├── db.ts                     # Neon DB client & queries
│   ├── tradier.ts                # Tradier API client
│   ├── calculations.ts           # Level calculation functions
│   ├── cache.ts                  # Caching utilities
│   └── utils.ts                  # Helper functions
│
├── types/
│   ├── stock.ts                  # Stock-related types
│   ├── chart.ts                  # Chart-related types
│   └── api.ts                    # API response types
│
├── hooks/
│   ├── useStockData.ts           # Stock data hook
│   ├── useQuadrantData.ts        # Quadrant data hook
│   └── useDebounce.ts            # Debounce hook
│
└── styles/
    └── globals.css               # Global styles
```

---

## TypeScript Types

### Core Types

```typescript
// types/stock.ts

export interface StockData {
  SYMBOL: string;
  EXPIRY_DT: string;
  TRADE_DATE: string;
  OPEN: number;
  HIGH: number;
  LOW: number;
  CLOSE: number;
  PUT_INT: number;
  CALL_INT: number;
  PUT_CALL_INT: number;
  call_low: number;
  put_HIGH: number;
  call_HIGH: number;
  put_LOW: number;
  UNUSED_PC: number;
  UNUSED_PC_REV: number;
  CALL_OI: number;
  PUT_OI: number;
  OI_DIFF: number;
}

export interface LevelCalculation {
  name: 'put_low' | 'put_int' | 'put_call_int' | 'call_int' | 'call_high';
  value: number;      // Percentage (e.g., 0.0294 for 2.94%)
  price: number;      // Actual price level
  distance: number;   // Absolute distance from close
}

export interface StockWithLevels {
  symbol: string;
  close: number;
  tradeDate: string;
  levels: LevelCalculation[];
  closestLevel: LevelCalculation;
}

export interface OHLCData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface QuadrantStock {
  symbol: string;
  close: number;
  levels: LevelCalculation[];
  closestLevel: string;
  closestValue: number;
  sector?: string;
  marketCap?: number;
}

export interface QuadrantFilters {
  sector?: string;
  dateRange?: { from: string; to: string };
  threshold?: number;
  search?: string;
}
```

---

## Environment Variables

```bash
# .env.local

# Database
DATABASE_URL=postgresql://user:password@host/database?sslmode=require

# Tradier API
TRADIER_API_KEY=your_tradier_api_key
TRADIER_API_URL=https://api.tradier.com/v1

# Optional
REDIS_URL=redis://localhost:6379
NODE_ENV=development
```

---

## Color Scheme

### Level Colors

```css
/* Level color palette */
--level-put-low: #EF4444;       /* Red */
--level-put-int: #F97316;       /* Orange */
--level-put-call-int: #EAB308;  /* Yellow */
--level-call-int: #84CC16;      /* Light Green */
--level-call-high: #22C55E;     /* Green */

/* Highlight */
--level-closest: #3B82F6;       /* Blue - bold */
```

### UI Colors (Tailwind)

```javascript
// tailwind.config.ts
module.exports = {
  theme: {
    extend: {
      colors: {
        levels: {
          putLow: '#EF4444',
          putInt: '#F97316',
          putCallInt: '#EAB308',
          callInt: '#84CC16',
          callHigh: '#22C55E',
          closest: '#3B82F6'
        }
      }
    }
  }
}
```

---

## Key SQL Queries

### Get Latest Levels for a Stock

```sql
SELECT 
  SYMBOL,
  TRADE_DATE,
  CLOSE,
  PUT_LOW,
  PUT_INT,
  PUT_CALL_INT,
  CALL_INT,
  CALL_HIGH
FROM public.eod_usmkts_price
WHERE SYMBOL = $1
ORDER BY TRADE_DATE DESC
LIMIT 1;
```

### Get Historical Data

```sql
SELECT 
  TRADE_DATE,
  CLOSE,
  PUT_LOW,
  PUT_INT,
  PUT_CALL_INT,
  CALL_INT,
  CALL_HIGH
FROM public.eod_usmkts_price
WHERE SYMBOL = $1
  AND TRADE_DATE BETWEEN $2 AND $3
ORDER BY TRADE_DATE ASC;
```

### Get All Stocks for Quadrant (Latest Date)

```sql
SELECT 
  SYMBOL,
  CLOSE,
  PUT_LOW,
  PUT_INT,
  PUT_CALL_INT,
  CALL_INT,
  CALL_HIGH
FROM public.eod_usmkts_price
WHERE TRADE_DATE = (
  SELECT MAX(TRADE_DATE) 
  FROM public.eod_usmkts_price
)
ORDER BY SYMBOL;
```

---

## Dependencies

### Production Dependencies

```json
{
  "dependencies": {
    "next": "^14.1.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@neondatabase/serverless": "^0.9.0",
    "lightweight-charts": "^4.1.0",
    "recharts": "^2.10.0",
    "axios": "^1.6.0",
    "date-fns": "^3.0.0",
    "zustand": "^4.4.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0"
  }
}
```

### Dev Dependencies

```json
{
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "typescript": "^5.3.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "eslint": "^8.55.0",
    "eslint-config-next": "^14.1.0"
  }
}
```

---

## Performance Considerations

### Caching Strategy

1. **API Response Caching**
   - Cache Tradier API responses (5-15 min)
   - Cache Neon DB queries (1-5 min)
   - Use in-memory cache or Redis

2. **Client-Side Caching**
   - React Query / SWR for data fetching
   - LocalStorage for user preferences

3. **Database Optimization**
   - Add indexes on frequently queried columns
   - Use connection pooling
   - Implement query result caching

### Chart Optimization

1. **Data Decimation**
   - Limit candles displayed (max 500-1000)
   - Implement pagination for historical data
   - Use time-based aggregation for older data

2. **Lazy Loading**
   - Load charts only when visible
   - Defer heavy calculations
   - Use React.lazy for code splitting

---

## Testing Strategy

### Unit Tests
- Calculation functions
- Utility functions
- Data transformations

### Integration Tests
- API endpoints
- Database queries
- External API calls

### E2E Tests
- User flows (search → chart view)
- Chart interactions
- Filter functionality

### Test Files
```
__tests__/
├── unit/
│   ├── calculations.test.ts
│   └── utils.test.ts
├── integration/
│   ├── api-stocks.test.ts
│   └── api-quadrant.test.ts
└── e2e/
    ├── stock-detail.test.ts
    └── quadrant-chart.test.ts
```

---

## Deployment Checklist

- [ ] Environment variables configured in Vercel
- [ ] Database connection tested in production
- [ ] Tradier API key validated
- [ ] All API endpoints tested
- [ ] Error logging set up
- [ ] Performance monitoring enabled
- [ ] Custom domain configured (optional)
- [ ] SSL certificate active
- [ ] CI/CD pipeline working
- [ ] Backup strategy in place

---

## Future Enhancements

### Phase 2 Features
- User authentication & watchlists
- Email/SMS alerts when stock near level
- Social sharing of charts
- Export chart as image
- Mobile app (React Native)

### Advanced Analytics
- Machine learning predictions
- Backtesting framework
- Strategy builder
- Risk analysis tools
- Portfolio tracking

### Community Features
- User comments/discussions
- Trade ideas sharing
- Leaderboards
- Educational content

---

## Support & Resources

### Documentation
- [Next.js Docs](https://nextjs.org/docs)
- [Lightweight Charts](https://tradingview.github.io/lightweight-charts/)
- [Recharts](https://recharts.org/)
- [Neon DB](https://neon.tech/docs)
- [Tradier API](https://documentation.tradier.com/)

### Team Contacts
- Project Lead: [Your Name]
- Database Admin: [Name]
- API Integration: [Name]

---

## Notes & Decisions

### Design Decisions

**Why Lightweight Charts?**
- Free and open source
- High performance
- Professional appearance
- Active development

**Why Recharts for Quadrant?**
- Good for scatter plots
- Customizable
- React-friendly

**Why Next.js?**
- SSR/SSG capabilities
- API routes (no separate backend)
- Great developer experience
- Vercel deployment integration

### Known Limitations

1. Tradier API rate limits (120 req/min for market data)
2. Free tier may require caching strategy
3. Real-time updates may need WebSocket (future)

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-06 | 0.1.0 | Initial project plan created |

---

**End of Master Reference Document**
