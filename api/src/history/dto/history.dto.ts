import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { MEDIA_TYPES, type MediaType } from '../../common/account.types';

/** One watch-progress entry as sent by the web client (see src/lib/account.ts). */
export class WatchEntryDto {
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  poster?: string | null;

  @IsIn(MEDIA_TYPES)
  mediaType!: MediaType;

  @IsOptional()
  @IsString()
  year?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  season?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  episode?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  position?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  duration?: number;

  /** Unix ms; clients omit it — the server stamps arrival time. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  updatedAt?: number;
}

export class PostHistoryDto {
  @ValidateNested()
  @Type(() => WatchEntryDto)
  entry!: WatchEntryDto;
}

export class ImportHistoryDto {
  @IsArray()
  @ArrayMaxSize(5_000)
  @ValidateNested({ each: true })
  @Type(() => WatchEntryDto)
  entries!: WatchEntryDto[];
}

/**
 * DELETE /v1/me/history key. `id` is the live web-client spelling; `mediaId` is
 * the REST-contract spelling — either is accepted, one is required.
 */
export class HistoryKeyQueryDto {
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  id?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  mediaId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  season?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  episode?: number;
}
