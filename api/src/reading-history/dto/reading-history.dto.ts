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

/** One reading-progress entry as sent by the web client (manga reader). */
export class ReadingEntryDto {
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
  chapter?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalPages?: number;

  /** Unix ms; clients omit it — the server stamps arrival time. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  updatedAt?: number;
}

export class PostReadingHistoryDto {
  @ValidateNested()
  @Type(() => ReadingEntryDto)
  entry!: ReadingEntryDto;
}

export class ImportReadingHistoryDto {
  @IsArray()
  @ArrayMaxSize(5_000)
  @ValidateNested({ each: true })
  @Type(() => ReadingEntryDto)
  entries!: ReadingEntryDto[];
}

/**
 * DELETE /v1/me/reading-history key. `id` is the live web-client spelling;
 * `mediaId` is the REST-contract spelling — either is accepted, one is required.
 */
export class ReadingHistoryKeyQueryDto {
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
  chapter?: number;
}