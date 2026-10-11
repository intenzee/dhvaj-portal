import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/** 02.8 §7 — the fields 02.8 may record on an aggregated Framework Matter. */
export class UpdateFrameworkMatterDto {
  @ApiPropertyOptional({ description: 'Flag the matter for Engagement Partner attention.' })
  @IsOptional()
  @IsBoolean()
  partnerAttention?: boolean;

  @ApiPropertyOptional({ description: 'Affected framework / downstream work.', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  impact?: string | null;

  @ApiPropertyOptional({ description: 'Resolution (required before closure).', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  resolution?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-10-31' })
  @IsOptional()
  @IsISO8601({ strict: true })
  dueDate?: string | null;
}

/** 02.8 §7 — send a matter back to its originating section (same matter, Under Review). */
export class ReturnFrameworkMatterDto {
  @ApiProperty({ description: 'What the source section must do.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  note!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string | null;
}

/** 02.8 §10 — create the Audit Framework Memorandum from the approved template. */
export class CreateFrameworkMemorandumDto {
  @ApiPropertyOptional({ description: 'A specific template variant (selection rules otherwise).' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_]{1,60}$/)
  variantKey?: string;
}

/** 02.8 §15 — professional confirmation of the system change-impact first pass. */
export class ConfirmFrameworkImpactDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;
}
