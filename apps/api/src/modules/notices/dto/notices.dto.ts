import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBase64,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { applyDecorators } from '@nestjs/common';
import {
  NOTICE_EVENT_KINDS,
  NOTICE_OUTCOMES,
  NOTICE_SERVED_VIAS,
  NOTICE_STATUSES,
  NOTICE_STREAMS,
  type AddNoticeEventRequest,
  type AppealNoticeRequest,
  type CloseNoticeRequest,
  type CreateNoticeRequest,
  type NoticeEventKind,
  type NoticeListQuery,
  type NoticeOutcome,
  type NoticeServedVia,
  type NoticeStatus,
  type NoticeStream,
  type UpdateNoticeRequest,
  type UpsertNoticeTypeRequest,
  type VoidNoticeEventRequest,
} from '@hsdg/contracts';

/** A calendar date, YYYY-MM-DD (and a real one). */
const IsDateOnly = () =>
  applyDecorators(
    Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '$property must be a date (YYYY-MM-DD)' }),
    IsISO8601({ strict: true }),
  );
/** A decimal amount string ("125000.00"), never a float. */
const IsAmount = () =>
  Matches(/^\d{1,14}(\.\d{1,2})?$/, { message: '$property must be an amount like "125000.00"' });
const IsFinancialYear = () =>
  Matches(/^\d{4}-\d{2}$/, { message: '$property must be a year like 2025-26' });

const LIST_STATUSES: (NoticeStatus | 'open')[] = ['open', ...NOTICE_STATUSES];
const PATCH_STATUSES = ['received', 'in_progress', 'withdrawn'] as const;
const DOCUMENT_KINDS = ['notice', 'reply', 'order'] as const;

export class NoticeListQueryDto implements NoticeListQuery {
  @ApiPropertyOptional({ enum: LIST_STATUSES, description: "'open' = all but closed / withdrawn." })
  @IsOptional()
  @IsIn(LIST_STATUSES)
  status?: NoticeStatus | 'open';

  @ApiPropertyOptional({ enum: NOTICE_STREAMS })
  @IsOptional()
  @IsIn(NOTICE_STREAMS)
  stream?: NoticeStream;

  @ApiPropertyOptional({ description: "An employee id, or 'me' for the caller." })
  @IsOptional()
  @ValidateIf((_o, v) => v !== 'me')
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Clock due on or before this date (YYYY-MM-DD).' })
  @IsOptional()
  @IsDateOnly()
  dueBefore?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  engagementId?: string;

  @ApiPropertyOptional({ description: 'Reference number or client name.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'nextCursor from the previous page.' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  cursor?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** The fields create and update share. */
class NoticeFieldsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  registrationId?: string | null;

  @ApiPropertyOptional({ enum: NOTICE_SERVED_VIAS })
  @IsOptional()
  @IsIn(NOTICE_SERVED_VIAS)
  servedVia?: NoticeServedVia;

  @ApiPropertyOptional({ nullable: true, example: '2025-26' })
  @IsOptional()
  @IsFinancialYear()
  financialYear?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-27' })
  @IsOptional()
  @IsFinancialYear()
  assessmentYear?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateOnly()
  periodFrom?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateOnly()
  periodTo?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '125000.00' })
  @IsOptional()
  @IsAmount()
  amountDemanded?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateOnly()
  replyDueOn?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Set the firm’s own date by hand.' })
  @IsOptional()
  @IsDateOnly()
  internalDueOverride?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  reviewerId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string | null;
}

export class CreateNoticeDto extends NoticeFieldsDto implements CreateNoticeRequest {
  @ApiProperty({ description: 'The Compliance or Assignment engagement it is worked under.' })
  @IsUUID()
  engagementId!: string;

  @ApiProperty({ example: 'GST_ASMT10' })
  @IsString()
  @Matches(/^[A-Z0-9_]{2,40}$/)
  noticeTypeCode!: string;

  @ApiProperty({ description: 'DIN or notice number.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  referenceNo!: string;

  @ApiProperty()
  @IsDateOnly()
  issuedOn!: string;

  @ApiProperty()
  @IsDateOnly()
  receivedOn!: string;

  @ApiPropertyOptional({ description: 'Defaults to the caller.' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ nullable: true, description: 'A document already uploaded, filed here.' })
  @IsOptional()
  @IsUUID()
  documentId?: string | null;
}

export class UpdateNoticeDto extends NoticeFieldsDto implements UpdateNoticeRequest {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  referenceNo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateOnly()
  issuedOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateOnly()
  receivedOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ enum: PATCH_STATUSES })
  @IsOptional()
  @IsIn(PATCH_STATUSES)
  status?: (typeof PATCH_STATUSES)[number];
}

export class AddNoticeEventDto implements AddNoticeEventRequest {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ enum: NOTICE_EVENT_KINDS })
  @IsIn(NOTICE_EVENT_KINDS)
  kind!: NoticeEventKind;

  @ApiProperty({ description: 'When it happened (an order: the date it was communicated).' })
  @IsDateOnly()
  occurredOn!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The hearing date; required for a hearing or an adjournment granted.',
  })
  @ValidateIf(
    (o: AddNoticeEventDto) =>
      o.kind === 'hearing' ||
      o.kind === 'adjournment_granted' ||
      (o.nextDate !== undefined && o.nextDate !== null),
  )
  @IsDateOnly()
  nextDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ackReference?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  documentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string | null;
}

export class VoidNoticeEventDto implements VoidNoticeEventRequest {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty()
  @IsString()
  @Matches(/\S/, { message: 'Say why the event is being voided.' })
  @MaxLength(1000)
  reason!: string;
}

export class CloseNoticeDto implements CloseNoticeRequest {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ enum: NOTICE_OUTCOMES })
  @IsIn(NOTICE_OUTCOMES)
  outcome!: NoticeOutcome;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsAmount()
  outcomeAmount?: string | null;

  @ApiProperty()
  @IsDateOnly()
  closedOn!: string;
}

export class AppealNoticeDto implements AppealNoticeRequest {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ description: 'Defaults to the notice engagement’s partner.' })
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional({ description: 'Defaults to the notice owner.' })
  @IsOptional()
  @IsUUID()
  managerId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

/** POST /notices/:id/documents — the notice, the reply or the order, base64 as elsewhere. */
export class NoticeDocumentUploadDto {
  @ApiProperty({ enum: DOCUMENT_KINDS })
  @IsIn(DOCUMENT_KINDS)
  documentType!: (typeof DOCUMENT_KINDS)[number];

  @ApiPropertyOptional({ description: 'Defaults to "<type> — <reference>".' })
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

export class UpsertNoticeTypeDto implements UpsertNoticeTypeRequest {
  @ApiProperty({ enum: NOTICE_STREAMS })
  @IsIn(NOTICE_STREAMS)
  stream!: NoticeStream;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  form?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  section?: string | null;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  defaultReplyDays?: number | null;

  @ApiProperty()
  @IsBoolean()
  appealable!: boolean;

  @ApiPropertyOptional({ nullable: true, example: 'GST_APPEAL_LIMITATION' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{2,60}$/)
  appealRuleCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Required when the type exists (409 when stale).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
