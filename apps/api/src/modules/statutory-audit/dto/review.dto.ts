import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  REVIEW_DECISION,
  REVIEW_LEVEL,
  REVIEW_TARGET_TYPE,
  type ReviewDecision,
  type ReviewLevel,
  type ReviewTargetType,
} from '@hsdg/contracts';

/** Raise a review note on a professional object (§344). */
export class RaiseReviewNoteDto {
  @ApiProperty({ enum: Object.values(REVIEW_TARGET_TYPE) })
  @IsIn(Object.values(REVIEW_TARGET_TYPE))
  targetType!: ReviewTargetType;

  @ApiProperty({ description: 'The procedure / audit area / evidence under review.' })
  @IsUUID()
  targetId!: string;

  @ApiProperty({ description: "The reviewer's comment requiring response/clearance." })
  @IsString()
  @MaxLength(4000)
  body!: string;

  @ApiPropertyOptional({ description: 'A blocking open note prevents completion (§29).' })
  @IsOptional()
  @IsBoolean()
  isBlocking?: boolean;

  @ApiPropertyOptional({
    enum: Object.values(REVIEW_LEVEL),
    description: 'Override the level; defaults to the target reviewer (partner if EP).',
  })
  @IsOptional()
  @IsIn(Object.values(REVIEW_LEVEL))
  reviewLevel?: ReviewLevel;
}

/** Edit a review note (PATCH semantics; version required). */
export class UpdateReviewNoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isBlocking?: boolean;

  @ApiPropertyOptional({ enum: Object.values(REVIEW_LEVEL) })
  @IsOptional()
  @IsIn(Object.values(REVIEW_LEVEL))
  reviewLevel?: ReviewLevel;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** The preparer's response to an open note (§344). */
export class RespondReviewNoteDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  response!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** Clear a review note — reviewer accepted/closed the point (§25). */
export class ClearReviewNoteDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** A reviewer's one-click decision on a queued procedure or area. */
export class ReviewDecisionDto {
  @ApiProperty({ enum: ['procedure', 'work_area'] })
  @IsIn(['procedure', 'work_area'])
  targetType!: ReviewTargetType;

  @ApiProperty()
  @IsUUID()
  targetId!: string;

  @ApiProperty({ enum: Object.values(REVIEW_DECISION) })
  @IsIn(Object.values(REVIEW_DECISION))
  decision!: ReviewDecision;

  @ApiPropertyOptional({ description: 'Return: what the preparer needs to do.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;

  @ApiPropertyOptional({ description: 'Return: also raise the notes the file suggests.' })
  @IsOptional()
  @IsBoolean()
  raiseSuggested?: boolean;
}

/** Raise the suggested notes on a queued item (all, or the keys given). */
export class RaiseSuggestedNotesDto {
  @ApiProperty()
  @IsUUID()
  targetId!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  sourceKeys?: string[];
}

/** Never offer a suggested note again on this file. */
export class DismissSuggestionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  sourceKey!: string;
}
