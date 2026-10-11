import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  PLANNING_ATTENTIONS,
  PLANNING_DESTINATIONS,
  PLANNING_RULE_TRIGGER_SOURCES,
  type CreatePlanningSignalRuleVersionInput,
  type PlanningAttention,
  type PlanningDestination,
  type PlanningRuleTriggerSource,
} from '@hsdg/contracts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Append a version to a Planning Signal Library rule (03.1 §21). */
export class CreatePlanningSignalRuleVersionDto implements CreatePlanningSignalRuleVersionInput {
  @ApiProperty({ example: 'PSR-027' })
  @Matches(/^PSR-[0-9]{3}$/, { message: 'ruleCode must look like PSR-001.' })
  ruleCode!: string;

  @ApiPropertyOptional({ description: 'Required for a new rule code; fixed afterwards.' })
  @IsOptional()
  @Matches(/^[a-z0-9_]{2,60}$/, { message: 'ruleKey must be lower_snake_case.' })
  ruleKey?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: PLANNING_RULE_TRIGGER_SOURCES })
  @IsIn(PLANNING_RULE_TRIGGER_SOURCES)
  triggerSource!: PlanningRuleTriggerSource;

  @ApiProperty({ example: '02.6' })
  @Matches(/^[0-9]{2}\.[0-9]{1,2}$/, { message: 'triggerSection must look like 02.6.' })
  triggerSection!: string;

  @ApiProperty({ description: 'JSON condition over the Planning Facts map.' })
  @IsObject()
  triggerCondition!: Record<string, unknown>;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  observationTemplate!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  whyMayMatter!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  potentialImplications!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(/^[a-z0-9_]{2,60}$/, { each: true })
  guidanceAnchors?: string[];

  @ApiPropertyOptional({ enum: PLANNING_DESTINATIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(PLANNING_DESTINATIONS, { each: true })
  destinations?: PlanningDestination[];

  @ApiProperty({ enum: PLANNING_ATTENTIONS })
  @IsIn(PLANNING_ATTENTIONS)
  suggestedAttention!: PlanningAttention;

  @ApiPropertyOptional({ nullable: true, example: 'framework:02.6' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^[a-z_]+:[A-Za-z0-9_.-]+$/, { message: 'sourceLink must look like framework:02.6.' })
  sourceLink?: string | null;

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
