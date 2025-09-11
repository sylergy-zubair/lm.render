import { database } from '@/db/client';
import * as schema from '@/db/schema';
import { eq, and, sql, desc, asc, like, inArray } from 'drizzle-orm';
import type { PropertyListing, PropertyWithDetails, NewProperty, NewPropertyDetail } from '@/db/schema';
import { imageResolver } from './image-resolver';

export class DatabaseService {
  private db = database;

  /**
   * Get paginated property listings with optional filters
   */
  async getProperties(params: {
    limit?: number;
    page?: number;
    rentOrBuy?: 'rent' | 'sale';
    beds?: number;
    area?: string;
    minPrice?: number;
    maxPrice?: number;
  } = {}): Promise<{ properties: PropertyListing[]; total: number; page: number; totalPages: number }> {
    const {
      limit = 25,
      page = 1,
      rentOrBuy,
      beds,
      area,
      minPrice,
      maxPrice
    } = params;

    const offset = (page - 1) * limit;

    try {
      // Build where conditions
      const conditions = [];
      
      if (rentOrBuy) {
        conditions.push(eq(schema.properties.rentOrBuy, rentOrBuy));
      }
      
      if (beds) {
        conditions.push(eq(schema.properties.beds, beds));
      }
      
      if (area) {
        conditions.push(like(schema.properties.area, `%${area}%`));
      }

      // Note: Price filtering would require parsing displayPrice
      // For now, we'll implement basic filters

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Get total count
      const [totalResult] = await this.db()
        .select({ count: sql<number>`count(*)` })
        .from(schema.properties)
        .where(whereClause);

      const total = totalResult.count;
      const totalPages = Math.ceil(total / limit);

      // Get properties with featured status
      const propertiesQuery = this.db()
        .select({
          propref: schema.properties.propref,
          displayAddress: schema.properties.displayAddress,
          displayPrice: schema.properties.displayPrice,
          beds: schema.properties.beds,
          baths: schema.properties.baths,
          area: schema.properties.area,
          rentOrBuy: schema.properties.rentOrBuy,
          geolocationLat: schema.properties.geolocationLat,
          geolocationLng: schema.properties.geolocationLng,
          available: schema.properties.available,
          createdAt: schema.properties.createdAt,
          updatedAt: schema.properties.updatedAt,
          featured: sql<boolean>`COALESCE(${schema.featuredProperties.featured}, 0)`
        })
        .from(schema.properties)
        .leftJoin(schema.featuredProperties, eq(schema.properties.propref, schema.featuredProperties.propref))
        .where(whereClause)
        .orderBy(desc(schema.properties.propref))
        .limit(limit)
        .offset(offset);

      const properties = await propertiesQuery;

      // Add optimized thumbnail from image resolver
      const propertiesWithThumbs = await Promise.all(
        properties.map(async (property) => {
          const details = await this.db()
            .select({ media: schema.propertyDetails.media })
            .from(schema.propertyDetails)
            .where(eq(schema.propertyDetails.propref, property.propref))
            .limit(1);

          let thumbnail = null;
          if (details[0]?.media) {
            // Use image resolver to get optimized thumbnail
            thumbnail = await imageResolver.getThumbnail(
              property.propref.toString(),
              details[0].media
            );
          }

          return {
            ...property,
            featured: Boolean(property.featured),
            thumbnail
          };
        })
      );

      return {
        properties: propertiesWithThumbs,
        total,
        page,
        totalPages
      };
    } catch (error) {
      console.error('[DatabaseService] Error fetching properties:', error);
      throw error;
    }
  }

  /**
   * Get featured properties
   */
  async getFeaturedProperties(limit = 7): Promise<PropertyListing[]> {
    try {
      const featuredProps = await this.db()
        .select({
          propref: schema.properties.propref,
          displayAddress: schema.properties.displayAddress,
          displayPrice: schema.properties.displayPrice,
          beds: schema.properties.beds,
          baths: schema.properties.baths,
          area: schema.properties.area,
          rentOrBuy: schema.properties.rentOrBuy,
          geolocationLat: schema.properties.geolocationLat,
          geolocationLng: schema.properties.geolocationLng,
          available: schema.properties.available,
          createdAt: schema.properties.createdAt,
          updatedAt: schema.properties.updatedAt,
        })
        .from(schema.properties)
        .innerJoin(schema.featuredProperties, eq(schema.properties.propref, schema.featuredProperties.propref))
        .where(eq(schema.featuredProperties.featured, true))
        .orderBy(desc(schema.properties.propref))
        .limit(limit);

      // Add optimized thumbnails
      const propertiesWithThumbs = await Promise.all(
        featuredProps.map(async (property) => {
          const details = await this.db()
            .select({ media: schema.propertyDetails.media })
            .from(schema.propertyDetails)
            .where(eq(schema.propertyDetails.propref, property.propref))
            .limit(1);

          let thumbnail = null;
          if (details[0]?.media) {
            // Use image resolver to get optimized thumbnail
            thumbnail = await imageResolver.getThumbnail(
              property.propref.toString(),
              details[0].media
            );
          }

          return {
            ...property,
            featured: true,
            thumbnail
          };
        })
      );

      return propertiesWithThumbs;
    } catch (error) {
      console.error('[DatabaseService] Error fetching featured properties:', error);
      throw error;
    }
  }

  /**
   * Get single property with full details
   */
  async getProperty(propref: string): Promise<PropertyWithDetails | null> {
    try {
      const propertyResult = await this.db()
        .select()
        .from(schema.properties)
        .where(eq(schema.properties.propref, parseInt(propref)))
        .limit(1);

      if (propertyResult.length === 0) {
        return null;
      }

      const property = propertyResult[0];

      // Get details
      const detailsResult = await this.db()
        .select()
        .from(schema.propertyDetails)
        .where(eq(schema.propertyDetails.propref, parseInt(propref)))
        .limit(1);

      // Get featured status
      const featuredResult = await this.db()
        .select({ featured: schema.featuredProperties.featured })
        .from(schema.featuredProperties)
        .where(eq(schema.featuredProperties.propref, parseInt(propref)))
        .limit(1);

      return {
        ...property,
        details: detailsResult[0] || undefined,
        featured: Boolean(featuredResult[0]?.featured)
      };
    } catch (error) {
      console.error('[DatabaseService] Error fetching property:', error);
      throw error;
    }
  }

  /**
   * Upsert property (insert or update)
   */
  async upsertProperty(propertyData: any): Promise<void> {
    try {
      const propref = parseInt(propertyData.propref);
      
      // Extract main property fields
      const propertyRecord: NewProperty = {
        propref,
        displayAddress: propertyData.displayaddress,
        displayPrice: propertyData.displayprice,
        beds: propertyData.beds,
        baths: propertyData.baths,
        area: propertyData.area,
        rentOrBuy: propertyData.rentorbuy,
        geolocationLat: propertyData.geolocation?.[0] || null,
        geolocationLng: propertyData.geolocation?.[1] || null,
        available: propertyData.available,
        updatedAt: new Date()
      };

      // Upsert main property
      await this.db()
        .insert(schema.properties)
        .values(propertyRecord)
        .onConflictDoUpdate({
          target: schema.properties.propref,
          set: {
            ...propertyRecord,
            updatedAt: sql`CURRENT_TIMESTAMP`
          }
        });

      // Upsert property details if we have full data
      if (propertyData.description || propertyData.features || propertyData.media) {
        const detailsRecord: NewPropertyDetail = {
          propref,
          description: propertyData.description || null,
          features: propertyData.features ? JSON.stringify(propertyData.features) : null,
          addressFull: propertyData.address ? JSON.stringify(propertyData.address) : null,
          media: propertyData.media ? JSON.stringify(propertyData.media) : null,
          updatedAt: new Date()
        };

        await this.db()
          .insert(schema.propertyDetails)
          .values(detailsRecord)
          .onConflictDoUpdate({
            target: schema.propertyDetails.propref,
            set: {
              ...detailsRecord,
              updatedAt: sql`CURRENT_TIMESTAMP`
            }
          });
      }
    } catch (error) {
      console.error('[DatabaseService] Error upserting property:', error);
      throw error;
    }
  }

  /**
   * Bulk upsert properties
   */
  async upsertProperties(properties: any[]): Promise<void> {
    try {
      if (properties.length === 0) return;

      console.log(`[DatabaseService] Upserting ${properties.length} properties`);
      
      // Process in chunks to avoid SQLite limits
      const chunkSize = 100;
      for (let i = 0; i < properties.length; i += chunkSize) {
        const chunk = properties.slice(i, i + chunkSize);
        await Promise.all(chunk.map(prop => this.upsertProperty(prop)));
      }

      console.log(`[DatabaseService] Successfully upserted ${properties.length} properties`);
    } catch (error) {
      console.error('[DatabaseService] Error bulk upserting properties:', error);
      throw error;
    }
  }

  /**
   * Set featured status for a property
   */
  async setFeaturedStatus(propref: string, featured: boolean): Promise<void> {
    try {
      const propertyId = parseInt(propref);
      
      // First check if the property exists in the properties table
      const propertyExists = await this.db()
        .select({ propref: schema.properties.propref })
        .from(schema.properties)
        .where(eq(schema.properties.propref, propertyId))
        .limit(1);

      if (propertyExists.length === 0) {
        throw new Error(`Property with ID ${propertyId} does not exist in the properties table`);
      }
      
      await this.db()
        .insert(schema.featuredProperties)
        .values({
          propref: propertyId,
          featured,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: schema.featuredProperties.propref,
          set: {
            featured,
            updatedAt: sql`CURRENT_TIMESTAMP`
          }
        });
    } catch (error) {
      console.error('[DatabaseService] Error setting featured status:', error);
      throw error;
    }
  }

  /**
   * Get sync metadata
   */
  async getSyncMetadata(key: string): Promise<schema.SyncMetadata | null> {
    try {
      const result = await this.db()
        .select()
        .from(schema.syncMetadata)
        .where(eq(schema.syncMetadata.key, key))
        .limit(1);

      return result[0] || null;
    } catch (error) {
      console.error('[DatabaseService] Error fetching sync metadata:', error);
      return null;
    }
  }

  /**
   * Update sync metadata
   */
  async updateSyncMetadata(key: string, data: Partial<schema.SyncMetadata>): Promise<void> {
    try {
      await this.db()
        .insert(schema.syncMetadata)
        .values({
          key,
          ...data,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: schema.syncMetadata.key,
          set: {
            ...data,
            updatedAt: sql`CURRENT_TIMESTAMP`
          }
        });
    } catch (error) {
      console.error('[DatabaseService] Error updating sync metadata:', error);
      throw error;
    }
  }

  /**
   * Pre-process images for better performance
   */
  async preProcessImages(limit = 50): Promise<void> {
    try {
      const properties = await this.db()
        .select({
          propref: schema.properties.propref,
          media: schema.propertyDetails.media
        })
        .from(schema.properties)
        .leftJoin(schema.propertyDetails, eq(schema.properties.propref, schema.propertyDetails.propref))
        .where(sql`${schema.propertyDetails.media} IS NOT NULL`)
        .limit(limit);

      const propertiesToProcess = properties.map(p => ({
        propref: p.propref.toString(),
        media: p.media || undefined
      }));

      console.log(`[DatabaseService] Pre-processing images for ${propertiesToProcess.length} properties`);
      await imageResolver.preProcessPropertyImages(propertiesToProcess);
    } catch (error) {
      console.error('[DatabaseService] Error pre-processing images:', error);
    }
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    totalProperties: number;
    featuredProperties: number;
    lastSync: string | null;
    syncStatus: string;
  }> {
    try {
      const [totalResult] = await this.db()
        .select({ count: sql<number>`count(*)` })
        .from(schema.properties);

      const [featuredResult] = await this.db()
        .select({ count: sql<number>`count(*)` })
        .from(schema.featuredProperties)
        .where(eq(schema.featuredProperties.featured, true));

      const syncMeta = await this.getSyncMetadata('properties_sync');

      return {
        totalProperties: totalResult.count,
        featuredProperties: featuredResult.count,
        lastSync: syncMeta?.lastSync || null,
        syncStatus: syncMeta?.status || 'unknown'
      };
    } catch (error) {
      console.error('[DatabaseService] Error fetching stats:', error);
      return {
        totalProperties: 0,
        featuredProperties: 0,
        lastSync: null,
        syncStatus: 'error'
      };
    }
  }
}

// Export singleton
export const databaseService = new DatabaseService();