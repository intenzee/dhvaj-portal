import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** AF-01 — Manager confirmation of the framework. */
export class ConfirmFrameworkDto {
  @ApiPropertyOptional({ description: 'Optional confirmation note.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @ApiProperty({ description: 'Baseline record version last seen (0 when none exists yet).' })
  @IsInt()
  @Min(0)
  recordVersion!: number;
}

/** AF-02 — Engagement Partner approval; freezes the baseline. */
export class ApproveFrameworkDto {
  @ApiPropertyOptional({
    description: 'Methodology version label to freeze (defaults per baseline).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  methodologyVersion?: string;

  @ApiProperty({ description: 'Baseline record version last seen.' })
  @IsInt()
  @Min(1)
  recordVersion!: number;
}

/** Controlled reopen (§13) — opens the next baseline version. */
export class ReopenFrameworkDto {
  @ApiProperty({ description: 'Why the approved framework is being reopened (audited).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;

  @ApiProperty({ description: 'Baseline record version last seen.' })
  @IsInt()
  @Min(1)
  recordVersion!: number;
}
