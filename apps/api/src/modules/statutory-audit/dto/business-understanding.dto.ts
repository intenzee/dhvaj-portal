import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BA01_ANSWERS,
  DATASET_STATUSES,
  EXPECTATION_BASES,
  EXPECTATION_DIRECTIONS,
  EXPECTATION_TYPES,
  FINANCIAL_UNITS,
  INDUSTRY_PROFILES,
  INVESTIGATION_ASSESSMENTS,
  INVESTIGATION_SIGNAL_DECISIONS,
  METRIC_SOURCE_TYPES,
  type Ba01Answer,
  type DatasetStatus,
  type ExpectationBasis,
  type ExpectationConclusion,
  type ExpectationDirection,
  type ExpectationType,
  type FinancialPeriod,
  type FinancialUnit,
  type IndustryProfile,
  type InvestigationAssessment,
  type InvestigationSignalDecision,
  type MetricSourceType,
  type UnderstandingAnswer,
} from '@hsdg/contracts';

const EXPECTATION_CONCLUSIONS: ExpectationConclusion[] = ['normal', 'explain', 'planning_signal'];
const AMOUNT = { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false } as const;

/** 03.2 record: industry profile, BA-01, conclusion. */
export class UpdateBusinessUnderstandingDto {
  @ApiPropertyOptional({ enum: INDUSTRY_PROFILES })
  @IsOptional()
  @IsIn(INDUSTRY_PROFILES)
  industryProfile?: IndustryProfile;

  @ApiPropertyOptional({ enum: BA01_ANSWERS })
  @IsOptional()
  @IsIn(BA01_ANSWERS)
  ba01?: Ba01Answer;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  conclusionSummary?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** 03.2.1–03.2.6 section. Answer shapes are validated against the field catalogue in the service. */
export class UpdateUnderstandingSectionDto {
  @ApiPropertyOptional({ enum: ['yes', 'no'] })
  @IsOptional()
  @IsIn(['yes', 'no'])
  anythingChanged?: 'yes' | 'no';

  @ApiPropertyOptional({ description: 'Field key → value (string, string[] or string[][]).' })
  @IsOptional()
  @IsObject()
  answers?: Record<string, UnderstandingAnswer>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reviewed?: boolean;

  @ApiProperty({ description: '0 when saving for the first time.' })
  @IsInt()
  @Min(0)
  version!: number;
}

/** 03.2.7 dataset header. */
export class UpdateFinancialDatasetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  periodEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  pyPeriodEnd?: string;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ enum: FINANCIAL_UNITS })
  @IsOptional()
  @IsIn(FINANCIAL_UNITS)
  units?: FinancialUnit;

  @ApiPropertyOptional({ enum: FINANCIAL_UNITS })
  @IsOptional()
  @IsIn(FINANCIAL_UNITS)
  pyUnits?: FinancialUnit;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cySource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pySource?: string;

  @ApiPropertyOptional({ enum: DATASET_STATUSES })
  @IsOptional()
  @IsIn(DATASET_STATUSES)
  dataStatus?: DatasetStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  sourceDate?: string;

  @ApiProperty({ description: '0 when saving for the first time.' })
  @IsInt()
  @Min(0)
  version!: number;
}

export class AddCustomMetricDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  label!: string;
}

export class FinancialValueDto {
  @ApiProperty()
  @IsString()
  @MaxLength(60)
  metricKey!: string;

  @ApiProperty({ enum: ['cy', 'py'] })
  @IsIn(['cy', 'py'])
  period!: FinancialPeriod;

  @ApiProperty({ nullable: true, description: 'null clears the figure.' })
  @IsOptional()
  @IsNumber(AMOUNT)
  @Min(-1e15)
  @Max(1e15)
  amount!: number | null;

  @ApiPropertyOptional({ enum: METRIC_SOURCE_TYPES })
  @IsOptional()
  @IsIn(METRIC_SOURCE_TYPES)
  sourceType?: MetricSourceType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiProperty({ description: '0 for a new figure.' })
  @IsInt()
  @Min(0)
  version!: number;
}

export class SaveFinancialValuesDto {
  @ApiProperty({ type: [FinancialValueDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FinancialValueDto)
  values!: FinancialValueDto[];
}

/** 03.2.9 investigation card. */
export class AssessInvestigationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  managementExplanation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  explanationBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  explanationDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  evidence?: string;

  @ApiPropertyOptional({ enum: INVESTIGATION_ASSESSMENTS })
  @IsOptional()
  @IsIn(INVESTIGATION_ASSESSMENTS)
  assessment?: InvestigationAssessment;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  affectedAreas?: string[];

  @ApiPropertyOptional({ enum: INVESTIGATION_SIGNAL_DECISIONS })
  @IsOptional()
  @IsIn(INVESTIGATION_SIGNAL_DECISIONS)
  signalDecision?: InvestigationSignalDecision;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  linkSignalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  noSignalRationale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  dueDate?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** §14 planning expectation. */
export class CreatePlanningExpectationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(60)
  metricKey!: string;

  @ApiProperty({ enum: EXPECTATION_TYPES })
  @IsIn(EXPECTATION_TYPES)
  expectationType!: ExpectationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber(AMOUNT)
  expectedAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber(AMOUNT)
  expectedLow?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber(AMOUNT)
  expectedHigh?: number;

  @ApiPropertyOptional({ enum: EXPECTATION_DIRECTIONS })
  @IsOptional()
  @IsIn(EXPECTATION_DIRECTIONS)
  expectedDirection?: ExpectationDirection;

  @ApiPropertyOptional({ description: 'Tolerance % used only to suggest investigation.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  tolerancePct?: number;

  @ApiProperty({ enum: EXPECTATION_BASES })
  @IsIn(EXPECTATION_BASES)
  basis!: ExpectationBasis;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  basisNote?: string;
}

export class UpdatePlanningExpectationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresInvestigation?: boolean;

  @ApiPropertyOptional({ enum: EXPECTATION_CONCLUSIONS })
  @IsOptional()
  @IsIn(EXPECTATION_CONCLUSIONS)
  conclusion?: ExpectationConclusion;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
