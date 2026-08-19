import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { REVIEW_OUTCOME, REVIEW_TYPE, type ReviewOutcome, type ReviewType } from '@hsdg/contracts';

class ReviewPointInputDto {
  @ApiProperty({ description: 'The matter raised in this review.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  matter!: string;

  @ApiPropertyOptional({ description: 'Flag a key/high-risk matter (key-matter review).' })
  @IsOptional()
  @IsBoolean()
  isKeyMatter?: boolean;
}

/** Record a manager or EP review (the terminal sign-off has its own endpoint). */
export class RecordReviewDto {
  @ApiProperty({ enum: [REVIEW_TYPE.managerReview, REVIEW_TYPE.epReview] })
  @IsIn([REVIEW_TYPE.managerReview, REVIEW_TYPE.epReview])
  reviewType!: Extract<ReviewType, 'manager_review' | 'ep_review'>;

  @ApiProperty({ enum: [REVIEW_OUTCOME.cleared, REVIEW_OUTCOME.returned] })
  @IsIn([REVIEW_OUTCOME.cleared, REVIEW_OUTCOME.returned])
  outcome!: Extract<ReviewOutcome, 'cleared' | 'returned'>;

  @ApiPropertyOptional({ description: 'Reviewer notes recorded in the review trail.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ type: [ReviewPointInputDto], description: 'Review points raised.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReviewPointInputDto)
  reviewPoints?: ReviewPointInputDto[];

  @ApiPropertyOptional({
    description: 'Expected current version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
