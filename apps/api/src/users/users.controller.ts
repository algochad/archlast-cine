import { Body, Controller, Get, Patch } from '@nestjs/common';
import type { AccountSettings, AccountState, AccountUser } from '../common/account.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/jwt-payload';
import { UpdateSettingsDto, UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('v1/users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  getMe(@CurrentUser() user: AuthUser): Promise<AccountState> {
    return this.users.getState(user.id);
  }

  @Patch()
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateUserDto,
  ): Promise<{ user: AccountUser }> {
    return this.users.updateName(user.id, dto.name);
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateSettingsDto,
  ): Promise<{ settings: AccountSettings }> {
    return this.users.updateSettings(user.id, dto);
  }
}
