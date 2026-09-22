import { Module } from '@nestjs/common';
import { ReadingHistoryController } from './reading-history.controller';
import { ReadingHistoryService } from './reading-history.service';

@Module({
  controllers: [ReadingHistoryController],
  providers: [ReadingHistoryService],
})
export class ReadingHistoryModule {}