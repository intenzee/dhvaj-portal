import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  ANALYTICS_RULE_KINDS,
  ATTENTION_PARAMETER_TYPES,
  DATASET_STATUSES,
  FINANCE_COST_BASES,
  METRIC_SOURCE_TYPES,
  METRIC_VALUE_TYPES,
  PLANNING_ATTENTIONS,
  type AnalyticsRuleDefinition,
  type AnalyticsRuleKind,
  type AttentionParameterType,
  type CreateAnalyticsMetricVersionInput,
  type CreateAnalyticsProfileVersionInput,
  type CreateAnalyticsRuleVersionInput,
  type DatasetStatus,
  type FinanceCostBasis,
  type MetricSourceType,
  type MetricValueType,
  type PlanningAttention,
} from '@hsdg/contracts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z0-9_]{2,60}$/;
const PROFILE_KEY = /^[a-z0-9_]{2,40}$/;

/** Versioning fields every library append carries (03.2 §23). */
class AnalyticsLibraryVersionDto {
  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @Matches(DATE, { message: 'effectiveFrom must be YYYY-MM-DD.' })
  effectiveFrom?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE, { message: 'effectiveTo must be YYYY-MM-DD.' })
  effectiveTo?: string | null;

  @ApiPropertyOptional({
    description: 'false retires / disables the item from its effective date.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  methodologyVersion?: string;

  @ApiProperty({ description: 'Why this version exists (audit trail).' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  changeNote!: string;
}

/** Append a version of a canonical metric definition. */
export class CreateAnalyticsMetricVersionDto
  extends AnalyticsLibraryVersionDto
  implements CreateAnalyticsMetricVersionInput
{
  @ApiProperty({ example: 'order_book' })
  @Matches(/^[a-z][a-z0-9_]{1,59}$/, { message: 'metricKey must be lower_snake_case.' })
  metricKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: METRIC_VALUE_TYPES })
  @IsIn(METRIC_VALUE_TYPES)
  valueType!: MetricValueType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  core?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Industry profile keys; empty = every profile.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @Matches(PROFILE_KEY, { each: true })
  appliesTo?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

/** Append a version of an industry analytics profile (§17). */
export class CreateAnalyticsProfileVersionDto
  extends AnalyticsLibraryVersionDto
  implements CreateAnalyticsProfileVersionInput
{
  @ApiProperty({ example: 'hospitality' })
  @Matches(PROFILE_KEY, { message: 'profileKey must be lower_snake_case (2–40 characters).' })
  profileKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  subIndustries?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  considerations?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  averageBalances?: boolean;

  @ApiProperty({ type: [String], example: ['total_borrowings'] })
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(KEY, { each: true })
  debtMetrics!: string[];

  @ApiProperty({ enum: FINANCE_COST_BASES })
  @IsIn(FINANCE_COST_BASES)
  financeCostBasis!: FinanceCostBasis;

  @ApiProperty({ type: [String], example: ['cost_of_sales', 'purchases'] })
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(KEY, { each: true })
  inventoryCostBases!: string[];

  @ApiProperty({ type: [String], example: ['purchases', 'cost_of_sales'] })
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(KEY, { each: true })
  payableCostBases!: string[];

  @ApiPropertyOptional({ nullable: true, example: 'revenue' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(KEY)
  inventoryTrendFallback?: string | null;
}

/** Append a version of an analytics rule (ratio or attention rule, §12 / §15). */
export class CreateAnalyticsRuleVersionDto
  extends AnalyticsLibraryVersionDto
  implements CreateAnalyticsRuleVersionInput
{
  @ApiProperty({ example: 'PAR-058' })
  @Matches(/^PAR-[0-9]{3}$/, { message: 'ruleCode must look like PAR-001.' })
  ruleCode!: string;

  @ApiPropertyOptional({ description: 'Required for a new rule code; fixed afterwards.' })
  @IsOptional()
  @Matches(/^[a-z0-9_]{2,80}$/, { message: 'ruleKey must be lower_snake_case.' })
  ruleKey?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: ANALYTICS_RULE_KINDS })
  @IsIn(ANALYTICS_RULE_KINDS)
  kind!: AnalyticsRuleKind;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @Matches(PROFILE_KEY, { each: true })
  appliesTo?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @Matches(PROFILE_KEY, { each: true })
  excludedFor?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(KEY, { each: true })
  requiredMetrics?: string[];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  formula!: string;

  @ApiProperty({ description: 'Kind-specific definition (validated against the library).' })
  @IsObject()
  definition!: AnalyticsRuleDefinition;

  @ApiPropertyOptional({ enum: ATTENTION_PARAMETER_TYPES, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(ATTENTION_PARAMETER_TYPES)
  parameterType?: AttentionParameterType | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  parameterValue?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  enhancedAt?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  immediateAt?: number | null;

  @ApiPropertyOptional({ enum: DATASET_STATUSES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(DATASET_STATUSES, { each: true })
  minDataStatus?: DatasetStatus[];

  @ApiPropertyOptional({ enum: METRIC_SOURCE_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(METRIC_SOURCE_TYPES, { each: true })
  minSourceTypes?: MetricSourceType[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  signalWording?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  whyMayMatter?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  affectedAreas?: string[];

  @ApiPropertyOptional({ enum: PLANNING_ATTENTIONS })
  @IsOptional()
  @IsIn(PLANNING_ATTENTIONS)
  suggestedAttention?: PlanningAttention;
}
