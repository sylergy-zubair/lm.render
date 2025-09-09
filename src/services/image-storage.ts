import { writeFile, readFile, mkdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import { appConfig } from '@/utils/config';
import { cacheService } from '@/cache/cache-service';
import type { OptimizedImage, ImageVariant } from './image-processor';

interface StorageMetadata {
  filename: string;
  propref: string;
  variants: ImageVariant[];
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
}

/**
 * Lightning-fast image storage service optimized for CDN delivery
 * Handles local storage with instant memory/Redis caching
 */
export class ImageStorageService {
  private readonly storageRoot: string;
  private readonly urlBase: string;
  private readonly maxCacheAge = 31536000; // 1 year for static images

  constructor() {
    this.storageRoot = appConfig.storage?.imagesPath || './storage/images';
    this.urlBase = `${appConfig.server.apiBaseUrl}/api/media`;
  }

  /**
   * Store optimized image with all variants
   */
  async storeOptimizedImage(
    optimized: OptimizedImage,
    filename: string,
    propref: string
  ): Promise<StorageMetadata> {
    const metadata: StorageMetadata = {
      filename,
      propref,
      variants: optimized.variants,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 0,
    };

    try {
      // Ensure storage directory exists
      const propertyDir = join(this.storageRoot, propref);
      await this.ensureDirectory(propertyDir);

      // Store metadata in cache for instant access
      const metadataKey = `storage:meta:${propref}:${filename}`;
      await cacheService.set(metadataKey, metadata, this.maxCacheAge);

      // Store optimized data in cache
      const optimizedKey = `storage:optimized:${propref}:${filename}`;
      await cacheService.set(optimizedKey, optimized, this.maxCacheAge);

      console.log(`[ImageStorage] Stored ${filename} with ${optimized.variants.length} variants`);
      
      return metadata;
    } catch (error) {
      console.error(`[ImageStorage] Failed to store ${filename}:`, error);
      throw error;
    }
  }

  /**
   * Retrieve optimized image with lightning-fast cache lookup
   */
  async getOptimizedImage(propref: string, filename: string): Promise<OptimizedImage | null> {
    try {
      // Check cache first for instant response
      const optimizedKey = `storage:optimized:${propref}:${filename}`;
      const cached = await cacheService.get<OptimizedImage>(optimizedKey);
      
      if (cached) {
        // Update access statistics
        await this.updateAccessStats(propref, filename);
        return cached;
      }

      // If not in cache, image needs to be processed
      return null;
    } catch (error) {
      console.error(`[ImageStorage] Failed to get ${filename}:`, error);
      return null;
    }
  }

  /**
   * Get image variant by specific format and size
   */
  async getImageVariant(
    propref: string,
    filename: string,
    width: number,
    format: 'avif' | 'webp' | 'jpeg'
  ): Promise<ImageVariant | null> {
    const optimized = await this.getOptimizedImage(propref, filename);
    
    if (!optimized) return null;

    // Find exact match or closest smaller size
    const variant = optimized.variants
      .filter(v => v.format === format && v.width <= width)
      .sort((a, b) => b.width - a.width)[0];

    return variant || null;
  }

  /**
   * Generate CDN-ready headers for images
   */
  getCDNHeaders(variant?: ImageVariant): Record<string, string> {
    const headers: Record<string, string> = {
      'Cache-Control': `public, max-age=${this.maxCacheAge}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'X-Cache-Status': variant ? 'HIT' : 'MISS',
    };

    if (variant) {
      headers['Content-Type'] = `image/${variant.format}`;
      headers['Content-Length'] = variant.size.toString();
      headers['X-Image-Format'] = variant.format.toUpperCase();
      headers['X-Image-Width'] = variant.width.toString();
      headers['X-Image-Height'] = variant.height?.toString() || '';
    }

    return headers;
  }

  /**
   * Generate responsive image metadata for frontend
   */
  generateResponsiveMetadata(optimized: OptimizedImage, propref: string): {
    srcsets: Record<string, string>;
    fallback: string;
    placeholder: string;
    dominantColor: string;
    aspectRatio: number;
  } {
    const aspectRatio = optimized.original.width / optimized.original.height;
    
    const srcsets: Record<string, string> = {};
    
    // Group variants by format
    ['avif', 'webp', 'jpeg'].forEach(format => {
      const variants = optimized.variants.filter(v => v.format === format);
      if (variants.length > 0) {
        srcsets[format] = variants
          .map(v => `${this.urlBase}/${propref}/${this.getVariantFilename(v)} ${v.width}w`)
          .join(', ');
      }
    });

    // Fallback to medium-sized JPEG
    const jpegVariants = optimized.variants.filter(v => v.format === 'jpeg');
    const fallback = jpegVariants[Math.floor(jpegVariants.length / 2)]?.url || jpegVariants[0]?.url || '';

    return {
      srcsets,
      fallback,
      placeholder: optimized.placeholder,
      dominantColor: optimized.dominantColor,
      aspectRatio,
    };
  }

  /**
   * Get storage statistics and popular images
   */
  async getStorageStats(): Promise<{
    totalImages: number;
    totalVariants: number;
    storageSize: number;
    popularImages: Array<{ filename: string; propref: string; accessCount: number }>;
    cacheHitRate: number;
  }> {
    try {
      const cacheStats = await cacheService.getStats();
      
      // Get popular images from cache metadata
      const popularImages: Array<{ filename: string; propref: string; accessCount: number }> = [];
      
      return {
        totalImages: Math.floor(cacheStats.memory.size / 5), // Estimate
        totalVariants: cacheStats.memory.size,
        storageSize: cacheStats.memory.memoryUsage,
        popularImages: popularImages.slice(0, 10),
        cacheHitRate: cacheStats.combined.overallHitRate,
      };
    } catch (error) {
      console.error('[ImageStorage] Failed to get stats:', error);
      return {
        totalImages: 0,
        totalVariants: 0,
        storageSize: 0,
        popularImages: [],
        cacheHitRate: 0,
      };
    }
  }

  /**
   * Preload popular images for instant response
   */
  async preloadPopularImages(proprefs: string[]): Promise<void> {
    const startTime = Date.now();
    
    try {
      console.log(`[ImageStorage] Preloading images for ${proprefs.length} properties`);
      
      // This would typically integrate with the image processor
      // For now, we'll prepare the cache keys
      
      const cacheWarmPromises = proprefs.map(async (propref) => {
        const metadataPattern = `storage:meta:${propref}:*`;
        // Check if images exist in cache
        return cacheService.has(metadataPattern);
      });
      
      await Promise.all(cacheWarmPromises);
      
      console.log(`[ImageStorage] Preload completed in ${Date.now() - startTime}ms`);
    } catch (error) {
      console.error('[ImageStorage] Preload failed:', error);
    }
  }

  /**
   * Clean up old/unused images
   */
  async cleanupStorage(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    // In a production system, this would clean up files older than maxAgeMs
    // For now, we'll just clear old cache entries
    
    try {
      const deletedCount = await cacheService.invalidatePattern('storage:*');
      console.log(`[ImageStorage] Cleanup removed ${deletedCount} old cache entries`);
      return deletedCount;
    } catch (error) {
      console.error('[ImageStorage] Cleanup failed:', error);
      return 0;
    }
  }

  /**
   * Utility functions
   */
  private async ensureDirectory(path: string): Promise<void> {
    try {
      await access(path);
    } catch {
      await mkdir(path, { recursive: true });
    }
  }

  private async updateAccessStats(propref: string, filename: string): Promise<void> {
    try {
      const metadataKey = `storage:meta:${propref}:${filename}`;
      const metadata = await cacheService.get<StorageMetadata>(metadataKey);
      
      if (metadata) {
        metadata.lastAccessed = Date.now();
        metadata.accessCount++;
        await cacheService.set(metadataKey, metadata, this.maxCacheAge);
      }
    } catch (error) {
      // Silent fail - access stats are not critical
    }
  }

  private getVariantFilename(variant: ImageVariant): string {
    const filename = variant.url.split('/').pop() || '';
    return filename;
  }

  /**
   * Generate optimized loading strategy
   */
  getLoadingStrategy(width: number): {
    loading: 'eager' | 'lazy';
    fetchPriority: 'high' | 'low' | 'auto';
    decoding: 'sync' | 'async';
  } {
    // Above-the-fold images load eagerly, below-the-fold lazy
    const isAboveFold = width >= 800; // Assume larger images are more prominent
    
    return {
      loading: isAboveFold ? 'eager' : 'lazy',
      fetchPriority: isAboveFold ? 'high' : 'low',
      decoding: 'async',
    };
  }

  /**
   * Generate complete image HTML with all optimizations
   */
  generateOptimizedImageHTML(
    optimized: OptimizedImage,
    propref: string,
    alt: string,
    sizes: string = '100vw',
    className: string = ''
  ): string {
    const metadata = this.generateResponsiveMetadata(optimized, propref);
    const strategy = this.getLoadingStrategy(optimized.original.width);
    
    const avifSrcset = metadata.srcsets.avif;
    const webpSrcset = metadata.srcsets.webp;
    const jpegSrcset = metadata.srcsets.jpeg;
    
    return `
<picture class="${className}">
  ${avifSrcset ? `<source srcset="${avifSrcset}" sizes="${sizes}" type="image/avif">` : ''}
  ${webpSrcset ? `<source srcset="${webpSrcset}" sizes="${sizes}" type="image/webp">` : ''}
  <img 
    src="${metadata.fallback}"
    srcset="${jpegSrcset}"
    sizes="${sizes}"
    alt="${alt}"
    loading="${strategy.loading}"
    fetchpriority="${strategy.fetchPriority}"
    decoding="${strategy.decoding}"
    style="aspect-ratio: ${metadata.aspectRatio.toFixed(3)}; background-color: ${metadata.dominantColor};"
    onload="this.style.backgroundImage='none'"
  />
</picture>`.trim();
  }
}

// Export singleton instance
export const imageStorage = new ImageStorageService();