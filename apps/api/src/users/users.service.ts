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
    return toAccountState(user as unknown as { id: number; email: string; name: string; region: string; provider: string; createdAt: Date; settings?: unknown });
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
    const existing = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!existing) throw new UnauthorizedException('Account no longer exists');

    const data: Record<string, unknown> = {};
    if (patch.region !== undefined) data.region = patch.region;
    if (patch.provider !== undefined) data.provider = patch.provider;

    if (patch.player !== undefined) {
      const currentSettings =
        existing.settings && typeof existing.settings === 'object' && existing.settings !== null
          ? (existing.settings as Record<string, unknown>)
          : {};
      const currentPlayer =
        currentSettings.player && typeof currentSettings.player === 'object' && currentSettings.player !== null
          ? (currentSettings.player as Record<string, unknown>)
          : {};
      const incoming = patch.player as Record<string, unknown>;
      // Explicitly merge known keys; strip undefined so they don't overwrite existing
      const nextPlayer: Record<string, unknown> = { ...currentPlayer };
      for (const key of ['seekStep', 'playbackRate', 'autoplay', 'prefSubLang', 'prefAudioLang', 'aspectMode', 'subStyle'] as const) {
        if (incoming[key] !== undefined) nextPlayer[key] = incoming[key];
      }
      const nextSettings = { ...currentSettings, player: nextPlayer };
      data.settings = nextSettings;
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: data as never,
    });
    return { settings: toAccountSettings(user as unknown as { region: string; provider: string; settings?: unknown }) };
  }
}
