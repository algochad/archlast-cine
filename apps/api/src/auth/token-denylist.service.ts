import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * Logout denylist: `denylist:{jti}` exists until the token's own `exp`, so a
 * leaked/stale Bearer token stops working immediately. Redis outages fail open
 * (token treated as valid) — degraded dev mode, mirroring /v1/health.
 */
@Injectable()
export class TokenDenylistService {
  private readonly logger = new Logger(TokenDenylistService.name);

  constructor(private readonly redis: RedisService) {}

  async revoke(jti: string, expSeconds: number): Promise<void> {
    const ttl = expSeconds - Math.floor(Date.now() / 1000);
    if (ttl <= 0) return;
    try {
      await this.redis.setWithTtl(`denylist:${jti}`, '1', ttl);
    } catch (error) {
      this.logger.warn(`Logout did not denylist ${jti} — Redis error (${(error as Error).message})`);
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    try {
      return await this.redis.has(`denylist:${jti}`);
    } catch (error) {
      this.logger.warn(`Denylist check skipped — Redis error (${(error as Error).message})`);
      return false;
    }
  }
}
