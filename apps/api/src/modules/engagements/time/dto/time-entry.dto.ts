import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Start the caller's timer on an engagement. An optional note describes the work. */
export class StartTimerDto {
  @ApiPropertyOptional({
    description: 'What you are working on (e.g. an off-portal site/task). Optional.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Stop the caller's running timer on an engagement, optionally annotating it. */
export class StopTimerDto {
  @ApiPropertyOptional({
    description:
      'A closing note for the session (kept if provided; otherwise the start note stands).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
