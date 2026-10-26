import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { JWT_SECRET, JWT_TTL } from '../common/env';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginRateLimitService } from './login-rate-limit.service';
import { TokenDenylistService } from './token-denylist.service';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: JWT_SECRET,
      signOptions: { expiresIn: JWT_TTL },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginRateLimitService,
    TokenDenylistService,
    // Applied process-wide: every other module's routes require a Bearer token
    // unless marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, TokenDenylistService],
})
export class AuthModule {}
