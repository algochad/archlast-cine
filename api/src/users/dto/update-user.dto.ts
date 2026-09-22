import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PROVIDER_IDS, REGION_IDS } from '../../common/account.types';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;
}

export class UpdateSettingsDto {
  @IsOptional()
  @IsIn(REGION_IDS)
  region?: string;

  @IsOptional()
  @IsIn(PROVIDER_IDS)
  provider?: string;
}
