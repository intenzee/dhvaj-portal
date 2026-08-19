import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { REVIEW_MODELS, type ReviewModelSlug } from '@hsdg/contracts';

/**
 * Escalate the engagement's review plan. The chosen model must be at least as
 * rigorous as the service requires — the database enforces escalate-only.
 */
export class SetReviewPlanDto {
  @ApiProperty({ enum: REVIEW_MODELS })
  @IsIn(REVIEW_MODELS)
  reviewModelSlug!: ReviewModelSlug;

  @ApiPropertyOptional({
    description: 'Expected current version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
