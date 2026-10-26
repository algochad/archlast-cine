import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { HistoryModule } from './history/history.module';
import { MyListModule } from './my-list/my-list.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    HistoryModule,
    MyListModule,
    HealthModule,
  ],
})
export class AppModule {}
