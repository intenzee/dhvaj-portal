import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { COMPLETION_ITEM_STATE, type CompletionItemState } from '@hsdg/contracts';

/** Update a Completion / Reporting checklist item (§27.07/§27.08; version required). */
export class UpdateCompletionItemDto {
  @ApiPropertyOptional({ enum: Object.values(COMPLETION_ITEM_STATE) })
  @IsOptional()
  @IsIn(Object.values(COMPLETION_ITEM_STATE))
  state?: CompletionItemState;

  @ApiPropertyOptional({ description: 'Professional note / conclusion for the item.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** Approve Completion, sign off, or archive — each takes an optional free-text memo. */
export class CompletionMemoDto {
  @ApiPropertyOptional({ description: 'Optional memo / note recorded with the action.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  memo?: string | null;
}

/** Archive the audit file — optional closing note (§27.10). */
export class ArchiveFileDto {
  @ApiPropertyOptional({ description: 'Optional archive note.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;
}
