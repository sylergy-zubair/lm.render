import type { Context } from 'hono';
import type { Logger } from 'pino';
import { ApiErrorCode, type ErrorResponse } from '@/types/api';

export function errorHandler(logger: Logger) {
  return (error: Error, c: Context): Response => {
    const requestId = c.get('requestId') || 'unknown';
    
    logger.error({
      error: error.message,
      stack: error.stack,
      requestId,
      path: c.req.path,
      method: c.req.method,
    }, 'Request error occurred');

    // Determine error code and status
    let statusCode = 500;
    let errorCode = ApiErrorCode.INTERNAL_ERROR;
    let message = 'An internal server error occurred';

    if (error.name === 'ZodError') {
      statusCode = 400;
      errorCode = ApiErrorCode.INVALID_REQUEST;
      message = 'Request validation failed';
    } else if (error.message.includes('unauthorized')) {
      statusCode = 401;
      errorCode = ApiErrorCode.UNAUTHORIZED;
      message = 'Authentication required';
    } else if (error.message.includes('forbidden')) {
      statusCode = 403;
      errorCode = ApiErrorCode.FORBIDDEN;
      message = 'Access denied';
    } else if (error.message.includes('not found')) {
      statusCode = 404;
      errorCode = ApiErrorCode.NOT_FOUND;
      message = 'Resource not found';
    } else if (error.message.includes('rate limit')) {
      statusCode = 429;
      errorCode = ApiErrorCode.RATE_LIMIT_EXCEEDED;
      message = 'Rate limit exceeded';
    }

    const errorResponse: ErrorResponse = {
      success: false,
      error: message,
      code: errorCode,
      timestamp: new Date().toISOString(),
      requestId,
    };

    // Include error details in development
    if (process.env.NODE_ENV === 'development') {
      errorResponse.details = {
        message: error.message,
        stack: error.stack,
      };
    }

    return c.json(errorResponse, statusCode);
  };
}