import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_URL } from '../common/env';

/**
 * Thin ioredis wrapper. Commands fail fast while Redis is down
 * (`enableOfflineQueue: false`) so guarded requests never hang; callers decide
 * whether a Redis outage degrades or rejects the request.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private lastErrorLog = 0;

  readonly client: Redis;

  constructor() {
    this.client = new Redis(REDIS_URL, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 250, 3_000),
    });
    this.client.on('error', (error: Error) => {
      const now = Date.now();
      if (now - this.lastErrorLog < 30_000) return;
      this.lastErrorLog = now;
      this.logger.warn(
        `Redis unavailable at ${REDIS_URL} (${error.message}). Start it with: docker compose up -d db redis`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }

  /** True when `PING` round-trips. */
  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  /** INCR + EXPIRE (expiry set on the first hit of the window). */
  async incrementWindow(key: string, ttlSeconds: number): Promise<number> {
    const hits = await this.client.incr(key);
    if (hits === 1) await this.client.expire(key, ttlSeconds);
    return hits;
  }

  /** Store `value` under `key` for `ttlSeconds`. */
  async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async has(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }
}
