import type { Context, Next } from 'hono';
import type { Logger } from 'pino';

export function performanceMiddleware(logger: Logger) {
  return async (c: Context, next: Next) => {
    const startTime = Date.now();
    const requestId = c.get('requestId') || 'unknown';

    // Add performance headers
    c.header('X-Request-ID', requestId);
    c.header('X-Powered-By', 'London Move API v1.0.0');
    c.header('X-Optimization', 'lightning');

    await next();

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    // Add response time header
    c.header('X-Response-Time', `${responseTime}ms`);

    // Log performance metrics
    logger.info({
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      responseTime,
      userAgent: c.req.header('user-agent'),
      ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
    }, 'Request completed');

    // Alert on slow responses (over 50ms)
    if (responseTime > 50) {
      logger.warn({
        requestId,
        responseTime,
        path: c.req.path,
        method: c.req.method,
      }, 'Slow response detected');
    }

    // Track performance for auto-optimization
    if (responseTime > 100) {
      logger.error({
        requestId,
        responseTime,
        path: c.req.path,
        method: c.req.method,
      }, 'Very slow response - optimization needed');
    }
  };
}