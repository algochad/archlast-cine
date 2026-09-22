import { BadRequestException, Injectable } from '@nestjs/common';
import type { MediaType, ReadingEntry } from '../common/account.types';
import { PrismaService } from '../prisma/prisma.service';
import type { ReadingEntryDto, ReadingHistoryKeyQueryDto } from './dto/reading-history.dto';

/** Continue-reading list cap. */
const READING_HISTORY_LIMIT = 200;

interface ReadingHistoryRow {
  provider: string;
  mediaId: string;
  title: string;
  poster: string | null;
  mediaType: string;
  year: string | null;
  chapter: number;
  page: number;
  totalPages: number;
  updatedAt: bigint;
}

function toReadingEntry(row: ReadingHistoryRow): ReadingEntry {
  return {
    provider: row.provider,
    id: row.mediaId,
    title: row.title,
    poster: row.poster,
    mediaType: row.mediaType as MediaType,
    year: row.year,
    chapter: row.chapter,
    page: row.page,
    totalPages: row.totalPages,
    // BigInt ms -> number (safe: < 2^53).
    updatedAt: Number(row.updatedAt),
  };
}

/** Row columns for both branches of an upsert; the server stamps `updatedAt`. */
function readingColumns(entry: ReadingEntryDto) {
  return {
    provider: entry.provider,
    mediaId: entry.id,
    title: entry.title,
    poster: entry.poster ?? null,
    mediaType: entry.mediaType,
    year: entry.year ?? null,
    chapter: entry.chapter ?? 0,
    page: entry.page ?? 0,
    totalPages: entry.totalPages ?? 0,
    updatedAt: BigInt(Math.round(entry.updatedAt ?? Date.now())),
  };
}

@Injectable()
export class ReadingHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: number): Promise<{ entries: ReadingEntry[] }> {
    const rows = await this.prisma.readingHistory.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: READING_HISTORY_LIMIT,
    });
    return { entries: rows.map(toReadingEntry) };
  }

  async upsert(userId: number, entry: ReadingEntryDto): Promise<{ entry: ReadingEntry }> {
    const key = {
      userId,
      provider: entry.provider,
      mediaId: entry.id,
      chapter: entry.chapter ?? 0,
    };
    const columns = readingColumns(entry);
    const row = await this.prisma.readingHistory.upsert({
      where: { userId_provider_mediaId_chapter: key },
      create: { userId, ...columns },
      update: columns,
    });
    return { entry: toReadingEntry(row) };
  }

  /** Bulk upsert (local reading-history upload); all-or-nothing in one transaction. */
  async importMany(userId: number, entries: ReadingEntryDto[]): Promise<{ count: number }> {
    if (entries.length > 0) {
      await this.prisma.$transaction(
        entries.map((entry) =>
          this.prisma.readingHistory.upsert({
            where: {
              userId_provider_mediaId_chapter: {
                userId,
                provider: entry.provider,
                mediaId: entry.id,
                chapter: entry.chapter ?? 0,
              },
            },
            create: { userId, ...readingColumns(entry) },
            update: readingColumns(entry),
          }),
        ),
      );
    }
    return { count: entries.length };
  }

  async remove(userId: number, query: ReadingHistoryKeyQueryDto): Promise<void> {
    const mediaId = query.id ?? query.mediaId;
    if (!mediaId) throw new BadRequestException('id is required');
    await this.prisma.readingHistory.deleteMany({
      where: {
        userId,
        provider: query.provider,
        mediaId,
        chapter: query.chapter ?? 0,
      },
    });
  }
}