import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  AF01_DECISION,
  AF02_DECISION,
  FRAMEWORK_SOURCE_SECTIONS,
  type Af01Decision,
  type Af02Decision,
  type FrameworkSourceSection,
} from '@hsdg/contracts';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One AF-01 "No – Further Work Required" item: the source section to fix. */
export class FrameworkReturnItemDto {
  @ApiProperty({ enum: FRAMEWORK_SOURCE_SECTIONS })
  @IsIn(FRAMEWORK_SOURCE_SECTIONS)
  section!: FrameworkSourceSection;

  @ApiProperty({ description: 'The further work required in that section.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  action!: string;

  @ApiPropertyOptional({ description: 'Who must address it.' })
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;
}

/** AF-01 — Manager review: submit for Partner approval or return for further work. */
export class ConfirmFrameworkDto {
  @ApiProperty({ enum: Object.values(AF01_DECISION) })
  @IsIn(Object.values(AF01_DECISION))
  decision!: Af01Decision;

  @ApiPropertyOptional({ description: 'Optional Manager review note.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @ApiPropertyOptional({ description: 'The Downstream Configuration Preview was reviewed (§11).' })
  @IsOptional()
  @IsBoolean()
  previewReviewed?: boolean;

  @ApiPropertyOptional({ type: [FrameworkReturnItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FrameworkReturnItemDto)
  returnItems?: FrameworkReturnItemDto[];

  @ApiProperty({ description: 'Baseline record version last seen (0 when none exists yet).' })
  @IsInt()
  @Min(0)
  recordVersion!: number;
}

/** One Approve-Subject-to-Conditions condition (§12). */
export class FrameworkConditionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  condition!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate!: string;

  @ApiProperty({ description: 'Impact if the condition is not met.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  impact!: string;

  @ApiProperty({ description: 'May Planning commence before the condition is resolved?' })
  @IsBoolean()
  planningMayCommence!: boolean;
}

/** AF-02 — Engagement Partner conclusion. */
export class ApproveFrameworkDto {
  @ApiProperty({ enum: Object.values(AF02_DECISION) })
  @IsIn(Object.values(AF02_DECISION))
  decision!: Af02Decision;

  @ApiPropertyOptional({ description: 'Methodology version label to freeze.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  methodologyVersion?: string;

  @ApiPropertyOptional({ type: [FrameworkConditionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FrameworkConditionDto)
  conditions?: FrameworkConditionDto[];

  @ApiPropertyOptional({ description: 'Return for Further Work: the reason.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  returnReason?: string;

  @ApiPropertyOptional({ enum: FRAMEWORK_SOURCE_SECTIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(FRAMEWORK_SOURCE_SECTIONS, { each: true })
  returnSections?: FrameworkSourceSection[];

  @ApiProperty({ description: 'Baseline record version last seen.' })
  @IsInt()
  @Min(1)
  recordVersion!: number;
}

/** Controlled reopen (§15) — preserves the approved baseline, opens the next version. */
export class ReopenFrameworkDto {
  @ApiProperty({ description: 'Why the approved framework is being reopened (audited).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;

  @ApiProperty({ enum: FRAMEWORK_SOURCE_SECTIONS, isArray: true })
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(FRAMEWORK_SOURCE_SECTIONS, { each: true })
  affectedSections!: FrameworkSourceSection[];

  @ApiProperty({ description: 'When the new fact was identified (ISO 8601).' })
  @IsISO8601()
  identifiedAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  identifiedByEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  evidenceNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  evidenceDocumentId?: string;

  @ApiProperty()
  @IsBoolean()
  reapprovalRequired!: boolean;

  @ApiProperty({ description: 'Baseline record version last seen.' })
  @IsInt()
  @Min(1)
  recordVersion!: number;
}

/** Clear a returned item / resolve an approval condition. */
export class ResolveFrameworkItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  resolution!: string;
}
