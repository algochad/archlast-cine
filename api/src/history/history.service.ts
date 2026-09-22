import { BadRequestException, Injectable } from '@nestjs/common';
import type { MediaType, WatchEntry } from '../common/account.types';
import { PrismaService } from '../prisma/prisma.service';
import type { HistoryKeyQueryDto, WatchEntryDto } from './dto/history.dto';

/** Continue-watching list cap. */
const HISTORY_LIMIT = 200;

interface WatchHistoryRow {
  provider: string;
  mediaId: string;
  title: string;
  poster: string | null;
  mediaType: string;
  year: string | null;
  season: number;
  episode: number;
  position: number;
  duration: number;
  updatedAt: bigint;
}

function toWatchEntry(row: WatchHistoryRow): WatchEntry {
  return {
    provider: row.provider,
    id: row.mediaId,
    title: row.title,
    poster: row.poster,
    mediaType: row.mediaType as MediaType,
    year: row.year,
    season: row.season,
    episode: row.episode,
    position: row.position,
    duration: row.duration,
    // BigInt ms -> number (safe: < 2^53).
    updatedAt: Number(row.updatedAt),
  };
}

/** Row columns for both branches of an upsert; the server stamps `updatedAt`. */
function historyColumns(entry: WatchEntryDto) {
  return {
    provider: entry.provider,
    mediaId: entry.id,
    title: entry.title,
    poster: entry.poster ?? null,
    mediaType: entry.mediaType,
    year: entry.year ?? null,
    season: entry.season ?? 0,
    episode: entry.episode ?? 0,
    position: entry.position ?? 0,
    duration: entry.duration ?? 0,
    updatedAt: BigInt(Math.round(entry.updatedAt ?? Date.now())),
  };
}

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: number): Promise<{ entries: WatchEntry[] }> {
    const rows = await this.prisma.watchHistory.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: HISTORY_LIMIT,
    });
    return { entries: rows.map(toWatchEntry) };
  }

  async upsert(userId: number, entry: WatchEntryDto): Promise<{ entry: WatchEntry }> {
    const key = {
      userId,
      provider: entry.provider,
      mediaId: entry.id,
      season: entry.season ?? 0,
      episode: entry.episode ?? 0,
    };
    const columns = historyColumns(entry);
    const row = await this.prisma.watchHistory.upsert({
      where: { userId_provider_mediaId_season_episode: key },
      create: { userId, ...columns },
      update: columns,
    });
    return { entry: toWatchEntry(row) };
  }

  /** Bulk upsert (local-history upload); all-or-nothing in one transaction. */
  async importMany(userId: number, entries: WatchEntryDto[]): Promise<{ count: number }> {
    if (entries.length > 0) {
      await this.prisma.$transaction(
        entries.map((entry) =>
          this.prisma.watchHistory.upsert({
            where: {
              userId_provider_mediaId_season_episode: {
                userId,
                provider: entry.provider,
                mediaId: entry.id,
                season: entry.season ?? 0,
                episode: entry.episode ?? 0,
              },
            },
            create: { userId, ...historyColumns(entry) },
            update: historyColumns(entry),
          }),
        ),
      );
    }
    return { count: entries.length };
  }

  async remove(userId: number, query: HistoryKeyQueryDto): Promise<void> {
    const mediaId = query.id ?? query.mediaId;
    if (!mediaId) throw new BadRequestException('id is required');
    await this.prisma.watchHistory.deleteMany({
      where: {
        userId,
        provider: query.provider,
        mediaId,
        season: query.season ?? 0,
        episode: query.episode ?? 0,
      },
    });
  }
}
