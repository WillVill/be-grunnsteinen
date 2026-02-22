import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorator to mark a route as public (no authentication required)
 * Use this on endpoints that should be accessible without a JWT token
 * @example
 * @Public()
 * @Get('health')
 * healthCheck() {}
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

