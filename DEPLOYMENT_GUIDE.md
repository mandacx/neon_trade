# Neon Trade - Vercel Deployment Guide

## Prerequisites

- [x] GitHub repository with your code
- [x] Vercel account (sign up at https://vercel.com)
- [x] Neon PostgreSQL database (already configured)
- [x] Alpaca API credentials
- [x] Tradier API credentials

## Pre-Deployment Checklist

### 1. Environment Variables Required

Create these in Vercel project settings:

```bash
# Database
DATABASE_URL=postgresql://neondb_owner:npg_yPg9n3SERzdf@ep-old-glitter-adyf8j6k-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require

# Alpaca API
ALPACA_API_KEY=AKONJCBJFP6CNSXASUE1
ALPACA_SECRET_KEY=nG7C0Y9nX4sWljSrcD4bzhfh7ThIwD57q81eaIr7
ALPACA_BASE_URL=https://data.alpaca.markets

# Tradier API
TRADIER_API_KEY=tQU9at0gbJ4mbYnv9awAYeKLaJLK
TRADIER_API_URL=https://api.tradier.com/v1

# Environment
NODE_ENV=production
```

### 2. Verify Build Configuration

✅ **Package.json scripts** (already configured):
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  }
}
```

### 3. Check Dependencies

All required dependencies are in package.json:
- ✅ Next.js 15.1.4
- ✅ React 19
- ✅ @neondatabase/serverless
- ✅ lightweight-charts
- ✅ recharts
- ✅ All other dependencies

## Deployment Steps

### Option 1: Deploy via Vercel Dashboard (Recommended)

#### Step 1: Push to GitHub
```bash
# Initialize git if not already done
git init

# Add all files
git add .

# Commit changes
git commit -m "Initial commit - ready for deployment"

# Add remote repository (replace with your repo URL)
git remote add origin https://github.com/YOUR_USERNAME/neon_trade.git

# Push to GitHub
git push -u origin main
```

#### Step 2: Import to Vercel

1. Go to https://vercel.com/dashboard
2. Click **"Add New..."** → **"Project"**
3. Import your GitHub repository `neon_trade`
4. Vercel will auto-detect Next.js configuration

#### Step 3: Configure Environment Variables

1. In the project setup screen, click **"Environment Variables"**
2. Add each variable from the list above:
   - Variable name: `DATABASE_URL`
   - Value: `postgresql://neondb_owner:...`
   - Environment: Select **Production**, **Preview**, and **Development**
3. Repeat for all variables
4. Click **"Deploy"**

#### Step 4: Wait for Build

- Vercel will automatically:
  - Install dependencies (`npm install`)
  - Run build (`npm run build`)
  - Deploy to edge network
- Build time: ~2-5 minutes

#### Step 5: Verify Deployment

Once deployed, you'll get a URL like:
```
https://neon-trade.vercel.app
```

Test the following pages:
- ✅ Home page: `/`
- ✅ Stock detail: `/stock/AAPL`
- ✅ Quadrant analysis: `/quadrant`
- ✅ API endpoints: `/api/quadrant/data`

### Option 2: Deploy via Vercel CLI

```bash
# Install Vercel CLI globally
npm install -g vercel

# Login to Vercel
vercel login

# Deploy to production
vercel --prod

# Follow prompts and add environment variables when asked
```

## Post-Deployment Configuration

### 1. Custom Domain (Optional)

1. Go to your project in Vercel Dashboard
2. Navigate to **Settings** → **Domains**
3. Add your custom domain
4. Update DNS records as instructed

### 2. Environment-Specific Variables

If you need different settings for preview deployments:

1. Go to **Settings** → **Environment Variables**
2. Create separate variables for:
   - **Production** (production branch only)
   - **Preview** (all preview deployments)
   - **Development** (local development)

### 3. Enable Analytics (Optional)

1. Go to **Analytics** tab in your project
2. Enable **Web Analytics** for traffic insights
3. Enable **Speed Insights** for performance monitoring

## Troubleshooting

### Build Failures

**Issue**: Build fails with module errors
```bash
Solution: Clear build cache
vercel --force
```

**Issue**: Environment variables not found
```bash
Solution: 
1. Check variables are set in Vercel Dashboard
2. Redeploy: Vercel → Deployments → ... → Redeploy
```

### Runtime Errors

**Issue**: Database connection fails
```bash
Solution: Verify DATABASE_URL is correct
- Check Neon database is active
- Ensure connection string includes ?sslmode=require
- Test connection locally first
```

**Issue**: API routes return 500 errors
```bash
Solution: Check Vercel Function Logs
1. Go to Vercel Dashboard → Project
2. Click on deployment → Functions tab
3. View logs for specific API route
```

### Performance Issues

**Issue**: Cold starts on API routes
```bash
Solution: 
- Neon serverless is optimized for this
- Consider upgrading Vercel plan for better performance
- Database connections pool automatically
```

## Monitoring & Maintenance

### 1. Check Logs

Access logs in Vercel Dashboard:
- **Runtime Logs**: Real-time function execution logs
- **Build Logs**: Build process details
- **Error Logs**: Caught errors and exceptions

### 2. Database Monitoring

Monitor your Neon database:
1. Login to https://console.neon.tech
2. Check connection usage
3. Monitor query performance
4. Set up alerts for connection limits

### 3. API Usage Monitoring

Track API usage for:
- **Alpaca API**: Check quota at https://alpaca.markets
- **Tradier API**: Monitor at https://developer.tradier.com

### 4. Set Up Alerts

Configure Vercel notifications:
1. Go to **Settings** → **Notifications**
2. Enable alerts for:
   - Failed deployments
   - High error rates
   - Performance degradation

## CI/CD Pipeline

Vercel automatically sets up CI/CD:

1. **Push to GitHub** → Vercel auto-deploys
2. **Pull Request** → Vercel creates preview deployment
3. **Merge to main** → Vercel deploys to production

### Branch Configuration

Configure branch deployments:
1. **Settings** → **Git**
2. Set **Production Branch**: `main` or `master`
3. Enable/disable automatic deployments for branches

## Security Best Practices

### 1. Environment Variables

✅ Never commit `.env.local` to git
✅ Use Vercel's encrypted environment variables
✅ Rotate API keys regularly

### 2. Database Security

✅ Use connection pooling (already configured with Neon)
✅ Enable SSL mode (already in DATABASE_URL)
✅ Limit database user permissions

### 3. API Rate Limiting

Consider implementing rate limiting for API routes:
```typescript
// Example: Add rate limiting to API routes
// You can implement this later if needed
```

## Scaling Considerations

### Current Setup
- ✅ Serverless functions (auto-scales)
- ✅ Edge network CDN
- ✅ Connection pooling (Neon)

### When to Scale
- Monitor response times in Vercel Analytics
- Check database connection usage in Neon
- Upgrade Vercel plan if needed for:
  - More function execution time
  - Higher bandwidth
  - Team collaboration features

## Cost Estimates

### Vercel
- **Hobby (Free)**: 
  - 100 GB bandwidth/month
  - Unlimited deployments
  - Good for MVP and testing

- **Pro ($20/month)**:
  - 1 TB bandwidth
  - Priority support
  - Team features

### Neon Database
- **Free Tier**: 
  - 0.5 GB storage
  - 100 hours compute/month
  - Good for development

- **Scale ($19/month)**:
  - Unlimited compute
  - 10 GB storage
  - Better for production

### APIs
- **Alpaca**: Free for market data
- **Tradier**: Free sandbox, paid for live trading

## Rollback Strategy

If something goes wrong after deployment:

1. **Via Dashboard**:
   - Go to **Deployments**
   - Find previous working deployment
   - Click **...** → **Promote to Production**

2. **Via CLI**:
   ```bash
   vercel rollback
   ```

## Next Steps After Deployment

1. ✅ Test all features in production
2. ✅ Set up custom domain
3. ✅ Enable analytics
4. ✅ Configure monitoring alerts
5. ✅ Document API endpoints
6. ✅ Set up error tracking (e.g., Sentry)
7. ✅ Configure backup strategy for database

## Support Resources

- **Vercel Docs**: https://vercel.com/docs
- **Next.js Docs**: https://nextjs.org/docs
- **Neon Docs**: https://neon.tech/docs
- **Vercel Discord**: https://vercel.com/discord
- **GitHub Issues**: For project-specific issues

---

## Quick Reference Commands

```bash
# Local development
npm run dev

# Build locally (test before deploy)
npm run build
npm run start

# Deploy to Vercel
vercel --prod

# Check logs
vercel logs [deployment-url]

# List deployments
vercel ls

# Rollback
vercel rollback
```

## Verification Checklist Post-Deployment

- [ ] Home page loads correctly
- [ ] Stock detail pages work (try `/stock/AAPL`)
- [ ] Quadrant analysis loads with filters
- [ ] Charts render properly
- [ ] API endpoints respond correctly
- [ ] Database queries execute successfully
- [ ] No console errors in browser
- [ ] Mobile responsive design works
- [ ] All environment variables are set
- [ ] SSL certificate is active
- [ ] Performance is acceptable (<3s load time)

---

**Deployment Date**: _____________
**Deployed By**: _____________
**Production URL**: _____________
**Notes**: _____________
