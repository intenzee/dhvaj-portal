import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ASSERTION_IDS,
  RISK_ASSERTION,
  RISK_RATING,
  RISK_SOURCE,
  RISK_STATUS,
  type AssertionId,
  type RiskAssertion,
  type RiskRating,
  type RiskSource,
  type RiskStatus,
} from '@hsdg/contracts';

/** Create a risk-register row (§22). */
export class CreateRiskDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  description!: string;

  @ApiProperty({ enum: Object.values(RISK_SOURCE) })
  @IsIn(Object.values(RISK_SOURCE))
  source!: RiskSource;

  @ApiPropertyOptional({ description: 'Financial-statement area, e.g. "Revenue".' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fsArea?: string;

  @ApiPropertyOptional({ enum: Object.values(RISK_ASSERTION) })
  @IsOptional()
  @IsIn(Object.values(RISK_ASSERTION))
  assertion?: RiskAssertion;

  @ApiPropertyOptional({
    description: '03.5 engagement Audit Area the risk sits in (§24 lineage).',
  })
  @IsOptional()
  @IsUUID()
  auditAreaId?: string | null;

  @ApiPropertyOptional({
    enum: ASSERTION_IDS,
    isArray: true,
    description: 'Canonical SA 315 assertion ids (03.5 §15).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(13)
  @IsIn(ASSERTION_IDS, { each: true })
  assertionIds?: AssertionId[];

  @ApiProperty({ enum: Object.values(RISK_RATING) })
  @IsIn(Object.values(RISK_RATING))
  rating!: RiskRating;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isSignificant?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFraudRisk?: boolean;

  @ApiPropertyOptional({ description: 'Planned audit response.' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  response?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewerEmployeeId?: string;

  @ApiPropertyOptional({ enum: Object.values(RISK_STATUS) })
  @IsOptional()
  @IsIn(Object.values(RISK_STATUS))
  status?: RiskStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  conclusion?: string;
}

/** Update a risk-register row — all fields optional; version is required (§22). */
export class UpdateRiskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ enum: Object.values(RISK_SOURCE) })
  @IsOptional()
  @IsIn(Object.values(RISK_SOURCE))
  source?: RiskSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fsArea?: string;

  @ApiPropertyOptional({ enum: Object.values(RISK_ASSERTION) })
  @IsOptional()
  @IsIn(Object.values(RISK_ASSERTION))
  assertion?: RiskAssertion;

  @ApiPropertyOptional({
    description: '03.5 engagement Audit Area the risk sits in (§24 lineage).',
  })
  @IsOptional()
  @IsUUID()
  auditAreaId?: string | null;

  @ApiPropertyOptional({
    enum: ASSERTION_IDS,
    isArray: true,
    description: 'Canonical SA 315 assertion ids (03.5 §15).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(13)
  @IsIn(ASSERTION_IDS, { each: true })
  assertionIds?: AssertionId[];

  @ApiPropertyOptional({ enum: Object.values(RISK_RATING) })
  @IsOptional()
  @IsIn(Object.values(RISK_RATING))
  rating?: RiskRating;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isSignificant?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFraudRisk?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  response?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewerEmployeeId?: string;

  @ApiPropertyOptional({ enum: Object.values(RISK_STATUS) })
  @IsOptional()
  @IsIn(Object.values(RISK_STATUS))
  status?: RiskStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  conclusion?: string;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen for this risk.' })
  @IsInt()
  @Min(1)
  version!: number;
}
