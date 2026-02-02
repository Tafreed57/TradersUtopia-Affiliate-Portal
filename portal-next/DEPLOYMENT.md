# Deployment Guide

This guide covers deploying the TradersUtopia Portal to production on Vercel.

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **PostgreSQL Database**: A managed PostgreSQL instance (e.g., Vercel Postgres, Supabase, Neon, Railway)
3. **Rewardful API Key**: Get from your Rewardful dashboard

## Environment Variables

Set these in your Vercel project settings under **Settings → Environment Variables**:

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `DIRECT_URL` | Direct database URL (for Prisma) | Same as DATABASE_URL for most providers |
| `JWT_SECRET` | Secret for JWT tokens (min 32 chars) | `your-super-secret-jwt-key-at-least-32-chars` |
| `REWARDFUL_API_KEY` | Rewardful API key | `rf_...` |
| `ADMIN_EMAILS` | Comma-separated admin emails | `admin@example.com,admin2@example.com` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `TEACHER_OVERRIDE_EMAILS` | (empty) | Comma-separated teacher emails |
| `SESSION_DURATION_HOURS` | `12` | Session token lifetime |
| `USD_TO_CAD_RATE` | `1.4` | Currency conversion rate |
| `LOG_LEVEL` | `info` | Logging level (debug/info/warn/error) |
| `LOG_JSON` | `false` | Output JSON logs |
| `NEXT_PUBLIC_APP_URL` | (auto) | Public URL of the app |

## Deployment Steps

### 1. Connect Repository

1. Push your code to GitHub
2. Import the project in Vercel
3. Select the `portal-next` directory as the root

### 2. Configure Build Settings

Vercel should auto-detect Next.js. Verify these settings:

- **Framework Preset**: Next.js
- **Build Command**: `npm run build`
- **Output Directory**: `.next`
- **Install Command**: `npm install`

### 3. Set Environment Variables

Add all required environment variables in Vercel:
1. Go to **Settings → Environment Variables**
2. Add each variable for **Production**, **Preview**, and **Development**
3. Use different values for production vs preview if needed

### 4. Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# (Optional) Seed with test data
npm run db:seed
```

For Vercel Postgres, add both `DATABASE_URL` and `DIRECT_URL` from the Vercel dashboard.

### 5. Deploy

```bash
# Deploy to production
vercel --prod

# Or push to main branch for auto-deploy
git push origin main
```

## Post-Deployment

### Verify Health Check

```bash
curl https://your-app.vercel.app/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-01T00:00:00.000Z",
  "version": "1.0.0",
  "uptime": 123,
  "checks": {
    "database": { "status": "ok", "latencyMs": 5 },
    "memory": { "status": "ok", "usedMB": 50, "totalMB": 256 }
  }
}
```

### Data Migration

If migrating from legacy GAS:

1. Export data from GAS (see `scripts/migration/README.md`)
2. Place export in `data/legacy-export.json`
3. Run migration: `npx tsx scripts/migration/run-all.ts --clean`
4. Validate: `npx tsx scripts/migration/validate.ts`

### DNS Configuration

If using a custom domain:

1. Add domain in Vercel project settings
2. Configure DNS records as instructed
3. Wait for SSL certificate provisioning

## Monitoring

### Health Endpoint

- **URL**: `/api/health`
- **Status Codes**:
  - `200`: Healthy or degraded
  - `503`: Unhealthy

### Logging

Logs are available in Vercel's **Deployments → Logs** tab.

Configure log level with `LOG_LEVEL` environment variable.

### Error Tracking

For production error tracking, consider adding:
- Sentry
- Vercel's built-in error monitoring
- LogRocket

## Rollback

To rollback to a previous deployment:

1. Go to **Deployments** in Vercel
2. Find the previous successful deployment
3. Click **•••** → **Promote to Production**

## Troubleshooting

### Build Failures

```bash
# Check for TypeScript errors
npm run typecheck

# Check for lint errors
npm run lint

# Test build locally
npm run build
```

### Database Connection Issues

- Verify `DATABASE_URL` is correct
- Check database allows connections from Vercel IPs
- Ensure `sslmode=require` for cloud databases

### API Errors

Check Vercel function logs:
1. Go to **Deployments**
2. Select the deployment
3. Click **Functions** tab
4. View logs for specific function

## Security Checklist

- [ ] JWT_SECRET is at least 32 characters
- [ ] DATABASE_URL uses SSL (`sslmode=require`)
- [ ] Admin emails are correct
- [ ] No sensitive data in client-side code
- [ ] CORS headers are configured correctly
- [ ] Rate limiting is enabled

## Performance

### Edge Caching

Static assets are automatically cached on Vercel's edge network.

### Database

- Use connection pooling for serverless
- Consider adding database indexes for frequently queried fields
- Monitor query performance in database dashboard

### API

- Rate limiting prevents abuse
- Responses include cache headers where appropriate
