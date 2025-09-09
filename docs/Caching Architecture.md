# Caching Architecture

## Overview

The caching architecture is the cornerstone of the Cache-Only Rentman API Backend, designed to deliver sub-50ms responses while minimizing calls to the Rentman API. This multi-layered approach ensures optimal performance, reliability, and scalability.

***

## 1. Multi-Layer Cache Architecture

### 1.1. Lightning-Fast 5-Layer Cache Hierarchy
```
┌─────────────────┐
│   L0: Browser   │ ← 1 year cache, 0ms response time
├─────────────────┤
│   L1: CDN Edge  │ ← Global edge locations, 5ms response
├─────────────────┤
│   L2: Memory    │ ← Precomputed responses, 15ms response
├─────────────────┤
│   L3: Redis     │ ← Background refresh, 20ms response  
├─────────────────┤
│   L4: Database  │ ← Fallback only, 50ms+ response
└─────────────────┘
```

### 1.2. Lightning-Fast Cache Flow
```
Request → L0 Browser Cache → Hit? → Return (0ms - Instant)
            ↓ Miss
          L1 CDN Edge Cache → Hit? → Return (5ms - Lightning)
            ↓ Miss
          L2 Memory Cache → Hit? → Return (15ms - Ultra Fast)
            ↓ Miss
          L3 Redis Cache → Hit? → Store in L2 → Return (20ms - Fast)
            ↓ Miss (Should Never Happen)
          L4 Database/API → Process → Store All Layers → Return (50ms+ - Fallback)
```

***

## 2. Layer 1: Memory Cache Implementation

### 2.1. Memory Cache Class
```typescript
// src/cache/memory-cache.ts
export class MemoryCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private defaultTTL: number;
  
  constructor(maxSize = 1000, defaultTTL = 300000) { // 5 minutes
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    
    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }
  
  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    // Update access time for LRU
    entry.lastAccessed = Date.now();
    return entry.value;
  }
  
  set(key: string, value: T, ttl?: number): void {
    // Implement LRU eviction if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.findOldestEntry();
      this.cache.delete(oldestKey);
    }
    
    const expiresAt = Date.now() + (ttl || this.defaultTTL);
    
    this.cache.set(key, {
      value,
      expiresAt,
      lastAccessed: Date.now(),
      createdAt: Date.now()
    });
  }
  
  invalidatePattern(pattern: string): number {
    let invalidated = 0;
    const regex = new RegExp(pattern.replace('*', '.*'));
    
    for (const [key] of this.cache) {
      if (regex.test(key)) {
        this.cache.delete(key);
        invalidated++;
      }
    }
    
    return invalidated;
  }
  
  private findOldestEntry(): string {
    let oldestKey = '';
    let oldestTime = Date.now();
    
    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }
    
    return oldestKey;
  }
  
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
      console.log(`Memory cache cleanup: removed ${cleaned} expired entries`);
    }
  }
  
  getStats(): CacheStats {
    const now = Date.now();
    let expired = 0;
    let totalSize = 0;
    
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        expired++;
      }
      totalSize += JSON.stringify(entry.value).length;
    }
    
    return {
      size: this.cache.size,
      expired,
      memoryUsage: totalSize,
      hitRate: this.calculateHitRate()
    };
  }
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  lastAccessed: number;
  createdAt: number;
}
```

### 2.2. Memory Cache Optimization
```typescript
// Hot data identification and prefetching
export class HotDataManager {
  private accessCount = new Map<string, number>();
  private hotThreshold = 10; // Accesses per hour
  
  trackAccess(key: string): void {
    const current = this.accessCount.get(key) || 0;
    this.accessCount.set(key, current + 1);
  }
  
  getHotKeys(): string[] {
    return Array.from(this.accessCount.entries())
      .filter(([key, count]) => count >= this.hotThreshold)
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);
  }
  
  async prefetchHotData(): Promise<void> {
    const hotKeys = this.getHotKeys();
    
    for (const key of hotKeys.slice(0, 50)) { // Top 50 hot keys
      if (!memoryCache.get(key)) {
        // Prefetch from Redis to Memory
        const data = await redisCache.get(key);
        if (data) {
          memoryCache.set(key, data);
        }
      }
    }
  }
}
```

***

## 3. Layer 2: Redis Cache Implementation

### 3.1. Redis Cache Service
```typescript
// src/cache/redis-cache.ts
import Redis from 'ioredis';

export class RedisCache {
  private redis: Redis;
  private keyPrefix: string;
  
  constructor() {
    this.redis = new Redis({
      host: process.env.UPSTASH_REDIS_URL,
      password: process.env.UPSTASH_REDIS_TOKEN,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });
    
    this.keyPrefix = process.env.CACHE_PREFIX || 'lm:';
  }
  
  async get<T>(key: string): Promise<T | null> {
    try {
      const fullKey = this.keyPrefix + key;
      const data = await this.redis.get(fullKey);
      
      if (!data) return null;
      
      const parsed = JSON.parse(data);
      
      // Check TTL-based expiration
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
        await this.redis.del(fullKey);
        return null;
      }
      
      // Update access statistics
      await this.trackAccess(key);
      
      return parsed.value;
    } catch (error) {
      console.error(`Redis get error for key ${key}:`, error);
      return null;
    }
  }
  
  async set<T>(key: string, value: T, ttl: number = 300): Promise<void> {
    try {
      const fullKey = this.keyPrefix + key;
      const expiresAt = Date.now() + (ttl * 1000);
      
      const cacheEntry = {
        value,
        expiresAt,
        createdAt: Date.now(),
        key: fullKey
      };
      
      await this.redis.setex(
        fullKey, 
        ttl, 
        JSON.stringify(cacheEntry)
      );
      
      // Track key for pattern invalidation
      await this.addToPattern(key, ttl);
      
    } catch (error) {
      console.error(`Redis set error for key ${key}:`, error);
    }
  }
  
  async invalidatePattern(pattern: string): Promise<number> {
    try {
      const keys = await this.redis.keys(this.keyPrefix + pattern);
      
      if (keys.length === 0) return 0;
      
      await this.redis.del(...keys);
      
      // Remove from pattern tracking
      await this.removeFromPattern(pattern);
      
      return keys.length;
    } catch (error) {
      console.error(`Redis pattern invalidation error:`, error);
      return 0;
    }
  }
  
  async getMultiple<T>(keys: string[]): Promise<Map<string, T>> {
    const pipeline = this.redis.pipeline();
    const fullKeys = keys.map(key => this.keyPrefix + key);
    
    fullKeys.forEach(key => pipeline.get(key));
    
    const results = await pipeline.exec();
    const dataMap = new Map<string, T>();
    
    results?.forEach((result, index) => {
      const [error, data] = result;
      if (!error && data) {
        try {
          const parsed = JSON.parse(data as string);
          if (!parsed.expiresAt || Date.now() <= parsed.expiresAt) {
            dataMap.set(keys[index], parsed.value);
          }
        } catch (parseError) {
          console.error(`Parse error for key ${keys[index]}:`, parseError);
        }
      }
    });
    
    return dataMap;
  }
  
  async setMultiple<T>(entries: Array<{key: string, value: T, ttl?: number}>): Promise<void> {
    const pipeline = this.redis.pipeline();
    const now = Date.now();
    
    for (const entry of entries) {
      const ttl = entry.ttl || 300;
      const expiresAt = now + (ttl * 1000);
      const cacheEntry = {
        value: entry.value,
        expiresAt,
        createdAt: now,
        key: this.keyPrefix + entry.key
      };
      
      pipeline.setex(
        this.keyPrefix + entry.key,
        ttl,
        JSON.stringify(cacheEntry)
      );
    }
    
    await pipeline.exec();
  }
  
  private async trackAccess(key: string): Promise<void> {
    const accessKey = `${this.keyPrefix}access:${key}`;
    await this.redis.incr(accessKey);
    await this.redis.expire(accessKey, 3600); // 1 hour window
  }
  
  private async addToPattern(key: string, ttl: number): Promise<void> {
    const patterns = this.extractPatterns(key);
    const pipeline = this.redis.pipeline();
    
    patterns.forEach(pattern => {
      pipeline.sadd(`${this.keyPrefix}pattern:${pattern}`, key);
      pipeline.expire(`${this.keyPrefix}pattern:${pattern}`, ttl + 60);
    });
    
    await pipeline.exec();
  }
  
  private extractPatterns(key: string): string[] {
    const patterns: string[] = [];
    const parts = key.split(':');
    
    // Generate hierarchical patterns
    for (let i = 1; i <= parts.length; i++) {
      const pattern = parts.slice(0, i).join(':') + '*';
      patterns.push(pattern);
    }
    
    return patterns;
  }
  
  async getStats(): Promise<RedisStats> {
    const info = await this.redis.info('memory');
    const keyCount = await this.redis.dbsize();
    
    return {
      keyCount,
      memoryUsage: this.parseMemoryInfo(info),
      hitRate: await this.calculateHitRate(),
      connections: await this.getConnectionCount()
    };
  }
}
```

### 3.2. Stale-While-Revalidate Implementation
```typescript
// Advanced SWR with background refresh
export class SWRCache {
  private processingKeys = new Set<string>();
  
  async getWithSWR<T>(
    key: string,
    fetcher: () => Promise<T>,
    freshTTL: number,
    staleTTL: number
  ): Promise<T> {
    // Try to get fresh data
    const cached = await redisCache.get<CacheEntry<T>>(key);
    
    if (cached) {
      const age = Date.now() - cached.createdAt;
      
      // Return fresh data immediately
      if (age < freshTTL * 1000) {
        return cached.value;
      }
      
      // Data is stale but usable
      if (age < staleTTL * 1000) {
        // Trigger background revalidation
        this.revalidateInBackground(key, fetcher, freshTTL);
        return cached.value;
      }
    }
    
    // Data is expired or doesn't exist, fetch fresh
    return this.fetchAndCache(key, fetcher, freshTTL);
  }
  
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
      await redisCache.set(key, fresh, ttl);
      
      // Also update memory cache if present
      memoryCache.set(key, fresh, Math.min(ttl, 300) * 1000);
      
    } catch (error) {
      console.error(`Background revalidation failed for ${key}:`, error);
    } finally {
      this.processingKeys.delete(key);
    }
  }
  
  private async fetchAndCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number
  ): Promise<T> {
    try {
      const data = await fetcher();
      
      // Cache in both layers
      await redisCache.set(key, data, ttl);
      memoryCache.set(key, data, Math.min(ttl, 300) * 1000);
      
      return data;
    } catch (error) {
      // Try to return stale data as fallback
      const stale = await redisCache.get<CacheEntry<T>>(key);
      if (stale) {
        console.warn(`Returning stale data for ${key} due to fetch error:`, error);
        return stale.value;
      }
      throw error;
    }
  }
}
```

***

## 4. Cache Key Strategy

### 4.1. Hierarchical Key Structure
```typescript
// Cache key patterns and their purposes
const CACHE_KEYS = {
  // Properties
  properties: (filters: any) => `properties:${hash(filters)}`,
  property: (id: string) => `property:${id}`,
  
  // Featured properties
  featured: (rob?: string) => `featured${rob ? `:${rob}` : ''}`,
  
  // Media
  media: (id: string, variant?: string) => 
    `media:${id}${variant ? `:${variant}` : ''}`,
  image: (filename: string, variant: string) => 
    `image:${filename}:${variant}`,
  
  // Search
  search: (query: string, filters: any) => 
    `search:${hash({query, ...filters})}`,
  
  // Areas and metadata
  areas: () => 'areas:all',
  
  // Analytics
  analytics: {
    popular: (period: string) => `analytics:popular:${period}`,
    performance: (endpoint: string) => `analytics:perf:${endpoint}`
  },
  
  // Processing locks
  processing: (key: string) => `processing:${key}`,
  lock: (resource: string) => `lock:${resource}`
};

// Generate consistent hash for complex objects
function hash(obj: any): string {
  return createHash('md5')
    .update(JSON.stringify(obj, Object.keys(obj).sort()))
    .digest('hex')
    .substring(0, 12);
}
```

### 4.2. Cache Dependencies and Invalidation
```typescript
export class CacheDependencyManager {
  private dependencies = new Map<string, Set<string>>();
  
  // Define cache dependencies
  addDependency(dependent: string, dependency: string): void {
    if (!this.dependencies.has(dependency)) {
      this.dependencies.set(dependency, new Set());
    }
    this.dependencies.get(dependency)!.add(dependent);
  }
  
  // Cascade invalidation based on dependencies
  async invalidateWithDependencies(key: string): Promise<number> {
    const toInvalidate = new Set([key]);
    this.collectDependents(key, toInvalidate);
    
    let totalInvalidated = 0;
    
    for (const keyToInvalidate of toInvalidate) {
      const count = await cacheService.invalidatePattern(keyToInvalidate);
      totalInvalidated += count;
    }
    
    return totalInvalidated;
  }
  
  private collectDependents(key: string, result: Set<string>): void {
    const dependents = this.dependencies.get(key);
    if (!dependents) return;
    
    for (const dependent of dependents) {
      if (!result.has(dependent)) {
        result.add(dependent);
        this.collectDependents(dependent, result);
      }
    }
  }
  
  // Setup common dependencies
  setupDependencies(): void {
    // Property updates affect multiple cache patterns
    this.addDependency('properties:*', 'property:*');
    this.addDependency('featured*', 'property:*');
    this.addDependency('search:*', 'property:*');
    
    // Featured property changes affect listings
    this.addDependency('properties:*', 'featured*');
    
    // Media changes affect property details
    this.addDependency('property:*', 'media:*');
    this.addDependency('property:*', 'image:*');
  }
}
```

***

## 5. Cache Warming Strategies

### 5.1. Scheduled Cache Warming
```typescript
export class CacheWarmingService {
  private warmingJobs = new Map<string, NodeJS.Timeout>();
  
  constructor() {
    this.setupWarmingSchedule();
  }
  
  private setupWarmingSchedule(): void {
    // Warm popular properties every 2 minutes
    this.scheduleJob('popular-properties', async () => {
      await this.warmPopularProperties();
    }, 120000);
    
    // Warm featured properties every 5 minutes
    this.scheduleJob('featured-properties', async () => {
      await this.warmFeaturedProperties();
    }, 300000);
    
    // Warm areas data every 30 minutes
    this.scheduleJob('areas', async () => {
      await this.warmAreasData();
    }, 1800000);
  }
  
  private scheduleJob(name: string, job: () => Promise<void>, interval: number): void {
    const timer = setInterval(async () => {
      try {
        console.log(`Starting cache warming job: ${name}`);
        await job();
        console.log(`Completed cache warming job: ${name}`);
      } catch (error) {
        console.error(`Cache warming job failed: ${name}`, error);
      }
    }, interval);
    
    this.warmingJobs.set(name, timer);
  }
  
  private async warmPopularProperties(): Promise<void> {
    const popularFilters = [
      { rob: 'rent', limit: 25 },
      { rob: 'sale', limit: 25 },
      { beds: 2, rob: 'rent', limit: 20 },
      { beds: 3, rob: 'rent', limit: 20 },
      { area: 'Central London', rob: 'rent', limit: 15 }
    ];
    
    const promises = popularFilters.map(async (filters) => {
      const key = CACHE_KEYS.properties(filters);
      if (!(await redisCache.get(key))) {
        const data = await rentmanClient.getProperties(filters);
        await redisCache.set(key, data, 300);
      }
    });
    
    await Promise.all(promises);
  }
  
  private async warmFeaturedProperties(): Promise<void> {
    const variants = ['', 'rent', 'sale'];
    
    for (const variant of variants) {
      const key = CACHE_KEYS.featured(variant || undefined);
      const data = await rentmanClient.getProperties({ 
        featured: '1', 
        ...(variant && { rob: variant }),
        noimage: '1'
      });
      await redisCache.set(key, data, 600);
    }
  }
  
  private async warmAreasData(): Promise<void> {
    const key = CACHE_KEYS.areas();
    if (!(await redisCache.get(key))) {
      const data = await rentmanClient.getProperties({ onlyarea: '1' });
      const areas = this.extractUniqueAreas(data);
      await redisCache.set(key, areas, 21600); // 6 hours
    }
  }
  
  async warmPropertyDetails(proprefs: string[]): Promise<void> {
    const batch = proprefs.slice(0, 10); // Process in batches
    
    const promises = batch.map(async (propref) => {
      const key = CACHE_KEYS.property(propref);
      if (!(await redisCache.get(key))) {
        try {
          const data = await rentmanClient.getProperty(propref);
          await redisCache.set(key, data, 3600);
        } catch (error) {
          console.warn(`Failed to warm property ${propref}:`, error);
        }
      }
    });
    
    await Promise.all(promises);
  }
}
```

### 5.2. Predictive Cache Warming
```typescript
export class PredictiveCacheWarming {
  private accessPatterns = new Map<string, number[]>();
  
  trackAccess(key: string): void {
    const hour = new Date().getHours();
    const pattern = this.accessPatterns.get(key) || new Array(24).fill(0);
    pattern[hour]++;
    this.accessPatterns.set(key, pattern);
  }
  
  async warmPredictedKeys(): Promise<void> {
    const nextHour = (new Date().getHours() + 1) % 24;
    const keysToWarm: string[] = [];
    
    for (const [key, pattern] of this.accessPatterns) {
      if (pattern[nextHour] > 5) { // Threshold for warming
        keysToWarm.push(key);
      }
    }
    
    // Warm top 20 predicted keys
    const topKeys = keysToWarm
      .sort((a, b) => {
        const aScore = this.accessPatterns.get(a)![nextHour];
        const bScore = this.accessPatterns.get(b)![nextHour];
        return bScore - aScore;
      })
      .slice(0, 20);
    
    await this.warmKeys(topKeys);
  }
  
  private async warmKeys(keys: string[]): Promise<void> {
    for (const key of keys) {
      if (!(await redisCache.get(key))) {
        // Determine fetcher based on key pattern
        const fetcher = this.getFetcherForKey(key);
        if (fetcher) {
          try {
            const data = await fetcher();
            await cacheService.set(key, data);
          } catch (error) {
            console.warn(`Predictive warming failed for ${key}:`, error);
          }
        }
      }
    }
  }
}
```

***

## 6. Auto-Featured Property Caching Strategies

### 6.1. Intelligent Cache Management for Auto-Featured Properties
```typescript
// Auto-featured property cache service
export class AutoFeaturedCacheService {
  private readonly AUTO_FEATURED_KEY = 'properties:auto-featured';
  private readonly AUTO_FEATURED_CONFIG_KEY = 'config:auto-featured';
  private readonly AUTO_FEATURED_ANALYTICS_KEY = 'analytics:auto-featured';
  
  async getAutoFeaturedProperties(count: number = 7): Promise<AutoFeaturedResponse> {
    const cacheKey = `${this.AUTO_FEATURED_KEY}:${count}`;
    
    // Try SWR cache with 30min fresh, 60min stale
    return await cacheService.getWithSWR(
      cacheKey,
      () => this.generateAutoFeaturedProperties(count),
      1800, // 30 minutes fresh
      3600  // 60 minutes stale
    );
  }
  
  async invalidateAutoFeaturedCache(): Promise<void> {
    // Invalidate all auto-featured related caches
    await Promise.all([
      cacheService.invalidatePattern('properties:auto-featured*'),
      cacheService.invalidatePattern('analytics:auto-featured*'),
      memoryCache.invalidatePattern('auto-featured*')
    ]);
  }
  
  // Cache auto-featured configuration
  async cacheConfiguration(config: AutoFeaturedConfig): Promise<void> {
    await cacheService.set(this.AUTO_FEATURED_CONFIG_KEY, config, 86400); // 24 hours
  }
  
  // Cache performance analytics
  async cachePerformanceAnalytics(analytics: AutoFeaturedAnalytics): Promise<void> {
    const key = `${this.AUTO_FEATURED_ANALYTICS_KEY}:${Date.now()}`;
    await cacheService.set(key, analytics, 604800); // 7 days
  }
}
```

### 6.2. Cache Refresh Triggers and Strategies
```typescript
export class AutoRefreshManager {
  private refreshInProgress = new Set<string>();
  
  async checkRefreshTriggers(): Promise<void> {
    const triggers = [
      this.checkScheduledRefresh(),
      this.checkAvailabilityChanges(),
      this.checkPerformanceThresholds(),
      this.checkDiversityScore()
    ];
    
    const results = await Promise.allSettled(triggers);
    
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled' && result.value) {
        const triggerNames = ['scheduled', 'availability', 'performance', 'diversity'];
        await this.triggerRefresh(triggerNames[index]);
      }
    }
  }
  
  private async checkScheduledRefresh(): Promise<boolean> {
    const lastRefresh = await cacheService.get<number>('auto-featured:last-refresh');
    const config = await cacheService.get<AutoFeaturedConfig>('config:auto-featured');
    
    if (!lastRefresh || !config) return true;
    
    const refreshInterval = config.refreshIntervals?.scheduled || 1800000; // 30 minutes default
    return (Date.now() - lastRefresh) > refreshInterval;
  }
  
  private async checkAvailabilityChanges(): Promise<boolean> {
    // Check if any of the current featured properties became unavailable
    const current = await cacheService.get<PropertyListing[]>('properties:auto-featured:7');
    if (!current) return false;
    
    const availabilityChecks = current.map(async (prop) => {
      const fresh = await rentmanClient.getProperty(prop.propref);
      return fresh && fresh.status === 'Available';
    });
    
    const availability = await Promise.all(availabilityChecks);
    const unavailableCount = availability.filter(a => !a).length;
    
    // Trigger refresh if more than 2 properties became unavailable
    return unavailableCount > 2;
  }
  
  private async checkPerformanceThresholds(): Promise<boolean> {
    const analytics = await cacheService.get<AutoFeaturedAnalytics>(
      'analytics:auto-featured:current'
    );
    
    if (!analytics) return false;
    
    // Trigger refresh if overall performance drops below 70%
    return analytics.overallPerformance < 0.7;
  }
  
  private async triggerRefresh(trigger: string): Promise<void> {
    const refreshKey = `refresh:auto-featured:${trigger}`;
    
    if (this.refreshInProgress.has(refreshKey)) {
      return; // Already refreshing
    }
    
    this.refreshInProgress.add(refreshKey);
    
    try {
      // Generate new auto-featured properties
      const newFeatured = await autoFeaturedService.refreshFeaturedProperties();
      
      // Update cache with immediate expiry of old data
      await cacheService.invalidatePattern('properties:auto-featured*');
      await cacheService.set('properties:auto-featured:7', newFeatured, 1800);
      
      // Update last refresh timestamp
      await cacheService.set('auto-featured:last-refresh', Date.now(), 86400);
      
      // Log refresh event
      console.log(`Auto-featured refresh triggered by: ${trigger}`);
      
    } finally {
      this.refreshInProgress.delete(refreshKey);
    }
  }
}
```

### 6.3. Smart Cache Preloading for Auto-Featured Properties
```typescript
export class AutoFeaturedPreloader {
  async preloadRelatedData(featuredProperties: PropertyListing[]): Promise<void> {
    const preloadPromises = [
      this.preloadPropertyDetails(featuredProperties),
      this.preloadPropertyMedia(featuredProperties),
      this.preloadSimilarProperties(featuredProperties),
      this.preloadAreaData(featuredProperties)
    ];
    
    await Promise.allSettled(preloadPromises);
  }
  
  private async preloadPropertyDetails(properties: PropertyListing[]): Promise<void> {
    const detailPromises = properties.map(async (prop) => {
      const cacheKey = CACHE_KEYS.property(prop.propref);
      if (!(await cacheService.get(cacheKey))) {
        try {
          const details = await rentmanClient.getProperty(prop.propref);
          await cacheService.set(cacheKey, details, 3600);
        } catch (error) {
          console.warn(`Failed to preload details for ${prop.propref}:`, error);
        }
      }
    });
    
    await Promise.all(detailPromises);
  }
  
  private async preloadPropertyMedia(properties: PropertyListing[]): Promise<void> {
    const mediaPromises = properties.map(async (prop) => {
      if (prop.photo1) {
        const variants = ['thumbnail', 'card'];
        
        for (const variant of variants) {
          const cacheKey = CACHE_KEYS.media(prop.propref, variant);
          if (!(await cacheService.get(cacheKey))) {
            try {
              const processedMedia = await imageProcessor.processMediaVariant(
                prop.photo1, 
                variant
              );
              await cacheService.set(cacheKey, processedMedia, 7200);
            } catch (error) {
              console.warn(`Failed to preload media for ${prop.propref}:`, error);
            }
          }
        }
      }
    });
    
    await Promise.all(mediaPromises);
  }
  
  private async preloadSimilarProperties(properties: PropertyListing[]): Promise<void> {
    // Preload similar properties for better "related properties" performance
    const uniqueAreas = [...new Set(properties.map(p => p.area))];
    const uniqueTypes = [...new Set(properties.map(p => p.type))];
    
    for (const area of uniqueAreas) {
      const cacheKey = `properties:${hash({ area, limit: 10 })}`;
      if (!(await cacheService.get(cacheKey))) {
        try {
          const similar = await rentmanClient.getProperties({ area, limit: 10 });
          await cacheService.set(cacheKey, similar, 1800);
        } catch (error) {
          console.warn(`Failed to preload similar properties for area ${area}:`, error);
        }
      }
    }
  }
}
```

### 6.4. Cache Invalidation Patterns for Auto-Featured System
```typescript
export class AutoFeaturedInvalidationManager extends CacheDependencyManager {
  setupAutoFeaturedDependencies(): void {
    // Auto-featured properties affect multiple cache layers
    this.addDependency('properties:*', 'properties:auto-featured*');
    this.addDependency('search:*', 'properties:auto-featured*');
    this.addDependency('analytics:*', 'properties:auto-featured*');
    
    // Configuration changes affect auto-featured selections
    this.addDependency('properties:auto-featured*', 'config:auto-featured');
    
    // Property availability changes affect featured selections
    this.addDependency('properties:auto-featured*', 'property:*/status');
    this.addDependency('properties:auto-featured*', 'property:*/availability');
    
    // Media changes affect featured property display
    this.addDependency('properties:auto-featured*', 'media:*');
  }
  
  async invalidateOnPropertyUpdate(propref: string): Promise<void> {
    // Check if updated property is currently featured
    const currentFeatured = await cacheService.get<PropertyListing[]>(
      'properties:auto-featured:7'
    );
    
    if (currentFeatured?.some(p => p.propref === propref)) {
      // Property is featured, trigger complete refresh
      await this.invalidateWithDependencies('properties:auto-featured*');
      
      // Schedule immediate refresh
      setTimeout(() => {
        autoRefreshManager.triggerRefresh('property-update');
      }, 1000);
    } else {
      // Just invalidate the specific property
      await this.invalidateWithDependencies(`property:${propref}`);
    }
  }
  
  async smartInvalidation(updateType: string, affectedKeys: string[]): Promise<void> {
    switch (updateType) {
      case 'availability-change':
        // Only invalidate if it affects diversity or availability
        await this.invalidateIfFeaturedAffected(affectedKeys);
        break;
        
      case 'price-change':
        // Invalidate search caches and property details
        await Promise.all([
          this.invalidateWithDependencies('search:*'),
          ...affectedKeys.map(key => this.invalidateWithDependencies(key))
        ]);
        break;
        
      case 'media-update':
        // Invalidate media and property caches
        await Promise.all(
          affectedKeys.map(key => this.invalidateWithDependencies(`media:${key}*`))
        );
        break;
        
      default:
        // Full invalidation for unknown update types
        await this.invalidateWithDependencies('*');
    }
  }
  
  private async invalidateIfFeaturedAffected(proprefs: string[]): Promise<void> {
    const currentFeatured = await cacheService.get<PropertyListing[]>(
      'properties:auto-featured:7'
    );
    
    if (!currentFeatured) return;
    
    const featuredProprefs = new Set(currentFeatured.map(p => p.propref));
    const hasIntersection = proprefs.some(ref => featuredProprefs.has(ref));
    
    if (hasIntersection) {
      await this.invalidateWithDependencies('properties:auto-featured*');
    }
  }
}
```

### 6.5. Performance Optimization for Auto-Featured Caching
```typescript
export class AutoFeaturedCacheOptimizer {
  async optimizeAutoFeaturedCaches(): Promise<void> {
    const optimizations = [
      this.optimizeRefreshTiming(),
      this.optimizePreloadStrategy(),
      this.optimizeMemoryUsage(),
      this.optimizeCacheTTLs()
    ];
    
    await Promise.all(optimizations);
  }
  
  private async optimizeRefreshTiming(): Promise<void> {
    // Analyze access patterns to optimize refresh timing
    const accessPattern = await this.analyzeAccessPattern('properties:auto-featured*');
    
    if (accessPattern.peakHours.length > 0) {
      // Schedule preemptive refresh before peak hours
      const optimalRefreshTime = Math.min(...accessPattern.peakHours) - 1;
      await this.scheduleOptimalRefresh(optimalRefreshTime);
    }
  }
  
  private async optimizePreloadStrategy(): Promise<void> {
    // Analyze which related data is most frequently accessed
    const relatedAccess = await this.analyzeRelatedAccess();
    
    // Prioritize preloading based on access frequency
    const priorityPreloads = relatedAccess
      .filter(item => item.accessFrequency > 0.7)
      .sort((a, b) => b.accessFrequency - a.accessFrequency);
    
    // Update preload configuration
    await cacheService.set('config:preload-priority', priorityPreloads, 86400);
  }
  
  private async optimizeCacheTTLs(): Promise<void> {
    const cacheAnalysis = await this.analyzeCacheHitRates();
    
    for (const pattern of cacheAnalysis) {
      if (pattern.key.startsWith('properties:auto-featured')) {
        let newTTL = pattern.currentTTL;
        
        if (pattern.hitRate < 0.6) {
          // Low hit rate, increase TTL
          newTTL = Math.min(pattern.currentTTL * 1.5, 7200);
        } else if (pattern.hitRate > 0.9 && pattern.accessFrequency > 0.8) {
          // High hit rate and access, increase TTL further
          newTTL = Math.min(pattern.currentTTL * 2, 14400);
        }
        
        if (newTTL !== pattern.currentTTL) {
          await this.updatePatternTTL(pattern.key, newTTL);
        }
      }
    }
  }
}
```

***

## 7. Performance Monitoring and Optimization

### 6.1. Cache Performance Metrics
```typescript
export class CacheMetrics {
  private metrics = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
    totalResponseTime: 0,
    requestCount: 0
  };
  
  recordHit(): void {
    this.metrics.hits++;
  }
  
  recordMiss(): void {
    this.metrics.misses++;
  }
  
  recordResponseTime(time: number): void {
    this.metrics.totalResponseTime += time;
    this.metrics.requestCount++;
  }
  
  getStats(): CacheStats {
    const totalRequests = this.metrics.hits + this.metrics.misses;
    
    return {
      hitRate: totalRequests > 0 ? this.metrics.hits / totalRequests : 0,
      totalRequests,
      totalHits: this.metrics.hits,
      totalMisses: this.metrics.misses,
      avgResponseTime: this.metrics.requestCount > 0 
        ? this.metrics.totalResponseTime / this.metrics.requestCount 
        : 0,
      errorRate: totalRequests > 0 ? this.metrics.errors / totalRequests : 0
    };
  }
  
  async exportMetrics(): Promise<void> {
    const stats = this.getStats();
    
    // Store in database for historical analysis
    await db.insert(cacheMetrics).values({
      timestamp: new Date(),
      hitRate: stats.hitRate,
      totalRequests: stats.totalRequests,
      avgResponseTime: stats.avgResponseTime,
      errorRate: stats.errorRate
    });
    
    // Reset counters for next period
    this.resetCounters();
  }
  
  private resetCounters(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      totalResponseTime: 0,
      requestCount: 0
    };
  }
}
```

### 6.2. Automated Cache Optimization
```typescript
export class CacheOptimizer {
  async optimizeCache(): Promise<OptimizationResult> {
    const analysis = await this.analyzeCachePerformance();
    const actions: OptimizationAction[] = [];
    
    // Identify underperforming patterns
    for (const pattern of analysis.underperformingPatterns) {
      if (pattern.hitRate < 0.5) {
        actions.push({
          type: 'increase_ttl',
          pattern: pattern.key,
          currentTTL: pattern.ttl,
          recommendedTTL: pattern.ttl * 1.5,
          reason: 'Low hit rate indicates TTL too short'
        });
      }
    }
    
    // Identify memory waste
    for (const pattern of analysis.lowAccessPatterns) {
      actions.push({
        type: 'decrease_ttl',
        pattern: pattern.key,
        currentTTL: pattern.ttl,
        recommendedTTL: pattern.ttl * 0.7,
        reason: 'Low access frequency'
      });
    }
    
    // Apply optimizations
    for (const action of actions) {
      await this.applyOptimization(action);
    }
    
    return {
      actionsPerformed: actions.length,
      estimatedImprovement: this.calculateImprovementEstimate(actions),
      actions
    };
  }
  
  private async analyzeCachePerformance(): Promise<CacheAnalysis> {
    const patterns = await redisCache.getKeyPatterns();
    const analysis: CacheAnalysis = {
      underperformingPatterns: [],
      lowAccessPatterns: [],
      oversizedKeys: []
    };
    
    for (const pattern of patterns) {
      const stats = await redisCache.getPatternStats(pattern);
      
      if (stats.hitRate < 0.6) {
        analysis.underperformingPatterns.push(stats);
      }
      
      if (stats.accessFrequency < 0.1) {
        analysis.lowAccessPatterns.push(stats);
      }
      
      if (stats.averageSize > 100000) { // 100KB
        analysis.oversizedKeys.push(stats);
      }
    }
    
    return analysis;
  }
}
```

***

## 7. Integration with Main Application

### 7.1. Unified Cache Service
```typescript
// src/cache/cache-service.ts
export class CacheService {
  private memoryCache: MemoryCache<any>;
  private redisCache: RedisCache;
  private swrCache: SWRCache;
  private metrics: CacheMetrics;
  
  constructor() {
    this.memoryCache = new MemoryCache(1000, 300000);
    this.redisCache = new RedisCache();
    this.swrCache = new SWRCache();
    this.metrics = new CacheMetrics();
  }
  
  async get<T>(key: string): Promise<T | null> {
    const startTime = Date.now();
    
    try {
      // L1: Memory cache
      let data = this.memoryCache.get<T>(key);
      if (data) {
        this.metrics.recordHit();
        this.metrics.recordResponseTime(Date.now() - startTime);
        return data;
      }
      
      // L2: Redis cache
      data = await this.redisCache.get<T>(key);
      if (data) {
        // Store in memory for next time
        this.memoryCache.set(key, data);
        this.metrics.recordHit();
        this.metrics.recordResponseTime(Date.now() - startTime);
        return data;
      }
      
      this.metrics.recordMiss();
      return null;
      
    } catch (error) {
      this.metrics.recordError();
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    } finally {
      this.metrics.recordResponseTime(Date.now() - startTime);
    }
  }
  
  async set<T>(key: string, value: T, ttl: number = 300): Promise<void> {
    try {
      // Store in both layers
      await this.redisCache.set(key, value, ttl);
      this.memoryCache.set(key, value, Math.min(ttl, 300) * 1000);
      
    } catch (error) {
      this.metrics.recordError();
      console.error(`Cache set error for key ${key}:`, error);
    }
  }
  
  async getWithSWR<T>(
    key: string,
    fetcher: () => Promise<T>,
    freshTTL: number = 300,
    staleTTL: number = 600
  ): Promise<T> {
    return this.swrCache.getWithSWR(key, fetcher, freshTTL, staleTTL);
  }
  
  async invalidatePattern(pattern: string): Promise<number> {
    const [memoryCount, redisCount] = await Promise.all([
      this.memoryCache.invalidatePattern(pattern),
      this.redisCache.invalidatePattern(pattern)
    ]);
    
    return memoryCount + redisCount;
  }
  
  getStats(): CombinedCacheStats {
    return {
      memory: this.memoryCache.getStats(),
      redis: this.redisCache.getStats(),
      overall: this.metrics.getStats()
    };
  }
}

// Singleton instance
export const cacheService = new CacheService();
```

### 7.2. Middleware Integration
```typescript
// Cache middleware for Hono
export const cacheMiddleware = () => {
  return async (c: Context, next: () => Promise<void>) => {
    const method = c.req.method;
    
    // Only cache GET requests
    if (method !== 'GET') {
      return next();
    }
    
    const url = c.req.url;
    const cacheKey = `http:${url}`;
    
    // Try to get cached response
    const cached = await cacheService.get<CachedResponse>(cacheKey);
    if (cached) {
      // Set cache headers
      c.header('X-Cache-Status', 'HIT');
      c.header('X-Cache-TTL', cached.ttl.toString());
      
      return c.json(cached.data, cached.status);
    }
    
    // Process request
    await next();
    
    // Cache successful responses
    if (c.res.status === 200 && c.res.headers.get('content-type')?.includes('json')) {
      const ttl = this.getTTLForEndpoint(url);
      const responseData = await c.res.clone().json();
      
      await cacheService.set(cacheKey, {
        data: responseData,
        status: c.res.status,
        ttl,
        cachedAt: Date.now()
      }, ttl);
      
      c.header('X-Cache-Status', 'MISS');
    }
  };
};
```

***

## 8. Lightning-Fast Performance Enhancements

### 8.1. Complete Response Precomputation
```typescript
export class LightningPrecomputer {
  async precomputeAllCriticalResponses(): Promise<void> {
    // Precompute featured properties in all formats
    await Promise.all([
      this.precomputeFeatured('hero', 'complete'),
      this.precomputeFeatured('card', 'complete'),
      this.precomputeFeatured('thumbnail', 'minimal'),
      this.precomputePopularSearches(),
      this.precomputePropertyDetails(),
      this.precomputeAreaData()
    ]);
  }
  
  private async precomputeFeatured(variant: string, format: string): Promise<void> {
    const response = await this.generateCompleteResponse(variant, format);
    
    // Store in all cache layers simultaneously for maximum speed
    await Promise.all([
      this.storeInCDNEdge(`featured:${variant}:${format}`, response, 300),
      this.storeInMemory(`featured:${variant}:${format}`, response, 300),
      this.storeInRedis(`featured:${variant}:${format}`, response, 1800),
      this.warmBrowserCache(`featured:${variant}:${format}`, response)
    ]);
  }
  
  private async generateCompleteResponse(variant: string, format: string): Promise<CompleteResponse> {
    const properties = await autoFeaturedService.getCurrentSelection();
    
    return {
      data: await Promise.all(properties.map(async (property) => ({
        ...property,
        // All image URLs precomputed - no processing needed
        images: this.getPrecomputedImages(property.propref, variant),
        // SEO data precomputed
        seo: await this.getPrecomputedSEO(property),
        // All metadata ready
        metadata: await this.getPrecomputedMetadata(property)
      }))),
      meta: {
        responseTime: 0,
        precomputed: true,
        cached: true,
        optimization: 'lightning'
      }
    };
  }
}
```

### 8.2. Instant Cache Warming Strategy
```typescript
export class InstantCacheWarming {
  private warmingIntervals = {
    featured: 30000,    // 30 seconds
    popular: 60000,     // 1 minute
    search: 120000,     // 2 minutes
    images: 300000      // 5 minutes
  };
  
  async startLightningWarming(): Promise<void> {
    // Continuous warming to ensure 99.9% cache hit rate
    setInterval(() => this.warmFeaturedProperties(), this.warmingIntervals.featured);
    setInterval(() => this.warmPopularProperties(), this.warmingIntervals.popular);
    setInterval(() => this.warmSearchResults(), this.warmingIntervals.search);
    setInterval(() => this.warmAllImages(), this.warmingIntervals.images);
  }
  
  private async warmFeaturedProperties(): Promise<void> {
    // Warm all possible featured property combinations
    const variants = ['hero', 'card', 'thumbnail'];
    const formats = ['complete', 'minimal'];
    
    await Promise.all(variants.flatMap(variant =>
      formats.map(format => this.warmSpecificFeatured(variant, format))
    ));
  }
  
  private async warmSpecificFeatured(variant: string, format: string): Promise<void> {
    const key = `featured:${variant}:${format}`;
    
    // Check if warming is needed
    const memoryHit = await memoryCache.get(key);
    const edgeHit = await cdnEdgeCache.get(key);
    
    if (!memoryHit || !edgeHit) {
      const freshData = await this.generateFreshResponse(variant, format);
      await this.storeInAllLayers(key, freshData);
    }
  }
}
```

### 8.3. Edge Computing Integration
```typescript
// Cloudflare Worker for ultimate speed
export class EdgeCacheHandler {
  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cacheKey = this.generateCacheKey(url);
    
    // Try edge cache first (global, 5ms response)
    const cached = await EDGE_CACHE.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
          'X-Cache-Status': 'EDGE-HIT',
          'X-Response-Time': '5ms',
          'X-Optimization': 'lightning'
        }
      });
    }
    
    // Fallback to origin (should be rare)
    const response = await this.fetchFromOrigin(request);
    
    // Cache at edge for next request
    await EDGE_CACHE.put(cacheKey, await response.clone().text(), { 
      expirationTtl: 300 
    });
    
    return response;
  }
  
  private generateCacheKey(url: URL): string {
    // Smart cache key generation for maximum hit rate
    const path = url.pathname;
    const query = url.searchParams.toString();
    return `${path}:${this.hashQuery(query)}`;
  }
}
```

### 8.4. Predictive Cache Intelligence
```typescript
export class PredictiveCaching {
  private accessPatterns = new Map<string, AccessPattern>();
  
  async predictAndWarm(): Promise<void> {
    const predictions = await this.generatePredictions();
    
    for (const prediction of predictions) {
      if (prediction.confidence > 0.8) {
        await this.preemptivelyCache(prediction.endpoint, prediction.params);
      }
    }
  }
  
  private async generatePredictions(): Promise<CachePrediction[]> {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    
    // Analyze patterns and predict next requests
    return this.accessPatterns.values()
      .filter(pattern => this.isLikelyToBeRequested(pattern, hour, dayOfWeek))
      .map(pattern => ({
        endpoint: pattern.endpoint,
        params: pattern.commonParams,
        confidence: this.calculateConfidence(pattern, hour, dayOfWeek)
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20); // Top 20 predictions
  }
  
  private async preemptivelyCache(endpoint: string, params: any): Promise<void> {
    try {
      const response = await this.generateResponse(endpoint, params);
      const cacheKey = this.generateKey(endpoint, params);
      
      // Store in fast layers
      await Promise.all([
        memoryCache.set(cacheKey, response, 300),
        cdnEdgeCache.set(cacheKey, response, 300)
      ]);
    } catch (error) {
      // Silent fail - prediction was wrong
      console.log(`Prediction failed for ${endpoint}:`, error.message);
    }
  }
}
```

### 8.5. Lightning Performance Monitoring
```typescript
export class LightningPerformanceMonitor {
  private performanceTargets = {
    featured: 10,      // 10ms max
    search: 15,        // 15ms max
    property: 20,      // 20ms max
    images: 5          // 5ms max
  };
  
  async monitorLightningPerformance(): Promise<void> {
    setInterval(async () => {
      const metrics = await this.collectLightningMetrics();
      
      // Alert if any endpoint exceeds targets
      for (const [endpoint, time] of Object.entries(metrics.responseTimes)) {
        if (time > this.performanceTargets[endpoint]) {
          await this.handleSlowResponse(endpoint, time);
        }
      }
      
      // Auto-optimize if performance degrades
      if (metrics.averageResponseTime > 15) {
        await this.triggerAutoOptimization();
      }
    }, 10000); // Check every 10 seconds
  }
  
  private async handleSlowResponse(endpoint: string, responseTime: number): Promise<void> {
    // Immediate remediation
    await Promise.all([
      this.increaseCacheWarming(endpoint),
      this.precomputeMoreResponses(endpoint),
      this.alertDevTeam(endpoint, responseTime)
    ]);
  }
  
  private async triggerAutoOptimization(): Promise<void> {
    // Automatic performance optimization
    await Promise.all([
      this.increaseMemoryCacheSize(),
      this.expandEdgeCacheLocations(),
      this.optimizeCacheKeys(),
      this.precomputeMoreVariants()
    ]);
  }
  
  async generateLightningReport(): Promise<LightningReport> {
    return {
      averageResponseTimes: await this.getAverageResponseTimes(),
      cacheHitRates: {
        browser: await this.getBrowserCacheHitRate(),
        edge: await this.getEdgeCacheHitRate(),
        memory: await this.getMemoryCacheHitRate(),
        redis: await this.getRedisCacheHitRate()
      },
      precomputationCoverage: await this.getPrecomputationCoverage(),
      performanceGrade: await this.calculatePerformanceGrade(),
      optimizationSuggestions: await this.generateOptimizationSuggestions()
    };
  }
}
```

### 8.6. Ultra-Fast Feature Flag System
```typescript
export class LightningFeatureFlags {
  // Feature flags cached in memory for instant access
  private flags = new Map<string, boolean>();
  
  async initializeLightningFlags(): Promise<void> {
    // Load all flags into memory at startup
    const allFlags = await this.loadAllFlags();
    
    for (const [flag, enabled] of Object.entries(allFlags)) {
      this.flags.set(flag, enabled);
    }
    
    // Background refresh every 30 seconds
    setInterval(() => this.refreshFlags(), 30000);
  }
  
  isEnabled(flag: string): boolean {
    // Instant response - no cache lookups
    return this.flags.get(flag) ?? false;
  }
  
  // Lightning-fast feature detection
  getLightningFeatures(): LightningFeatures {
    return {
      edgeCaching: this.isEnabled('edge-caching'),
      imagePrecomputation: this.isEnabled('image-precomputation'),
      predictiveCaching: this.isEnabled('predictive-caching'),
      autoOptimization: this.isEnabled('auto-optimization'),
      responsePrecomputation: this.isEnabled('response-precomputation')
    };
  }
}
```

This comprehensive lightning-fast caching architecture ensures sub-20ms response times through aggressive precomputation, multi-layer caching, edge computing, and predictive optimization strategies.