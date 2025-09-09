# 🚀 Deployment Guide - Render (Free Tier)

## Prerequisites
- GitHub account with this repository
- Render account (free signup at render.com)

## Step 1: Prepare Repository

1. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "🚀 Ready for deployment to Render"
   git push origin main
   ```

2. **Update render.yaml:**
   - Edit `render.yaml` line 7: Replace `your-username/london-move` with your actual GitHub repo

## Step 2: Deploy to Render

### Option A: Deploy via Render Dashboard
1. Go to [render.com](https://render.com) and sign in
2. Click **"New +"** → **"Blueprint"**
3. Connect your GitHub repository
4. Select this repository and branch `main`
5. Render will read `render.yaml` and set up both services:
   - Web Service (london-move-api)
   - Redis Service (london-move-redis)

### Option B: Deploy Individual Services
1. **Create Redis Service:**
   - New → Redis
   - Name: `london-move-redis`
   - Plan: Free
   
2. **Create Web Service:**
   - New → Web Service
   - Connect GitHub repo
   - Runtime: Node
   - Build Command: `bun install`
   - Start Command: `bun run start`

## Step 3: Set Environment Variables

In Render Dashboard → Web Service → Environment:

**Required Variables:**
```
NODE_ENV=production
RENTMAN_API_TOKEN=LRnFpm0C5d81s1S1PuCNfQuVj3wSGbWgd%2BZJwrmZE1bbo8mEdr9p4t%2FZ8jMoldu0PosD3sJbNDuHO7OwDn%2FvxPwQv73AEehgp8Hjb0%2FB%2BAPYpQt%2Bcc55bA2Z2ye1VwaqDCZnmcBqpd4%3D
UPSTASH_REDIS_URL=redis://london-move-redis:6379
```

**Auto-configured by render.yaml:**
- PORT, CORS_ORIGINS, LOG_LEVEL, Feature flags, etc.

## Step 4: Verify Deployment

1. **Check Build Logs:**
   - Monitor the deployment in Render dashboard
   - Ensure Bun installation and build succeeds

2. **Test Endpoints:**
   ```bash
   # Replace with your actual Render URL
   curl https://your-app-name.onrender.com/health
   curl https://your-app-name.onrender.com/api
   curl https://your-app-name.onrender.com/admin
   ```

3. **Admin Panel:**
   - Visit: `https://your-app-name.onrender.com/admin`
   - Check all tabs work (Properties, Featured, Cache, Health)

## Step 5: Configure Custom Domain (Optional)

1. In Render Dashboard → Web Service → Settings
2. Add custom domain
3. Update DNS records as instructed
4. SSL certificate auto-generated

## 🎯 What You Get (Free Tier)

- **Web Service**: 750 hours/month, auto-sleep after 15min
- **Redis Cache**: 25MB storage, perfect for property caching
- **HTTPS**: Automatic SSL certificates
- **Auto-deploy**: Updates on git push
- **Monitoring**: Built-in logs and metrics

## 🔧 Post-Deployment

1. **Update Frontend URL:**
   - Update your Framer project to use: `https://your-app-name.onrender.com`
   
2. **Monitor Performance:**
   - Check admin panel → Health tab
   - Monitor Redis cache hit rates
   - Watch for cold starts (15min sleep)

3. **Optimization:**
   - Consider upgrading to paid plan for zero-downtime
   - Monitor cache efficiency in admin panel

## 🚨 Troubleshooting

**Build Fails:**
- Check Bun installation in build logs
- Verify package.json scripts

**Redis Connection Issues:**
- Ensure Redis service is running
- Check UPSTASH_REDIS_URL format

**API Timeouts:**
- First request after sleep may take 30+ seconds
- Subsequent requests will be fast

## 📈 Monitoring

- **Health Check**: `/health`
- **API Status**: `/api`
- **Admin Dashboard**: `/admin`
- **Cache Stats**: `/admin` → Cache tab

Your London Move API is now live and ready for production! 🎉