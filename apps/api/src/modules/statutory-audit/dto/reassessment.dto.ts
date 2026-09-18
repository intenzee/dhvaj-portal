import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { REASSESSMENT_CHANGE_TYPE, type ReassessmentChangeType } from '@hsdg/contracts';

/** Raise a change-impact / reassessment event (§30). */
export class RaiseReassessmentDto {
  @ApiProperty({ enum: Object.values(REASSESSMENT_CHANGE_TYPE) })
  @IsIn(Object.values(REASSESSMENT_CHANGE_TYPE))
  changeType!: ReassessmentChangeType;

  @ApiProperty({ description: 'The professional reason for the change (§30).' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  reason!: string;
}

/** Resolve a reassessment — optimistic concurrency on version. */
export class ResolveReassessmentDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
