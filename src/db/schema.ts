import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Properties table - main property listings
export const properties = sqliteTable('properties', {
  propref: integer('propref').primaryKey(),
  displayAddress: text('display_address').notNull(),
  displayPrice: text('display_price').notNull(),
  beds: integer('beds'),
  baths: integer('baths'),
  area: text('area'),
  rentOrBuy: text('rent_or_buy', { enum: ['rent', 'sale'] }).notNull(),
  geolocationLat: real('geolocation_lat'),
  geolocationLng: real('geolocation_lng'),
  available: text('available'), // Date as ISO string
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  areaIdx: index('idx_properties_area').on(table.area),
  bedsIdx: index('idx_properties_beds').on(table.beds),
  rentBuyIdx: index('idx_properties_rent_buy').on(table.rentOrBuy),
  availableIdx: index('idx_properties_available').on(table.available),
  locationIdx: index('idx_properties_location').on(table.geolocationLat, table.geolocationLng),
}));

// Property details - full property data
export const propertyDetails = sqliteTable('property_details', {
  propref: integer('propref').primaryKey().references(() => properties.propref, { onDelete: 'cascade' }),
  description: text('description'),
  features: text('features'), // JSON string
  addressFull: text('address_full'), // JSON string
  media: text('media'), // JSON string
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Featured properties - admin-controlled featured status
export const featuredProperties = sqliteTable('featured_properties', {
  propref: integer('propref').primaryKey().references(() => properties.propref, { onDelete: 'cascade' }),
  featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  featuredIdx: index('idx_featured_status').on(table.featured),
}));

// Sync metadata - track data freshness and sync status
export const syncMetadata = sqliteTable('sync_metadata', {
  key: text('key').primaryKey(),
  lastSync: text('last_sync'), // ISO timestamp
  totalProperties: integer('total_properties'),
  status: text('status', { enum: ['syncing', 'completed', 'failed'] }).notNull().default('completed'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Types for TypeScript
export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;
export type PropertyDetail = typeof propertyDetails.$inferSelect;
export type NewPropertyDetail = typeof propertyDetails.$inferInsert;
export type FeaturedProperty = typeof featuredProperties.$inferSelect;
export type NewFeaturedProperty = typeof featuredProperties.$inferInsert;
export type SyncMetadata = typeof syncMetadata.$inferSelect;
export type NewSyncMetadata = typeof syncMetadata.$inferInsert;

// Combined types for API responses
export type PropertyWithDetails = Property & {
  details?: PropertyDetail;
  featured?: boolean;
};

export type PropertyListing = Property & {
  featured: boolean;
  thumbnail?: string;
};