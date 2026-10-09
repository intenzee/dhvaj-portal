import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  COMPARATIVES_STATUSES,
  SCH_ANSWERS,
  SCH_PROFESSIONAL_ACTIONS,
  SCHEDULE_III_CONCLUSIONS,
  SPECIALISED_EFFECTS,
  type ComparativesStatus,
  type PartnerApproveScheduleIiiInput,
  type RecordScheduleIiiDecisionInput,
  type SchAnswer,
  type SchProfessionalAction,
  type ScheduleIiiOutcome,
  type SetScheduleIiiFactsInput,
  type SpecialisedEffect,
} from '@hsdg/contracts';

/** SCH-06 — record the professional Schedule III conclusion (02.3 spec §17). */
export class RecordScheduleIiiDecisionDto implements RecordScheduleIiiDecisionInput {
  @ApiPropertyOptional({ enum: SCH_PROFESSIONAL_ACTIONS })
  @IsOptional()
  @IsIn(SCH_PROFESSIONAL_ACTIONS)
  action?: SchProfessionalAction;

  @ApiPropertyOptional({ enum: SCHEDULE_III_CONCLUSIONS })
  @IsOptional()
  @IsIn(SCHEDULE_III_CONCLUSIONS)
  conclusion?: ScheduleIiiOutcome;

  @ApiPropertyOptional({ description: 'Reason — required for an override.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  basis?: string;

  @ApiPropertyOptional({ description: 'Technical basis — required for an override.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  technicalBasis?: string;

  @ApiPropertyOptional({ description: 'Downstream impact note.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  impact?: string;

  @ApiPropertyOptional({ description: 'Required for Information Pending.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pendingReason?: string;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** SCH-02 / SCH-04 / SCH-05 answers (partial update; null clears). */
export class SetScheduleIiiFactsDto implements SetScheduleIiiFactsInput {
  @ApiPropertyOptional({ enum: SCH_ANSWERS, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(SCH_ANSWERS)
  specialisedAnswer?: SchAnswer | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  governingAuthority?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  frameworkName?: string | null;

  @ApiPropertyOptional({ enum: SPECIALISED_EFFECTS, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(SPECIALISED_EFFECTS)
  specialisedEffect?: SpecialisedEffect | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  specialisedVersion?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  specialisedProvisionId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  specialisedReference?: string | null;

  @ApiPropertyOptional({ enum: COMPARATIVES_STATUSES, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(COMPARATIVES_STATUSES)
  comparativesStatus?: ComparativesStatus | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  comparativesReason?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'A unit the applicable version permits.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  roundingUnit?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  roundingReason?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** SCH-06 — Engagement Partner approval. */
export class PartnerApproveScheduleIiiDto implements PartnerApproveScheduleIiiInput {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
