import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  PLANNING_ATTENTIONS,
  PLANNING_CHANGE_CATEGORIES,
  PLANNING_CONSIDERATION_KINDS,
  type CreatePlanningConsiderationRuleVersionInput,
  type PlanningAttention,
  type PlanningConsiderationKind,
} from '@hsdg/contracts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z0-9_]{2,60}$/;

/** Append a version to a Strategic Consideration Library rule (03.1 §13.2–13.3, §21). */
export class CreatePlanningConsiderationRuleVersionDto implements CreatePlanningConsiderationRuleVersionInput {
  @ApiProperty({ example: 'PCR-018' })
  @Matches(/^PCR-[0-9]{3}$/, { message: 'ruleCode must look like PCR-001.' })
  ruleCode!: string;

  @ApiPropertyOptional({ description: 'Required for a new rule code; fixed afterwards.' })
  @IsOptional()
  @Matches(KEY, { message: 'considerationKey must be lower_snake_case.' })
  considerationKey?: string;

  @ApiProperty({ enum: PLANNING_CONSIDERATION_KINDS })
  @IsIn(PLANNING_CONSIDERATION_KINDS)
  kind!: PlanningConsiderationKind;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @ApiProperty({ description: 'Why the consideration is generated (shown to the Manager).' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  basis!: string;

  @ApiPropertyOptional({ type: [String], description: 'Planning Signal Library rule keys.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @Matches(KEY, { each: true })
  matchRuleKeys?: string[];

  @ApiPropertyOptional({ enum: PLANNING_CHANGE_CATEGORIES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(PLANNING_CHANGE_CATEGORIES, { each: true })
  matchChangeCategories?: string[];

  @ApiPropertyOptional({ enum: PLANNING_ATTENTIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(PLANNING_ATTENTIONS, { each: true })
  matchAttention?: PlanningAttention[];

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @Matches(DATE, { message: 'effectiveFrom must be YYYY-MM-DD.' })
  effectiveFrom?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE, { message: 'effectiveTo must be YYYY-MM-DD.' })
  effectiveTo?: string | null;

  @ApiPropertyOptional({ description: 'false retires the rule from its effective date.' })
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
