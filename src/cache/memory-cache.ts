/**
 * High-performance memory cache with LRU eviction
 * Designed for lightning-fast response times
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  lastAccessed: number;
  createdAt: number;
  size: number;
  hitCount: number;
}

interface CacheStats {
  size: number;
  maxSize: number;
  hitCount: number;
  missCount: number;
  evictionCount: number;
  totalMemoryUsage: number;
  hitRate: number;
  averageAge: number;
}

export class MemoryCache<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly defaultTTL: number;
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;
  private cleanupInterval?: Timer;

  constructor(maxSize = 1000, defaultTTL = 300000) { // 5 minutes default
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Get value from cache
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.missCount++;
      return null;
    }
    
    const now = Date.now();
    
    // Check if expired
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }
    
    // Update access statistics
    entry.lastAccessed = now;
    entry.hitCount++;
    this.hitCount++;
    
    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key: string, value: T, ttl?: number): void {
    const now = Date.now();
    const expiresAt = now + (ttl || this.defaultTTL);
    const size = this.calculateSize(value);

    // Check if we need to make room
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      value,
      expiresAt,
      lastAccessed: now,
      createdAt: now,
      size,
      hitCount: 0,
    };

    this.cache.set(key, entry);
  }

  /**
   * Delete key from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
    this.evictionCount = 0;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Get multiple keys at once
   */
  getMultiple(keys: string[]): Map<string, T> {
    const results = new Map<string, T>();
    
    for (const key of keys) {
      const value = this.get(key);
      if (value !== null) {
        results.set(key, value);
      }
    }
    
    return results;
  }

  /**
   * Set multiple key-value pairs
   */
  setMultiple(entries: Array<{ key: string; value: T; ttl?: number }>): void {
    for (const { key, value, ttl } of entries) {
      this.set(key, value, ttl);
    }
  }

  /**
   * Invalidate keys matching pattern
   */
  invalidatePattern(pattern: string): number {
    let invalidated = 0;
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    
    for (const [key] of this.cache) {
      if (regex.test(key)) {
        this.cache.delete(key);
        invalidated++;
      }
    }
    
    return invalidated;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const now = Date.now();
    let totalMemoryUsage = 0;
    let totalAge = 0;
    let expiredCount = 0;

    for (const [, entry] of this.cache) {
      totalMemoryUsage += entry.size;
      totalAge += now - entry.createdAt;
      
      if (now > entry.expiresAt) {
        expiredCount++;
      }
    }

    const totalRequests = this.hitCount + this.missCount;
    const hitRate = totalRequests > 0 ? this.hitCount / totalRequests : 0;
    const averageAge = this.cache.size > 0 ? totalAge / this.cache.size : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitCount: this.hitCount,
      missCount: this.missCount,
      evictionCount: this.evictionCount,
      totalMemoryUsage,
      hitRate,
      averageAge,
    };
  }

  /**
   * Get most accessed keys
   */
  getHotKeys(limit = 10): Array<{ key: string; hitCount: number; lastAccessed: number }> {
    const entries = Array.from(this.cache.entries())
      .map(([key, entry]) => ({
        key,
        hitCount: entry.hitCount,
        lastAccessed: entry.lastAccessed,
      }))
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, limit);

    return entries;
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[MemoryCache] Cleaned up ${cleaned} expired entries`);
    }
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestKey = '';
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictionCount++;
    }
  }

  /**
   * Calculate approximate size of value
   */
  private calculateSize(value: T): number {
    try {
      return JSON.stringify(value).length * 2; // Rough estimate (UTF-16)
    } catch {
      return 100; // Default size if can't serialize
    }
  }

  /**
   * Preload keys based on access patterns
   */
  async preloadHotData(fetcher: (key: string) => Promise<T>): Promise<void> {
    const hotKeys = this.getHotKeys(20);
    
    for (const { key } of hotKeys) {
      if (!this.has(key)) {
        try {
          const value = await fetcher(key);
          this.set(key, value);
        } catch (error) {
          console.warn(`[MemoryCache] Failed to preload key ${key}:`, error);
        }
      }
    }
  }

  /**
   * Destroy cache and cleanup
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }

  /**
   * Get cache size in human-readable format
   */
  getHumanReadableStats(): string {
    const stats = this.getStats();
    const memoryMB = (stats.totalMemoryUsage / 1024 / 1024).toFixed(2);
    const hitRatePercent = (stats.hitRate * 100).toFixed(1);
    const avgAgeMinutes = (stats.averageAge / 1000 / 60).toFixed(1);

    return `Size: ${stats.size}/${stats.maxSize}, Memory: ${memoryMB}MB, Hit Rate: ${hitRatePercent}%, Avg Age: ${avgAgeMinutes}min`;
  }
}

// Export singleton instance
export const memoryCache = new MemoryCache(
  1000, // Max 1000 entries
  300000 // 5 minute default TTL
);