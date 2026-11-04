import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  INVOICE_SEND_CHANNEL,
  QUICK_INVOICE_GST_RATES,
  RECURRING_INVOICE_MODE,
  type FirmLogoType,
  type InvoiceSendChannel,
  type QuickInvoiceGstRate,
  type RecurringInvoiceMode,
} from '@hsdg/contracts';

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const AMOUNT_MESSAGE = 'The amount is rupees, up to two decimals (e.g. 15000 or 15000.50).';

export class QuickInvoiceDto {
  @ApiProperty() @IsUUID() engagementServiceId!: string;

  @ApiProperty({ example: '15000' })
  @Matches(AMOUNT, { message: AMOUNT_MESSAGE })
  amount!: string;

  @ApiProperty({ enum: QUICK_INVOICE_GST_RATES, example: 18 })
  @Type(() => Number)
  @IsIn(QUICK_INVOICE_GST_RATES, { message: 'GST is 0, 5, 12, 18 or 28 %.' })
  gstRate!: QuickInvoiceGstRate;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string | null;

  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() issue?: boolean;
}

export class SetRecurringInvoiceDto {
  @ApiProperty({ example: '15000' })
  @Matches(AMOUNT, { message: AMOUNT_MESSAGE })
  amount!: string;

  @ApiProperty({ enum: QUICK_INVOICE_GST_RATES })
  @Type(() => Number)
  @IsIn(QUICK_INVOICE_GST_RATES, { message: 'GST is 0, 5, 12, 18 or 28 %.' })
  gstRate!: QuickInvoiceGstRate;

  @ApiProperty({ minimum: 1, maximum: 28 })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'The day is 1–28, so every month has it.' })
  @Max(28, { message: 'The day is 1–28, so every month has it.' })
  dayOfMonth!: number;

  @ApiProperty({ enum: Object.values(RECURRING_INVOICE_MODE) })
  @IsIn(Object.values(RECURRING_INVOICE_MODE))
  mode!: RecurringInvoiceMode;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string | null;
}

export class SendInvoiceDto {
  @ApiProperty({ enum: Object.values(INVOICE_SEND_CHANNEL) })
  @IsIn(Object.values(INVOICE_SEND_CHANNEL))
  channel!: InvoiceSendChannel;
}

/** null clears a field; the database checks PAN, IFSC, account number and UPI. */
export class UpdateFirmProfileDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(10)
  pan?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(200)
  website?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(200)
  bankAccountName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(200)
  bankName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(30)
  bankAccountNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(11)
  bankIfsc?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(200)
  bankBranch?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(130)
  upiId?: string | null;
}

export class SetFirmLogoDto {
  @ApiProperty({ enum: ['image/png', 'image/jpeg'] })
  @IsIn(['image/png', 'image/jpeg'], { message: 'The logo is a PNG or a JPEG.' })
  contentType!: FirmLogoType;

  @ApiProperty({ description: 'The file, base64 (at most 500 KB decoded).' })
  @IsString()
  @MaxLength(700_000, { message: 'The logo is over 500 KB; make it smaller and upload it again.' })
  contentBase64!: string;
}
