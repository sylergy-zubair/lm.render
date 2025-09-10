import { memoryCache } from './memory-cache';
import type { CacheMeta } from '@/types/api';

interface CacheOptions {
  ttl?: number;
  skipMemory?: boolean;
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
  combined: {
    totalRequests: number;
    memoryHits: number;
    misses: number;
    overallHitRate: number;
  };
}

/**
 * Unified cache service implementing our lightning-fast caching strategy
 * Memory Cache only (sub-millisecond access)
 */
export class CacheService {
  private readonly processingKeys = new Set<string>();
  private stats = {
    memoryHits: 0,
    misses: 0,
  };

  /**
   * Get value from memory cache
   */
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    try {
      // Memory Cache only
      if (!options.skipMemory) {
        const memoryValue = memoryCache.get<T>(key);
        if (memoryValue !== null) {
          this.stats.memoryHits++;
          return memoryValue;
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
   * Set value in memory cache
   */
  async set<T>(key: string, value: T, ttl: number = 300, options: CacheOptions = {}): Promise<void> {
    try {
      // Store in Memory only
      if (!options.skipMemory) {
        const memoryTTL = Math.min(ttl, 600) * 1000; // Max 10 minutes in memory
        memoryCache.set(key, value, memoryTTL);
      }
    } catch (error) {
      console.error(`[CacheService] Set error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Delete from memory cache
   */
  async delete(key: string): Promise<boolean> {
    try {
      return memoryCache.delete(key);
    } catch (error) {
      console.error(`[CacheService] Delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Check if key exists in memory cache
   */
  async has(key: string): Promise<boolean> {
    try {
      return memoryCache.has(key);
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
   * Invalidate keys matching pattern in memory cache
   */
  async invalidatePattern(pattern: string): Promise<number> {
    try {
      return memoryCache.invalidatePattern(pattern);
    } catch (error) {
      console.error(`[CacheService] Pattern invalidation error:`, error);
      return 0;
    }
  }

  /**
   * Get multiple keys from memory cache
   */
  async getMultiple<T>(keys: string[]): Promise<Map<string, T>> {
    const results = new Map<string, T>();

    // Get all from memory cache
    for (const key of keys) {
      const value = memoryCache.get<T>(key);
      if (value !== null) {
        results.set(key, value);
        this.stats.memoryHits++;
      } else {
        this.stats.misses++;
      }
    }

    return results;
  }

  /**
   * Set multiple keys in memory cache
   */
  async setMultiple<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    try {
      // Set in memory only
      memoryCache.setMultiple(entries.map(e => ({
        key: e.key,
        value: e.value,
        ttl: Math.min(e.ttl || 300, 600) * 1000, // Max 10 minutes
      })));
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
   * Get memory cache statistics
   */
  async getStats(): Promise<CacheStats> {
    try {
      const memoryStats = memoryCache.getStats();

      const totalRequests = this.stats.memoryHits + this.stats.misses;
      const overallHitRate = totalRequests > 0 
        ? this.stats.memoryHits / totalRequests 
        : 0;

      return {
        memory: {
          size: memoryStats.size,
          hitRate: memoryStats.hitRate,
          memoryUsage: memoryStats.totalMemoryUsage,
        },
        combined: {
          totalRequests,
          memoryHits: this.stats.memoryHits,
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
   * Health check for memory cache
   */
  async healthCheck(): Promise<{
    memory: { status: 'up' | 'down'; entries: number };
    overall: { status: 'healthy' | 'unhealthy' };
  }> {
    const memoryStats = memoryCache.getStats();

    return {
      memory: {
        status: 'up',
        entries: memoryStats.size,
      },
      overall: {
        status: 'healthy',
      },
    };
  }

  /**
   * Clear memory cache
   */
  async clear(): Promise<void> {
    memoryCache.clear();

    // Reset stats
    this.stats = {
      memoryHits: 0,
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
    // Try memory cache
    const memoryValue = memoryCache.get<T>(key);
    if (memoryValue !== null) {
      // Memory cache doesn't store metadata, so estimate
      return {
        value: memoryValue,
        createdAt: Date.now() - 30000, // Assume 30 seconds old
      };
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
  generateCacheMeta(key: string, hit: boolean, level: 'memory' | 'miss'): CacheMeta {
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