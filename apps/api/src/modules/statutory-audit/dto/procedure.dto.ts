import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EVIDENCE_KIND,
  EXCEPTION_SEVERITY,
  EXCEPTION_STATUS,
  PROCEDURE_STATE,
  RISK_ASSERTION,
  SAMPLING_METHOD,
  type EvidenceKind,
  type ExceptionSeverity,
  type ExceptionStatus,
  type ProcedureAssertion,
  type ProcedureState,
  type SamplingMethod,
} from '@hsdg/contracts';

/** Create a procedure inside an audit area (§13). */
export class CreateProcedureDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional({ description: 'Why the procedure is performed.' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  objective?: string;

  @ApiPropertyOptional({ enum: Object.values(RISK_ASSERTION), isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(Object.values(RISK_ASSERTION), { each: true })
  assertions?: ProcedureAssertion[];

  @ApiPropertyOptional({ description: 'The risk this procedure responds to (§22).' })
  @IsOptional()
  @IsUUID()
  riskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  population?: string;

  @ApiPropertyOptional({ enum: Object.values(SAMPLING_METHOD) })
  @IsOptional()
  @IsIn(Object.values(SAMPLING_METHOD))
  samplingMethod?: SamplingMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sampleSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewerEmployeeId?: string;

  @ApiPropertyOptional({ description: 'Internal deadline (YYYY-MM-DD).' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'The evidence expected from the procedure.' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  expectedEvidence?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  conclusion?: string;
}

/** Update a procedure — all fields optional; version required (PATCH semantics). */
export class UpdateProcedureDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  objective?: string;

  @ApiPropertyOptional({ enum: Object.values(RISK_ASSERTION), isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(Object.values(RISK_ASSERTION), { each: true })
  assertions?: ProcedureAssertion[];

  @ApiPropertyOptional({ description: 'Risk id, or null to clear the risk response.' })
  @IsOptional()
  @IsUUID()
  riskId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  population?: string;

  @ApiPropertyOptional({ enum: Object.values(SAMPLING_METHOD) })
  @IsOptional()
  @IsIn(Object.values(SAMPLING_METHOD))
  samplingMethod?: SamplingMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sampleSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewerEmployeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  expectedEvidence?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  conclusion?: string;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Transition a procedure's professional state (§13). */
export class SetProcedureStateDto {
  @ApiProperty({ enum: Object.values(PROCEDURE_STATE) })
  @IsIn(Object.values(PROCEDURE_STATE))
  state!: ProcedureState;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}

/** Link a procedure to another audit area (§14 reuse). */
export class LinkAreaDto {
  @ApiProperty()
  @IsUUID()
  workAreaId!: string;
}

/** Add a new piece of evidence to a procedure (§9, §12). */
export class AddEvidenceDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional({ enum: Object.values(EVIDENCE_KIND) })
  @IsOptional()
  @IsIn(Object.values(EVIDENCE_KIND))
  kind?: EvidenceKind;

  @ApiPropertyOptional({ description: 'A linked DHVAJ document on the same engagement.' })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

/** Link an existing evidence record to another procedure (§9 reuse). */
export class LinkEvidenceDto {
  @ApiProperty()
  @IsUUID()
  evidenceId!: string;
}

/** Raise an exception on a procedure (§12). */
export class AddExceptionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(8000)
  description!: string;

  @ApiPropertyOptional({ enum: Object.values(EXCEPTION_SEVERITY) })
  @IsOptional()
  @IsIn(Object.values(EXCEPTION_SEVERITY))
  severity?: ExceptionSeverity;

  @ApiPropertyOptional({ enum: Object.values(EXCEPTION_STATUS) })
  @IsOptional()
  @IsIn(Object.values(EXCEPTION_STATUS))
  status?: ExceptionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  resolution?: string;
}

/** Update an exception — all fields optional; version required. */
export class UpdateExceptionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @ApiPropertyOptional({ enum: Object.values(EXCEPTION_SEVERITY) })
  @IsOptional()
  @IsIn(Object.values(EXCEPTION_SEVERITY))
  severity?: ExceptionSeverity;

  @ApiPropertyOptional({ enum: Object.values(EXCEPTION_STATUS) })
  @IsOptional()
  @IsIn(Object.values(EXCEPTION_STATUS))
  status?: ExceptionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  resolution?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
