import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MERGE_TAKE_FIELDS, type MergeTakeField } from '@hsdg/contracts';

/** POST /entities/:keepId/merge — the client to archive into the kept one. */
export class MergeClientsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  dropId!: string;

  @ApiPropertyOptional({ enum: MERGE_TAKE_FIELDS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MERGE_TAKE_FIELDS.length)
  @IsIn(MERGE_TAKE_FIELDS, { each: true })
  take?: MergeTakeField[];
}

/** POST /entities/duplicates/dismiss — "these two are not the same client". */
export class DismissDuplicateDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  aId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  bId!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
