import { Hono } from 'hono';
import { rentmanClient } from '@/clients/rentman-client';
import { cacheService } from '@/cache/cache-service';
import { databaseService } from '@/services/database';
import { responsePrecomputer } from '@/services/response-precomputer';
import { syncService } from '@/services/sync-service';

const app = new Hono();

/**
 * GET /admin/api/properties - Get all properties for admin management
 */
app.get('/properties', async (c) => {
  try {
    const properties = await rentmanClient.getProperties({
      limit: 1000, // Get more properties for admin view
    });

    // Get detailed property info for first image
    const propertiesWithImages = await Promise.all(
      properties.slice(0, 50).map(async (property) => {
        try {
          const detail = await rentmanClient.getProperty(property.propref.toString());
          return {
            ...property,
            thumbnail: detail.media?.photos?.[0] || null,
          };
        } catch (error) {
          return {
            ...property,
            thumbnail: null,
          };
        }
      })
    );

    return c.json({
      success: true,
      data: propertiesWithImages,
      count: propertiesWithImages.length,
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
 * GET /admin/api/featured - Get currently featured properties (admin controlled)
 */
app.get('/featured', async (c) => {
  try {
    // Get featured properties directly from database (super fast!)
    const featuredWithImages = await databaseService.getFeaturedProperties(50);
    
    return c.json({
      success: true,
      data: featuredWithImages,
      count: featuredWithImages.length,
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
 * POST /admin/api/properties/:propref/featured - Toggle featured status
 */
app.post('/properties/:propref/featured', async (c) => {
  try {
    const propref = c.req.param('propref');
    const body = await c.req.json();
    const { featured } = body;
    
    if (typeof featured !== 'boolean') {
      return c.json({
        success: false,
        error: 'Featured status must be boolean',
      }, 400);
    }
    
    // Store featured status in database (permanent storage)
    await databaseService.setFeaturedStatus(propref, featured);
    
    // Invalidate related caches
    await cacheService.invalidatePattern('properties:*');
    await cacheService.invalidatePattern('framer:featured*');
    
    return c.json({
      success: true,
      data: {
        propref,
        featured,
        message: `Property ${propref} ${featured ? 'marked as featured' : 'unmarked as featured'}`,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Toggle featured error:', error);
    return c.json({
      success: false,
      error: 'Failed to toggle featured status',
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
 * POST /admin/api/sync/force - Force immediate sync from Rentman
 */
app.post('/sync/force', async (c) => {
  try {
    console.log('[Admin] Force sync requested');
    const result = await syncService.forceSyncNow();
    
    return c.json({
      success: result.success,
      data: {
        propertiesSynced: result.propertiesSynced,
        error: result.error,
      },
      message: result.success 
        ? `Successfully synced ${result.propertiesSynced} properties`
        : `Sync failed: ${result.error}`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin force sync error:', error);
    return c.json({
      success: false,
      error: 'Failed to initiate sync',
      message: 'An error occurred while trying to sync',
    }, 500);
  }
});

/**
 * GET /admin/api/health - Admin health check
 */
app.get('/health', async (c) => {
  try {
    const [rentmanHealth, cacheStats, cacheHealth] = await Promise.all([
      rentmanClient.healthCheck(),
      cacheService.getStats(),
      cacheService.healthCheck(),
    ]);

    return c.json({
      success: true,
      data: {
        rentman: rentmanHealth,
        cache: {
          status: cacheHealth.overall.status === 'unhealthy' ? 'down' : 'up',
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