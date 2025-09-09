import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { serve } from '@hono/node-server';
import pino from 'pino';

import { appConfig, isDevelopment } from '@/utils/config';
import { errorHandler } from '@/utils/error-handler';
import { performanceMiddleware } from '@/utils/performance-middleware';
import propertiesRoute from '@/routes/properties';
import framerRoute from '@/routes/framer';
import adminRoute from '@/admin/routes/admin';
import { responsePrecomputer } from '@/services/response-precomputer';

// Initialize logger
const log = pino({
  level: appConfig.logging.level,
  // Disable pretty printing for now to avoid transport issues with Bun
  // transport: isDevelopment ? {
  //   target: 'pino-pretty',
  //   options: {
  //     colorize: true,
  //   },
  // } : undefined,
});

// Create Hono app
const app = new Hono();

// Global middleware
app.use('*', requestId());

app.use('*', cors({
  origin: [
    ...appConfig.frontend.corsOrigins,
    'https://stupendous-share-046449.framer.app',
    'https://*.framer.app',
    'https://framer.com',
    'http://localhost:3000',
    'http://localhost:3001',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
  allowHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'User-Agent',
    'DNT',
    'Cache-Control',
    'X-Mx-ReqToken',
  ],
  exposeHeaders: [
    'X-Response-Time',
    'X-Cache-Status', 
    'X-Request-ID',
    'X-Framer-Optimized',
    'X-Precomputed',
    'X-Image-Format',
    'ETag',
    'Last-Modified',
  ],
  credentials: false,
  maxAge: 86400, // 24 hours for preflight cache
}));

app.use('*', performanceMiddleware(log));

if (appConfig.logging.enableRequestLogging) {
  app.use('*', logger((message) => {
    log.info(message);
  }));
}

// Root endpoint - redirect to API info
app.get('/', (c) => {
  return c.redirect('/api');
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: appConfig.server.nodeEnv,
  });
});

// Mount API routes
app.route('/api/properties', propertiesRoute);
app.route('/api/framer', framerRoute);

// Admin routes
app.route('/admin/api', adminRoute);

// Admin HTML page  
app.get('/admin', async (c) => {
  const file = Bun.file('./admin.html');
  const html = await file.text();
  return c.html(html);
});

// API routes
app.get('/api/health', (c) => {
  return c.json({
    success: true,
    data: {
      api: { status: 'up', responseTime: 0 },
      cache: { status: 'connecting' },
      database: { status: 'connecting' },
      features: appConfig.features,
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: appConfig.server.nodeEnv,
    },
  });
});

// Basic API info endpoint
app.get('/api', (c) => {
  return c.json({
    success: true,
    data: {
      name: 'London Move API',
      description: 'Lightning-fast cache-only Rentman API backend',
      version: '1.0.0',
      endpoints: [
        'GET /api/health - API health check',
        'GET /api/framer/featured - ⚡ Lightning-fast featured properties for Framer',
        'GET /api/framer/properties - ⚡ Optimized property listings for Framer',
        'GET /api/framer/property/:id - ⚡ Property details for Framer',
        'GET /api/framer/images/:propref/:filename - ⚡ Optimized images for Framer',
        'GET /api/framer/health - Framer-specific health check',
        'POST /api/framer/warm-cache - Trigger cache warming',
        'GET /api/properties - Paginated property listings with caching',
        'GET /api/properties/featured - Auto-selected featured properties',
        'GET /api/properties/search - Full-text property search',
        'GET /api/properties/:id - Property details with caching',
        'GET /api/properties/:id/media - Lightning-fast optimized property media',
        'GET /api/properties/:id/media/:filename - Individual optimized images',
      ],
      performance: {
        target: '<20ms response times',
        caching: '5-layer cache architecture',
        optimization: 'Lightning-fast',
      },
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
});

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    message: `The endpoint ${c.req.method} ${c.req.path} does not exist`,
    timestamp: new Date().toISOString(),
  }, 404);
});

// Error handler
app.onError(errorHandler(log));

// Start server
const port = appConfig.server.port;

console.log(`🚀 Starting London Move API server...`);
console.log(`📍 Environment: ${appConfig.server.nodeEnv}`);
console.log(`🌐 Port: ${port}`);
console.log(`⚡ Performance: Lightning-fast mode enabled`);
console.log(`🎯 Target: Sub-20ms response times`);

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  log.info(`🎉 Server started successfully at ${appConfig.server.apiBaseUrl}`);
  log.info(`📊 Health check: ${appConfig.server.apiBaseUrl}/health`);
  log.info(`🔧 API info: ${appConfig.server.apiBaseUrl}/api`);
  log.info(`⚡ Framer endpoints: ${appConfig.server.apiBaseUrl}/api/framer/*`);
  
  // Start background cache warming for lightning-fast responses
  setTimeout(async () => {
    try {
      log.info('🔥 Starting intelligent cache warming...');
      await responsePrecomputer.warmCache();
      log.info('✅ Cache warming completed - Framer site ready for lightning speed!');
      
      // Start periodic warming every hour
      responsePrecomputer.startPeriodicWarming(3600000);
      log.info('🔄 Periodic cache warming activated (every 1 hour)');
    } catch (error) {
      log.error('❌ Cache warming failed:', error);
    }
  }, 1000); // Start warming 1 second after server starts
});