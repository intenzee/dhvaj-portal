import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ACCOUNTING_ENVIRONMENTS,
  PROFILE_FINANCIAL_PARAMETERS,
  PROFILE_FINANCIAL_SOURCES,
  SPECIAL_ENTITY_TYPES,
  type AccountingEnvironment,
  type ProfileFinancialParameter,
  type ProfileFinancialSource,
  type SpecialEntityType,
} from '@hsdg/contracts';

/** Update the professional facts captured on the 02.1 profile (Cards B/G/H/I). */
export class UpdateEntityProfileDto {
  @ApiPropertyOptional({ enum: SPECIAL_ENTITY_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(SPECIAL_ENTITY_TYPES, { each: true })
  specialEntityTypes?: SpecialEntityType[];

  @ApiPropertyOptional({ description: 'First-year audit — overrides the system-derived value.' })
  @IsOptional()
  @IsBoolean()
  initialAudit?: boolean;

  @ApiPropertyOptional({ description: 'Joint audit — drives SA 299.' })
  @IsOptional()
  @IsBoolean()
  jointAudit?: boolean;

  @ApiPropertyOptional({ enum: ACCOUNTING_ENVIRONMENTS, nullable: true })
  @IsOptional()
  @IsIn(ACCOUNTING_ENVIRONMENTS)
  accountingEnvironment?: AccountingEnvironment | null;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen for the profile.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Capture one financial parameter (current + prior FY) — guide §9.1 Card D. */
export class CaptureProfileFinancialDto {
  @ApiProperty({ enum: PROFILE_FINANCIAL_PARAMETERS })
  @IsIn(PROFILE_FINANCIAL_PARAMETERS)
  parameter!: ProfileFinancialParameter;

  @ApiPropertyOptional({ description: 'Current-year figure (INR).', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  currentValue?: number | null;

  @ApiPropertyOptional({ description: 'Prior-year figure (INR).', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priorValue?: number | null;

  @ApiPropertyOptional({ enum: PROFILE_FINANCIAL_SOURCES, nullable: true })
  @IsOptional()
  @IsIn(PROFILE_FINANCIAL_SOURCES)
  source?: ProfileFinancialSource | null;

  @ApiPropertyOptional({ description: 'Who prepared the figure.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  preparer?: string | null;

  @ApiPropertyOptional({ description: 'Link an existing document as evidence (never a copy).' })
  @IsOptional()
  @IsUUID()
  documentId?: string | null;
}

/** Confirm the profile — freezes the fact set for 02.2–02.9 (Completion). */
export class ConfirmProfileDto {
  @ApiPropertyOptional({ description: 'Optional note recorded with the confirmation.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}
