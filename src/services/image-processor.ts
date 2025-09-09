import sharp from 'sharp';
import { appConfig } from '@/utils/config';
import { cacheService } from '@/cache/cache-service';

export interface ImageVariant {
  width: number;
  height?: number;
  format: 'avif' | 'webp' | 'jpeg';
  quality: number;
  size: number;
  url: string;
}

export interface OptimizedImage {
  original: {
    width: number;
    height: number;
    format: string;
    size: number;
  };
  variants: ImageVariant[];
  placeholder: string; // base64 blur placeholder
  dominantColor: string;
}

interface ProcessingOptions {
  formats?: ('avif' | 'webp' | 'jpeg')[];
  widths?: number[];
  quality?: { avif: number; webp: number; jpeg: number };
  generatePlaceholder?: boolean;
}

const DEFAULT_OPTIONS: ProcessingOptions = {
  formats: ['avif', 'webp', 'jpeg'],
  widths: [400, 800, 1200, 1600], // Responsive breakpoints
  quality: { avif: 80, webp: 85, jpeg: 90 },
  generatePlaceholder: true,
};

export class ImageProcessor {
  private readonly maxConcurrentProcessing = 3;
  private processingQueue = new Map<string, Promise<OptimizedImage>>();

  /**
   * Process image with lightning-fast caching and multiple format variants
   */
  async processImage(
    imageBuffer: Buffer,
    filename: string,
    options: ProcessingOptions = {}
  ): Promise<OptimizedImage> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const cacheKey = `image:processed:${filename}:${this.hashOptions(opts)}`;

    // Check cache first for instant response
    const cached = await cacheService.get<OptimizedImage>(cacheKey);
    if (cached) {
      return cached;
    }

    // Prevent duplicate processing
    if (this.processingQueue.has(cacheKey)) {
      return await this.processingQueue.get(cacheKey)!;
    }

    // Process image with all optimizations
    const processingPromise = this.performImageProcessing(imageBuffer, filename, opts);
    this.processingQueue.set(cacheKey, processingPromise);

    try {
      const result = await processingPromise;
      
      // Cache for 24 hours (images rarely change)
      await cacheService.set(cacheKey, result, 86400);
      
      return result;
    } finally {
      this.processingQueue.delete(cacheKey);
    }
  }

  /**
   * Perform actual image processing with Sharp
   */
  private async performImageProcessing(
    imageBuffer: Buffer,
    filename: string,
    options: ProcessingOptions
  ): Promise<OptimizedImage> {
    const startTime = Date.now();
    
    try {
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      
      if (!metadata.width || !metadata.height) {
        throw new Error('Invalid image metadata');
      }

      // Generate all variants in parallel for speed
      const variantPromises: Promise<ImageVariant>[] = [];
      
      for (const format of options.formats!) {
        for (const width of options.widths!) {
          // Skip if target width is larger than original
          if (width <= metadata.width) {
            variantPromises.push(
              this.generateVariant(image, width, format, options.quality![format], filename)
            );
          }
        }
      }

      // Generate placeholder and dominant color in parallel
      const [variants, placeholder, dominantColor] = await Promise.all([
        Promise.all(variantPromises),
        options.generatePlaceholder ? this.generatePlaceholder(image) : Promise.resolve(''),
        this.extractDominantColor(image),
      ]);

      const processingTime = Date.now() - startTime;
      console.log(`[ImageProcessor] Processed ${filename} in ${processingTime}ms with ${variants.length} variants`);

      return {
        original: {
          width: metadata.width,
          height: metadata.height,
          format: metadata.format || 'unknown',
          size: imageBuffer.length,
        },
        variants: variants.sort((a, b) => a.width - b.width), // Sort by width
        placeholder,
        dominantColor,
      };
    } catch (error) {
      console.error(`[ImageProcessor] Failed to process ${filename}:`, error);
      throw new Error(`Image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate single image variant
   */
  private async generateVariant(
    image: sharp.Sharp,
    width: number,
    format: 'avif' | 'webp' | 'jpeg',
    quality: number,
    filename: string
  ): Promise<ImageVariant> {
    const height = Math.round(width * 0.75); // Maintain aspect ratio approximation
    
    let pipeline = image.clone().resize(width, null, {
      withoutEnlargement: true,
      fit: sharp.fit.inside,
    });

    // Apply format-specific optimizations
    switch (format) {
      case 'avif':
        pipeline = pipeline.avif({
          quality,
          effort: 4, // Balance between speed and compression
          chromaSubsampling: '4:2:0',
        });
        break;
      case 'webp':
        pipeline = pipeline.webp({
          quality,
          effort: 4,
          smartSubsample: true,
        });
        break;
      case 'jpeg':
        pipeline = pipeline.jpeg({
          quality,
          mozjpeg: true,
          progressive: true,
        });
        break;
    }

    const buffer = await pipeline.toBuffer();
    const variantFilename = `${this.getBasename(filename)}_${width}w.${format}`;
    
    return {
      width,
      height,
      format,
      quality,
      size: buffer.length,
      url: this.generateImageUrl(variantFilename),
    };
  }

  /**
   * Generate ultra-small blur placeholder (< 1KB)
   */
  private async generatePlaceholder(image: sharp.Sharp): Promise<string> {
    const buffer = await image
      .clone()
      .resize(20, 15) // Tiny 20x15 placeholder
      .blur(1)
      .jpeg({ quality: 30 })
      .toBuffer();
    
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  }

  /**
   * Extract dominant color for background while loading
   */
  private async extractDominantColor(image: sharp.Sharp): Promise<string> {
    try {
      const { dominant } = await image.clone().resize(1, 1).raw().toBuffer({ resolveWithObject: true });
      const stats = await image.stats();
      
      if (stats.dominant) {
        const { r, g, b } = stats.dominant;
        return `rgb(${r}, ${g}, ${b})`;
      }
      
      return '#f5f5f5'; // Fallback gray
    } catch {
      return '#f5f5f5';
    }
  }

  /**
   * Process image from Rentman API base64 data
   */
  async processFromBase64(
    base64Data: string,
    filename: string,
    options?: ProcessingOptions
  ): Promise<OptimizedImage> {
    try {
      // Remove data URL prefix if present
      const base64Clean = base64Data.replace(/^data:image\/[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      
      return await this.processImage(buffer, filename, options);
    } catch (error) {
      console.error(`[ImageProcessor] Failed to process base64 image ${filename}:`, error);
      throw error;
    }
  }

  /**
   * Batch process multiple images efficiently
   */
  async processMultiple(
    images: Array<{ buffer: Buffer; filename: string; options?: ProcessingOptions }>
  ): Promise<OptimizedImage[]> {
    // Process in batches to avoid memory issues
    const batchSize = this.maxConcurrentProcessing;
    const results: OptimizedImage[] = [];
    
    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      const batchPromises = batch.map(({ buffer, filename, options }) =>
        this.processImage(buffer, filename, options)
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * Generate srcset string for responsive images
   */
  generateSrcSet(variants: ImageVariant[], format: 'avif' | 'webp' | 'jpeg'): string {
    return variants
      .filter(v => v.format === format)
      .map(v => `${v.url} ${v.width}w`)
      .join(', ');
  }

  /**
   * Generate complete picture element markup for maximum compatibility
   */
  generatePictureMarkup(
    optimized: OptimizedImage,
    alt: string,
    sizes: string = '100vw'
  ): string {
    const avifVariants = optimized.variants.filter(v => v.format === 'avif');
    const webpVariants = optimized.variants.filter(v => v.format === 'webp');
    const jpegVariants = optimized.variants.filter(v => v.format === 'jpeg');
    
    const fallbackSrc = jpegVariants[Math.floor(jpegVariants.length / 2)]?.url || jpegVariants[0]?.url;
    
    return `
<picture>
  ${avifVariants.length ? `<source srcset="${this.generateSrcSet(optimized.variants, 'avif')}" sizes="${sizes}" type="image/avif">` : ''}
  ${webpVariants.length ? `<source srcset="${this.generateSrcSet(optimized.variants, 'webp')}" sizes="${sizes}" type="image/webp">` : ''}
  <img src="${fallbackSrc}" 
       srcset="${this.generateSrcSet(optimized.variants, 'jpeg')}"
       sizes="${sizes}"
       alt="${alt}"
       style="background-color: ${optimized.dominantColor}"
       loading="lazy"
       decoding="async">
</picture>`.trim();
  }

  /**
   * Get cache statistics for monitoring
   */
  async getCacheStats(): Promise<{
    totalImages: number;
    cacheSize: string;
    hitRate: number;
  }> {
    const stats = await cacheService.getStats();
    
    return {
      totalImages: stats.memory.size + stats.redis.keyCount,
      cacheSize: `${(stats.memory.memoryUsage / 1024 / 1024).toFixed(2)}MB`,
      hitRate: stats.combined.overallHitRate,
    };
  }

  /**
   * Utility functions
   */
  private hashOptions(options: ProcessingOptions): string {
    return Buffer.from(JSON.stringify(options)).toString('base64').slice(0, 8);
  }

  private getBasename(filename: string): string {
    return filename.split('.')[0];
  }

  private generateImageUrl(filename: string): string {
    return `${appConfig.server.apiBaseUrl}/api/media/${filename}`;
  }

  /**
   * Clear image cache for specific property
   */
  async invalidatePropertyImages(propref: string): Promise<number> {
    return await cacheService.invalidatePattern(`image:*:${propref}:*`);
  }

  /**
   * Warm cache for popular images
   */
  async warmImageCache(popularImages: string[]): Promise<void> {
    console.log(`[ImageProcessor] Warming cache for ${popularImages.length} popular images`);
    
    for (const filename of popularImages) {
      try {
        const cacheKey = `image:processed:${filename}:*`;
        const exists = await cacheService.has(cacheKey);
        
        if (!exists) {
          // This would typically fetch from Rentman and process
          console.log(`[ImageProcessor] Would warm cache for ${filename}`);
        }
      } catch (error) {
        console.warn(`[ImageProcessor] Failed to warm cache for ${filename}:`, error);
      }
    }
  }
}

// Export singleton instance
export const imageProcessor = new ImageProcessor();