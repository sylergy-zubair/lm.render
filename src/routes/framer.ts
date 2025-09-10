import { Hono } from 'hono';
import { responsePrecomputer } from '@/services/response-precomputer';
import { cacheService } from '@/cache/cache-service';
import { imageStorage } from '@/services/image-storage';
import type { ApiResponse } from '@/types/api';

const app = new Hono();

/**
 * GET /api/framer/featured - Lightning-fast featured properties for Framer
 * Optimized for sub-5ms responses with complete precomputation
 */
app.get('/featured', async (c) => {
  const startTime = Date.now();
  
  try {
    // Try to get precomputed response first (lightning-fast)
    const precomputed = await responsePrecomputer.getPrecomputed('properties/featured');
    
    if (precomputed) {
      const responseTime = Date.now() - startTime;
      
      // Set all precomputed headers for maximum performance
      Object.entries(precomputed.headers).forEach(([key, value]) => {
        c.header(key, value);
      });
      
      c.header('X-Response-Time', `${responseTime}ms`);
      c.header('X-Framer-Optimized', 'true');
      c.header('X-Cache-Status', 'PRECOMPUTED');
      
      return c.json(precomputed.data, precomputed.statusCode);
    }
    
    // Fallback: trigger immediate precomputation if not available
    console.warn('[Framer] Featured properties not precomputed, generating now...');
    await responsePrecomputer.precomputeFeaturedProperties();
    
    // Get the newly precomputed response
    const newPrecomputed = await responsePrecomputer.getPrecomputed('properties/featured');
    if (newPrecomputed) {
      const responseTime = Date.now() - startTime;
      
      Object.entries(newPrecomputed.headers).forEach(([key, value]) => {
        c.header(key, value);
      });
      
      c.header('X-Response-Time', `${responseTime}ms`);
      c.header('X-Cache-Status', 'GENERATED');
      c.header('X-Framer-Optimized', 'true');
      
      return c.json(newPrecomputed.data, newPrecomputed.statusCode);
    }
    
    // Ultimate fallback (should never happen)
    return c.json({
      success: false,
      error: 'Featured properties temporarily unavailable',
      code: 'PRECOMPUTE_UNAVAILABLE',
    }, 503);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error('[Framer] Featured properties error:', error);
    
    return c.json({
      success: false,
      error: 'Failed to load featured properties',
      code: 'FRAMER_API_ERROR',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * GET /api/framer/properties - Lightning-fast property listings for Framer
 */
app.get('/properties', async (c) => {
  const startTime = Date.now();
  
  try {
    // Extract and sanitize query parameters for Framer
    const rob = c.req.query('rob') || 'rent';
    const beds = c.req.query('beds');
    const limit = Math.min(parseInt(c.req.query('limit') || '25'), 50); // Max 50 for performance
    const page = Math.max(parseInt(c.req.query('page') || '1'), 1);
    
    // Build cache-friendly endpoint key
    const params = new URLSearchParams();
    params.set('rob', rob);
    if (beds) params.set('beds', beds);
    params.set('limit', limit.toString());
    params.set('page', page.toString());
    
    const endpoint = `properties?${params.toString()}`;
    
    // Try precomputed response
    const precomputed = await responsePrecomputer.getPrecomputed(endpoint);
    
    if (precomputed) {
      const responseTime = Date.now() - startTime;
      
      Object.entries(precomputed.headers).forEach(([key, value]) => {
        c.header(key, value);
      });
      
      c.header('X-Response-Time', `${responseTime}ms`);
      c.header('X-Framer-Optimized', 'true');
      c.header('X-Cache-Status', 'PRECOMPUTED');
      
      // For Framer component compatibility, return data array directly
      if (precomputed.data.success && precomputed.data.data) {
        return c.json(precomputed.data.data);
      }
      
      return c.json(precomputed.data, precomputed.statusCode);
    }
    
    // If not precomputed, check if it's a popular query worth computing
    const popularQueries = [
      'rob=rent&limit=25&page=1',
      'rob=rent&beds=1&limit=25&page=1',
      'rob=rent&beds=2&limit=25&page=1',
      'rob=rent&beds=3&limit=25&page=1',
      'rob=sale&limit=25&page=1',
    ];
    
    if (popularQueries.includes(params.toString())) {
      console.warn(`[Framer] Popular query not precomputed: ${params.toString()}`);
      // Trigger background precomputation for next time
      responsePrecomputer.precomputePropertyListings(1).catch(err => 
        console.error('Background precompute failed:', err)
      );
    }
    
    // Return fast fallback for uncommon queries
    return c.json({
      success: false,
      error: 'Properties are being optimized, please try again in a moment',
      code: 'OPTIMIZING',
      suggested_endpoints: [
        '/api/framer/featured',
        '/api/framer/properties?rob=rent',
        '/api/framer/properties?rob=rent&beds=2',
      ],
    }, 202);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error('[Framer] Properties error:', error);
    
    return c.json({
      success: false,
      error: 'Failed to load properties',
      code: 'FRAMER_API_ERROR',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * GET /api/framer/property/:id - Lightning-fast property details for Framer
 */
app.get('/property/:id', async (c) => {
  const startTime = Date.now();
  
  try {
    const propref = c.req.param('id');
    const endpoint = `properties/${propref}`;
    
    // Try precomputed response
    const precomputed = await responsePrecomputer.getPrecomputed(endpoint);
    
    if (precomputed) {
      const responseTime = Date.now() - startTime;
      
      Object.entries(precomputed.headers).forEach(([key, value]) => {
        c.header(key, value);
      });
      
      c.header('X-Response-Time', `${responseTime}ms`);
      c.header('X-Framer-Optimized', 'true');
      c.header('X-Cache-Status', 'PRECOMPUTED');
      
      return c.json(precomputed.data, precomputed.statusCode);
    }
    
    // For property details, we can trigger immediate computation since it's a specific request
    console.log(`[Framer] Property ${propref} not precomputed, generating now...`);
    
    try {
      await responsePrecomputer.precomputePropertyDetails([propref]);
      
      const newPrecomputed = await responsePrecomputer.getPrecomputed(endpoint);
      if (newPrecomputed) {
        const responseTime = Date.now() - startTime;
        
        Object.entries(newPrecomputed.headers).forEach(([key, value]) => {
          c.header(key, value);
        });
        
        c.header('X-Response-Time', `${responseTime}ms`);
        c.header('X-Cache-Status', 'GENERATED');
        c.header('X-Framer-Optimized', 'true');
        
        return c.json(newPrecomputed.data, newPrecomputed.statusCode);
      }
    } catch (computeError) {
      console.error(`[Framer] Failed to compute ${propref}:`, computeError);
    }
    
    return c.json({
      success: false,
      error: `Property ${propref} not found or unavailable`,
      code: 'PROPERTY_NOT_FOUND',
    }, 404);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error('[Framer] Property detail error:', error);
    
    return c.json({
      success: false,
      error: 'Failed to load property details',
      code: 'FRAMER_API_ERROR',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * GET /api/framer/images/:propref/thumbnail - Get property thumbnail
 */
app.get('/images/:propref/thumbnail', async (c) => {
  const startTime = Date.now();
  
  try {
    const propref = c.req.param('propref');
    
    // Get first image from precomputed property data
    const endpoint = `properties/${propref}`;
    const precomputed = await responsePrecomputer.getPrecomputed(endpoint);
    
    if (precomputed && precomputed.data.success && precomputed.data.data) {
      const property = precomputed.data.data;
      let imageUrl = null;
      
      // Try to get thumbnail from media data
      if (property.details?.media) {
        try {
          const media = JSON.parse(property.details.media);
          if (media.photos && media.photos.length > 0) {
            imageUrl = `data:image/jpeg;base64,${media.photos[0]}`;
          }
        } catch (e) {
          console.warn(`Failed to parse media for ${propref}:`, e);
        }
      }
      
      const responseTime = Date.now() - startTime;
      c.header('X-Response-Time', `${responseTime}ms`);
      c.header('X-Framer-Optimized', 'true');
      
      return c.json({
        success: true,
        imageUrl,
        propref,
        responseTime,
      });
    }
    
    return c.json({
      success: false,
      error: 'Property or thumbnail not found',
      propref,
    }, 404);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error('[Framer] Thumbnail error:', error);
    
    return c.json({
      success: false,
      error: 'Failed to load thumbnail',
      propref: c.req.param('propref'),
      responseTime,
    }, 500);
  }
});

/**
 * GET /api/framer/images/:propref/all - Get all property media
 */
app.get('/images/:propref/all', async (c) => {
  const startTime = Date.now();
  
  try {
    const propref = c.req.param('propref');
    
    // Get property data with media
    const endpoint = `properties/${propref}`;
    const precomputed = await responsePrecomputer.getPrecomputed(endpoint);
    
    if (precomputed && precomputed.data.success && precomputed.data.data) {
      const property = precomputed.data.data;
      const mediaImages = [];
      
      // Parse media from property details
      if (property.details?.media) {
        try {
          const media = JSON.parse(property.details.media);
          if (media.photos && Array.isArray(media.photos)) {
            media.photos.forEach((photo, index) => {
              mediaImages.push({
                propref,
                filename: `photo${index + 1}.jpg`,
                caption: `Property image ${index + 1}`,
                base64data: photo,
                imgorder: index.toString(),
              });
            });
          }
        } catch (e) {
          console.warn(`Failed to parse media for ${propref}:`, e);
        }
      }
      
      const responseTime = Date.now() - startTime;
      c.header('X-Response-Time', `${responseTime}ms`);
      c.header('X-Framer-Optimized', 'true');
      
      return c.json(mediaImages);
    }
    
    return c.json({
      success: false,
      error: 'Property not found',
      propref,
    }, 404);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error('[Framer] Media error:', error);
    
    return c.json({
      success: false,
      error: 'Failed to load property media',
      propref: c.req.param('propref'),
      responseTime,
    }, 500);
  }
});

/**
 * GET /api/framer/images/:propref/:filename - Optimized image delivery for Framer
 */
app.get('/images/:propref/:filename', async (c) => {
  const startTime = Date.now();
  
  try {
    const propref = c.req.param('propref');
    const filename = c.req.param('filename');
    const format = c.req.query('format') as 'avif' | 'webp' | 'jpeg' || 'webp';
    const width = parseInt(c.req.query('w') || '800');
    
    // Get optimized image variant
    const variant = await imageStorage.getImageVariant(propref, filename, width, format);
    
    if (variant) {
      const responseTime = Date.now() - startTime;
      
      // Set optimal headers for Framer image loading
      const headers = {
        ...imageStorage.getCDNHeaders(variant),
        'X-Framer-Optimized': 'true',
        'X-Response-Time': `${responseTime}ms`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Response-Time, X-Image-Format',
      };
      
      Object.entries(headers).forEach(([key, value]) => {
        c.header(key, value);
      });
      
      return c.json({
        success: true,
        url: variant.url,
        format: variant.format,
        width: variant.width,
        height: variant.height,
        size: variant.size,
        optimized: true,
        responseTime,
      });
    }
    
    return c.json({
      success: false,
      error: 'Image not found or not yet optimized',
      code: 'IMAGE_NOT_FOUND',
      propref,
      filename,
    }, 404);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error('[Framer] Image delivery error:', error);
    
    return c.json({
      success: false,
      error: 'Failed to deliver image',
      code: 'IMAGE_DELIVERY_ERROR',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * GET /api/framer/health - Framer-specific health check with performance metrics
 */
app.get('/health', async (c) => {
  const startTime = Date.now();
  
  try {
    const [cacheStats, warmingStats] = await Promise.all([
      cacheService.getStats(),
      responsePrecomputer.getWarmingStats(),
    ]);
    
    const responseTime = Date.now() - startTime;
    
    c.header('X-Response-Time', `${responseTime}ms`);
    c.header('X-Framer-Optimized', 'true');
    
    return c.json({
      success: true,
      status: 'optimal',
      framer: {
        optimized: true,
        precomputed: warmingStats.totalPrecomputed,
        hitRate: warmingStats.hitRate,
        avgResponseTime: warmingStats.avgResponseTime,
        lastWarming: warmingStats.lastWarming,
        nextWarming: warmingStats.nextWarming,
      },
      performance: {
        cacheHitRate: cacheStats.combined.overallHitRate,
        totalRequests: cacheStats.combined.totalRequests,
        memoryUsage: cacheStats.memory.memoryUsage,
        redisStatus: cacheStats.redis.status,
      },
      endpoints: [
        'GET /api/framer/featured - Lightning-fast featured properties',
        'GET /api/framer/properties - Optimized property listings', 
        'GET /api/framer/property/:id - Property details',
        'GET /api/framer/images/:propref/:filename - Optimized images',
      ],
      responseTime,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error('[Framer] Health check error:', error);
    
    return c.json({
      success: false,
      status: 'degraded',
      error: 'Health check failed',
      responseTime,
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * POST /api/framer/warm-cache - Trigger immediate cache warming (for admin use)
 */
app.post('/warm-cache', async (c) => {
  const startTime = Date.now();
  
  try {
    // Start cache warming in background
    const warmingPromise = responsePrecomputer.warmCache();
    
    // Don't wait for completion, return immediately
    const responseTime = Date.now() - startTime;
    
    c.header('X-Response-Time', `${responseTime}ms`);
    c.header('X-Framer-Optimized', 'true');
    
    return c.json({
      success: true,
      message: 'Cache warming initiated',
      status: 'warming',
      responseTime,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error('[Framer] Cache warming error:', error);
    
    return c.json({
      success: false,
      error: 'Failed to initiate cache warming',
      code: 'WARMING_FAILED',
      responseTime,
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

export default app;