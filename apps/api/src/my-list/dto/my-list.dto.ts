import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { MEDIA_TYPES, type MediaType } from '../../common/account.types';

/** One saved title as sent by the web client (see src/lib/account.ts). */
export class MyListItemDto {
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

  /** Unix ms; the server stamps arrival time when omitted. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  addedAt?: number;
}

export class PostMyListDto {
  @ValidateNested()
  @Type(() => MyListItemDto)
  item!: MyListItemDto;
}

/** DELETE key: `id` (web client) or `mediaId` (REST contract). */
export class MyListKeyQueryDto {
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
}
