import { Hono } from 'hono';
import { z } from 'zod';
import { rentmanClient } from '@/clients/rentman-client';
import { cacheService } from '@/cache/cache-service';
import { databaseService } from '@/services/database';
import { imageProcessor } from '@/services/image-processor';
import { imageStorage } from '@/services/image-storage';
import { imageResolver } from '@/services/image-resolver';
import { appConfig } from '@/utils/config';
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
 * GET /api/properties/:id - Property details with optimized images
 */
app.get('/:id', async (c) => {
  const startTime = Date.now();
  
  try {
    const propref = c.req.param('id');
    const cacheKey = `property:enhanced:${propref}`;
    
    // Check cache for enhanced property with image data
    const cached = await cacheService.get<PropertyDetail & { images?: any }>(cacheKey);
    
    if (cached) {
      const responseTime = Date.now() - startTime;
      
      c.header('X-Cache-Status', 'HIT');
      c.header('X-Response-Time', `${responseTime}ms`);
      
      const response: ApiResponse<PropertyDetail & { images?: any }> = {
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
    
    // Fetch property details
    const property = await rentmanClient.getProperty(propref);
    
    // Enhance with optimized image metadata
    let enhancedProperty = { ...property };
    
    if (property.media && (property.media.photos?.length > 0 || property.media.floorplan || property.media.epc)) {
      try {
        const mediaJson = JSON.stringify(property.media);
        const resolvedImages = await imageResolver.resolvePropertyImages(propref, mediaJson);
        
        enhancedProperty.images = {
          photos: resolvedImages.photos.map(photo => ({
            filename: photo.filename,
            thumbnail: photo.thumbnailUrl,
            responsive: photo.responsiveMetadata,
            optimized: !!photo.optimized
          })),
          thumbnail: resolvedImages.thumbnail ? {
            url: resolvedImages.thumbnail.thumbnailUrl,
            responsive: resolvedImages.thumbnail.responsiveMetadata
          } : undefined,
          floorplan: resolvedImages.floorplan ? {
            filename: resolvedImages.floorplan.filename,
            thumbnail: resolvedImages.floorplan.thumbnailUrl,
            optimized: !!resolvedImages.floorplan.optimized
          } : undefined,
          epc: resolvedImages.epc ? {
            filename: resolvedImages.epc.filename,
            thumbnail: resolvedImages.epc.thumbnailUrl,
            optimized: !!resolvedImages.epc.optimized
          } : undefined,
        };
      } catch (error) {
        console.warn(`[Properties] Failed to enhance images for property ${propref}:`, error);
      }
    }
    
    // Cache enhanced property for 30 minutes
    await cacheService.set(cacheKey, enhancedProperty, 1800);
    
    const responseTime = Date.now() - startTime;
    
    c.header('X-Cache-Status', 'ENHANCED');
    c.header('X-Response-Time', `${responseTime}ms`);
    
    const response: ApiResponse<PropertyDetail & { images?: any }> = {
      success: true,
      data: enhancedProperty,
      meta: {
        cache: cacheService.generateCacheMeta(cacheKey, false, 'enhanced'),
        performance: {
          responseTime,
          cacheHit: false,
          optimization: 'image-enhanced',
        },
        images: enhancedProperty.images ? {
          totalPhotos: enhancedProperty.images.photos?.length || 0,
          optimizedCount: enhancedProperty.images.photos?.filter((p: any) => p.optimized).length || 0,
          hasResponsive: !!enhancedProperty.images.thumbnail?.responsive
        } : undefined
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
 * GET /api/properties/:id/media - Fast property media list
 */
app.get('/:id/media', async (c) => {
  const startTime = Date.now();
  
  try {
    const propref = c.req.param('id');
    const cacheKey = `media:list:${propref}`;
    
    // Try cache first for lightning-fast response
    const cached = await cacheService.get<any>(cacheKey);
    
    if (cached) {
      const responseTime = Date.now() - startTime;
      
      c.header('X-Response-Time', `${responseTime}ms`);
      c.header('X-Cache-Status', 'HIT');
      
      const response: ApiResponse<typeof cached> = {
        success: true,
        data: cached,
        meta: {
          propref,
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
    
    // Cache miss - fetch from Rentman
    const property = await rentmanClient.getProperty(propref);
    const mediaFiles = [
      ...(property.media.photos || []),
      property.media.floorplan,
      property.media.epc,
      property.media.brochure,
    ].filter(Boolean);
    
    if (mediaFiles.length === 0) {
      const responseTime = Date.now() - startTime;
      const emptyResult = { images: [], message: 'No media available for this property' };
      
      // Cache empty result for 5 minutes
      await cacheService.set(cacheKey, emptyResult, 300);
      
      return c.json({
        success: true,
        data: emptyResult,
        meta: {
          propref,
          performance: { responseTime, cacheHit: false },
        },
      });
    }

    // Generate simple media list with URLs (no processing)
    const mediaList = {
      images: mediaFiles.slice(0, 20).map((filename, index) => ({
        filename,
        url: `${appConfig.server.apiBaseUrl}/api/properties/${propref}/media/${filename}`,
        thumbnail: index === 0, // First image is thumbnail
      })),
      total: mediaFiles.length,
      processed: mediaFiles.length,
    };

    const responseTime = Date.now() - startTime;
    
    // Cache for 1 hour
    await cacheService.set(cacheKey, mediaList, 3600);
    
    c.header('X-Response-Time', `${responseTime}ms`);
    c.header('X-Cache-Status', 'MISS');
    
    const response: ApiResponse<typeof mediaList> = {
      success: true,
      data: mediaList,
      meta: {
        propref,
        cache: cacheService.generateCacheMeta(cacheKey, false, 'miss'),
        performance: {
          responseTime,
          cacheHit: false,
          optimization: 'fast',
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
 * GET /api/properties/:id/media/:filename - Optimized image delivery with format negotiation
 */
app.get('/:id/media/:filename', async (c) => {
  const startTime = Date.now();
  
  try {
    const propref = c.req.param('id');
    const filename = c.req.param('filename');
    
    // Parse query parameters for format/size preferences
    const width = parseInt(c.req.query('w') || '800');
    const format = (c.req.query('format') as 'avif' | 'webp' | 'jpeg') || 'jpeg';
    
    // Content negotiation based on Accept header
    const acceptHeader = c.req.header('Accept') || '';
    let preferredFormat = format;
    
    if (acceptHeader.includes('image/avif')) {
      preferredFormat = 'avif';
    } else if (acceptHeader.includes('image/webp')) {
      preferredFormat = 'webp';
    }
    
    // Try to get optimized variant
    const variant = await imageStorage.getImageVariant(propref, filename, width, preferredFormat);
    
    if (variant) {
      const responseTime = Date.now() - startTime;
      
      // Serve optimized variant (this would typically be served from file system or CDN)
      const headers = imageStorage.getCDNHeaders(variant);
      
      // Add performance headers
      headers['X-Response-Time'] = `${responseTime}ms`;
      headers['X-Image-Optimized'] = 'true';
      headers['X-Original-Format'] = format;
      headers['X-Served-Format'] = preferredFormat;
      
      Object.entries(headers).forEach(([key, value]) => c.header(key, value));
      
      // For now, fall back to original image since we don't have file serving implemented
      // In production, this would serve the actual optimized file
      return c.json({
        success: true,
        message: 'Optimized variant available',
        data: {
          variant,
          url: variant.url,
          metadata: {
            width: variant.width,
            height: variant.height,
            format: variant.format,
            size: variant.size,
            quality: variant.quality
          }
        },
        meta: {
          performance: { responseTime },
          optimization: 'variant-served'
        }
      });
    }
    
    // Fallback to original image processing
    const cacheKey = `image:original:${propref}:${filename}`;
    const cached = await cacheService.get<{ buffer: Buffer; contentType: string }>(cacheKey);
    
    if (cached) {
      const responseTime = Date.now() - startTime;
      
      // Set caching headers
      c.header('X-Response-Time', `${responseTime}ms`);
      c.header('X-Cache-Status', 'HIT');
      c.header('X-Image-Optimized', 'false');
      c.header('Content-Type', cached.contentType);
      c.header('Cache-Control', 'public, max-age=86400'); // 24 hours
      
      return c.body(cached.buffer);
    }
    
    // Cache miss - fetch from Rentman and potentially optimize
    console.log(`[Properties] Fetching image: ${propref}/${filename}`);
    
    const mediaResponse = await rentmanClient.getMediaByFilename(filename);
    
    if (mediaResponse.base64data) {
      const responseTime = Date.now() - startTime;
      const imageBuffer = Buffer.from(mediaResponse.base64data, 'base64');
      
      // Trigger background optimization (don't wait for it)
      imageProcessor.processFromBase64(mediaResponse.base64data, filename)
        .then(optimized => imageStorage.storeOptimizedImage(optimized, filename, propref))
        .catch(error => console.warn(`[Properties] Background optimization failed for ${filename}:`, error));
      
      const contentType = 'image/jpeg'; // Rentman images are typically JPEG
      
      // Cache original for 24 hours
      await cacheService.set(cacheKey, { buffer: imageBuffer, contentType }, 86400);
      
      c.header('X-Response-Time', `${responseTime}ms`);
      c.header('X-Cache-Status', 'MISS');
      c.header('X-Image-Optimized', 'background-processing');
      c.header('Content-Type', contentType);
      c.header('Cache-Control', 'public, max-age=86400');
      
      return c.body(imageBuffer);
    }
    
    // Image not found
    return c.json({
      success: false,
      error: 'Image not found',
      code: 'IMAGE_NOT_FOUND',
    }, 404);
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error(`[Properties] Get image error:`, error);
    
    return c.json({
      success: false,
      error: 'Failed to fetch image',
      code: 'IMAGE_FETCH_ERROR',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

/**
 * GET /api/properties/:id/responsive-images - Get responsive image metadata for property
 */
app.get('/:id/responsive-images', async (c) => {
  const startTime = Date.now();
  
  try {
    const propref = c.req.param('id');
    const cacheKey = `responsive-images:${propref}`;
    
    // Check cache first
    const cached = await cacheService.get<any>(cacheKey);
    
    if (cached) {
      const responseTime = Date.now() - startTime;
      
      c.header('X-Cache-Status', 'HIT');
      c.header('X-Response-Time', `${responseTime}ms`);
      
      return c.json({
        success: true,
        data: cached,
        meta: {
          propref,
          performance: { responseTime, cacheHit: true }
        }
      });
    }
    
    // Get property from database to access media
    const property = await databaseService.getProperty(propref);
    
    if (!property?.details?.media) {
      return c.json({
        success: true,
        data: { images: [], message: 'No media available for this property' },
        meta: { propref }
      });
    }
    
    // Resolve responsive images
    const resolvedImages = await imageResolver.resolvePropertyImages(propref, property.details.media);
    
    const responseData = {
      thumbnail: resolvedImages.thumbnail ? {
        url: resolvedImages.thumbnail.thumbnailUrl,
        srcsets: resolvedImages.thumbnail.responsiveMetadata?.srcsets,
        aspectRatio: resolvedImages.thumbnail.responsiveMetadata?.aspectRatio,
        dominantColor: resolvedImages.thumbnail.responsiveMetadata?.dominantColor,
        placeholder: resolvedImages.thumbnail.responsiveMetadata?.placeholder
      } : null,
      photos: resolvedImages.photos.map(photo => ({
        filename: photo.filename,
        thumbnail: photo.thumbnailUrl,
        srcsets: photo.responsiveMetadata?.srcsets,
        aspectRatio: photo.responsiveMetadata?.aspectRatio,
        dominantColor: photo.responsiveMetadata?.dominantColor,
        placeholder: photo.responsiveMetadata?.placeholder,
        optimized: !!photo.optimized
      })),
      floorplan: resolvedImages.floorplan ? {
        filename: resolvedImages.floorplan.filename,
        thumbnail: resolvedImages.floorplan.thumbnailUrl,
        optimized: !!resolvedImages.floorplan.optimized
      } : null,
      epc: resolvedImages.epc ? {
        filename: resolvedImages.epc.filename,
        thumbnail: resolvedImages.epc.thumbnailUrl,
        optimized: !!resolvedImages.epc.optimized
      } : null,
      totalImages: resolvedImages.photos.length,
      optimizedCount: resolvedImages.photos.filter(p => p.optimized).length,
    };
    
    // Cache for 1 hour
    await cacheService.set(cacheKey, responseData, 3600);
    
    const responseTime = Date.now() - startTime;
    
    c.header('X-Cache-Status', 'MISS');
    c.header('X-Response-Time', `${responseTime}ms`);
    
    return c.json({
      success: true,
      data: responseData,
      meta: {
        propref,
        performance: { responseTime, cacheHit: false },
        optimization: 'responsive-metadata'
      }
    });
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    c.header('X-Response-Time', `${responseTime}ms`);
    
    console.error(`[Properties] Get responsive images error:`, error);
    
    return c.json({
      success: false,
      error: 'Failed to fetch responsive images',
      code: 'RESPONSIVE_IMAGES_ERROR',
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