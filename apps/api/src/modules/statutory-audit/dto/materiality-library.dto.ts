import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  MATERIALITY_ATTENTION_CRITERIA,
  MATERIALITY_OVERRIDE_ATTENTIONS,
  MATERIALITY_RULE_KINDS,
  type CreateMaterialityRuleVersionInput,
  type MaterialityAttentionCriterion,
  type MaterialityOverrideAttention,
  type MaterialityRuleKind,
} from '@hsdg/contracts';
import { AnalyticsLibraryVersionDto } from './analytics-library.dto';

const KEY = /^[a-z0-9_]{2,60}$/;

/** Append a version of a Materiality Methodology Library rule (03.3 §8). */
export class CreateMaterialityRuleVersionDto
  extends AnalyticsLibraryVersionDto
  implements CreateMaterialityRuleVersionInput
{
  @ApiProperty({ example: 'MMR-016' })
  @Matches(/^MMR-[0-9]{3}$/, { message: 'ruleCode must look like MMR-001.' })
  ruleCode!: string;

  @ApiProperty({ enum: MATERIALITY_RULE_KINDS })
  @IsIn(MATERIALITY_RULE_KINDS)
  kind!: MaterialityRuleKind;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ nullable: true, example: 'metric:loan_book' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^([a-z_]{3,20}|metric:[a-z][a-z0-9_]{1,59})$/)
  benchmarkKey?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  benchmarkLabel?: string | null;

  @ApiPropertyOptional({ enum: MATERIALITY_ATTENTION_CRITERIA, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(MATERIALITY_ATTENTION_CRITERIA)
  attentionCriterion?: MaterialityAttentionCriterion | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  lowPct?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  highPct?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  parameterValue?: number | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @Matches(KEY, { each: true })
  industryProfiles?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(KEY, { each: true })
  circumstances?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  considerations?: string[];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  sourceBasis!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  provisional?: boolean;

  @ApiPropertyOptional({ enum: MATERIALITY_OVERRIDE_ATTENTIONS })
  @IsOptional()
  @IsIn(MATERIALITY_OVERRIDE_ATTENTIONS)
  overrideAttention?: MaterialityOverrideAttention;
}
