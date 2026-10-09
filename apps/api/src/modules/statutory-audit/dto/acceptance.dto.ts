import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { SEGMENT_STATES, type SegmentState } from '@hsdg/contracts';

/** 01.5 — the signed-in team member's own independence declaration (spec §8). */
export class RecordIndependenceDeclarationDto {
  @ApiProperty({ enum: ['independent', 'threat_disclosed'] })
  @IsIn(['independent', 'threat_disclosed'])
  status!: 'independent' | 'threat_disclosed';

  @ApiPropertyOptional({ description: 'Required when a threat is disclosed.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  disclosure?: string | null;
}

/** Record one Section 01 answer with its detail fields (spec §4–§9). */
export class RecordAcceptanceAnswerDto {
  @ApiProperty({ description: 'Question key, e.g. `app_01`, or `ind_03:<engagement service id>`.' })
  @IsString()
  @MaxLength(100)
  questionKey!: string;

  @ApiProperty({
    nullable: true,
    description:
      "The chosen option's value, an ISO date, or `recorded` for a form; null clears it.",
  })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(/^[a-z0-9_:-]{1,60}$/)
  answer!: string | null;

  @ApiPropertyOptional({ description: 'Detail fields recorded with the answer.' })
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;

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
