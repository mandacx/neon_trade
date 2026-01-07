# Pre-Deployment Checklist

## Code Preparation
- [ ] All features tested locally
- [ ] No console errors in browser dev tools
- [ ] Build runs successfully (`npm run build`)
- [ ] All TypeScript errors resolved
- [ ] `.env.local` is NOT committed to git

## Git Repository
- [ ] Code pushed to GitHub/GitLab
- [ ] Repository is accessible
- [ ] Branch strategy defined (main/master for production)

## Vercel Setup
- [ ] Vercel account created
- [ ] Project imported from Git
- [ ] Framework preset: Next.js (auto-detected)
- [ ] Build command: `next build` (default)
- [ ] Output directory: `.next` (default)

## Environment Variables (Add in Vercel Dashboard)
- [ ] `DATABASE_URL` - Neon PostgreSQL connection string
- [ ] `ALPACA_API_KEY` - Alpaca API key
- [ ] `ALPACA_SECRET_KEY` - Alpaca secret key  
- [ ] `ALPACA_BASE_URL` - https://data.alpaca.markets
- [ ] `TRADIER_API_KEY` - Tradier API key
- [ ] `TRADIER_API_URL` - https://api.tradier.com/v1
- [ ] `NODE_ENV` - production

## Database (Neon)
- [ ] Database is active and accessible
- [ ] Connection pooling enabled
- [ ] Tables created with correct schema
- [ ] Sample data loaded (optional)
- [ ] SSL mode enabled in connection string

## API Keys
- [ ] Alpaca API keys are for production (not sandbox)
- [ ] Tradier API key has necessary permissions
- [ ] API rate limits understood
- [ ] Keys are not exposed in client-side code

## First Deployment
- [ ] Click "Deploy" in Vercel
- [ ] Wait for build to complete (2-5 minutes)
- [ ] Check build logs for errors
- [ ] Note deployment URL

## Post-Deployment Testing
- [ ] Home page loads: `https://your-app.vercel.app/`
- [ ] Stock page works: `https://your-app.vercel.app/stock/AAPL`
- [ ] Quadrant page works: `https://your-app.vercel.app/quadrant`
- [ ] Date filters work correctly
- [ ] Charts render properly
- [ ] API endpoints respond: `/api/quadrant/data`
- [ ] Database queries execute successfully
- [ ] No CORS errors
- [ ] Mobile responsive design verified

## Performance Check
- [ ] Page load time < 3 seconds
- [ ] Charts load smoothly
- [ ] No JavaScript errors in console
- [ ] Images optimized and loading
- [ ] Lighthouse score > 80

## Production Configuration
- [ ] Custom domain added (optional)
- [ ] SSL certificate active
- [ ] Analytics enabled (optional)
- [ ] Error monitoring setup (optional)
- [ ] Monitoring alerts configured

## Documentation
- [ ] README.md updated with project info
- [ ] Deployment guide reviewed
- [ ] Environment variables documented
- [ ] API endpoints documented (optional)

## Security
- [ ] No API keys in client code
- [ ] Environment variables secured in Vercel
- [ ] Database uses SSL connection
- [ ] CORS properly configured
- [ ] Rate limiting considered

## Backup Plan
- [ ] Know how to rollback deployment
- [ ] Previous working deployment identified
- [ ] Database backup strategy defined
- [ ] Contact info for support resources

---

## Quick Deploy Command (After Setup)

```bash
# Test build locally
npm run build
npm run start

# Deploy to Vercel (CLI)
vercel --prod

# Or push to GitHub (automatic deployment)
git push origin main
```

## Emergency Rollback

```bash
# Via Vercel CLI
vercel rollback

# Or via Dashboard:
# Deployments → Previous Version → Promote to Production
```

---

**Last Updated**: ___________
**Deployed By**: ___________
**Production URL**: ___________
