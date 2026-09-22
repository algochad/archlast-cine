import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  toAccountSettings,
  toAccountState,
  toAccountUser,
  type AccountSettings,
  type AccountState,
  type AccountUser,
} from '../common/account.types';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateSettingsDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getState(userId: number): Promise<AccountState> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return toAccountState(user);
  }

  async updateName(userId: number, name?: string): Promise<{ user: AccountUser }> {
    if (name === undefined) return { user: (await this.getState(userId)).user };
    const user = await this.prisma.user.update({ where: { id: userId }, data: { name: name.trim() } });
    return { user: toAccountUser(user) };
  }

  async updateSettings(
    userId: number,
    patch: UpdateSettingsDto,
  ): Promise<{ settings: AccountSettings }> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { region: patch.region, provider: patch.provider },
    });
    return { settings: toAccountSettings(user) };
  }
}
