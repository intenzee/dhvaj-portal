import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import {
  ACCEPTANCE_ANSWERS,
  ACCEPTANCE_CONCLUSIONS,
  SEGMENT_STATES,
  type AcceptanceAnswer,
  type AcceptanceConclusion,
  type SegmentState,
} from '@hsdg/contracts';

/** Record a Yes/No/NA answer for an acceptance question (§8.3). */
export class RecordAcceptanceAnswerDto {
  @ApiProperty()
  @IsString()
  @MaxLength(60)
  questionKey!: string;

  @ApiProperty({ enum: ACCEPTANCE_ANSWERS })
  @IsIn(ACCEPTANCE_ANSWERS)
  answer!: AcceptanceAnswer;

  @ApiPropertyOptional({ description: 'Narrative required only on an exception.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  narrative?: string;

  @ApiPropertyOptional({ description: 'Link an existing document as evidence (never a copy).' })
  @IsOptional()
  @IsUUID()
  documentId?: string;
}

/** Mark a segment complete, not-applicable, or reopen it (§8.3). */
export class SetSegmentStateDto {
  @ApiProperty({ enum: SEGMENT_STATES })
  @IsIn(SEGMENT_STATES)
  state!: SegmentState;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen for this segment.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Engagement Partner approval (FINAL-02) — unlocks Section 02 (§8.5). */
export class ApproveAcceptanceDto {
  @ApiProperty({ enum: ACCEPTANCE_CONCLUSIONS })
  @IsIn(ACCEPTANCE_CONCLUSIONS)
  conclusion!: AcceptanceConclusion;

  @ApiPropertyOptional({ description: 'The acceptance memo / rationale recorded with approval.' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  memo?: string;
}
