import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { PROVIDER_IDS, REGION_IDS } from '../../common/account.types';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;
}

export class SubStyleDto {
  @IsOptional()
  @IsIn(['sans', 'serif', 'mono', 'anime'])
  font?: string;

  @IsOptional()
  @IsIn(['normal', 'bold'])
  weight?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2)
  scale?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  stroke?: string;

  @IsOptional()
  @IsString()
  shadow?: string;

  @IsOptional()
  @IsString()
  bg?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  bgOpacity?: number;

  @IsOptional()
  @IsNumber()
  yOffset?: number;
}

export class PlayerPrefsDto {
  @IsOptional()
  @IsIn([5, 10, 15, 30, 60])
  seekStep?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.25)
  @Max(3)
  playbackRate?: number;

  @IsOptional()
  @IsBoolean()
  autoplay?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prefSubLang?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prefAudioLang?: string[];

  @IsOptional()
  @IsIn(['contain', 'cover', 'fill'])
  aspectMode?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SubStyleDto)
  subStyle?: SubStyleDto;
}

export class UpdateSettingsDto {
  @IsOptional()
  @IsIn(REGION_IDS)
  region?: string;

  @IsOptional()
  @IsIn(PROVIDER_IDS)
  provider?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PlayerPrefsDto)
  player?: PlayerPrefsDto;
}
