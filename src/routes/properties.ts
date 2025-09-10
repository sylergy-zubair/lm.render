import { Hono } from 'hono';
import { z } from 'zod';
import { rentmanClient } from '@/clients/rentman-client';
import { cacheService } from '@/cache/cache-service';
import { databaseService } from '@/services/database';
import { imageProcessor } from '@/services/image-processor';
import { imageStorage } from '@/services/image-storage';
import type { ApiResponse, PaginationMeta } from '@/types/api';
import type { PropertyListing, PropertyDetail, RentmanApiParams } from '@/types/rentman';

const app = new Hono();

// Validation schemas
const PropertyFiltersSchema = z.object({
  rob: z.enum(['rent', 'sale']).optional(),
  featured: z.enum(['1', '0']).optional(),
  area: z.string().optional(),
  beds: z.coerce.number().min(0).max(10).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  type: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  page: z.coerce.number().min(1).default(1),
});

const PropertySearchSchema = z.object({
  q: z.string().min(1),
  rob: z.enum(['rent', 'sale']).optional(),
  beds: z.coerce.number().min(0).max(10).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  area: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  page: z.coerce.number().min(1).default(1),
});

/**
 * GET /api/properties - Paginated property listings with caching
 */
app.get('/', async (c) => {
  const startTime = Date.now();
  
  try {
    // Validate query parameters
    const queryEntries = Array.from(c.req.queries()).map(([key, values]) => [key, values[0]]);
    const filters = PropertyFiltersSchema.parse(Object.fromEntries(queryEntries));
    
    // Generate cache key based on filters
    const cacheKey = `properties:${JSON.stringify(filters)}`;
    
    // Try to get from cache first (lightning-fast response)
    const cached = await cacheService.get<PropertyListing[]>(cacheKey);
    
    if (cached) {
      const responseTime = Date.now() - startTime;
      
      // Add performance headers
      c.header('X-Cache-Status', 'HIT');
      c.header('X-Response-Time', `${responseTime}ms`);
      
      const response: ApiResponse<PropertyListing[]> = {
        success: true,
        data: cached,
        meta: {
          cache: cacheService.generateCacheMeta(cacheKey, true, 'memory'),
          performance: {
            responseTime,
            cacheHit: true,
            optimization: 'lightning',
          },
          pagination: generatePagination(cached, filters),
        },
      };
      
      return c.json(response);
    }
    
    // Cache miss - fetch from Rentman API
    const rentmanParams: RentmanApiParams = {
      rob: filters.rob,
      featured: filters.featured,
      area: filters.area,
      beds: filters.beds,
      maxprice: filters.maxPrice,
      minprice: filters.minPrice,
      type: filters.type,
      limit: filters.limit,
      page: filters.page,
      noimage: '1', // Exclude images for listings performance
    };
    
    const properties = await rentmanClient.getProperties(rentmanParams);
    
    // Cache for 5 minutes (300 seconds)
    await cacheService.set(cacheKey, properties, 300);
    
    const responseTime = Date.now() - startTime;
    
    // Add performance headers
    c.header('X-Cache-Status', 'MISS');
    c.header('X-Response-Time', `${responseTime}ms`);
    
    const response: ApiResponse<PropertyListing[]> = {
      success: true,
      data: properties,
      meta: {
        cache: cacheService.generateCacheMeta(cacheKey, false, 'miss'),
        performance: {
          responseTime,
          cacheHit: false,
        },
        pagination: generatePagination(properties, filters),
      },
    };
    
    return c.json(response);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error('[Properties] List properties error:', error);
    
    return c.json({
      success: false,
      error: 'Failed to fetch properties',
      code: 'RENTMAN_API_ERROR',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * GET /api/properties/featured - Auto-selected featured properties
 */
app.get('/featured', async (c) => {
  const startTime = Date.now();
  
  try {
    // Get featured properties directly from SQLite database
    const properties = await databaseService.getFeaturedProperties(7);
    
    const responseTime = Date.now() - startTime;
    
    // Add performance headers
    c.header('X-Cache-Status', 'DATABASE');
    c.header('X-Response-Time', `${responseTime}ms`);
    c.header('X-Optimization', 'sqlite-lightning');
    
    const response: ApiResponse<PropertyListing[]> = {
      success: true,
      data: properties,
      meta: {
        source: 'database',
        performance: {
          responseTime,
          optimization: 'sqlite-direct',
        },
      },
    };
    
    return c.json(response);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error('[Properties] Featured properties error:', error);
    
    return c.json({
      success: false,
      error: 'Failed to fetch featured properties',
      code: 'RENTMAN_API_ERROR',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * GET /api/properties/search - Full-text property search
 */
app.get('/search', async (c) => {
  const startTime = Date.now();
  
  try {
    // Validate search parameters
    const searchQueryEntries = Array.from(c.req.queries()).map(([key, values]) => [key, values[0]]);
    const searchParams = PropertySearchSchema.parse(Object.fromEntries(searchQueryEntries));
    
    // Generate cache key for search
    const cacheKey = `search:${JSON.stringify(searchParams)}`;
    
    // Try cache first
    const cached = await cacheService.get<PropertyListing[]>(cacheKey);
    
    if (cached) {
      const responseTime = Date.now() - startTime;
      
      c.header('X-Cache-Status', 'HIT');
      c.header('X-Response-Time', `${responseTime}ms`);
      
      const response: ApiResponse<PropertyListing[]> = {
        success: true,
        data: cached,
        meta: {
          cache: cacheService.generateCacheMeta(cacheKey, true, 'memory'),
          performance: {
            responseTime,
            cacheHit: true,
            optimization: 'lightning',
          },
        },
      };
      
      return c.json(response);
    }
    
    // Cache miss - search via Rentman
    const properties = await rentmanClient.searchProperties(searchParams.q, {
      rob: searchParams.rob,
      beds: searchParams.beds,
      maxprice: searchParams.maxPrice,
      minprice: searchParams.minPrice,
      area: searchParams.area,
      limit: searchParams.limit,
      page: searchParams.page,
      noimage: '1',
    });
    
    // Cache search results for 10 minutes
    await cacheService.set(cacheKey, properties, 600);
    
    const responseTime = Date.now() - startTime;
    
    c.header('X-Cache-Status', 'MISS');
    c.header('X-Response-Time', `${responseTime}ms`);
    
    const response: ApiResponse<PropertyListing[]> = {
      success: true,
      data: properties,
      meta: {
        cache: cacheService.generateCacheMeta(cacheKey, false, 'miss'),
        performance: {
          responseTime,
          cacheHit: false,
        },
      },
    };
    
    return c.json(response);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error('[Properties] Search properties error:', error);
    
    return c.json({
      success: false,
      error: 'Failed to search properties',
      code: 'RENTMAN_API_ERROR',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * GET /api/properties/:id - Property details with caching
 */
app.get('/:id', async (c) => {
  const startTime = Date.now();
  
  try {
    const propref = c.req.param('id');
    const cacheKey = `property:${propref}`;
    
    // Try SWR cache for property details
    const property = await cacheService.getWithSWR(
      cacheKey,
      () => rentmanClient.getProperty(propref),
      { freshTTL: 1800, staleTTL: 3600 } // 30min fresh, 60min stale
    );
    
    const responseTime = Date.now() - startTime;
    
    c.header('X-Cache-Status', 'SWR');
    c.header('X-Response-Time', `${responseTime}ms`);
    
    const response: ApiResponse<PropertyDetail> = {
      success: true,
      data: property,
      meta: {
        cache: cacheService.generateCacheMeta(cacheKey, true, 'redis'),
        performance: {
          responseTime,
          cacheHit: true,
          optimization: 'lightning',
        },
      },
    };
    
    return c.json(response);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error(`[Properties] Get property details error:`, error);
    
    // Handle 404 specifically
    if (error instanceof Error && error.message.includes('not found')) {
      return c.json({
        success: false,
        error: 'Property not found',
        code: 'PROPERTY_NOT_FOUND',
        timestamp: new Date().toISOString(),
      }, 404);
    }
    
    return c.json({
      success: false,
      error: 'Failed to fetch property details',
      code: 'RENTMAN_API_ERROR',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * GET /api/properties/:id/media - Lightning-fast optimized property media
 */
app.get('/:id/media', async (c) => {
  const startTime = Date.now();
  
  try {
    const propref = c.req.param('id');
    const format = c.req.query('format') as 'avif' | 'webp' | 'jpeg' | undefined;
    const width = parseInt(c.req.query('width') || '800');
    const quality = parseInt(c.req.query('quality') || '85');
    
    const cacheKey = `media:optimized:${propref}:${format || 'all'}:${width}:${quality}`;
    
    // Try SWR cache for lightning-fast response
    const mediaData = await cacheService.getWithSWR(
      cacheKey,
      async () => {
        // Get property details to extract media filenames
        const property = await rentmanClient.getProperty(propref);
        const mediaFiles = [
          property.media.photos,
          property.media.floorplan,
          property.media.epc,
          property.media.brochure,
        ].flat().filter(Boolean);
        
        if (mediaFiles.length === 0) {
          return { images: [], message: 'No media available for this property' };
        }

        // Process each media file with optimization
        const optimizedImages = await Promise.allSettled(
          mediaFiles.slice(0, 10).map(async (filename) => { // Limit to 10 images
            try {
              // Check if already optimized and cached
              const existing = await imageStorage.getOptimizedImage(propref, filename);
              if (existing) {
                return imageStorage.generateResponsiveMetadata(existing, propref);
              }

              // Fetch from Rentman and process
              const mediaResponse = await rentmanClient.getMediaByFilename(filename);
              const optimized = await imageProcessor.processFromBase64(
                mediaResponse.base64data,
                filename,
                {
                  formats: format ? [format] : ['avif', 'webp', 'jpeg'],
                  widths: [400, 800, 1200, 1600],
                  quality: { avif: quality, webp: quality, jpeg: quality + 5 },
                }
              );

              // Store for future instant access
              await imageStorage.storeOptimizedImage(optimized, filename, propref);
              
              return imageStorage.generateResponsiveMetadata(optimized, propref);
            } catch (error) {
              console.warn(`[Properties] Failed to process ${filename}:`, error);
              return null;
            }
          })
        );

        // Filter successful results
        const successfulImages = optimizedImages
          .filter((result): result is PromiseFulfilledResult<any> => 
            result.status === 'fulfilled' && result.value !== null)
          .map(result => result.value);

        return {
          images: successfulImages,
          total: mediaFiles.length,
          processed: successfulImages.length,
          failed: mediaFiles.length - successfulImages.length,
        };
      },
      { freshTTL: 3600, staleTTL: 7200 } // 1h fresh, 2h stale
    );

    const responseTime = Date.now() - startTime;
    
    // Set CDN-friendly headers
    const headers = imageStorage.getCDNHeaders();
    Object.entries(headers).forEach(([key, value]) => {
      c.header(key, value);
    });
    
    c.header('X-Response-Time', `${responseTime}ms`);
    c.header('X-Optimization', 'lightning-media');
    
    const response: ApiResponse<typeof mediaData> = {
      success: true,
      data: mediaData,
      meta: {
        propref,
        format: format || 'all',
        width,
        quality,
        cache: cacheService.generateCacheMeta(cacheKey, true, 'redis'),
        performance: {
          responseTime,
          cacheHit: true,
          optimization: 'lightning',
        },
      },
    };
    
    return c.json(response);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error(`[Properties] Get property media error:`, error);
    
    return c.json({
      success: false,
      error: 'Failed to fetch property media',
      code: 'RENTMAN_API_ERROR',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * GET /api/properties/:id/media/:filename - Individual optimized image
 */
app.get('/:id/media/:filename', async (c) => {
  const startTime = Date.now();
  
  try {
    const propref = c.req.param('id');
    const filename = c.req.param('filename');
    const format = c.req.query('format') as 'avif' | 'webp' | 'jpeg' || 'webp';
    const width = parseInt(c.req.query('w') || '800');
    
    // Try to get optimized image from storage
    const variant = await imageStorage.getImageVariant(propref, filename, width, format);
    
    if (variant) {
      const responseTime = Date.now() - startTime;
      
      // Set CDN headers for maximum caching
      const headers = imageStorage.getCDNHeaders(variant);
      Object.entries(headers).forEach(([key, value]) => {
        c.header(key, value);
      });
      
      c.header('X-Response-Time', `${responseTime}ms`);
      
      // Return direct image URL for CDN
      return c.json({
        success: true,
        url: variant.url,
        format: variant.format,
        width: variant.width,
        height: variant.height,
        size: variant.size,
        responseTime,
      });
    }
    
    // If not found, try to fetch directly from Rentman as fallback
    try {
      console.log(`[Properties] Fetching image directly from Rentman: ${propref}/${filename}`);
      
      // Direct fetch from Rentman without Sharp processing for now
      const mediaResponse = await rentmanClient.getMediaByFilename(filename);
      
      if (mediaResponse.base64data) {
        const responseTime = Date.now() - startTime;
        
        // Return the image data directly as binary (original format)
        const imageBuffer = Buffer.from(mediaResponse.base64data, 'base64');
        
        c.header('X-Response-Time', `${responseTime}ms`);
        c.header('X-Cache-Status', 'DIRECT');
        c.header('Content-Type', 'image/jpeg'); // Rentman images are typically JPEG
        c.header('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        
        return c.body(imageBuffer);
      }
    } catch (directError) {
      console.warn(`[Properties] Direct fetch failed for ${filename}:`, directError);
    }
    
    // If still not found, return 404
    return c.json({
      success: false,
      error: 'Image not found or not yet processed',
      code: 'IMAGE_NOT_FOUND',
    }, 404);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error(`[Properties] Get individual media error:`, error);
    
    return c.json({
      success: false,
      error: 'Failed to fetch image',
      code: 'IMAGE_FETCH_ERROR',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * Helper function to generate pagination metadata
 */
function generatePagination(data: any[], filters: any): PaginationMeta {
  const current = filters.page || 1;
  const limit = filters.limit || 25;
  const total = data.length;
  const pages = Math.ceil(total / limit);
  
  return {
    current,
    total,
    pages,
    hasNext: current < pages,
    hasPrev: current > 1,
    limit,
  };
}

export default app;