import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { FRAMEWORK_CONCLUSION, type FrameworkConclusion } from '@hsdg/contracts';

/** Record the professional conclusion for a framework area (§19). */
export class FrameworkDecisionDto {
  @ApiProperty({ enum: Object.values(FRAMEWORK_CONCLUSION) })
  @IsIn(Object.values(FRAMEWORK_CONCLUSION))
  conclusion!: FrameworkConclusion;

  @ApiPropertyOptional({
    description: 'Professional basis; required when overriding the suggestion.',
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

  @ApiProperty({ description: 'Optimistic-concurrency version last seen for this assessment.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Link evidence to a framework area — an existing document or a note (§16, §18). */
export class AddFrameworkEvidenceDto {
  @ApiPropertyOptional({ description: 'An existing document id to link (never a duplicate copy).' })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({ description: 'A free-text evidence note.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

/** Approve the Framework Memo (§18). */
export class ApproveFrameworkDto {
  @ApiPropertyOptional({
    description: 'The framework memo / rationale recorded with the approval.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  memo?: string;
}
