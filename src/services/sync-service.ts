import { rentmanClient } from '@/clients/rentman-client';
import { databaseService } from '@/services/database';
import { cacheService } from '@/cache/cache-service';

export class SyncService {
  private isRunning = false;
  private syncInterval: Timer | null = null;
  private syncIntervalMs = 60 * 60 * 1000; // 1 hour

  /**
   * Start the background sync service
   */
  async start(): Promise<void> {
    console.log('[SyncService] Starting background sync service...');
    
    try {
      // Run initial sync
      await this.performSync();
      
      // Schedule periodic sync
      this.syncInterval = setInterval(() => {
        this.performSync().catch(error => {
          console.error('[SyncService] Periodic sync failed:', error);
        });
      }, this.syncIntervalMs);
      
      console.log(`[SyncService] Scheduled periodic sync every ${this.syncIntervalMs / 1000 / 60} minutes`);
    } catch (error) {
      console.error('[SyncService] Failed to start sync service:', error);
      throw error;
    }
  }

  /**
   * Stop the background sync service
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    console.log('[SyncService] Background sync service stopped');
  }

  /**
   * Perform a full sync from Rentman to SQLite
   */
  async performSync(): Promise<{ success: boolean; propertiesSynced: number; error?: string }> {
    if (this.isRunning) {
      console.log('[SyncService] Sync already in progress, skipping...');
      return { success: false, propertiesSynced: 0, error: 'Sync already running' };
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    console.log('[SyncService] Starting property sync from Rentman...');

    try {
      // Update sync metadata to 'syncing'
      await databaseService.updateSyncMetadata('properties_sync', {
        status: 'syncing',
        lastSync: new Date()
      });

      // Fetch all properties from Rentman
      console.log('[SyncService] Fetching properties from Rentman...');
      const properties = await rentmanClient.getProperties({ 
        limit: 2000, // Get all properties
        noimage: '0' // We want image data
      });

      console.log(`[SyncService] Fetched ${properties.length} properties from Rentman`);

      if (properties.length === 0) {
        throw new Error('No properties returned from Rentman API');
      }

      // Get detailed property data for a subset (to avoid overloading)
      console.log('[SyncService] Fetching detailed property data...');
      const propertiesWithDetails = await this.fetchPropertyDetails(properties);

      // Bulk upsert to SQLite
      console.log('[SyncService] Upserting properties to SQLite...');
      await databaseService.upsertProperties(propertiesWithDetails);

      // Automatically set featured properties if none exist
      await this.autoSetFeaturedProperties(propertiesWithDetails);

      // Update sync metadata
      const syncDuration = Date.now() - startTime;
      await databaseService.updateSyncMetadata('properties_sync', {
        status: 'completed',
        lastSync: new Date(),
        totalProperties: properties.length,
        errorMessage: null
      });

      // Clear related caches to force refresh
      await this.invalidateRelatedCaches();

      console.log(`[SyncService] Sync completed successfully in ${syncDuration}ms. Synced ${properties.length} properties.`);

      return {
        success: true,
        propertiesSynced: properties.length
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[SyncService] Sync failed:', error);

      // Update sync metadata with error
      await databaseService.updateSyncMetadata('properties_sync', {
        status: 'failed',
        errorMessage: errorMessage
      });

      return {
        success: false,
        propertiesSynced: 0,
        error: errorMessage
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Fetch detailed property data for properties (in chunks to avoid overloading)
   */
  private async fetchPropertyDetails(properties: any[]): Promise<any[]> {
    const propertiesWithDetails = [];
    const maxDetails = 100; // Limit detailed fetches to avoid overloading Rentman
    
    for (let i = 0; i < Math.min(properties.length, maxDetails); i++) {
      const property = properties[i];
      
      try {
        // Get full property details
        const propertyDetail = await rentmanClient.getProperty(property.propref.toString());
        propertiesWithDetails.push(propertyDetail);
        
        // Add small delay to avoid overwhelming Rentman
        if (i % 10 === 0 && i > 0) {
          await this.sleep(100); // 100ms delay every 10 requests
        }
      } catch (error) {
        console.warn(`[SyncService] Failed to fetch details for property ${property.propref}:`, error);
        // Include the basic property data even if details fail
        propertiesWithDetails.push(property);
      }
    }

    // Add remaining properties (without full details)
    for (let i = maxDetails; i < properties.length; i++) {
      propertiesWithDetails.push(properties[i]);
    }

    return propertiesWithDetails;
  }

  /**
   * Sync a specific property by ID
   */
  async syncProperty(propref: string): Promise<boolean> {
    try {
      console.log(`[SyncService] Syncing individual property ${propref}...`);
      
      const property = await rentmanClient.getProperty(propref);
      await databaseService.upsertProperty(property);
      
      // Invalidate cache for this property
      await cacheService.invalidatePattern(`property:${propref}*`);
      await cacheService.invalidatePattern('properties:*');
      
      console.log(`[SyncService] Successfully synced property ${propref}`);
      return true;
    } catch (error) {
      console.error(`[SyncService] Failed to sync property ${propref}:`, error);
      return false;
    }
  }

  /**
   * Get sync status and statistics
   */
  async getSyncStatus(): Promise<{
    isRunning: boolean;
    lastSync: string | null;
    status: string;
    totalProperties: number;
    errorMessage?: string;
  }> {
    const stats = await databaseService.getStats();
    const syncMeta = await databaseService.getSyncMetadata('properties_sync');

    return {
      isRunning: this.isRunning,
      lastSync: stats.lastSync,
      status: stats.syncStatus,
      totalProperties: stats.totalProperties,
      errorMessage: syncMeta?.errorMessage || undefined
    };
  }

  /**
   * Force an immediate sync (useful for admin)
   */
  async forceSyncNow(): Promise<{ success: boolean; propertiesSynced: number; error?: string }> {
    console.log('[SyncService] Force sync requested');
    return this.performSync();
  }

  /**
   * Migrate existing featured properties from cache to database
   */
  async migrateFeaturedProperties(): Promise<number> {
    console.log('[SyncService] Migrating featured properties from cache to database...');
    
    let migratedCount = 0;
    
    try {
      // We'll scan for cached featured properties keys
      // This is a one-time migration function
      
      // For now, we'll just ensure the featured properties system is ready
      // Real migration would happen if we had existing cache data
      
      console.log(`[SyncService] Featured properties migration completed. Migrated ${migratedCount} properties.`);
      return migratedCount;
    } catch (error) {
      console.error('[SyncService] Featured properties migration failed:', error);
      return 0;
    }
  }

  /**
   * Invalidate related caches after sync
   */
  private async invalidateRelatedCaches(): Promise<void> {
    try {
      await Promise.all([
        cacheService.invalidatePattern('properties:*'),
        cacheService.invalidatePattern('framer:*'),
        cacheService.invalidatePattern('precomputed:*')
      ]);
      console.log('[SyncService] Invalidated related caches');
    } catch (error) {
      console.warn('[SyncService] Failed to invalidate caches:', error);
    }
  }

  /**
   * Automatically set featured properties if none exist
   */
  private async autoSetFeaturedProperties(properties: any[]): Promise<void> {
    try {
      // Check current featured properties count
      const stats = await databaseService.getStats();
      const currentFeatured = stats.featuredProperties;
      
      if (currentFeatured === 7) {
        console.log(`[SyncService] Already have exactly 7 featured properties, skipping auto-selection`);
        return;
      }

      if (currentFeatured > 7) {
        console.log(`[SyncService] Found ${currentFeatured} featured properties (more than 7), will keep first 7`);
        // TODO: Implement logic to keep only first 7 if needed
        return;
      }

      console.log(`[SyncService] Found ${currentFeatured} featured properties, auto-selecting ${7 - currentFeatured} more to reach 7...`);

      // Get currently featured properties to avoid duplicates
      const currentlyFeaturedProps = await databaseService.getFeaturedProperties(20);
      const currentlyFeaturedIds = new Set(currentlyFeaturedProps.map(p => parseInt(p.propref)));

      // Auto-select featured properties based on criteria:
      // 1. Not already featured
      // 2. Recent properties preferred (by propref)
      // 3. Try to prefer properties with images but don't require it
      const allCandidates = properties
        .filter(p => !currentlyFeaturedIds.has(parseInt(p.propref))) // Not already featured
        .sort((a, b) => parseInt(b.propref) - parseInt(a.propref)); // Recent first

      // Prefer properties with images, but fallback to any property
      let featuredCandidates = allCandidates.filter(p => {
        try {
          return p.details?.media && 
                 JSON.parse(p.details.media).photos && 
                 JSON.parse(p.details.media).photos.length > 0;
        } catch {
          return false;
        }
      }).slice(0, 12);

      const needed = 7 - currentFeatured;
      
      console.log(`[SyncService] Available properties: ${allCandidates.length}, with images: ${featuredCandidates.length}, needed: ${needed}`);

      // If not enough candidates with images, include any available property
      if (featuredCandidates.length < needed && allCandidates.length > 0) {
        console.log(`[SyncService] Not enough properties with images (${featuredCandidates.length}), including properties without images`);
        featuredCandidates = allCandidates.slice(0, Math.max(12, needed));
      }

      if (featuredCandidates.length === 0 || needed <= 0) {
        console.log('[SyncService] No suitable additional properties found for featuring');
        return;
      }

      // Select needed additional featured properties with diversity preference
      const newFeatured = [];
      const usedAreas = new Set();
      const rentSaleCount = { rent: 0, sale: 0 };

      // First pass: Try to get diverse properties
      for (const property of featuredCandidates) {
        if (newFeatured.length >= needed) break;

        const area = property.area?.toLowerCase() || 'unknown';
        const rentOrBuy = property.rentOrBuy || 'rent';

        // Prefer diversity in areas and rent/sale mix
        const areaUsed = usedAreas.has(area);
        const typeBalance = rentSaleCount[rentOrBuy] < Math.ceil(needed / 2); // Balance types

        if (!areaUsed || typeBalance || newFeatured.length < Math.min(3, needed)) {
          newFeatured.push(property.propref);
          usedAreas.add(area);
          rentSaleCount[rentOrBuy]++;
        }
      }

      // Second pass: Fill remaining slots if we don't have enough yet
      if (newFeatured.length < needed) {
        for (const property of featuredCandidates) {
          if (newFeatured.length >= needed) break;
          
          if (!newFeatured.includes(property.propref)) {
            newFeatured.push(property.propref);
          }
        }
      }

      // Fallback: If still not enough, take from all properties
      if (newFeatured.length < needed) {
        const remainingCandidates = properties
          .filter(p => !currentlyFeaturedIds.has(parseInt(p.propref)))
          .filter(p => !newFeatured.includes(p.propref))
          .sort((a, b) => parseInt(b.propref) - parseInt(a.propref))
          .slice(0, needed - newFeatured.length);
        
        newFeatured.push(...remainingCandidates.map(p => p.propref));
      }

      // Take only what we need
      const finalNewFeatured = newFeatured.slice(0, needed);

      if (finalNewFeatured.length === 0) {
        console.log('[SyncService] No additional properties available for featuring');
        return;
      }

      // Set new featured properties in database
      for (const propref of finalNewFeatured) {
        await databaseService.setFeaturedStatus(propref.toString(), true);
      }

      const totalFeatured = currentFeatured + finalNewFeatured.length;
      console.log(`[SyncService] Auto-selected ${finalNewFeatured.length} additional featured properties: ${finalNewFeatured.join(', ')}`);
      console.log(`[SyncService] Total featured properties now: ${totalFeatured}`);

    } catch (error) {
      console.error('[SyncService] Failed to auto-set featured properties:', error);
    }
  }

  /**
   * Simple sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get next sync time
   */
  getNextSyncTime(): Date | null {
    if (!this.syncInterval) return null;
    
    const lastSync = new Date(); // This would be from sync metadata in real implementation
    return new Date(lastSync.getTime() + this.syncIntervalMs);
  }
}

// Export singleton
export const syncService = new SyncService();