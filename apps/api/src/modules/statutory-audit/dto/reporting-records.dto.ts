import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  FRAUD_CONCLUSIONS,
  FRAUD_PERPETRATORS,
  FRAUD_SOURCES,
  REPORTING_CARD_KEYS,
  REPORTING_EVIDENCE_KINDS,
  TRIS,
  type AddDirectorCheckInput,
  type CreateFraudMatterInput,
  type FraudConclusion,
  type FraudPerpetrator,
  type FraudSource,
  type LinkReportingEvidenceInput,
  type RecordFraudConsultationInput,
  type ReportingCardKey,
  type ReportingEvidenceKind,
  type Tri,
  type UpdateDirectorCheckInput,
  type UpdateFraudMatterInput,
} from '@hsdg/contracts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIN = /^\d{8}$/;
const nullable = () => ValidateIf((_o, v) => v !== null && v !== undefined);

class Versioned {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

function Text(max = 2000) {
  return function (target: object, key: string) {
    ApiPropertyOptional({ nullable: true })(target, key);
    IsOptional()(target, key);
    nullable()(target, key);
    IsString()(target, key);
    MaxLength(max)(target, key);
  };
}

function DateText() {
  return function (target: object, key: string) {
    ApiPropertyOptional({ nullable: true, description: 'YYYY-MM-DD' })(target, key);
    IsOptional()(target, key);
    nullable()(target, key);
    Matches(DATE)(target, key);
  };
}

function Amount() {
  return function (target: object, key: string) {
    ApiPropertyOptional({ nullable: true, description: '₹ amount (or estimate) involved' })(
      target,
      key,
    );
    IsOptional()(target, key);
    nullable()(target, key);
    IsNumber({ maxDecimalPlaces: 2 })(target, key);
    Min(0)(target, key);
  };
}

// ── §14 Fraud Matter ─────────────────────────────────────────────────────────

export class CreateFraudMatterDto implements CreateFraudMatterInput {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  nature!: string;

  @Text(8000) description?: string | null;
  @Amount() amount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  amountEstimated?: boolean;

  @ApiPropertyOptional({ enum: FRAUD_PERPETRATORS })
  @IsOptional()
  @IsIn(FRAUD_PERPETRATORS)
  perpetrator?: FraudPerpetrator;

  @Text(2000) partiesInvolved?: string | null;
  @DateText() knowledgeDate?: string | null;

  @ApiPropertyOptional({ enum: FRAUD_SOURCES })
  @IsOptional()
  @IsIn(FRAUD_SOURCES)
  source?: FraudSource;

  @Text(200) sourceRef?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullable()
  @IsUUID()
  procedureId?: string | null;
}

export class UpdateFraudMatterDto extends Versioned implements UpdateFraudMatterInput {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  nature?: string;

  @Text(8000) description?: string | null;
  @Amount() amount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  amountEstimated?: boolean;

  @ApiPropertyOptional({ enum: FRAUD_PERPETRATORS })
  @IsOptional()
  @IsIn(FRAUD_PERPETRATORS)
  perpetrator?: FraudPerpetrator;

  @Text(2000) partiesInvolved?: string | null;
  @DateText() knowledgeDate?: string | null;

  @ApiPropertyOptional({ enum: FRAUD_SOURCES })
  @IsOptional()
  @IsIn(FRAUD_SOURCES)
  source?: FraudSource;

  @Text(200) sourceRef?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullable()
  @IsUUID()
  procedureId?: string | null;

  @Text(8000) auditProcedures?: string | null;
  @Text(8000) tcwgCommunication?: string | null;
  @DateText() boardReportedOn?: string | null;
  @DateText() replyReceivedOn?: string | null;
  @DateText() cgForwardedOn?: string | null;
  @Text(200) adt4Reference?: string | null;
  @Text(4000) regulatoryNote?: string | null;

  @ApiPropertyOptional({ enum: FRAUD_CONCLUSIONS })
  @IsOptional()
  @IsIn(FRAUD_CONCLUSIONS)
  conclusion?: FraudConclusion;

  @Text(4000) conclusionNote?: string | null;

  @ApiPropertyOptional({ description: 'true withdraws the matter (kept, never deleted).' })
  @IsOptional()
  @IsBoolean()
  withdrawn?: boolean;
}

export class RecordFraudConsultationDto extends Versioned implements RecordFraudConsultationInput {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  note!: string;
}

// ── §12 Section 164(2) director workpaper ───────────────────────────────────

export class AddDirectorCheckDto implements AddDirectorCheckInput {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ nullable: true, description: '8-digit DIN' })
  @IsOptional()
  @nullable()
  @Matches(DIN, { message: 'DIN must be 8 digits.' })
  din?: string | null;

  @Text(200) designation?: string | null;
}

export class UpdateDirectorCheckDto extends Versioned implements UpdateDirectorCheckInput {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ nullable: true, description: '8-digit DIN' })
  @IsOptional()
  @nullable()
  @Matches(DIN, { message: 'DIN must be 8 digits.' })
  din?: string | null;

  @Text(200) designation?: string | null;
  @DateText() appointedOn?: string | null;
  @DateText() ceasedOn?: string | null;
  @Text(4000) directorshipInfo?: string | null;
  @Text(500) representationRef?: string | null;
  @Text(500) mcaSource?: string | null;

  @ApiPropertyOptional({ enum: TRIS })
  @IsOptional()
  @IsIn(TRIS)
  disqualified?: Tri;

  @Text(8000) legalAnalysis?: string | null;
  @Text(4000) auditorConclusion?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withdrawn?: boolean;
}

// ── §16 per-card evidence ───────────────────────────────────────────────────

export class LinkReportingEvidenceDto implements LinkReportingEvidenceInput {
  @ApiProperty({ enum: REPORTING_CARD_KEYS })
  @IsIn(REPORTING_CARD_KEYS)
  cardKey!: ReportingCardKey;

  @ApiPropertyOptional({ description: 'A document already on this engagement.' })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({ description: 'Section 06 evidence in this workflow.' })
  @IsOptional()
  @IsUUID()
  auditEvidenceId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullable()
  @IsUUID()
  fraudMatterId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullable()
  @IsUUID()
  directorId?: string | null;

  @ApiPropertyOptional({ enum: REPORTING_EVIDENCE_KINDS })
  @IsOptional()
  @IsIn(REPORTING_EVIDENCE_KINDS)
  kind?: ReportingEvidenceKind;

  @Text(2000) note?: string | null;
}
