import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { MATTER_STATUSES, type MatterStatus } from '@hsdg/contracts';

/** Update/resolve a matter (assign, transition, resolve, accept) — §10. */
export class UpdateMatterDto {
  @ApiPropertyOptional({ enum: MATTER_STATUSES })
  @IsOptional()
  @IsIn(MATTER_STATUSES)
  status?: MatterStatus;

  @ApiPropertyOptional({
    description: 'Resolution / basis; required when accepting a matter with approval.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  resolution?: string;

  @ApiPropertyOptional({ description: 'Assign an owner (employee id).' })
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;

  @ApiPropertyOptional({ description: 'Due date (ISO-8601 date).' })
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Link an existing document as evidence (never a copy).' })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({ description: 'A free-text note.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @ApiPropertyOptional({ description: 'Optimistic-concurrency version last seen for this matter.' })
  @IsInt()
  @Min(1)
  version!: number;
}
