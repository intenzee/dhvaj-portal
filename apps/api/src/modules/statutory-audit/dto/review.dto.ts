import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
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
  REVIEW_LEVEL,
  REVIEW_TARGET_TYPE,
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
