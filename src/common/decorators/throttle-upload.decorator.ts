import { Throttle } from '@nestjs/throttler';

/**
 * Decorator for file upload endpoints - 10 requests per minute
 * Prevents abuse of file upload functionality
 */
export const ThrottleUpload = () => Throttle({ default: { limit: 10, ttl: 60000 } });

