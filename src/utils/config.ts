import { config } from 'dotenv';
import { z } from 'zod';
import type { AppConfig } from '@/types/config';

// Load environment variables
config();

// Validation schemas
const ServerConfigSchema = z.object({
  port: z.coerce.number().default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  apiBaseUrl: z.string().default('http://localhost:3000'),
});

const RentmanConfigSchema = z.object({
  apiToken: z.string().min(1, 'Rentman API token is required'),
  baseUrl: z.string().url().default('https://www.rentman.online'),
});

const CacheConfigSchema = z.object({
  redis: z.object({
    url: z.string().default('redis://localhost:6379'),
    token: z.string().optional(),
    password: z.string().optional(),
  }),
  memory: z.object({
    size: z.coerce.number().default(1000),
    ttl: z.coerce.number().default(300000), // 5 minutes
  }),
  prefix: z.string().default('lm:'),
});

const DatabaseConfigSchema = z.object({
  url: z.string().min(1, 'Database URL is required'),
});

const CDNConfigSchema = z.object({
  aws: z.object({
    accessKeyId: z.string().min(1, 'AWS access key is required'),
    secretAccessKey: z.string().min(1, 'AWS secret key is required'),
    region: z.string().default('us-east-1'),
  }),
  s3: z.object({
    bucket: z.string().default('london-move-images'),
  }),
  baseUrl: z.string().url().default('https://cdn.london-move.com'),
});

const AdminConfigSchema = z.object({
  jwtSecret: z.string().min(32, 'JWT secret must be at least 32 characters'),
  defaultEmail: z.string().email(),
  defaultPassword: z.string().min(8, 'Admin password must be at least 8 characters'),
});

const FrontendConfigSchema = z.object({
  url: z.string().url(),
  corsOrigins: z.string().transform(str => str.split(',')).pipe(z.array(z.string().url())),
});

const FeatureFlagsSchema = z.object({
  enableEdgeCaching: z.coerce.boolean().default(true),
  enableImagePrecomputation: z.coerce.boolean().default(true),
  enablePredictiveCaching: z.coerce.boolean().default(true),
  enableAutoOptimization: z.coerce.boolean().default(true),
  enableResponsePrecomputation: z.coerce.boolean().default(true),
});

const ImageConfigSchema = z.object({
  qualityDefault: z.coerce.number().min(1).max(100).default(85),
  maxWidth: z.coerce.number().default(3840),
  maxHeight: z.coerce.number().default(2160),
});

const LoggingConfigSchema = z.object({
  level: z.string().default('info'),
  enableRequestLogging: z.coerce.boolean().default(true),
});

// Main config schema
const AppConfigSchema = z.object({
  server: ServerConfigSchema,
  rentman: RentmanConfigSchema,
  cache: CacheConfigSchema,
  database: DatabaseConfigSchema,
  cdn: CDNConfigSchema,
  admin: AdminConfigSchema,
  frontend: FrontendConfigSchema,
  features: FeatureFlagsSchema,
  image: ImageConfigSchema,
  logging: LoggingConfigSchema,
});

// Parse and validate configuration
function loadConfig(): AppConfig {
  try {
    return AppConfigSchema.parse({
      server: {
        port: process.env.PORT,
        nodeEnv: process.env.NODE_ENV,
        apiBaseUrl: process.env.API_BASE_URL,
      },
      rentman: {
        apiToken: process.env.RENTMAN_API_TOKEN,
        baseUrl: process.env.RENTMAN_BASE_URL,
      },
      cache: {
        redis: {
          url: process.env.REDIS_URL,
          token: process.env.UPSTASH_REDIS_TOKEN,
          password: process.env.REDIS_PASSWORD,
        },
        memory: {
          size: process.env.MEMORY_CACHE_SIZE,
          ttl: process.env.MEMORY_CACHE_TTL,
        },
        prefix: process.env.CACHE_PREFIX,
      },
      database: {
        url: process.env.DATABASE_URL,
      },
      cdn: {
        aws: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          region: process.env.AWS_REGION,
        },
        s3: {
          bucket: process.env.S3_BUCKET,
        },
        baseUrl: process.env.CDN_BASE_URL,
      },
      admin: {
        jwtSecret: process.env.JWT_SECRET,
        defaultEmail: process.env.ADMIN_DEFAULT_EMAIL,
        defaultPassword: process.env.ADMIN_DEFAULT_PASSWORD,
      },
      frontend: {
        url: process.env.FRONTEND_URL,
        corsOrigins: process.env.CORS_ORIGINS,
      },
      features: {
        enableEdgeCaching: process.env.ENABLE_EDGE_CACHING,
        enableImagePrecomputation: process.env.ENABLE_IMAGE_PRECOMPUTATION,
        enablePredictiveCaching: process.env.ENABLE_PREDICTIVE_CACHING,
        enableAutoOptimization: process.env.ENABLE_AUTO_OPTIMIZATION,
        enableResponsePrecomputation: process.env.ENABLE_RESPONSE_PRECOMPUTATION,
      },
      image: {
        qualityDefault: process.env.IMAGE_QUALITY_DEFAULT,
        maxWidth: process.env.IMAGE_MAX_WIDTH,
        maxHeight: process.env.IMAGE_MAX_HEIGHT,
      },
      logging: {
        level: process.env.LOG_LEVEL,
        enableRequestLogging: process.env.ENABLE_REQUEST_LOGGING,
      },
    });
  } catch (error) {
    console.error('Configuration validation failed:', error);
    process.exit(1);
  }
}

// Export singleton config
export const appConfig = loadConfig();

// Development mode helpers
export const isDevelopment = appConfig.server.nodeEnv === 'development';
export const isProduction = appConfig.server.nodeEnv === 'production';
export const isTest = appConfig.server.nodeEnv === 'test';