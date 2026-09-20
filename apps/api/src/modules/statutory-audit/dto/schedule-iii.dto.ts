import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { SCHEDULE_III_CONCLUSIONS, type ScheduleIiiOutcome } from '@hsdg/contracts';

/** Record the professional Schedule III conclusion for 02.3 (override needs a basis, §19). */
export class RecordScheduleIiiDecisionDto {
  @ApiProperty({ enum: SCHEDULE_III_CONCLUSIONS })
  @IsIn(SCHEDULE_III_CONCLUSIONS)
  conclusion!: ScheduleIiiOutcome;

  @ApiPropertyOptional({
    description: 'Required when the conclusion overrides the system suggestion.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  basis?: string;

  @ApiPropertyOptional({ description: 'Downstream impact note.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  impact?: string;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}
