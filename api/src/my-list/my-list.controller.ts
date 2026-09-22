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
import type { MyListItem } from '../common/account.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/jwt-payload';
import { MyListKeyQueryDto, PostMyListDto } from './dto/my-list.dto';
import { MyListService } from './my-list.service';

@Controller('v1/me/mylist')
export class MyListController {
  constructor(private readonly myList: MyListService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<{ items: MyListItem[] }> {
    return this.myList.list(user.id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  add(@CurrentUser() user: AuthUser, @Body() dto: PostMyListDto): Promise<{ item: MyListItem }> {
    return this.myList.add(user.id, dto.item);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Query() query: MyListKeyQueryDto): Promise<void> {
    return this.myList.remove(user.id, query);
  }
}
