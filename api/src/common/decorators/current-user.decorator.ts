import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser, RequestWithUser } from '../types/jwt-payload';

/** Injects the authenticated principal attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    if (!req.user) {
      // Guard contract: guarded handlers always have a principal.
      throw new Error('CurrentUser used on an unguarded route');
    }
    return req.user;
  },
);
