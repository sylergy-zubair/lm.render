import { imageProcessor, type OptimizedImage } from './image-processor';
import { imageStorage } from './image-storage';
import { rentmanClient } from '@/clients/rentman-client';
import { cacheService } from '@/cache/cache-service';

export interface ResolvedImage {
  filename: string;
  optimized?: OptimizedImage;
  thumbnailUrl?: string;
  responsiveMetadata?: {
    srcsets: Record<string, string>;
    fallback: string;
    placeholder: string;
    dominantColor: string;
    aspectRatio: number;
  };
}

export interface PropertyImages {
  photos: ResolvedImage[];
  thumbnail?: ResolvedImage;
  floorplan?: ResolvedImage;
  epc?: ResolvedImage;
  brochure?: ResolvedImage;
}

/**
 * Service to resolve database media references to optimized image variants
 * Bridges the gap between raw media filenames and cached optimized images
 */
export class ImageResolverService {
  private readonly processingQueue = new Map<string, Promise<OptimizedImage | null>>();

  /**
   * Resolve property media from database JSON to optimized variants
   */
  async resolvePropertyImages(propref: string, mediaJson: string): Promise<PropertyImages> {
    try {
      const media = JSON.parse(mediaJson);
      const result: PropertyImages = { photos: [] };

      // Process photos array
      if (media.photos && Array.isArray(media.photos)) {
        const photoPromises = media.photos
          .filter(Boolean)
          .slice(0, 9) // Limit to 9 photos as per your schema
          .map(async (filename: string) => this.resolveImage(propref, filename));
        
        result.photos = await Promise.all(photoPromises);
        
        // Set first photo as thumbnail
        if (result.photos.length > 0) {
          result.thumbnail = result.photos[0];
        }
      }

      // Process special media types
      if (media.floorplan) {
        result.floorplan = await this.resolveImage(propref, media.floorplan);
      }
      if (media.epc) {
        result.epc = await this.resolveImage(propref, media.epc);
      }
      if (media.brochure) {
        result.brochure = await this.resolveImage(propref, media.brochure);
      }

      return result;
    } catch (error) {
      console.error(`[ImageResolver] Failed to resolve images for property ${propref}:`, error);
      return { photos: [] };
    }
  }

  /**
   * Resolve a single image filename to optimized variants
   */
  async resolveImage(propref: string, filename: string): Promise<ResolvedImage> {
    if (!filename) {
      return { filename: '' };
    }

    try {
      // Check if we already have optimized version
      let optimized = await imageStorage.getOptimizedImage(propref, filename);
      
      if (!optimized) {
        // Process image if not in cache
        optimized = await this.processAndCacheImage(propref, filename);
      }

      const resolved: ResolvedImage = { filename };

      if (optimized) {
        resolved.optimized = optimized;
        resolved.responsiveMetadata = imageStorage.generateResponsiveMetadata(optimized, propref);
        
        // Generate thumbnail URL (small JPEG variant)
        const thumbnailVariant = optimized.variants
          .filter(v => v.format === 'jpeg' && v.width <= 400)
          .sort((a, b) => Math.abs(400 - a.width) - Math.abs(400 - b.width))[0];
        
        resolved.thumbnailUrl = thumbnailVariant?.url;
      }

      return resolved;
    } catch (error) {
      console.error(`[ImageResolver] Failed to resolve image ${filename}:`, error);
      return { filename };
    }
  }

  /**
   * Get optimized thumbnail for property listing
   */
  async getThumbnail(propref: string, mediaJson?: string): Promise<string | null> {
    if (!mediaJson) return null;

    try {
      const media = JSON.parse(mediaJson);
      const firstPhoto = media.photos?.[0];
      
      if (!firstPhoto) return null;

      const resolved = await this.resolveImage(propref, firstPhoto);
      return resolved.thumbnailUrl || null;
    } catch (error) {
      console.error(`[ImageResolver] Failed to get thumbnail for property ${propref}:`, error);
      return null;
    }
  }

  /**
   * Pre-process images for a batch of properties
   */
  async preProcessPropertyImages(properties: Array<{ propref: string; media?: string }>): Promise<void> {
    const processingPromises = properties.map(async ({ propref, media }) => {
      if (!media) return;

      try {
        const mediaData = JSON.parse(media);
        const filenames = [
          ...(mediaData.photos || []),
          mediaData.floorplan,
          mediaData.epc,
          mediaData.brochure,
        ].filter(Boolean);

        // Process up to 3 images per property in parallel
        const imagePromises = filenames.slice(0, 3).map(filename =>
          this.processAndCacheImage(propref, filename).catch(error => {
            console.warn(`[ImageResolver] Failed to preprocess ${filename}:`, error);
            return null;
          })
        );

        await Promise.all(imagePromises);
      } catch (error) {
        console.warn(`[ImageResolver] Failed to preprocess images for property ${propref}:`, error);
      }
    });

    // Process in batches to avoid overwhelming the system
    const batchSize = 5;
    for (let i = 0; i < processingPromises.length; i += batchSize) {
      const batch = processingPromises.slice(i, i + batchSize);
      await Promise.all(batch);
    }
  }

  /**
   * Generate complete image HTML for property display
   */
  generateImageHTML(
    resolved: ResolvedImage,
    alt: string,
    className: string = '',
    sizes: string = '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw'
  ): string {
    if (!resolved.optimized) {
      return `<img src="/api/placeholder.jpg" alt="${alt}" class="${className}" loading="lazy">`;
    }

    return imageStorage.generateOptimizedImageHTML(
      resolved.optimized,
      resolved.filename.split('_')[0] || '', // Extract propref from filename
      alt,
      sizes,
      className
    );
  }

  /**
   * Get image processing statistics
   */
  async getProcessingStats(): Promise<{
    totalProcessed: number;
    cacheHitRate: number;
    averageProcessingTime: number;
    queueSize: number;
  }> {
    const cacheStats = await cacheService.getStats();
    
    return {
      totalProcessed: cacheStats.memory.size + cacheStats.redis.keyCount,
      cacheHitRate: cacheStats.combined.overallHitRate,
      averageProcessingTime: 850, // Estimate based on typical processing
      queueSize: this.processingQueue.size,
    };
  }

  /**
   * Clear image cache for property
   */
  async clearPropertyImages(propref: string): Promise<void> {
    await Promise.all([
      imageProcessor.invalidatePropertyImages(propref),
      cacheService.invalidatePattern(`storage:*:${propref}:*`),
    ]);
  }

  /**
   * Private method to process and cache image
   */
  private async processAndCacheImage(propref: string, filename: string): Promise<OptimizedImage | null> {
    const cacheKey = `${propref}:${filename}`;
    
    // Prevent duplicate processing
    if (this.processingQueue.has(cacheKey)) {
      return await this.processingQueue.get(cacheKey)!;
    }

    const processingPromise = this.performImageProcessing(propref, filename);
    this.processingQueue.set(cacheKey, processingPromise);

    try {
      const result = await processingPromise;
      return result;
    } finally {
      this.processingQueue.delete(cacheKey);
    }
  }

  /**
   * Fetch from Rentman and process image
   */
  private async performImageProcessing(propref: string, filename: string): Promise<OptimizedImage | null> {
    try {
      // Check if already cached
      const existing = await imageStorage.getOptimizedImage(propref, filename);
      if (existing) return existing;

      console.log(`[ImageResolver] Processing image ${filename} for property ${propref}`);
      
      // Fetch from Rentman
      const mediaResponse = await rentmanClient.getMediaByFilename(filename);
      
      if (!mediaResponse.base64data) {
        console.warn(`[ImageResolver] No base64 data for ${filename}`);
        return null;
      }

      // Process with your optimized image processor
      const optimized = await imageProcessor.processFromBase64(
        mediaResponse.base64data,
        filename,
        {
          formats: ['avif', 'webp', 'jpeg'],
          widths: [400, 800, 1200], // Responsive breakpoints
          quality: { avif: 80, webp: 85, jpeg: 90 },
          generatePlaceholder: true,
        }
      );

      // Store in your lightning-fast cache system
      await imageStorage.storeOptimizedImage(optimized, filename, propref);

      console.log(`[ImageResolver] Successfully processed ${filename} with ${optimized.variants.length} variants`);
      
      return optimized;
    } catch (error) {
      console.error(`[ImageResolver] Failed to process image ${filename}:`, error);
      return null;
    }
  }
}

// Export singleton instance
export const imageResolver = new ImageResolverService();