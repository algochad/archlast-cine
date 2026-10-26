import { Module } from '@nestjs/common';
import { MyListController } from './my-list.controller';
import { MyListService } from './my-list.service';

@Module({
  controllers: [MyListController],
  providers: [MyListService],
})
export class MyListModule {}
