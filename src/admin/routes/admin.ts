import { Hono } from 'hono';
import { rentmanClient } from '@/clients/rentman-client';
import { cacheService } from '@/cache/cache-service';
import { responsePrecomputer } from '@/services/response-precomputer';

const app = new Hono();

/**
 * GET /admin/api/properties - Get all properties for admin management
 */
app.get('/properties', async (c) => {
  try {
    const properties = await rentmanClient.getProperties({
      limit: 1000, // Get more properties for admin view
    });

    return c.json({
      success: true,
      data: properties,
      count: properties.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin properties error:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch properties',
    }, 500);
  }
});

/**
 * GET /admin/api/featured - Get currently featured properties
 */
app.get('/featured', async (c) => {
  try {
    const featured = await rentmanClient.getFeaturedProperties();
    
    return c.json({
      success: true,
      data: featured,
      count: featured.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin featured properties error:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch featured properties',
    }, 500);
  }
});

/**
 * GET /admin/api/cache/stats - Get cache statistics
 */
app.get('/cache/stats', async (c) => {
  try {
    const stats = await cacheService.getStats();
    const warmingStats = await responsePrecomputer.getWarmingStats();
    
    return c.json({
      success: true,
      data: {
        cache: stats,
        precomputation: warmingStats,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin cache stats error:', error);
    return c.json({
      success: false,
      error: 'Failed to get cache statistics',
    }, 500);
  }
});

/**
 * POST /admin/api/cache/clear - Clear cache
 */
app.post('/cache/clear', async (c) => {
  try {
    await cacheService.clear();
    
    return c.json({
      success: true,
      message: 'Cache cleared successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin cache clear error:', error);
    return c.json({
      success: false,
      error: 'Failed to clear cache',
    }, 500);
  }
});

/**
 * POST /admin/api/cache/warm - Warm cache
 */
app.post('/cache/warm', async (c) => {
  try {
    // Start cache warming in background
    responsePrecomputer.warmCache().catch(err => 
      console.error('Background cache warming failed:', err)
    );
    
    return c.json({
      success: true,
      message: 'Cache warming initiated',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin cache warm error:', error);
    return c.json({
      success: false,
      error: 'Failed to initiate cache warming',
    }, 500);
  }
});

/**
 * GET /admin/api/health - Admin health check
 */
app.get('/health', async (c) => {
  try {
    const [rentmanHealth, cacheStats] = await Promise.all([
      rentmanClient.healthCheck(),
      cacheService.getStats(),
    ]);

    return c.json({
      success: true,
      data: {
        rentman: rentmanHealth,
        cache: {
          status: cacheStats.redis.status === 'connected' ? 'up' : 'down',
          hitRate: cacheStats.combined.overallHitRate,
          totalRequests: cacheStats.combined.totalRequests,
        },
        server: {
          status: 'up',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin health check error:', error);
    return c.json({
      success: false,
      error: 'Health check failed',
    }, 500);
  }
});

export default app;