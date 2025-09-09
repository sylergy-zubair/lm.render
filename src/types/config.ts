export interface ServerConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  apiBaseUrl: string;
}

export interface RentmanConfig {
  apiToken: string;
  baseUrl: string;
}

export interface CacheConfig {
  redis: {
    url: string;
    token?: string;
    password?: string;
  };
  memory: {
    size: number;
    ttl: number;
  };
  prefix: string;
}

export interface DatabaseConfig {
  url: string;
}

export interface CDNConfig {
  aws: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
  };
  s3: {
    bucket: string;
  };
  baseUrl: string;
}

export interface AdminConfig {
  jwtSecret: string;
  defaultEmail: string;
  defaultPassword: string;
}

export interface FrontendConfig {
  url: string;
  corsOrigins: string[];
}

export interface FeatureFlags {
  enableEdgeCaching: boolean;
  enableImagePrecomputation: boolean;
  enablePredictiveCaching: boolean;
  enableAutoOptimization: boolean;
  enableResponsePrecomputation: boolean;
}

export interface AppConfig {
  server: ServerConfig;
  rentman: RentmanConfig;
  cache: CacheConfig;
  database: DatabaseConfig;
  cdn: CDNConfig;
  admin: AdminConfig;
  frontend: FrontendConfig;
  features: FeatureFlags;
  image: {
    qualityDefault: number;
    maxWidth: number;
    maxHeight: number;
  };
  logging: {
    level: string;
    enableRequestLogging: boolean;
  };
}