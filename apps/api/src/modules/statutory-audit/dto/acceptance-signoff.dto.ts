import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  ACCEPTANCE_CONCLUSIONS,
  ACCEPTANCE_RECOMMENDATIONS,
  type AcceptanceConclusion,
  type AcceptanceRecommendation,
} from '@hsdg/contracts';

/** FINAL-01 — the Manager's recommendation, submitted to the Engagement Partner. */
export class SubmitAcceptanceRecommendationDto {
  @ApiProperty({ enum: ACCEPTANCE_RECOMMENDATIONS })
  @IsIn(ACCEPTANCE_RECOMMENDATIONS)
  recommendation!: AcceptanceRecommendation;

  @ApiPropertyOptional({
    description: 'Optional when clear; required for safeguards, partner review or decline.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comments?: string;
}

/** FINAL-02 — the Engagement Partner's conclusion. */
export class ApproveAcceptanceDto {
  @ApiProperty({ enum: ACCEPTANCE_CONCLUSIONS })
  @IsIn(ACCEPTANCE_CONCLUSIONS)
  conclusion!: AcceptanceConclusion;

  @ApiPropertyOptional({ description: 'Required to return or decline.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reason?: string;

  @ApiPropertyOptional({ description: 'Required for Accept / Continue subject to safeguards.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  safeguards?: string;

  @ApiPropertyOptional({ description: 'Acceptance memo; drafted from the file when blank.' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  memo?: string;
}

/** Controlled reopen of an approved Section 01. */
export class ReopenAcceptanceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  reason!: string;
}
