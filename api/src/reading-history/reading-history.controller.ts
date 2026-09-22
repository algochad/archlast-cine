import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import type { ReadingEntry } from '../common/account.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/jwt-payload';
import {
  ImportReadingHistoryDto,
  PostReadingHistoryDto,
  ReadingHistoryKeyQueryDto,
} from './dto/reading-history.dto';
import { ReadingHistoryService } from './reading-history.service';

@Controller('v1/me/reading-history')
export class ReadingHistoryController {
  constructor(private readonly readingHistory: ReadingHistoryService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<{ entries: ReadingEntry[] }> {
    return this.readingHistory.list(user.id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  upsert(
    @CurrentUser() user: AuthUser,
    @Body() dto: PostReadingHistoryDto,
  ): Promise<{ entry: ReadingEntry }> {
    return this.readingHistory.upsert(user.id, dto.entry);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  import(
    @CurrentUser() user: AuthUser,
    @Body() dto: ImportReadingHistoryDto,
  ): Promise<{ count: number }> {
    return this.readingHistory.importMany(user.id, dto.entries);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Query() query: ReadingHistoryKeyQueryDto,
  ): Promise<void> {
    return this.readingHistory.remove(user.id, query);
  }
}