# Image Optimization Pipeline

## Overview

The image optimization pipeline handles Rentman's base64-encoded images and transforms them into multiple optimized variants for different use cases. This system ensures fast loading times while maintaining image quality across all device types.

***

## 1. Pipeline Architecture

### 1.1. Processing Flow
```
Rentman Base64 Data → Decode → Sharp Processing → Multiple Variants → CDN Upload → Cache URLs
```

### 1.2. Key Components
- **Image Decoder**: Converts base64 strings to binary data
- **Sharp Processor**: High-performance image manipulation
- **Variant Generator**: Creates multiple sizes and formats
- **CDN Uploader**: Stores optimized images on AWS S3/CloudFront
- **URL Cache**: Redis caching of processed image URLs

***

## 2. Image Types & Variants

### 2.1. Property Photos (photo1-photo9) - Frontend Optimized
```typescript
const photoVariants = {
  // Mobile-first responsive variants
  thumbnail: {
    width: 300,
    height: 200,
    quality: 80,
    formats: ['avif', 'webp', 'jpeg'],
    use: 'Property listings, mobile cards',
    responsive: {
      '1x': { width: 300, height: 200 },
      '2x': { width: 600, height: 400 },
      '3x': { width: 900, height: 600 }
    }
  },
  card: {
    width: 800,
    height: 600,
    quality: 85,
    formats: ['avif', 'webp', 'jpeg'],
    use: 'Property cards, search results',
    responsive: {
      '1x': { width: 800, height: 600 },
      '2x': { width: 1600, height: 1200 }
    }
  },
  hero: {
    width: 1200,
    height: 800,
    quality: 90,
    formats: ['avif', 'webp', 'jpeg'],
    use: 'Featured property hero sections',
    responsive: {
      '1x': { width: 1200, height: 800 },
      '2x': { width: 2400, height: 1600 }
    }
  },
  full: {
    width: 1920,
    height: 1080,
    quality: 90,
    formats: ['avif', 'webp', 'jpeg'],
    use: 'Lightbox, gallery view, desktop',
    responsive: {
      '1x': { width: 1920, height: 1080 },
      '2x': { width: 3840, height: 2160 }
    }
  },
  // Framer-specific variants for different breakpoints
  mobile: {
    width: 375,
    height: 250,
    quality: 75,
    formats: ['avif', 'webp', 'jpeg'],
    use: 'Mobile viewport (375px)',
    responsive: {
      '1x': { width: 375, height: 250 },
      '2x': { width: 750, height: 500 },
      '3x': { width: 1125, height: 750 }
    }
  },
  tablet: {
    width: 768,
    height: 512,
    quality: 85,
    formats: ['avif', 'webp', 'jpeg'],
    use: 'Tablet viewport (768px)',
    responsive: {
      '1x': { width: 768, height: 512 },
      '2x': { width: 1536, height: 1024 }
    }
  },
  desktop: {
    width: 1440,
    height: 960,
    quality: 90,
    formats: ['avif', 'webp', 'jpeg'],
    use: 'Desktop viewport (1440px+)',
    responsive: {
      '1x': { width: 1440, height: 960 },
      '2x': { width: 2880, height: 1920 }
    }
  }
};
```

### 2.2. Specialized Images
```typescript
const specialImageTypes = {
  floorplan: {
    quality: 95,
    preserveAspectRatio: true,
    formats: ['png', 'jpeg'],
    use: 'Architectural drawings'
  },
  epc: {
    quality: 100,
    format: 'png',
    preserveText: true,
    use: 'Energy certificates'
  },
  brochure: {
    quality: 95,
    format: 'pdf',
    thumbnailGeneration: true,
    use: 'Property brochures'
  }
};
```

***

## 3. Implementation Details

### 3.1. Enhanced Image Processor Class - Frontend Optimized
```typescript
// src/processing/image-processor.ts
import sharp from 'sharp';
import { uploadToCDN } from './cdn-uploader';
import { cacheService } from '../cache/cache-service';

export class ImageProcessor {
  private variants = {
    thumbnail: { width: 300, height: 200, quality: 80 },
    card: { width: 800, height: 600, quality: 85 },
    hero: { width: 1200, height: 800, quality: 90 },
    full: { maxWidth: 1920, maxHeight: 1080, quality: 90 },
    mobile: { width: 375, height: 250, quality: 75 },
    tablet: { width: 768, height: 512, quality: 85 },
    desktop: { width: 1440, height: 960, quality: 90 }
  };

  async processImage(base64Data: string, filename: string, type: 'photo' | 'floorplan' | 'epc'): Promise<ProcessedImage> {
    try {
      // Decode base64
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Validate image
      const metadata = await sharp(buffer).metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error('Invalid image data');
      }

      // Generate all variants with modern formats
      const variants = await this.generateModernVariants(buffer, filename, type);
      
      // Upload to CDN with optimized headers
      const urls = await this.uploadVariants(variants, filename);
      
      // Generate responsive image URLs
      const responsiveUrls = this.generateResponsiveUrls(urls, filename);
      
      // Cache URLs with proper TTL
      await this.cacheImageUrls(filename, responsiveUrls);
      
      return {
        filename,
        originalSize: buffer.length,
        variants: responsiveUrls,
        metadata: {
          width: metadata.width,
          height: metadata.height,
          format: metadata.format,
          hasAlpha: metadata.hasAlpha
        },
        processedAt: new Date(),
        supportedFormats: ['avif', 'webp', 'jpeg']
      };
    } catch (error) {
      console.error(`Image processing failed for ${filename}:`, error);
      throw new ImageProcessingError(`Failed to process ${filename}`, error);
    }
  }

  private async generateModernVariants(buffer: Buffer, filename: string, type: string): Promise<ImageVariant[]> {
    const variants: ImageVariant[] = [];
    const sharpInstance = sharp(buffer);
    const configs = this.getVariantConfig(type);
    
    for (const [variantName, config] of Object.entries(configs)) {
      // Generate responsive variants (1x, 2x, 3x)
      for (const [density, dimensions] of Object.entries(config.responsive || { '1x': config })) {
        const suffix = density === '1x' ? '' : `_${density}`;
        
        // AVIF (best compression, modern browsers)
        if (config.formats.includes('avif')) {
          try {
            const avifBuffer = await sharpInstance
              .clone()
              .resize(dimensions.width, dimensions.height, { 
                fit: 'cover', 
                withoutEnlargement: true,
                kernel: sharp.kernel.lanczos3
              })
              .avif({ 
                quality: config.quality,
                effort: 6 // Max effort for best compression
              })
              .toBuffer();
            
            variants.push({
              name: `${variantName}${suffix}_avif`,
              buffer: avifBuffer,
              contentType: 'image/avif',
              size: avifBuffer.length,
              density,
              variant: variantName,
              format: 'avif'
            });
          } catch (avifError) {
            console.warn(`AVIF generation failed for ${filename}:`, avifError);
          }
        }
        
        // WebP (good compression, wide support)
        if (config.formats.includes('webp')) {
          const webpBuffer = await sharpInstance
            .clone()
            .resize(dimensions.width, dimensions.height, { 
              fit: 'cover', 
              withoutEnlargement: true,
              kernel: sharp.kernel.lanczos3
            })
            .webp({ 
              quality: config.quality,
              effort: 6
            })
            .toBuffer();
          
          variants.push({
            name: `${variantName}${suffix}_webp`,
            buffer: webpBuffer,
            contentType: 'image/webp',
            size: webpBuffer.length,
            density,
            variant: variantName,
            format: 'webp'
          });
        }
        
        // JPEG (universal fallback)
        if (config.formats.includes('jpeg')) {
          const jpegBuffer = await sharpInstance
            .clone()
            .resize(dimensions.width, dimensions.height, { 
              fit: 'cover', 
              withoutEnlargement: true,
              kernel: sharp.kernel.lanczos3
            })
            .jpeg({ 
              quality: config.quality,
              progressive: true,
              mozjpeg: true
            })
            .toBuffer();
          
          variants.push({
            name: `${variantName}${suffix}_jpeg`,
            buffer: jpegBuffer,
            contentType: 'image/jpeg',
            size: jpegBuffer.length,
            density,
            variant: variantName,
            format: 'jpeg'
          });
        }
      }
    }
    
    return variants;
  }

  private generateResponsiveUrls(urls: Record<string, string>, filename: string): ResponsiveImageUrls {
    const responsive: ResponsiveImageUrls = {};
    
    // Group URLs by variant and density
    for (const [key, url] of Object.entries(urls)) {
      const [variant, density = '1x', format] = key.split('_');
      
      if (!responsive[variant]) {
        responsive[variant] = {};
      }
      
      if (!responsive[variant][format]) {
        responsive[variant][format] = {};
      }
      
      responsive[variant][format][density] = url;
    }
    
    return responsive;
  }

  // Generate Picture element data for frontend
  async getPictureElementData(filename: string, variant: string = 'card'): Promise<PictureElementData> {
    const urls = await cacheService.get<ResponsiveImageUrls>(`image:${filename}:responsive`);
    
    if (!urls || !urls[variant]) {
      throw new Error(`No processed images found for ${filename}:${variant}`);
    }
    
    const variantUrls = urls[variant];
    const sources: SourceElement[] = [];
    
    // Generate sources in order of preference (AVIF first, JPEG last)
    for (const format of ['avif', 'webp', 'jpeg']) {
      if (variantUrls[format]) {
        const srcset = Object.entries(variantUrls[format])
          .map(([density, url]) => `${url} ${density}`)
          .join(', ');
        
        sources.push({
          type: `image/${format}`,
          srcset,
          sizes: this.getSizesAttribute(variant)
        });
      }
    }
    
    return {
      sources,
      fallbackSrc: variantUrls.jpeg?.['1x'] || variantUrls.webp?.['1x'],
      alt: `Property image ${filename}`,
      loading: 'lazy',
      decoding: 'async'
    };
  }

  private getSizesAttribute(variant: string): string {
    const sizesMap = {
      mobile: '(max-width: 375px) 100vw, 375px',
      tablet: '(max-width: 768px) 100vw, 768px',
      thumbnail: '(max-width: 300px) 100vw, 300px',
      card: '(max-width: 800px) 100vw, 800px',
      hero: '(max-width: 1200px) 100vw, 1200px',
      desktop: '(max-width: 1440px) 100vw, 1440px',
      full: '100vw'
    };
    
    return sizesMap[variant] || '100vw';
  }
}

// Enhanced type definitions
interface ResponsiveImageUrls {
  [variant: string]: {
    [format: string]: {
      [density: string]: string;
    };
  };
}

interface PictureElementData {
  sources: SourceElement[];
  fallbackSrc: string;
  alt: string;
  loading: 'lazy' | 'eager';
  decoding: 'async' | 'sync';
}

interface SourceElement {
  type: string;
  srcset: string;
  sizes: string;
}

interface ImageVariant {
  name: string;
  buffer: Buffer;
  contentType: string;
  size: number;
  density: string;
  variant: string;
  format: string;
}
```

### 3.2. CDN Upload Handler
```typescript
// src/processing/cdn-uploader.ts
import AWS from 'aws-sdk';

export class CDNUploader {
  private s3: AWS.S3;
  private bucket: string;
  private cdnBaseUrl: string;

  constructor() {
    this.s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.bucket = process.env.S3_BUCKET || 'london-move-images';
    this.cdnBaseUrl = process.env.CDN_BASE_URL || 'https://cdn.london-move.com';
  }

  async uploadVariant(variant: ImageVariant, path: string): Promise<string> {
    const key = `images/${path}/${variant.name}`;
    
    await this.s3.upload({
      Bucket: this.bucket,
      Key: key,
      Body: variant.buffer,
      ContentType: variant.contentType,
      CacheControl: 'max-age=31536000', // 1 year
      ACL: 'public-read'
    }).promise();
    
    return `${this.cdnBaseUrl}/${key}`;
  }

  async uploadVariants(variants: ImageVariant[], basePath: string): Promise<Record<string, string>> {
    const uploadPromises = variants.map(async (variant) => {
      const url = await this.uploadVariant(variant, basePath);
      return [variant.name, url];
    });
    
    const results = await Promise.all(uploadPromises);
    return Object.fromEntries(results);
  }
}
```

***

## 4. Performance Optimizations

### 4.1. Lazy Loading Strategy
```typescript
// On-demand processing with background optimization
export class LazyImageProcessor {
  async getImageUrl(filename: string, variant: string = 'thumbnail'): Promise<string> {
    // Check cache first
    const cached = await cacheService.get(`image:${filename}:${variant}`);
    if (cached) return cached;
    
    // Check if processing is in progress
    const processing = await cacheService.get(`processing:${filename}`);
    if (processing) {
      // Return placeholder or wait
      return this.getPlaceholderUrl(filename, variant);
    }
    
    // Start processing in background
    this.processImageBackground(filename);
    
    // Return placeholder for immediate response
    return this.getPlaceholderUrl(filename, variant);
  }
  
  private async processImageBackground(filename: string): Promise<void> {
    // Mark as processing
    await cacheService.set(`processing:${filename}`, true, 300);
    
    try {
      // Get base64 from Rentman API
      const mediaData = await rentmanClient.getMediaByFilename(filename);
      
      // Process image
      const processed = await imageProcessor.processImage(
        mediaData.base64data, 
        filename, 
        this.getImageType(filename)
      );
      
      // Cache all variant URLs
      for (const [variant, url] of Object.entries(processed.variants)) {
        await cacheService.set(`image:${filename}:${variant}`, url, 86400); // 24 hours
      }
      
    } finally {
      // Remove processing flag
      await cacheService.delete(`processing:${filename}`);
    }
  }
}
```

### 4.2. Batch Processing
```typescript
// Process multiple images for a property at once
export class BatchImageProcessor {
  async processPropertyImages(propref: string): Promise<void> {
    const property = await rentmanClient.getProperty(propref);
    const imageFields = [
      'photo1', 'photo2', 'photo3', 'photo4', 'photo5',
      'photo6', 'photo7', 'photo8', 'photo9', 'floorplan', 'epc'
    ];
    
    const processingPromises = imageFields
      .filter(field => property[field])
      .map(async (field) => {
        const mediaData = await rentmanClient.getMediaByFilename(property[field]);
        return this.imageProcessor.processImage(
          mediaData.base64data,
          property[field],
          this.getImageTypeFromField(field)
        );
      });
    
    await Promise.all(processingPromises);
    
    // Warm cache for common variants
    await this.warmPropertyImageCache(propref);
  }
}
```

***

## 5. Error Handling & Resilience

### 5.1. Graceful Degradation
```typescript
export class ResilientImageHandler {
  async getImageWithFallback(filename: string, variant: string): Promise<string> {
    try {
      // Try to get optimized image
      return await this.getOptimizedImage(filename, variant);
    } catch (error) {
      console.warn(`Optimized image failed for ${filename}:`, error);
      
      try {
        // Fallback to original base64 conversion
        return await this.getOriginalImage(filename);
      } catch (fallbackError) {
        console.error(`All image sources failed for ${filename}:`, fallbackError);
        
        // Return placeholder
        return this.getPlaceholderImage(variant);
      }
    }
  }
  
  private getPlaceholderImage(variant: string): string {
    const placeholders = {
      thumbnail: 'https://via.placeholder.com/300x200?text=Loading',
      card: 'https://via.placeholder.com/800x600?text=Loading',
      full: 'https://via.placeholder.com/1920x1080?text=Loading'
    };
    
    return placeholders[variant] || placeholders.thumbnail;
  }
}
```

### 5.2. Resource Management
```typescript
export class ResourceManager {
  private processingQueue = new Map<string, Promise<any>>();
  private maxConcurrent = 5;
  private currentProcessing = 0;
  
  async queueImageProcessing(filename: string, processingFn: () => Promise<any>): Promise<any> {
    // Prevent duplicate processing
    if (this.processingQueue.has(filename)) {
      return this.processingQueue.get(filename);
    }
    
    // Wait if at capacity
    while (this.currentProcessing >= this.maxConcurrent) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.currentProcessing++;
    
    const promise = processingFn()
      .finally(() => {
        this.currentProcessing--;
        this.processingQueue.delete(filename);
      });
    
    this.processingQueue.set(filename, promise);
    return promise;
  }
}
```

***

## 6. Monitoring & Analytics

### 6.1. Processing Metrics
```typescript
export class ImageMetrics {
  async trackProcessingTime(filename: string, startTime: number, endTime: number): Promise<void> {
    const duration = endTime - startTime;
    
    await Promise.all([
      // Store in database for analytics
      db.insert(imageProcessingMetrics).values({
        filename,
        processingTime: duration,
        timestamp: new Date()
      }),
      
      // Update Redis counters
      redis.incr('image:processing:count'),
      redis.incrby('image:processing:total_time', duration),
      
      // Alert if processing is slow
      duration > 5000 && this.alertSlowProcessing(filename, duration)
    ]);
  }
  
  async getProcessingStats(): Promise<ImageStats> {
    const [count, totalTime] = await Promise.all([
      redis.get('image:processing:count'),
      redis.get('image:processing:total_time')
    ]);
    
    return {
      totalProcessed: parseInt(count) || 0,
      averageTime: count ? (totalTime / count) : 0,
      successRate: await this.getSuccessRate(),
      cacheHitRate: await this.getCacheHitRate()
    };
  }
}
```

### 6.2. Cache Optimization
```typescript
export class ImageCacheOptimizer {
  async analyzeCachePerformance(): Promise<CacheAnalysis> {
    const metrics = await Promise.all([
      this.getCacheHitRate(),
      this.getPopularVariants(),
      this.getUnusedImages()
    ]);
    
    return {
      hitRate: metrics[0],
      popularVariants: metrics[1],
      cleanupCandidates: metrics[2],
      recommendations: this.generateOptimizationRecommendations(metrics)
    };
  }
  
  async cleanupUnusedImages(): Promise<void> {
    const unusedImages = await this.getUnusedImages();
    
    for (const image of unusedImages) {
      if (this.isOlderThan(image.lastAccessed, 30)) { // 30 days
        await this.deleteImageVariants(image.filename);
        await this.removeFromCache(image.filename);
      }
    }
  }
}
```

***

## 7. Integration with Main System

### 7.1. API Integration
```typescript
// In routes/media.ts
app.get('/api/properties/:id/media', async (c) => {
  const propref = c.req.param('id');
  const variant = c.req.query('variant') || 'thumbnail';
  
  try {
    // Get processed images
    const images = await lazyImageProcessor.getPropertyImages(propref, variant);
    
    return c.json({
      data: images,
      meta: {
        variant,
        totalImages: images.length,
        cached: true
      }
    });
  } catch (error) {
    // Return fallback response
    return c.json({
      data: [],
      error: 'Images temporarily unavailable',
      fallback: true
    }, 206); // Partial content
  }
});
```

### 7.2. Admin Interface Integration
```typescript
// Admin endpoint for image management
app.post('/admin/api/images/:filename/reprocess', adminAuth, async (c) => {
  const filename = c.req.param('filename');
  
  try {
    // Clear existing cache
    await cacheService.invalidatePattern(`image:${filename}:*`);
    
    // Reprocess image
    await imageProcessor.reprocessImage(filename);
    
    return c.json({ success: true, message: 'Image reprocessed successfully' });
  } catch (error) {
    return c.json({ error: 'Failed to reprocess image' }, 500);
  }
});
```

***

## 8. Frontend Integration for Framer

### 8.1. Enhanced Media API Endpoint
```typescript
// Enhanced media endpoint with frontend-specific optimizations
app.get('/api/properties/:id/media', async (c) => {
  const propref = c.req.param('id');
  const variant = c.req.query('variant') || 'card';
  const format = c.req.query('format'); // 'avif', 'webp', 'jpeg'
  const density = c.req.query('density') || '1x'; // '1x', '2x', '3x'
  const pictureData = c.req.query('picture') === 'true';
  
  try {
    if (pictureData) {
      // Return complete picture element data for frontend
      const images = await imageProcessor.getPropertyPictureData(propref);
      
      return c.json({
        data: images,
        meta: {
          variant,
          totalImages: images.length,
          formats: ['avif', 'webp', 'jpeg'],
          responsive: true,
          cached: true
        }
      });
    } else {
      // Return specific format/variant
      const imageUrl = await imageProcessor.getSpecificImage(propref, variant, format, density);
      
      return c.json({
        data: { url: imageUrl },
        meta: {
          variant,
          format,
          density,
          cached: true
        }
      });
    }
  } catch (error) {
    // Progressive enhancement - return fallback
    const fallback = await imageProcessor.getFallbackImage(propref, variant);
    
    return c.json({
      data: fallback,
      meta: {
        fallback: true,
        variant,
        cached: false
      }
    }, 206); // Partial content
  }
});

// Bulk image optimization for property lists
app.post('/api/properties/media/bulk', async (c) => {
  const { proprefs, variant = 'thumbnail' } = await c.req.json();
  
  const results = await Promise.allSettled(
    proprefs.map(async (propref: string) => {
      const pictureData = await imageProcessor.getPictureElementData(propref, variant);
      return { propref, ...pictureData };
    })
  );
  
  const successful = results
    .filter(result => result.status === 'fulfilled')
    .map(result => (result as PromiseFulfilledResult<any>).value);
  
  return c.json({
    data: successful,
    meta: {
      requested: proprefs.length,
      successful: successful.length,
      variant,
      bulkOptimized: true
    }
  });
});
```

### 8.2. Frontend Response Formats
```typescript
// Framer-optimized response format
interface FramerImageResponse {
  data: {
    // Picture element data ready for use
    sources: Array<{
      type: string;           // 'image/avif', 'image/webp', 'image/jpeg'
      srcset: string;         // 'url 1x, url 2x, url 3x'
      sizes: string;          // '(max-width: 768px) 100vw, 768px'
    }>;
    fallbackSrc: string;      // JPEG fallback
    alt: string;              // SEO-optimized alt text
    loading: 'lazy' | 'eager'; // Performance hint
    decoding: 'async';        // Performance hint
    
    // Additional metadata for Framer
    aspectRatio: string;      // '4/3', '16/9', etc.
    backgroundColor: string;  // Extracted dominant color for placeholder
    blurDataURL?: string;     // Base64 blur placeholder
  };
  meta: {
    variant: string;
    formats: string[];
    responsive: boolean;
    cached: boolean;
    processingTime?: number;
  };
}

// Enhanced featured properties response with optimized images
interface EnhancedFeaturedResponse {
  data: Array<{
    // Standard property data
    propref: string;
    displayaddress: string;
    displayprice: string;
    beds: number;
    type: string;
    
    // Optimized image data for immediate use
    heroImage: {
      sources: SourceElement[];
      fallbackSrc: string;
      alt: string;
      aspectRatio: string;
      blurDataURL: string;
      backgroundColor: string;
    };
    thumbnailImage: {
      sources: SourceElement[];
      fallbackSrc: string;
      alt: string;
      aspectRatio: string;
      blurDataURL: string;
    };
    
    // Performance optimizations
    preloadHints: {
      dns: string[];          // DNS prefetch hints
      preconnect: string[];   // Preconnect hints
      prefetch: string[];     // Resource prefetch hints
    };
  }>;
  
  meta: {
    count: 7;
    autoGenerated: true;
    lastRefresh: string;
    nextRefresh: string;
    imageOptimization: {
      enabled: true;
      formats: ['avif', 'webp', 'jpeg'];
      variants: string[];
      responsive: true;
    };
  };
}
```

### 8.3. Performance Optimizations for Framer
```typescript
// Blur placeholder generation for better UX
export class BlurPlaceholderGenerator {
  async generateBlurDataURL(buffer: Buffer): Promise<string> {
    try {
      const blurBuffer = await sharp(buffer)
        .resize(20, 20, { fit: 'cover' })
        .jpeg({ quality: 20 })
        .toBuffer();
      
      return `data:image/jpeg;base64,${blurBuffer.toString('base64')}`;
    } catch (error) {
      // Return default blur placeholder
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAhEAACAQMDBQAAAAAAAAAAAAABAgMABAUGIWGRkqGx0f/EABUBAQEAAAAAAAAAAAAAAAAAAAMF/8QAGhEAAgIDAAAAAAAAAAAAAAAAAAECEgMRkf/aAAwDAQACEQMRAD8AltJagyeH0AthI5xdrLcNM91BF5pX2HaH9bcfaSXWGaRmknyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    }
  }
  
  async extractDominantColor(buffer: Buffer): Promise<string> {
    try {
      const { dominant } = await sharp(buffer).stats();
      const r = Math.round(dominant.r);
      const g = Math.round(dominant.g);
      const b = Math.round(dominant.b);
      return `rgb(${r}, ${g}, ${b})`;
    } catch (error) {
      return '#f0f0f0'; // Default placeholder color
    }
  }
}

// Preload hints for better performance
export class PreloadHintGenerator {
  generatePreloadHints(property: PropertyListing): PreloadHints {
    const cdnDomain = new URL(process.env.CDN_BASE_URL).hostname;
    
    return {
      dns: [
        cdnDomain,
        'fonts.googleapis.com',
        'fonts.gstatic.com'
      ],
      preconnect: [
        process.env.CDN_BASE_URL,
        'https://fonts.googleapis.com'
      ],
      prefetch: [
        // Prefetch hero variant for likely next view
        `${process.env.CDN_BASE_URL}/images/${property.propref}/hero_avif`,
        `${process.env.CDN_BASE_URL}/images/${property.propref}/hero_webp`
      ]
    };
  }
}
```

### 8.4. Framer Component Integration Examples
```typescript
// Example usage in Framer components
export const FramerOptimizedImage: React.FC<{
  propref: string;
  variant: 'thumbnail' | 'card' | 'hero';
  className?: string;
}> = ({ propref, variant, className }) => {
  const [imageData, setImageData] = useState<FramerImageResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    fetch(`/api/properties/${propref}/media?variant=${variant}&picture=true`)
      .then(res => res.json())
      .then((data: FramerImageResponse) => {
        setImageData(data);
        setIsLoading(false);
      });
  }, [propref, variant]);
  
  if (isLoading || !imageData) {
    return (
      <div 
        className={`bg-gray-200 animate-pulse ${className}`}
        style={{ backgroundColor: imageData?.data.backgroundColor || '#f0f0f0' }}
      />
    );
  }
  
  return (
    <picture className={className}>
      {imageData.data.sources.map((source, index) => (
        <source
          key={index}
          type={source.type}
          srcSet={source.srcset}
          sizes={source.sizes}
        />
      ))}
      <img
        src={imageData.data.fallbackSrc}
        alt={imageData.data.alt}
        loading={imageData.data.loading}
        decoding={imageData.data.decoding}
        className="w-full h-full object-cover"
        style={{
          aspectRatio: imageData.data.aspectRatio,
          backgroundImage: imageData.data.blurDataURL ? `url(${imageData.data.blurDataURL})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      />
    </picture>
  );
};

// Enhanced featured properties hook for Framer
export const useFeaturedProperties = () => {
  const [properties, setProperties] = useState<EnhancedFeaturedResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    fetch('/api/properties/featured')
      .then(res => res.json())
      .then((data: EnhancedFeaturedResponse) => {
        setProperties(data);
        setIsLoading(false);
        
        // Add preload hints to document head
        data.data.forEach(property => {
          property.preloadHints.dns.forEach(domain => {
            addDNSPrefetch(domain);
          });
          
          property.preloadHints.preconnect.forEach(url => {
            addPreconnect(url);
          });
        });
      });
  }, []);
  
  return { properties: properties?.data || [], isLoading, meta: properties?.meta };
};
```

### 8.5. SEO and Performance Headers
```typescript
// Enhanced CDN headers for optimal Framer performance
export class FramerOptimizedHeaders {
  static getImageHeaders(format: string, variant: string): Record<string, string> {
    const baseHeaders = {
      'Cache-Control': 'public, max-age=31536000, immutable', // 1 year
      'Vary': 'Accept',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    };
    
    // Format-specific headers
    const formatHeaders = {
      avif: {
        'Content-Type': 'image/avif',
        'X-Image-Format': 'avif'
      },
      webp: {
        'Content-Type': 'image/webp',
        'X-Image-Format': 'webp'
      },
      jpeg: {
        'Content-Type': 'image/jpeg',
        'X-Image-Format': 'jpeg'
      }
    };
    
    // Performance hints
    const performanceHeaders = {
      'X-Variant': variant,
      'X-Optimized-For': 'framer',
      'Link': `<${process.env.CDN_BASE_URL}>; rel=preconnect`
    };
    
    return {
      ...baseHeaders,
      ...formatHeaders[format],
      ...performanceHeaders
    };
  }
}
```

This comprehensive image optimization pipeline ensures fast, reliable image delivery optimized specifically for modern frontend frameworks like Framer, with advanced responsive image support, modern format delivery, and performance-first design.