import { Throttle } from '@nestjs/throttler';

/**
 * Decorator for auth endpoints - 5 requests per minute
 * Prevents brute force attacks on authentication endpoints
 */
export const ThrottleAuth = () => Throttle({ default: { limit: 5, ttl: 60000 } });

