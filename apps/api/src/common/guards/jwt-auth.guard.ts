import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthUser, JwtPayload, RequestWithUser } from '../types/jwt-payload';
import { TokenDenylistService } from '../../auth/token-denylist.service';

/**
 * Global guard: every route requires `Authorization: Bearer <jwt>` unless it is
 * marked @Public(). Verifies the signature, then rejects tokens whose `jti` was
 * denylisted by logout.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly denylist: TokenDenylistService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (payload.jti && (await this.denylist.isRevoked(payload.jti))) {
      throw new UnauthorizedException('Token revoked');
    }

    const user: AuthUser = {
      id: Number(payload.sub),
      email: payload.email,
      jti: payload.jti,
      exp: payload.exp,
    };
    request.user = user;
    return true;
  }
}
