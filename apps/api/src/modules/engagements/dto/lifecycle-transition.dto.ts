import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

/** Generic body for a lifecycle action with no extra requirements beyond an optional reason. */
export class LifecycleTransitionDto {
  @ApiPropertyOptional({ description: 'Reason recorded in the lifecycle history / audit trail.' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Expected current version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

/** put-on-hold: reason is mandatory (§11 — the hold must be explained). */
export class PutOnHoldDto {
  @ApiProperty({ description: 'Why the engagement is being put on hold.' })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Optional expected resume date.' })
  @IsOptional()
  @IsDateString()
  expectedResumeDate?: string;

  @ApiPropertyOptional({
    description: 'Expected current version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

/** reopen: MP-only governance action; reason is mandatory (§12). */
export class ReopenEngagementDto {
  @ApiProperty({ description: 'Why the engagement is being reopened.' })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({
    description: 'Expected current version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

/** Service-workflow transition (§16-19) — distinct from the engagement lifecycle. */
export class WorkflowTransitionDto {
  @ApiProperty({
    example: 'advance',
    description: 'The workflow-transition action key (from hsdg.workflow_transitions).',
  })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,40}$/, { message: 'action must be a lowercase snake_case key' })
  action!: string;

  @ApiPropertyOptional({
    description: 'Expected current version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
