import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AGGREGATION_FACTOR_KEYS,
  BENCHMARK_ASSESSMENTS,
  MAT04_ANSWERS,
  MAT06_ANSWERS,
  MAT07_ANSWERS,
  MAT08_ANSWERS,
  MATERIALITY_BENCHMARKS,
  PCT_FACTOR_KEYS,
  PRINCIPAL_USERS,
  QUALITATIVE_RESPONSES,
  REVISION_TRIGGERS,
  SPECIFIC_SCOPE_TYPES,
  SPECIFIC_THRESHOLD_TYPES,
  USER_FOCUS_MEASURES,
  type BenchmarkAssessment,
  type Mat04Answer,
  type Mat06Answer,
  type Mat07Answer,
  type Mat08Answer,
  type MaterialityBenchmark,
  type PrincipalUser,
  type QualitativeResponse,
  type RevisionTrigger,
  type SpecificScopeType,
  type SpecificThresholdType,
  type UserFocusMeasure,
} from '@hsdg/contracts';

const AMOUNT = { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false } as const;
const PCT = { maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false } as const;
const TEXT = 4000;

/** 03.3 determination — partial update of the current draft (MAT-01…MAT-08). */
export class UpdateMaterialityDto {
  @ApiPropertyOptional({ enum: PRINCIPAL_USERS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRINCIPAL_USERS.length)
  @IsIn(PRINCIPAL_USERS, { each: true })
  principalUsers?: PrincipalUser[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) principalUsersOther?:
    string | null;

  @ApiPropertyOptional({ enum: USER_FOCUS_MEASURES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(USER_FOCUS_MEASURES.length)
  @IsIn(USER_FOCUS_MEASURES, { each: true })
  userFocus?: UserFocusMeasure[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) userFocusOther?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsNumber(AMOUNT) @Min(0.01) pyOverallMateriality?:
    number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber(AMOUNT) @Min(0.01) pyPerformanceMateriality?:
    number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber(AMOUNT) @Min(0.01) pyClearlyTrivial?:
    number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) pyBenchmark?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) pySource?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) pyAuditDifferences?:
    string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) normalisationRationale?:
    string | null;

  @ApiPropertyOptional({ enum: MATERIALITY_BENCHMARKS })
  @IsOptional()
  @IsIn(MATERIALITY_BENCHMARKS)
  selectedBenchmark?: MaterialityBenchmark | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) otherBenchmarkLabel?:
    string | null;

  @ApiPropertyOptional({ description: 'Dataset units (03.2.7).' })
  @IsOptional()
  @IsNumber(AMOUNT)
  @Min(0.01)
  otherBenchmarkAmount?: number | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) otherBenchmarkSource?:
    string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) benchmarkRationale?:
    string | null;

  @ApiPropertyOptional({ description: 'Selected % of the benchmark (auditor judgment).' })
  @IsOptional()
  @IsNumber(PCT)
  @Min(0.0001)
  @Max(100)
  selectedPct?: number | null;

  @ApiPropertyOptional({ description: 'Rupees.' })
  @IsOptional()
  @IsNumber(AMOUNT)
  @Min(0.01)
  selectedOm?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) omAdjustmentReason?:
    string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) omOverrideReason?:
    string | null;

  @ApiPropertyOptional({ enum: PCT_FACTOR_KEYS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(PCT_FACTOR_KEYS, { each: true })
  pctFactorsConsidered?: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) pctFactorsNote?: string | null;

  @ApiPropertyOptional({ enum: MAT04_ANSWERS })
  @IsOptional()
  @IsIn(MAT04_ANSWERS)
  mat04?: Mat04Answer | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) mat04Rationale?: string | null;

  @ApiPropertyOptional({ enum: AGGREGATION_FACTOR_KEYS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(AGGREGATION_FACTOR_KEYS, { each: true })
  aggregationFactors?: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) aggregationOther?:
    string | null;

  @ApiPropertyOptional({ description: 'PM as % of OM (auditor judgment).' })
  @IsOptional()
  @IsNumber(PCT)
  @Min(0.0001)
  @Max(99.9999)
  pmPct?: number | null;

  @ApiPropertyOptional({ description: 'Rupees.' })
  @IsOptional()
  @IsNumber(AMOUNT)
  @Min(0.01)
  selectedPm?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) pmAdjustmentReason?:
    string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) pmRationale?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) pmOverrideReason?:
    string | null;

  @ApiPropertyOptional({ enum: MAT06_ANSWERS })
  @IsOptional()
  @IsIn(MAT06_ANSWERS)
  mat06?: Mat06Answer | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) mat06Note?: string | null;

  @ApiPropertyOptional({ description: 'Rupees.' })
  @IsOptional()
  @IsNumber(AMOUNT)
  @Min(0.01)
  selectedCtt?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) cttRationale?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) cttOverrideReason?:
    string | null;

  @ApiPropertyOptional({ enum: MAT07_ANSWERS })
  @IsOptional()
  @IsIn(MAT07_ANSWERS)
  mat07?: Mat07Answer | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) mat07Note?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) conclusionSummary?:
    string | null;

  @ApiPropertyOptional({ enum: MAT08_ANSWERS })
  @IsOptional()
  @IsIn(MAT08_ANSWERS)
  mat08?: Mat08Answer | null;

  @ApiPropertyOptional({
    description: 'Re-take the benchmark snapshot after 03.2 figures changed.',
  })
  @IsOptional()
  @IsBoolean()
  reconfirmSource?: boolean;

  @ApiProperty({ description: '0 when creating v1.0.' })
  @IsInt()
  @Min(0)
  version!: number;
}

export class AssessBenchmarkDto {
  @ApiProperty({ enum: BENCHMARK_ASSESSMENTS })
  @IsIn(BENCHMARK_ASSESSMENTS)
  assessment!: BenchmarkAssessment;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) rationale?: string | null;

  @ApiProperty({ description: '0 when first assessed.' })
  @IsInt()
  @Min(0)
  version!: number;
}

export class NormalisationAdjustmentDto {
  @ApiProperty() @IsString() @MaxLength(500) description!: string;

  @ApiProperty({ description: 'Dataset units; + or −.' })
  @IsNumber(AMOUNT)
  amount!: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) reason?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() recurring?: boolean;
  @ApiPropertyOptional({ description: 'Evidence reference (SharePoint link / document).' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  evidence?: string | null;

  @ApiPropertyOptional({ description: 'Required on update.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class SpecificMaterialityDto {
  @ApiProperty({ enum: SPECIFIC_SCOPE_TYPES })
  @IsIn(SPECIFIC_SCOPE_TYPES)
  scopeType!: SpecificScopeType;

  @ApiProperty() @IsString() @MaxLength(500) scope!: string;

  @ApiProperty({ enum: SPECIFIC_THRESHOLD_TYPES })
  @IsIn(SPECIFIC_THRESHOLD_TYPES)
  thresholdType!: SpecificThresholdType;

  @ApiPropertyOptional({ description: 'Rupees.' })
  @IsOptional()
  @IsNumber(AMOUNT)
  @Min(0.01)
  amount?: number | null;
  @ApiPropertyOptional({ description: 'Rupees.' })
  @IsOptional()
  @IsNumber(AMOUNT)
  @Min(0.01)
  specificPm?: number | null;
  @ApiProperty() @IsString() @MaxLength(TEXT) reason!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  affectedAreas?: string[];

  @ApiPropertyOptional({ description: 'Required on update.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class SaveQualitativeDto {
  @ApiProperty({ enum: QUALITATIVE_RESPONSES })
  @IsIn(QUALITATIVE_RESPONSES)
  response!: QualitativeResponse;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) note?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() signalId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() focusId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() significant?: boolean;

  @ApiProperty({ description: '0 when first answered.' })
  @IsInt()
  @Min(0)
  version!: number;
}

export class StartRevisionDto {
  @ApiProperty({ enum: REVISION_TRIGGERS })
  @IsIn(REVISION_TRIGGERS)
  trigger!: RevisionTrigger;

  @ApiProperty() @IsString() @MaxLength(TEXT) reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) revisionDate?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerEmployeeId?: string | null;
}

export class UpdateRevisionItemDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerEmployeeId?: string | null;

  @ApiPropertyOptional({ enum: ['open', 'resolved'] })
  @IsOptional()
  @IsIn(['open', 'resolved'])
  status?: 'open' | 'resolved';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(TEXT) resolution?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
