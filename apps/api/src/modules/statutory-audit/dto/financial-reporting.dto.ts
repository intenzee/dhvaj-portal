import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  FRF_ANSWER,
  FRF_PROFESSIONAL_ACTION,
  PRIOR_FRAMEWORK,
  REPORTING_FRAMEWORK_CONCLUSIONS,
  type FrfAnswer,
  type FrfProfessionalAction,
  type PriorFramework,
  type ReportingFrameworkOutcome,
} from '@hsdg/contracts';

const ANSWERS = Object.values(FRF_ANSWER);
const FY = /^\d{4}-\d{2}$/;

/** Capture the 02.2 answers (FRF-01..04, 06, group, SMC). Null clears an answer. */
export class SetFinancialReportingFactsDto {
  @ApiPropertyOptional({ description: 'Listed / in process only on an SME exchange or ITP.' })
  @IsOptional()
  @IsBoolean()
  isListedOnSmeExchange?: boolean;

  @ApiPropertyOptional({ description: 'Ind AS applied in a prior year (legacy; prefer FRF-02).' })
  @IsOptional()
  @IsBoolean()
  priorIndAs?: boolean;

  @ApiPropertyOptional({ description: 'Ind AS voluntarily adopted (legacy; prefer FRF-03).' })
  @IsOptional()
  @IsBoolean()
  voluntaryIndAs?: boolean;

  @ApiPropertyOptional({
    description: 'A group company applies Ind AS (legacy; prefer groupAnswer).',
  })
  @IsOptional()
  @IsBoolean()
  groupTriggersIndAs?: boolean;

  @ApiPropertyOptional({
    enum: Object.values(PRIOR_FRAMEWORK),
    nullable: true,
    description: 'FRF-01',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(Object.values(PRIOR_FRAMEWORK))
  priorFramework?: PriorFramework | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'FRF-01 source (e.g. "FY 2023-24 audited FS").',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  priorFrameworkSource?: string | null;

  @ApiPropertyOptional({ enum: ANSWERS, nullable: true, description: 'FRF-02' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(ANSWERS)
  indAsAlreadyApplicable?: FrfAnswer | null;

  @ApiPropertyOptional({ nullable: true, example: '2019-20' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(FY)
  firstIndAsFy?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'FRF-02 original trigger.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  originalTrigger?: string | null;

  @ApiPropertyOptional({ enum: ANSWERS, nullable: true, description: 'FRF-03' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(ANSWERS)
  voluntaryAnswer?: FrfAnswer | null;

  @ApiPropertyOptional({ nullable: true, example: '2024-25' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(FY)
  voluntaryFirstIndAsFy?: string | null;

  @ApiPropertyOptional({ enum: ANSWERS, nullable: true, description: '§11 group test answer' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(ANSWERS)
  groupAnswer?: FrfAnswer | null;

  @ApiPropertyOptional({
    enum: ANSWERS,
    nullable: true,
    description: '§16 holding/subsidiary of a non-SMC',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(ANSWERS)
  groupNonSmc?: FrfAnswer | null;

  @ApiPropertyOptional({
    nullable: true,
    description: '§16 maximum borrowings in the preceding year (₹).',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  @Min(0)
  smcMaxBorrowings?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'FRF-06 confirm / override.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsBoolean()
  firstTimeAdoption?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  firstTimeAdoptionReason?: string | null;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** FRF-05 — record the professional conclusion. */
export class RecordFinancialReportingDecisionDto {
  @ApiPropertyOptional({ enum: Object.values(FRF_PROFESSIONAL_ACTION) })
  @IsOptional()
  @IsIn(Object.values(FRF_PROFESSIONAL_ACTION))
  action?: FrfProfessionalAction;

  @ApiPropertyOptional({ enum: REPORTING_FRAMEWORK_CONCLUSIONS })
  @IsOptional()
  @IsIn(REPORTING_FRAMEWORK_CONCLUSIONS)
  conclusion?: ReportingFrameworkOutcome;

  @ApiPropertyOptional({ description: 'Required when the conclusion overrides the system.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  basis?: string;

  @ApiPropertyOptional({ description: 'Downstream impact note.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  impact?: string;

  @ApiPropertyOptional({ description: 'Required for Information Pending — which fact is missing.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pendingReason?: string;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** FRF-05 — Engagement Partner approval. */
export class PartnerApproveFinancialReportingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}
