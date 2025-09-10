import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';
import { appConfig } from '@/utils/config';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { sql } from 'drizzle-orm';

class DatabaseClient {
  private sqlite: Database;
  private db: ReturnType<typeof drizzle>;
  private isInitialized = false;

  constructor() {
    // Extract database path from DATABASE_URL or use default
    const databasePath = this.getDatabasePath();
    
    console.log(`[Database] Connecting to SQLite database: ${databasePath}`);
    
    try {
      this.sqlite = new Database(databasePath, { create: true });
      this.db = drizzle(this.sqlite, { schema });
      
      // Enable WAL mode for better performance
      this.sqlite.exec('PRAGMA journal_mode = WAL;');
      this.sqlite.exec('PRAGMA synchronous = NORMAL;');
      this.sqlite.exec('PRAGMA cache_size = 1000;');
      this.sqlite.exec('PRAGMA foreign_keys = ON;');
      
      console.log('[Database] SQLite connection established');
    } catch (error) {
      console.error('[Database] Failed to connect to SQLite:', error);
      throw error;
    }
  }

  private getDatabasePath(): string {
    if (appConfig.database.url.startsWith('sqlite:')) {
      return appConfig.database.url.replace('sqlite:', '');
    }
    
    // Default path for development and production
    return process.env.NODE_ENV === 'production' 
      ? './data/london_move.db'
      : './data/london_move_dev.db';
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('[Database] Initializing database schema...');
      
      // Create data directory if it doesn't exist
      try {
        await Bun.write('./data/.gitkeep', '');
      } catch (e) {
        // Directory might already exist
      }
      
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
      // For now, we'll create tables manually
      // TODO: Use proper migrations with drizzle-kit
      await this.db.run(sql`
        CREATE TABLE IF NOT EXISTS properties (
          propref INTEGER PRIMARY KEY,
          display_address TEXT NOT NULL,
          display_price TEXT NOT NULL,
          beds INTEGER,
          baths INTEGER,
          area TEXT,
          rent_or_buy TEXT CHECK(rent_or_buy IN ('rent', 'sale')) NOT NULL,
          geolocation_lat REAL,
          geolocation_lng REAL,
          available TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
      `);

      await this.db.run(sql`
        CREATE TABLE IF NOT EXISTS property_details (
          propref INTEGER PRIMARY KEY,
          description TEXT,
          features TEXT,
          address_full TEXT,
          media TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          FOREIGN KEY (propref) REFERENCES properties(propref) ON DELETE CASCADE
        );
      `);

      await this.db.run(sql`
        CREATE TABLE IF NOT EXISTS featured_properties (
          propref INTEGER PRIMARY KEY,
          featured INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          FOREIGN KEY (propref) REFERENCES properties(propref) ON DELETE CASCADE
        );
      `);

      await this.db.run(sql`
        CREATE TABLE IF NOT EXISTS sync_metadata (
          key TEXT PRIMARY KEY,
          last_sync TEXT,
          total_properties INTEGER,
          status TEXT CHECK(status IN ('syncing', 'completed', 'failed')) NOT NULL DEFAULT 'completed',
          error_message TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
      `);

      // Create indexes
      await this.db.run(sql`CREATE INDEX IF NOT EXISTS idx_properties_area ON properties(area);`);
      await this.db.run(sql`CREATE INDEX IF NOT EXISTS idx_properties_beds ON properties(beds);`);
      await this.db.run(sql`CREATE INDEX IF NOT EXISTS idx_properties_rent_buy ON properties(rent_or_buy);`);
      await this.db.run(sql`CREATE INDEX IF NOT EXISTS idx_properties_available ON properties(available);`);
      await this.db.run(sql`CREATE INDEX IF NOT EXISTS idx_properties_location ON properties(geolocation_lat, geolocation_lng);`);
      await this.db.run(sql`CREATE INDEX IF NOT EXISTS idx_featured_status ON featured_properties(featured);`);

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

  get sqlite() {
    return this.sqlite;
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
      this.sqlite.close();
      console.log('[Database] Connection closed');
    } catch (error) {
      console.error('[Database] Error closing connection:', error);
    }
  }
}

// Export singleton instance
export const databaseClient = new DatabaseClient();
export const database = () => databaseClient.database;