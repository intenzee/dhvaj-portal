import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { ENTITY_STATUSES, PAN_REGEX, type EntityStatus } from '@hsdg/contracts';

/** All fields optional — a partial update. */
export class UpdateEntityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legalName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  displayName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  typeSlug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  officeCode?: string;

  @ApiPropertyOptional({ nullable: true, example: 'AAACA1234A' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(PAN_REGEX, { message: 'pan must be a valid PAN (e.g. AAACA1234A)' })
  pan?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  parentEntityId?: string | null;

  @ApiPropertyOptional({ enum: ENTITY_STATUSES })
  @IsOptional()
  @IsIn(ENTITY_STATUSES)
  status?: EntityStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  incorporationDate?: string | null;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
