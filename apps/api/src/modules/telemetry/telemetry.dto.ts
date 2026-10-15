import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  TELEMETRY_BATCH_MAX,
  TELEMETRY_KINDS,
  WORKFLOW_MEASURE,
  WORKFLOW_TARGET_RULES,
  type SaveWorkflowBaselineInput,
  type TelemetryKind,
  type WorkflowMeasureKey,
  type WorkflowTarget,
  type WorkflowTargetRule,
  type WorkflowTargetsUpdate,
} from '@hsdg/contracts';

export class TelemetryEventDto {
  @ApiProperty({ enum: TELEMETRY_KINDS })
  @IsIn(TELEMETRY_KINDS)
  kind!: TelemetryKind;

  @ApiProperty({ example: '/engagements/:id', maxLength: 200 })
  @IsString()
  @Matches(/^\//)
  @MaxLength(200)
  path!: string;

  @ApiProperty({ type: [String], example: ['m', 'part', 'tab'], description: 'Names only' })
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^[A-Za-z0-9_-]{1,40}$/, { each: true })
  params!: string[];

  @ApiPropertyOptional({ example: 'today', nullable: true })
  @IsOptional()
  @Matches(/^[a-z0-9_-]{1,40}$/)
  source?: string | null;

  @ApiProperty({ example: 'k3J9x0aQ2mZ1' })
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  sessionId!: string;

  @ApiPropertyOptional({ example: '2026-10-14T05:30:00.000Z' })
  @IsOptional()
  @IsISO8601()
  at?: string;
}

export class TelemetryBatchDto {
  @ApiProperty({ type: [TelemetryEventDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TELEMETRY_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => TelemetryEventDto)
  events!: TelemetryEventDto[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class WorkflowMeasuresQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-08',
    description: 'First IST day (default: 6 days before `to`)',
  })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-14', description: 'Last IST day (default: today)' })
  @IsOptional()
  @Matches(DAY)
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  officeId?: string;
}

export class SaveWorkflowBaselineDto implements SaveWorkflowBaselineInput {
  @ApiProperty({ example: '2026-09-01', description: 'First IST day' })
  @Matches(DAY)
  from!: string;

  @ApiProperty({ example: '2026-09-30', description: 'Last IST day (today or earlier)' })
  @Matches(DAY)
  to!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Omit for the firm' })
  @IsOptional()
  @IsUUID()
  officeId?: string | null;
}

const MEASURE_KEYS = Object.values(WORKFLOW_MEASURE);

export class WorkflowTargetDto implements WorkflowTarget {
  @ApiProperty({ enum: MEASURE_KEYS })
  @IsIn(MEASURE_KEYS)
  key!: WorkflowMeasureKey;

  @ApiProperty({ enum: WORKFLOW_TARGET_RULES })
  @IsIn(WORKFLOW_TARGET_RULES)
  rule!: WorkflowTargetRule;

  @ApiProperty({ example: -30, description: 'A ceiling or floor, or a change in per cent' })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  value!: number;
}

export class WorkflowTargetsUpdateDto implements WorkflowTargetsUpdate {
  @ApiProperty({ type: [WorkflowTargetDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MEASURE_KEYS.length)
  @ValidateNested({ each: true })
  @Type(() => WorkflowTargetDto)
  items!: WorkflowTargetDto[];
}
