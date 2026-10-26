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
import type { WatchEntry } from '../common/account.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/jwt-payload';
import { HistoryKeyQueryDto, ImportHistoryDto, PostHistoryDto } from './dto/history.dto';
import { HistoryService } from './history.service';

@Controller('v1/me/history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<{ entries: WatchEntry[] }> {
    return this.history.list(user.id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  upsert(
    @CurrentUser() user: AuthUser,
    @Body() dto: PostHistoryDto,
  ): Promise<{ entry: WatchEntry }> {
    return this.history.upsert(user.id, dto.entry);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  import(
    @CurrentUser() user: AuthUser,
    @Body() dto: ImportHistoryDto,
  ): Promise<{ count: number }> {
    return this.history.importMany(user.id, dto.entries);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Query() query: HistoryKeyQueryDto): Promise<void> {
    return this.history.remove(user.id, query);
  }
}
