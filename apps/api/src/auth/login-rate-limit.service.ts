import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS } from '../common/env';
import { RedisService } from '../redis/redis.service';

/**
 * Fixed-window login throttle: `login:{email}:{ip}` counts every attempt
 * (successful or not) for {@link LOGIN_WINDOW_SECONDS}; the (N+1)th is a 429.
 * Redis outages fail open — the app must stay usable in local dev without it.
 */
@Injectable()
export class LoginRateLimitService {
  private readonly logger = new Logger(LoginRateLimitService.name);

  constructor(private readonly redis: RedisService) {}

  async assertWithinLimit(email: string, ip: string): Promise<void> {
    const key = `login:${email}:${ip}`;
    let hits: number;
    try {
      hits = await this.redis.incrementWindow(key, LOGIN_WINDOW_SECONDS);
    } catch (error) {
      this.logger.warn(`Rate limit skipped — Redis error (${(error as Error).message})`);
      return;
    }
    if (hits > LOGIN_MAX_ATTEMPTS) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many login attempts. Try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
