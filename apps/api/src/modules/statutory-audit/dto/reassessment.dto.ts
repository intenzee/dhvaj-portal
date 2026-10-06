import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { REASSESSMENT_CHANGE_TYPE, type ReassessmentChangeType } from '@hsdg/contracts';

/** Raise a change-impact / reassessment event (§30). */
export class RaiseReassessmentDto {
  @ApiPropertyOptional({
    enum: Object.values(REASSESSMENT_CHANGE_TYPE),
    description: 'Required unless raising a detected change.',
  })
  @IsOptional()
  @IsIn(Object.values(REASSESSMENT_CHANGE_TYPE))
  changeType?: ReassessmentChangeType;

  @ApiPropertyOptional({
    description:
      'The professional reason for the change (§30). Optional for a detected change — its reason is used.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  reason?: string;

  @ApiPropertyOptional({ description: 'Raise this detected change (from `detections`).' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  detectionKey?: string;
}

/** Never offer a detected change again on this file. */
export class DismissDetectionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(400)
  detectionKey!: string;
}

/** Resolve a reassessment — optimistic concurrency on version. */
export class ResolveReassessmentDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
