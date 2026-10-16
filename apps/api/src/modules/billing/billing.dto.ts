import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
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
  GST_RATES,
  GSTIN_REGEX,
  RECEIPT_MODES,
  TDS_SECTIONS,
  type AdjustmentStatus,
  type ReceiptMode,
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
export class RequestCreditNoteDto {
  @ApiProperty({ example: '5000.00', description: 'Before tax; GST is added as on the invoice.' })
  @Matches(AMOUNT, { message: 'taxableValue must be a positive amount with up to two decimals.' })
  taxableValue!: string;

  @ApiPropertyOptional({ enum: GST_RATES, description: "Defaults to the invoice's highest rate." })
  @IsOptional()
  @Type(() => Number)
  @IsIn(GST_RATES)
  gstRate?: number;

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
