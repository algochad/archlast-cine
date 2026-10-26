import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { compareSync, hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { User } from '@prisma/client';
import { toAccountState, type AccountState } from '../common/account.types';
import type { AuthUser } from '../common/types/jwt-payload';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginRateLimitService } from './login-rate-limit.service';
import { TokenDenylistService } from './token-denylist.service';

const HASH_ROUNDS = 10;

export type SessionPayload = AccountState & { accessToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly rateLimit: LoginRateLimitService,
    private readonly denylist: TokenDenylistService,
  ) {}

  async register(dto: RegisterDto): Promise<SessionPayload> {
    const email = dto.email.trim().toLowerCase();
    try {
      const user = await this.prisma.user.create({
        data: { email, name: dto.name.trim(), passwordHash: hashSync(dto.password, HASH_ROUNDS) },
      });
      return await this.issueSession(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
  }

  async login(dto: LoginDto, ip: string): Promise<SessionPayload> {
    const email = dto.email.trim().toLowerCase();
    await this.rateLimit.assertWithinLimit(email, ip);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !compareSync(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueSession(user);
  }

  /** Denylist the presented token's jti until its own exp. */
  async logout(user: AuthUser): Promise<void> {
    await this.denylist.revoke(user.jti, user.exp);
  }

  private async issueSession(user: User): Promise<SessionPayload> {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      jti: randomUUID(),
    });
    return { ...toAccountState(user), accessToken };
  }
}
