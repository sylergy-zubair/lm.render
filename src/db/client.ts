import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { appConfig } from '@/utils/config';
import { sql } from 'drizzle-orm';

class DatabaseClient {
  private postgresClient: postgres.Sql;
  private db: ReturnType<typeof drizzle>;
  private isInitialized = false;

  constructor() {
    const databaseUrl = appConfig.database.url;
    
    if (!this.isPostgresUrl(databaseUrl)) {
      throw new Error('DATABASE_URL must be a valid PostgreSQL connection string (postgresql:// or postgres://)');
    }
    
    this.initializePostgres(databaseUrl);
  }

  private isPostgresUrl(url: string): boolean {
    return url.startsWith('postgresql://') || url.startsWith('postgres://');
  }

  private initializePostgres(databaseUrl: string): void {
    console.log(`[Database] Connecting to PostgreSQL database`);
    
    try {
      this.postgresClient = postgres(databaseUrl, {
        max: 10, // Maximum connections
        idle_timeout: 20,
        connect_timeout: 10,
      });
      
      this.db = drizzle(this.postgresClient, { schema });
      console.log('[Database] PostgreSQL connection established');
    } catch (error) {
      console.error('[Database] Failed to connect to PostgreSQL:', error);
      throw error;
    }
  }


  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('[Database] Initializing database schema...');
      
      // Run migrations
      await this.runMigrations();
      
      // Initialize sync metadata
      await this.initializeSyncMetadata();
      
      this.isInitialized = true;
      console.log('[Database] Database initialization completed');
    } catch (error) {
      console.error('[Database] Initialization failed:', error);
      throw error;
    }
  }

  private async runMigrations(): Promise<void> {
    try {
    // PostgreSQL schema creation
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS properties (
        propref SERIAL PRIMARY KEY,
        display_address TEXT NOT NULL,
        display_price TEXT NOT NULL,
        beds INTEGER,
        baths INTEGER,
        area TEXT,
        rent_or_buy TEXT CHECK(rent_or_buy IN ('rent', 'sale')) NOT NULL,
        geolocation_lat REAL,
        geolocation_lng REAL,
        available TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS property_details (
        propref INTEGER PRIMARY KEY,
        description TEXT,
        features TEXT,
        address_full TEXT,
        media TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (propref) REFERENCES properties(propref) ON DELETE CASCADE
      );
    `);

    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS featured_properties (
        propref INTEGER PRIMARY KEY,
        featured BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (propref) REFERENCES properties(propref) ON DELETE CASCADE
      );
    `);

    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        last_sync TIMESTAMP,
        total_properties INTEGER,
        status TEXT CHECK(status IN ('syncing', 'completed', 'failed')) NOT NULL DEFAULT 'completed',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // Create indexes for PostgreSQL
    await this.db.execute(sql`CREATE INDEX IF NOT EXISTS idx_properties_area ON properties(area);`);
    await this.db.execute(sql`CREATE INDEX IF NOT EXISTS idx_properties_beds ON properties(beds);`);
    await this.db.execute(sql`CREATE INDEX IF NOT EXISTS idx_properties_rent_buy ON properties(rent_or_buy);`);
    await this.db.execute(sql`CREATE INDEX IF NOT EXISTS idx_properties_available ON properties(available);`);
    await this.db.execute(sql`CREATE INDEX IF NOT EXISTS idx_properties_location ON properties(geolocation_lat, geolocation_lng);`);
    await this.db.execute(sql`CREATE INDEX IF NOT EXISTS idx_featured_status ON featured_properties(featured);`);
      
      console.log('[Database] Schema and indexes created successfully');
    } catch (error) {
      console.error('[Database] Migration failed:', error);
      throw error;
    }
  }

  private async initializeSyncMetadata(): Promise<void> {
    try {
      // Check if sync metadata exists
      const existing = await this.db.select().from(schema.syncMetadata).where(
        sql`key = 'properties_sync'`
      ).limit(1);

      if (existing.length === 0) {
        await this.db.insert(schema.syncMetadata).values({
          key: 'properties_sync',
          lastSync: null,
          totalProperties: 0,
          status: 'completed'
        });
        
        console.log('[Database] Sync metadata initialized');
      }
    } catch (error) {
      console.error('[Database] Failed to initialize sync metadata:', error);
      throw error;
    }
  }

  get database() {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }


  async healthCheck(): Promise<{ status: 'up' | 'down'; responseTime: number; totalProperties: number }> {
    const startTime = Date.now();
    
    try {
      const result = await this.db.select({ count: sql<number>`count(*)` }).from(schema.properties);
      const totalProperties = result[0]?.count || 0;
      
      return {
        status: 'up',
        responseTime: Date.now() - startTime,
        totalProperties
      };
    } catch (error) {
      console.error('[Database] Health check failed:', error);
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        totalProperties: 0
      };
    }
  }

  async close(): Promise<void> {
    try {
      if (this.postgresClient) {
        await this.postgresClient.end();
      }
      console.log('[Database] Connection closed');
    } catch (error) {
      console.error('[Database] Error closing connection:', error);
    }
  }
}

// Export singleton instance
export const databaseClient = new DatabaseClient();
export const database = () => databaseClient.database;