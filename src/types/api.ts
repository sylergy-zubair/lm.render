export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: {
    pagination?: PaginationMeta;
    cache?: CacheMeta;
    performance?: PerformanceMeta;
  };
}

export interface ErrorResponse {
  success: false;
  error: string;
  details?: any;
  code: string;
  timestamp: string;
  requestId?: string;
}

export interface PaginationMeta {
  current: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
  limit: number;
}

export interface CacheMeta {
  hit: boolean;
  ttl: number;
  key: string;
  level?: 'browser' | 'edge' | 'memory' | 'redis' | 'database';
}

export interface PerformanceMeta {
  responseTime: number;
  cacheHit: boolean;
  precomputed?: boolean;
  optimization?: 'lightning' | 'standard' | 'fallback';
}

export enum ApiErrorCode {
  // Authentication
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  
  // Validation
  INVALID_REQUEST = 'INVALID_REQUEST',
  MISSING_PARAMETER = 'MISSING_PARAMETER',
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  
  // Resources
  NOT_FOUND = 'NOT_FOUND',
  PROPERTY_NOT_FOUND = 'PROPERTY_NOT_FOUND',
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // External Services
  RENTMAN_API_ERROR = 'RENTMAN_API_ERROR',
  CACHE_ERROR = 'CACHE_ERROR',
  IMAGE_PROCESSING_ERROR = 'IMAGE_PROCESSING_ERROR',
  
  // Server Errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE'
}

export interface RequestContext {
  requestId: string;
  timestamp: number;
  userAgent?: string;
  ip?: string;
  path: string;
  method: string;
  query?: Record<string, string>;
}