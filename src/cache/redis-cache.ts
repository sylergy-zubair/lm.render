import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { appConfig } from '@/utils/config';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  key: string;
}

interface RedisStats {
  keyCount: number;
  memoryUsage: string;
  hitRate: number;
  connections: number;
  avgResponseTime: number;
}

export class RedisCache {
  private redis: Redis;
  private keyPrefix: string;
  private connected = false;
  private hitCount = 0;
  private missCount = 0;
  private responseTimes: number[] = [];

  constructor() {
    this.keyPrefix = appConfig.cache.prefix;
    this.redis = new Redis(this.getRedisConfig());
    this.setupEventHandlers();
  }

  /**
   * Get value from Redis cache
   */
  async get<T>(key: string): Promise<T | null> {
    const startTime = Date.now();
    
    try {
      const fullKey = this.keyPrefix + key;
      const data = await this.redis.get(fullKey);
      
      this.recordResponseTime(Date.now() - startTime);
      
      if (!data) {
        this.missCount++;
        return null;
      }

      const parsed = JSON.parse(data) as CacheEntry<T>;
      
      // Check TTL-based expiration
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
        await this.redis.del(fullKey);
        this.missCount++;
        return null;
      }

      // Update access statistics
      await this.trackAccess(key);
      this.hitCount++;
      
      return parsed.value;
    } catch (error) {
      this.recordResponseTime(Date.now() - startTime);
      console.error(`[RedisCache] Get error for key ${key}:`, error);
      this.missCount++;
      return null;
    }
  }

  /**
   * Set value in Redis cache
   */
  async set<T>(key: string, value: T, ttl: number = 300): Promise<void> {
    const startTime = Date.now();
    
    try {
      const fullKey = this.keyPrefix + key;
      const expiresAt = Date.now() + (ttl * 1000);
      
      const cacheEntry: CacheEntry<T> = {
        value,
        expiresAt,
        createdAt: Date.now(),
        key: fullKey,
      };
      
      await this.redis.setex(fullKey, ttl, JSON.stringify(cacheEntry));
      
      // Track key for pattern invalidation
      await this.addToPattern(key, ttl);
      
      this.recordResponseTime(Date.now() - startTime);
    } catch (error) {
      this.recordResponseTime(Date.now() - startTime);
      console.error(`[RedisCache] Set error for key ${key}:`, error);
      throw error;
    }
  }

  /**
   * Delete key from Redis cache
   */
  async delete(key: string): Promise<boolean> {
    try {
      const fullKey = this.keyPrefix + key;
      const result = await this.redis.del(fullKey);
      return result > 0;
    } catch (error) {
      console.error(`[RedisCache] Delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    try {
      const fullKey = this.keyPrefix + key;
      const result = await this.redis.exists(fullKey);
      return result === 1;
    } catch (error) {
      console.error(`[RedisCache] Has error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get multiple keys at once
   */
  async getMultiple<T>(keys: string[]): Promise<Map<string, T>> {
    const startTime = Date.now();
    
    try {
      const pipeline = this.redis.pipeline();
      const fullKeys = keys.map(key => this.keyPrefix + key);
      
      fullKeys.forEach(key => pipeline.get(key));
      
      const results = await pipeline.exec();
      const dataMap = new Map<string, T>();
      
      if (results) {
        results.forEach((result, index) => {
        const [error, data] = result;
        if (!error && data) {
          try {
            const parsed = JSON.parse(data as string) as CacheEntry<T>;
            if (!parsed.expiresAt || Date.now() <= parsed.expiresAt) {
              dataMap.set(keys[index], parsed.value);
              this.hitCount++;
            } else {
              this.missCount++;
            }
          } catch (parseError) {
            console.error(`[RedisCache] Parse error for key ${keys[index]}:`, parseError);
            this.missCount++;
          }
        } else {
          this.missCount++;
        }
        });
      }
      
      this.recordResponseTime(Date.now() - startTime);
      return dataMap;
    } catch (error) {
      this.recordResponseTime(Date.now() - startTime);
      console.error('[RedisCache] GetMultiple error:', error);
      return new Map();
    }
  }

  /**
   * Set multiple key-value pairs
   */
  async setMultiple<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    const startTime = Date.now();
    
    try {
      const pipeline = this.redis.pipeline();
      const now = Date.now();
      
      for (const entry of entries) {
        const ttl = entry.ttl || 300;
        const expiresAt = now + (ttl * 1000);
        const cacheEntry: CacheEntry<T> = {
          value: entry.value,
          expiresAt,
          createdAt: now,
          key: this.keyPrefix + entry.key,
        };
        
        pipeline.setex(
          this.keyPrefix + entry.key,
          ttl,
          JSON.stringify(cacheEntry)
        );
      }
      
      await pipeline.exec();
      this.recordResponseTime(Date.now() - startTime);
    } catch (error) {
      this.recordResponseTime(Date.now() - startTime);
      console.error('[RedisCache] SetMultiple error:', error);
      throw error;
    }
  }

  /**
   * Invalidate keys matching pattern
   */
  async invalidatePattern(pattern: string): Promise<number> {
    try {
      const keys = await this.redis.keys(this.keyPrefix + pattern);
      
      if (keys.length === 0) {
        return 0;
      }
      
      await this.redis.del(...keys);
      
      // Remove from pattern tracking
      await this.removeFromPattern(pattern);
      
      return keys.length;
    } catch (error) {
      console.error('[RedisCache] Pattern invalidation error:', error);
      return 0;
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    try {
      const keys = await this.redis.keys(this.keyPrefix + '*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.error('[RedisCache] Clear error:', error);
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<RedisStats> {
    try {
      const [info, keyCount] = await Promise.all([
        this.redis.info('memory'),
        this.redis.dbsize(),
      ]);
      
      const hitRate = this.hitCount + this.missCount > 0 
        ? this.hitCount / (this.hitCount + this.missCount)
        : 0;
      
      const avgResponseTime = this.responseTimes.length > 0
        ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
        : 0;
      
      return {
        keyCount,
        memoryUsage: this.parseMemoryInfo(info),
        hitRate,
        connections: await this.getConnectionCount(),
        avgResponseTime,
      };
    } catch (error) {
      console.error('[RedisCache] Stats error:', error);
      return {
        keyCount: 0,
        memoryUsage: '0MB',
        hitRate: 0,
        connections: 0,
        avgResponseTime: 0,
      };
    }
  }

  /**
   * Health check for Redis
   */
  async healthCheck(): Promise<{ status: 'up' | 'down'; responseTime: number }> {
    const startTime = Date.now();
    
    try {
      await this.redis.ping();
      return {
        status: 'up',
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Get Redis configuration
   */
  private getRedisConfig(): RedisOptions | string {
    // If we have a Redis URL, let ioredis parse it automatically
    if (appConfig.cache.redis.url && (appConfig.cache.redis.url.startsWith('redis://') || appConfig.cache.redis.url.startsWith('rediss://'))) {
      // Return URL string directly - ioredis will handle authentication and TLS
      return appConfig.cache.redis.url;
    }
    
    // Fallback to manual config for non-URL formats
    const config: RedisOptions = {
      host: appConfig.cache.redis.url || 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
      lazyConnect: true,
      keepAlive: 30000,
      connectTimeout: 10000,
      commandTimeout: 10000,
      family: 4,
    };
    
    if (appConfig.cache.redis.password) {
      config.password = appConfig.cache.redis.password;
    }
    
    return config;
  }

  /**
   * Setup Redis event handlers
   */
  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      this.connected = true;
      console.log('[RedisCache] Connected to Redis');
    });

    this.redis.on('error', (error) => {
      this.connected = false;
      console.error('[RedisCache] Redis error:', error);
    });

    this.redis.on('close', () => {
      this.connected = false;
      console.warn('[RedisCache] Redis connection closed');
    });

    this.redis.on('reconnecting', () => {
      console.log('[RedisCache] Reconnecting to Redis...');
    });
  }

  /**
   * Track access for hot key analysis
   */
  private async trackAccess(key: string): Promise<void> {
    try {
      const accessKey = `${this.keyPrefix}access:${key}`;
      await this.redis.incr(accessKey);
      await this.redis.expire(accessKey, 3600); // 1 hour window
    } catch (error) {
      // Silent fail for access tracking
    }
  }

  /**
   * Add key to pattern tracking
   */
  private async addToPattern(key: string, ttl: number): Promise<void> {
    try {
      const patterns = this.extractPatterns(key);
      const pipeline = this.redis.pipeline();
      
      patterns.forEach(pattern => {
        pipeline.sadd(`${this.keyPrefix}pattern:${pattern}`, key);
        pipeline.expire(`${this.keyPrefix}pattern:${pattern}`, ttl + 60);
      });
      
      await pipeline.exec();
    } catch (error) {
      // Silent fail for pattern tracking
    }
  }

  /**
   * Remove key from pattern tracking
   */
  private async removeFromPattern(pattern: string): Promise<void> {
    try {
      await this.redis.del(`${this.keyPrefix}pattern:${pattern}`);
    } catch (error) {
      // Silent fail for pattern tracking
    }
  }

  /**
   * Extract hierarchical patterns from key
   */
  private extractPatterns(key: string): string[] {
    const patterns: string[] = [];
    const parts = key.split(':');
    
    for (let i = 1; i <= parts.length; i++) {
      const pattern = parts.slice(0, i).join(':') + '*';
      patterns.push(pattern);
    }
    
    return patterns;
  }

  /**
   * Parse memory info from Redis INFO command
   */
  private parseMemoryInfo(info: string): string {
    const lines = info.split('\n');
    const memoryLine = lines.find(line => line.startsWith('used_memory_human:'));
    return memoryLine ? memoryLine.split(':')[1].trim() : '0MB';
  }

  /**
   * Get connection count
   */
  private async getConnectionCount(): Promise<number> {
    try {
      const info = await this.redis.info('clients');
      if (info) {
        const lines = info.split('\n');
        const clientsLine = lines.find(line => line.startsWith('connected_clients:'));
        return clientsLine ? parseInt(clientsLine.split(':')[1].trim()) : 0;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Record response time for statistics
   */
  private recordResponseTime(time: number): void {
    this.responseTimes.push(time);
    
    // Keep only last 100 response times
    if (this.responseTimes.length > 100) {
      this.responseTimes.shift();
    }
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Graceful shutdown
   */
  async disconnect(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (error) {
      console.error('[RedisCache] Disconnect error:', error);
    }
  }
}

// Export singleton instance
export const redisCache = new RedisCache();