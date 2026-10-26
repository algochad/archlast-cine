import { BadRequestException, Injectable } from '@nestjs/common';
import type { MediaType, MyListItem } from '../common/account.types';
import { PrismaService } from '../prisma/prisma.service';
import type { MyListItemDto, MyListKeyQueryDto } from './dto/my-list.dto';

interface MyListRow {
  provider: string;
  mediaId: string;
  title: string;
  poster: string | null;
  mediaType: string;
  year: string | null;
  addedAt: bigint;
}

function toMyListItem(row: MyListRow): MyListItem {
  return {
    provider: row.provider,
    id: row.mediaId,
    title: row.title,
    poster: row.poster,
    mediaType: row.mediaType as MediaType,
    year: row.year,
    // BigInt ms -> number (safe: < 2^53).
    addedAt: Number(row.addedAt),
  };
}

@Injectable()
export class MyListService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: number): Promise<{ items: MyListItem[] }> {
    const rows = await this.prisma.myList.findMany({
      where: { userId },
      orderBy: { addedAt: 'desc' },
    });
    return { items: rows.map(toMyListItem) };
  }

  /** Idempotent add: re-adding refreshes metadata but keeps the original addedAt. */
  async add(userId: number, item: MyListItemDto): Promise<{ item: MyListItem }> {
    const metadata = {
      title: item.title,
      poster: item.poster ?? null,
      mediaType: item.mediaType,
      year: item.year ?? null,
    };
    const row = await this.prisma.myList.upsert({
      where: {
        userId_provider_mediaId: { userId, provider: item.provider, mediaId: item.id },
      },
      create: {
        userId,
        provider: item.provider,
        mediaId: item.id,
        ...metadata,
        addedAt: BigInt(Math.round(item.addedAt ?? Date.now())),
      },
      update: metadata,
    });
    return { item: toMyListItem(row) };
  }

  async remove(userId: number, query: MyListKeyQueryDto): Promise<void> {
    const mediaId = query.id ?? query.mediaId;
    if (!mediaId) throw new BadRequestException('id is required');
    await this.prisma.myList.deleteMany({ where: { userId, provider: query.provider, mediaId } });
  }
}
