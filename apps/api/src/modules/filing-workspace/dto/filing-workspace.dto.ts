import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBase64,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CHECKLIST_ITEM_STATUSES,
  FILING_REFERENCE_KINDS,
  STREAMS,
  type ChecklistItemStatus,
  type FilingReferenceKind,
  type Stream,
} from '@hsdg/contracts';

export class StreamParamDto {
  @IsUUID()
  id!: string;

  @IsIn(STREAMS)
  stream!: Stream;
}

export class StreamTreeQueryDto {
  @ApiPropertyOptional({ description: 'GSTIN / TAN / PAN registration; defaults to the first.' })
  @IsOptional()
  @IsUUID()
  registrationId?: string;

  @ApiPropertyOptional({ example: '2026-27' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  fy?: string;
}

export class PatchChecklistItemDto {
  @ApiProperty({ enum: CHECKLIST_ITEM_STATUSES })
  @IsIn(CHECKLIST_ITEM_STATUSES)
  status!: ChecklistItemStatus;

  @ApiPropertyOptional({ description: 'Required when marking Not applicable.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  naReason?: string;

  @ApiPropertyOptional({
    description: 'Note on the tick; required (the UDIN) on a step a partner ticks.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class SaveFiguresDto {
  @ApiProperty({ description: 'Figures keyed per the filing’s figure schema.' })
  @IsObject()
  figures!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'The figures version you edited (omit on first save).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class SlotRequestDto {
  @ApiPropertyOptional({ description: 'What the client is asked for; defaults to the slot name.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  requestedInfo?: string;

  @ApiPropertyOptional({ example: '2026-11-05' })
  @IsOptional()
  @IsDateString()
  escalationDate?: string;

  @ApiPropertyOptional({ description: 'Upload-link lifetime in hours.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  ttlHours?: number;
}

export class SlotUploadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  filename!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contentType?: string;

  @ApiProperty({ description: 'File bytes, base64-encoded.' })
  @IsBase64()
  contentBase64!: string;
}

export class LodgeDto {
  @ApiPropertyOptional({
    enum: FILING_REFERENCE_KINDS,
    description: 'Defaults by stream (GST → ARN).',
  })
  @IsOptional()
  @IsIn(FILING_REFERENCE_KINDS)
  referenceKind?: FilingReferenceKind;

  @ApiPropertyOptional({
    example: 'AA191026123456Z',
    description:
      'Required for a filing; a meeting (AGM, board meeting) defaults to an internal one.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  referenceNo?: string;

  @ApiProperty({ example: '2026-10-20', description: 'Filed on — for a meeting, held on.' })
  @IsDateString()
  filedOn!: string;

  @ApiPropertyOptional({
    description: 'AGM only: the auditor was appointed or re-appointed at this AGM (ADT-1 follows).',
  })
  @IsOptional()
  @IsBoolean()
  auditorAppointed?: boolean;

  @ApiPropertyOptional({ description: 'Defaults to you.' })
  @IsOptional()
  @IsUUID()
  filedByEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isNil?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  figures?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  lateFeePaid?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  interestPaid?: number;

  @ApiPropertyOptional({
    description: 'ROC: the normal filing fee paid (the additional fee is lateFeePaid).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  normalFeePaid?: number;

  @ApiProperty({ description: 'The acknowledgement, uploaded to this filing first.' })
  @IsUUID()
  ackDocumentId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

export class FileDocumentDto {
  @ApiProperty({ example: 'SALES_REGISTER' })
  @Matches(/^[A-Z0-9_]{2,40}$/)
  slotCode!: string;
}

export class ReasonDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class CorrectionDto {
  @ApiPropertyOptional({ description: 'The later filing that carried the correction.' })
  @IsOptional()
  @IsUUID()
  correctedInInstanceId?: string;

  @ApiProperty({ example: 'B2B invoice 114 corrected in GSTR-1 Dec 2026 (Table 9A).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note!: string;
}
