import { memoryCache } from './memory-cache';
import { redisCache } from './redis-cache';
import type { CacheMeta } from '@/types/api';

interface CacheOptions {
  ttl?: number;
  skipMemory?: boolean;
  skipRedis?: boolean;
}

interface SWROptions {
  freshTTL: number;
  staleTTL: number;
}

interface CacheStats {
  memory: {
    size: number;
    hitRate: number;
    memoryUsage: number;
  };
  redis: {
    keyCount: number;
    hitRate: number;
    avgResponseTime: number;
    status: 'up' | 'down';
  };
  combined: {
    totalRequests: number;
    memoryHits: number;
    redisHits: number;
    misses: number;
    overallHitRate: number;
  };
}

/**
 * Unified cache service implementing our lightning-fast caching strategy
 * Layer 1: Memory Cache (sub-millisecond access)
 * Layer 2: Redis Cache (single-digit millisecond access)
 */
export class CacheService {
  private readonly processingKeys = new Set<string>();
  private stats = {
    memoryHits: 0,
    redisHits: 0,
    misses: 0,
  };

  /**
   * Get value from cache with fallback strategy
   */
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    try {
      // Layer 1: Memory Cache (fastest)
      if (!options.skipMemory) {
        const memoryValue = memoryCache.get<T>(key);
        if (memoryValue !== null) {
          this.stats.memoryHits++;
          return memoryValue;
        }
      }

      // Layer 2: Redis Cache
      if (!options.skipRedis) {
        const redisValue = await redisCache.get<T>(key);
        if (redisValue !== null) {
          this.stats.redisHits++;
          
          // Populate memory cache for next time
          if (!options.skipMemory) {
            memoryCache.set(key, redisValue, Math.min(options.ttl || 300, 300) * 1000);
          }
          
          return redisValue;
        }
      }

      this.stats.misses++;
      return null;
    } catch (error) {
      console.error(`[CacheService] Get error for key ${key}:`, error);
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Set value in both cache layers
   */
  async set<T>(key: string, value: T, ttl: number = 300, options: CacheOptions = {}): Promise<void> {
    try {
      const promises: Promise<any>[] = [];

      // Store in Redis
      if (!options.skipRedis) {
        promises.push(redisCache.set(key, value, ttl));
      }

      // Store in Memory (with shorter TTL)
      if (!options.skipMemory) {
        const memoryTTL = Math.min(ttl, 300) * 1000; // Max 5 minutes in memory
        memoryCache.set(key, value, memoryTTL);
      }

      await Promise.all(promises);
    } catch (error) {
      console.error(`[CacheService] Set error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Delete from both cache layers
   */
  async delete(key: string): Promise<boolean> {
    try {
      const [memoryResult, redisResult] = await Promise.all([
        Promise.resolve(memoryCache.delete(key)),
        redisCache.delete(key),
      ]);

      return memoryResult || redisResult;
    } catch (error) {
      console.error(`[CacheService] Delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Check if key exists in any cache layer
   */
  async has(key: string): Promise<boolean> {
    try {
      // Check memory first (faster)
      if (memoryCache.has(key)) {
        return true;
      }

      // Check Redis
      return await redisCache.has(key);
    } catch (error) {
      console.error(`[CacheService] Has error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get with Stale-While-Revalidate pattern for lightning-fast responses
   */
  async getWithSWR<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: SWROptions = { freshTTL: 300, staleTTL: 600 }
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.getWithMetadata<T>(key);
    
    if (cached) {
      const age = Date.now() - cached.createdAt;
      
      // Return fresh data immediately
      if (age < options.freshTTL * 1000) {
        return cached.value;
      }
      
      // Data is stale but usable - return it and refresh in background
      if (age < options.staleTTL * 1000) {
        // Trigger background revalidation (fire and forget)
        this.revalidateInBackground(key, fetcher, options.freshTTL);
        return cached.value;
      }
    }
    
    // Data is expired or doesn't exist - fetch fresh
    return await this.fetchAndCache(key, fetcher, options.freshTTL);
  }

  /**
   * Invalidate keys matching pattern in both cache layers
   */
  async invalidatePattern(pattern: string): Promise<number> {
    try {
      const [memoryCount, redisCount] = await Promise.all([
        Promise.resolve(memoryCache.invalidatePattern(pattern)),
        redisCache.invalidatePattern(pattern),
      ]);

      return memoryCount + redisCount;
    } catch (error) {
      console.error(`[CacheService] Pattern invalidation error:`, error);
      return 0;
    }
  }

  /**
   * Get multiple keys efficiently
   */
  async getMultiple<T>(keys: string[]): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    const missingKeys: string[] = [];

    // First, try to get all from memory
    for (const key of keys) {
      const value = memoryCache.get<T>(key);
      if (value !== null) {
        results.set(key, value);
        this.stats.memoryHits++;
      } else {
        missingKeys.push(key);
      }
    }

    // If we have missing keys, try Redis
    if (missingKeys.length > 0) {
      try {
        const redisResults = await redisCache.getMultiple<T>(missingKeys);
        
        for (const [key, value] of redisResults) {
          results.set(key, value);
          this.stats.redisHits++;
          
          // Populate memory cache
          memoryCache.set(key, value, 300000); // 5 minutes
        }

        // Count misses
        const redisHitKeys = new Set(redisResults.keys());
        const finalMisses = missingKeys.filter(key => !redisHitKeys.has(key));
        this.stats.misses += finalMisses.length;
      } catch (error) {
        console.error('[CacheService] GetMultiple Redis error:', error);
        this.stats.misses += missingKeys.length;
      }
    }

    return results;
  }

  /**
   * Set multiple keys efficiently
   */
  async setMultiple<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    try {
      // Set in memory immediately
      memoryCache.setMultiple(entries.map(e => ({
        key: e.key,
        value: e.value,
        ttl: Math.min(e.ttl || 300, 300) * 1000,
      })));

      // Set in Redis (background)
      await redisCache.setMultiple(entries);
    } catch (error) {
      console.error('[CacheService] SetMultiple error:', error);
      throw error;
    }
  }

  /**
   * Warm cache with data
   */
  async warmCache<T>(data: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    await this.setMultiple(data);
    console.log(`[CacheService] Warmed cache with ${data.length} entries`);
  }

  /**
   * Get comprehensive cache statistics
   */
  async getStats(): Promise<CacheStats> {
    try {
      const [memoryStats, redisStats, redisHealth] = await Promise.all([
        Promise.resolve(memoryCache.getStats()),
        redisCache.getStats(),
        redisCache.healthCheck(),
      ]);

      const totalRequests = this.stats.memoryHits + this.stats.redisHits + this.stats.misses;
      const overallHitRate = totalRequests > 0 
        ? (this.stats.memoryHits + this.stats.redisHits) / totalRequests 
        : 0;

      return {
        memory: {
          size: memoryStats.size,
          hitRate: memoryStats.hitRate,
          memoryUsage: memoryStats.totalMemoryUsage,
        },
        redis: {
          keyCount: redisStats.keyCount,
          hitRate: redisStats.hitRate,
          avgResponseTime: redisStats.avgResponseTime,
          status: redisHealth.status,
        },
        combined: {
          totalRequests,
          memoryHits: this.stats.memoryHits,
          redisHits: this.stats.redisHits,
          misses: this.stats.misses,
          overallHitRate,
        },
      };
    } catch (error) {
      console.error('[CacheService] Stats error:', error);
      throw error;
    }
  }

  /**
   * Health check for cache systems
   */
  async healthCheck(): Promise<{
    memory: { status: 'up' | 'down'; entries: number };
    redis: { status: 'up' | 'down'; responseTime: number };
    overall: { status: 'healthy' | 'degraded' | 'unhealthy' };
  }> {
    const memoryStats = memoryCache.getStats();
    const redisHealth = await redisCache.healthCheck();

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    
    if (redisHealth.status === 'up') {
      overallStatus = 'healthy';
    } else if (memoryStats.size > 0) {
      overallStatus = 'degraded'; // Memory cache working, Redis down
    } else {
      overallStatus = 'unhealthy';
    }

    return {
      memory: {
        status: 'up',
        entries: memoryStats.size,
      },
      redis: {
        status: redisHealth.status,
        responseTime: redisHealth.responseTime,
      },
      overall: {
        status: overallStatus,
      },
    };
  }

  /**
   * Clear all caches
   */
  async clear(): Promise<void> {
    await Promise.all([
      Promise.resolve(memoryCache.clear()),
      redisCache.clear(),
    ]);

    // Reset stats
    this.stats = {
      memoryHits: 0,
      redisHits: 0,
      misses: 0,
    };
  }

  /**
   * Get cache metadata for a key
   */
  private async getWithMetadata<T>(key: string): Promise<{
    value: T;
    createdAt: number;
  } | null> {
    // Try memory first
    const memoryValue = memoryCache.get<T>(key);
    if (memoryValue !== null) {
      // Memory cache doesn't store metadata, so estimate
      return {
        value: memoryValue,
        createdAt: Date.now() - 30000, // Assume 30 seconds old
      };
    }

    // Try Redis with metadata
    try {
      const fullKey = 'lm:' + key;
      const data = await redisCache['redis'].get(fullKey);
      
      if (data) {
        const parsed = JSON.parse(data);
        return {
          value: parsed.value,
          createdAt: parsed.createdAt,
        };
      }
    } catch (error) {
      // Silent fail
    }

    return null;
  }

  /**
   * Background revalidation for SWR
   */
  private async revalidateInBackground<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number
  ): Promise<void> {
    // Prevent multiple concurrent revalidations
    if (this.processingKeys.has(key)) {
      return;
    }

    this.processingKeys.add(key);

    try {
      const fresh = await fetcher();
      await this.set(key, fresh, ttl);
    } catch (error) {
      console.error(`[CacheService] Background revalidation failed for ${key}:`, error);
    } finally {
      this.processingKeys.delete(key);
    }
  }

  /**
   * Fetch and cache data
   */
  private async fetchAndCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number
  ): Promise<T> {
    try {
      const data = await fetcher();
      await this.set(key, data, ttl);
      return data;
    } catch (error) {
      // Try to return stale data as fallback
      const stale = await this.get<T>(key);
      if (stale !== null) {
        console.warn(`[CacheService] Returning stale data for ${key} due to fetch error:`, error);
        return stale;
      }
      throw error;
    }
  }

  /**
   * Generate cache metadata
   */
  generateCacheMeta(key: string, hit: boolean, level: 'memory' | 'redis' | 'miss'): CacheMeta {
    return {
      hit,
      ttl: 300, // Default TTL
      key,
      level: level === 'miss' ? undefined : level,
    };
  }
}

// Export singleton instance
export const cacheService = new CacheService();