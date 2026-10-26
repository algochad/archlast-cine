import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('v1/health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Also used by scripts/dev.mjs and the compose healthcheck. */
  @Public()
  @Get()
  async health(): Promise<{ ok: boolean; db: boolean; redis: boolean }> {
    const [db, redis] = await Promise.all([this.prisma.ping(), this.redis.ping()]);
    return { ok: db && redis, db, redis };
  }
}
