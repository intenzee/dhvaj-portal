import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AF01_DECISION,
  AF02_DECISION,
  type Af01Decision,
  type Af02Decision,
} from '@hsdg/contracts';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** AF-01 — Manager confirmation of the framework. */
export class ConfirmFrameworkDto {
  @ApiProperty({ enum: Object.values(AF01_DECISION) })
  @IsIn(Object.values(AF01_DECISION))
  decision!: Af01Decision;

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
  @ApiProperty({ enum: Object.values(AF02_DECISION) })
  @IsIn(Object.values(AF02_DECISION))
  decision!: Af02Decision;

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
