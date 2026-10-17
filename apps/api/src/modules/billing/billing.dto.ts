import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBase64,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ADJUSTMENT_STATUSES,
  FEE_MILESTONE_KINDS,
  GSTIN_REGEX,
  RECEIPT_MODES,
  SET_ASIDE_KINDS,
  TDS_SECTIONS,
  type AdjustmentStatus,
  type FeeMilestoneKind,
  type FeeWaiverStatus,
  type ReceiptMode,
  type SetAsideKind,
  type TdsSection,
} from '@hsdg/contracts';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

/** A positive amount with at most two decimals. */
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

/** PS-201 · Billing → Settings. */
export class UpdateBillingSettingsDto {
  @ApiProperty({ description: 'The version read; a stale one is a 409.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ description: "The firm's GSTIN; its first two digits are the state." })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(GSTIN_REGEX, { message: 'gstin is not a valid GSTIN.' })
  gstin?: string | null;

  @ApiPropertyOptional({ example: '07' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{2}$/, { message: 'stateCode must be a two-digit GST state code.' })
  stateCode?: string | null;

  @ApiPropertyOptional({ example: '998221' })
  @IsOptional()
  @Matches(/^\d{4,8}$/, { message: 'sacDefault must be a 4–8 digit SAC.' })
  sacDefault?: string;

  @ApiPropertyOptional({ example: 'INV', description: '1–5 capitals or digits.' })
  @IsOptional()
  @Matches(/^[A-Z0-9]{1,5}$/, { message: 'invoicePrefix must be 1–5 capitals or digits.' })
  invoicePrefix?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  invoiceTermsDays?: number;

  @ApiPropertyOptional({
    example: [7, 15, 30],
    description: 'Days after due for the automatic reminder e-mails (PS-203).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(365, { each: true })
  invoiceReminderDays?: number[];

  @ApiPropertyOptional({ description: 'Automatic reminder e-mails to clients (off by default).' })
  @IsOptional()
  @IsBoolean()
  autoInvoiceReminders?: boolean;

  @ApiPropertyOptional({
    example: '1.00',
    description: 'Rupees a 26AS credit may differ from the TDS booked and still match (PS-204).',
  })
  @IsOptional()
  @Matches(/^(1000(\.0{1,2})?|\d{1,3}(\.\d{1,2})?)$/, {
    message: 'tdsMatchTolerance must be between 0 and 1000 rupees.',
  })
  tdsMatchTolerance?: string;

  @ApiPropertyOptional({
    example: '2026-04-01',
    nullable: true,
    description: 'The day billing started in the app; the unbilled list starts there (PS-206).',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  billingFrom?: string | null;
}

/** PS-202 · one invoice's share of a receipt. */
export class ReceiptAllocationDto {
  @ApiProperty()
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({
    example: '50000.00',
    description: 'Counts towards the invoice total (gross of TDS).',
  })
  @Matches(AMOUNT, { message: 'amount must be a positive amount with up to two decimals.' })
  amount!: string;
}

/** PS-202 · POST /billing/receipts. */
export class CreateReceiptDto {
  @ApiProperty()
  @IsUUID()
  clientEntityId!: string;

  @ApiProperty({ example: '2026-10-16' })
  @IsDateString()
  receivedOn!: string;

  @ApiProperty({ enum: RECEIPT_MODES })
  @IsIn(RECEIPT_MODES)
  mode!: ReceiptMode;

  @ApiPropertyOptional({ description: 'UTR, cheque number or UPI reference.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string | null;

  @ApiProperty({ example: '90000.00', description: 'What reached the bank.' })
  @Matches(AMOUNT, { message: 'netAmount must be a positive amount with up to two decimals.' })
  netAmount!: string;

  @ApiPropertyOptional({ example: '10000.00', description: 'TDS the client deducted.' })
  @IsOptional()
  @Matches(AMOUNT, { message: 'tdsAmount must be an amount with up to two decimals.' })
  tdsAmount?: string;

  @ApiPropertyOptional({ enum: TDS_SECTIONS })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(TDS_SECTIONS)
  tdsSection?: TdsSection | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankAccount?: string | null;

  @ApiPropertyOptional({
    type: [ReceiptAllocationDto],
    description: 'Omit to allocate to the oldest open invoices first; [] keeps it as an advance.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiptAllocationDto)
  allocations?: ReceiptAllocationDto[];
}

/** PS-202 · POST /billing/receipts/:id/reverse. */
export class ReverseReceiptDto {
  @ApiProperty({ example: 'Cheque returned unpaid' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

/** PS-202 · GET /billing/receipts. */
export class ReceiptListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

/** PS-205 · POST /billing/invoices/:invoiceId/credit-notes. */
export class CreditNoteLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  invoiceLineId!: string;

  @ApiProperty({ example: '5000.00', description: "Before tax; the line's GST rate is added." })
  @Matches(AMOUNT, { message: 'taxableValue must be a positive amount with up to two decimals.' })
  taxableValue!: string;
}

export class RequestCreditNoteDto {
  @ApiProperty({ type: [CreditNoteLineDto], description: 'The invoice lines it reduces.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreditNoteLineDto)
  lines!: CreditNoteLineDto[];

  @ApiProperty({ example: 'Scope reduced: one return not filed' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

/** PS-205 · POST /billing/invoices/:invoiceId/write-offs. */
export class RequestWriteOffDto {
  @ApiProperty({ example: '5000.00' })
  @Matches(AMOUNT, { message: 'amount must be a positive amount with up to two decimals.' })
  amount!: string;

  @ApiProperty({ example: 'Client wound up; balance not recoverable' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

/** PS-205 · POST /billing/{credit-notes|write-offs}/:id/decision. */
export class DecideAdjustmentDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

/** PS-205 · GET /billing/adjustments. */
export class AdjustmentListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @ApiPropertyOptional({ enum: ADJUSTMENT_STATUSES })
  @IsOptional()
  @IsIn(ADJUSTMENT_STATUSES)
  status?: AdjustmentStatus;
}

/** PS-203 · POST /billing/invoices/:id/remind. */
export class RemindInvoiceDto {
  @ApiPropertyOptional({
    enum: ['email', 'whatsapp', 'copy'],
    description: "Omit for the firm's reminder channel.",
  })
  @IsOptional()
  @IsIn(['email', 'whatsapp', 'copy'])
  channel?: 'email' | 'whatsapp' | 'copy';
}

/** PS-206: whose unbilled fees to list. */
export class UnbilledQueryDto {
  @ApiPropertyOptional({ description: "Only this engagement partner's engagements." })
  @IsOptional()
  @IsUUID()
  partnerId?: string;
}

/** PS-206: the due fee periods to put on one draft invoice. */
export class DraftFromUnbilledDto {
  @ApiProperty()
  @IsUUID()
  engagementId!: string;

  @ApiProperty({ type: [String], example: ['retainer:2026-09'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  keys!: string[];
}

/**
 * PS-206: due periods billed outside the app (the outside invoice named), or
 * not billed (a waiver a partner decides; the reason is checked by the service).
 */
export class SetAsideFeesDto extends DraftFromUnbilledDto {
  @ApiProperty({ enum: SET_ASIDE_KINDS })
  @IsIn(SET_ASIDE_KINDS)
  kind!: SetAsideKind;

  @ApiPropertyOptional({ example: 'Client relationship: first year fee waived by the MP' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ example: 'TALLY/1234', description: 'billed_outside: its number.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  externalInvoiceNumber?: string;

  @ApiPropertyOptional({ example: '2026-03-31', description: 'billed_outside: its date.' })
  @IsOptional()
  @IsDateString({ strict: true })
  externalInvoiceDate?: string;
}

/** PS-206: waivers, by status. */
export class FeeWaiversQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: FeeWaiverStatus;
}

/** PS-206: list a set-aside period again. */
export class RestoreFeeDto {
  @ApiProperty()
  @IsUUID()
  engagementId!: string;

  @ApiProperty({ example: 'retainer:2026-09' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  key!: string;
}

/** PS-206: a fee agreed on a milestone or an event. */
export class CreateFeeMilestoneDto {
  @ApiProperty({ enum: FEE_MILESTONE_KINDS })
  @IsIn(FEE_MILESTONE_KINDS)
  kind!: FeeMilestoneKind;

  @ApiProperty({ example: 'Valuation report delivered' })
  @IsString()
  @Matches(/\S/, { message: 'Say what the fee is for.' })
  @MaxLength(300)
  description!: string;

  @ApiProperty({ example: '75000.00' })
  @Matches(/^\d{1,12}(\.\d{1,2})?$/, { message: 'amount must be a positive amount.' })
  @Matches(/[1-9]/, { message: 'amount must be more than zero.' })
  amount!: string;

  @ApiProperty({ example: '2026-11-30', description: 'Billable from this date.' })
  @IsDateString({ strict: true })
  dueOn!: string;
}

const FINANCIAL_YEAR = /^\d{4}-\d{2}$/;
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;

/** PS-204: a 26AS text export or a Form 16A, as TRACES gives it. */
export class ImportTdsCreditsDto {
  @ApiProperty({ example: 'AAAFZ9999Q-2027.txt' })
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

  @ApiPropertyOptional({
    description: "A TRACES PDF's password (DDMMYYYY). Used to read the file; never stored.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;
}

/** PS-204: the year (and quarter) to match. */
export class TdsMatchQueryDto {
  @ApiProperty({ example: '2026-27' })
  @Matches(FINANCIAL_YEAR, { message: 'financialYear must look like 2026-27.' })
  financialYear!: string;

  @ApiPropertyOptional({ enum: QUARTERS, description: 'Omit for the whole year.' })
  @IsOptional()
  @IsIn(QUARTERS)
  quarter?: (typeof QUARTERS)[number];
}

/** PS-204: ask a client to file or correct their TDS return. */
export class RemindTdsDto extends TdsMatchQueryDto {
  @ApiProperty()
  @IsUUID()
  clientId!: string;

  @ApiPropertyOptional({
    enum: ['email', 'whatsapp', 'copy'],
    description: "Omit for the firm's reminder channel.",
  })
  @IsOptional()
  @IsIn(['email', 'whatsapp', 'copy'])
  channel?: 'email' | 'whatsapp' | 'copy';

  @ApiPropertyOptional({ description: 'Send although the client was reminded in the last 7 days.' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
