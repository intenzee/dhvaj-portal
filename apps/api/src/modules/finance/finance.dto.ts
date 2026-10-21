import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBase64,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { BOOKS_FORMATS, type BooksFormat } from '@hsdg/contracts';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_MESSAGE = 'month must be YYYY-MM';

export class FinanceMonthQueryDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(MONTH, { message: MONTH_MESSAGE })
  month!: string;
}

export const GST_REGISTER_FILES = ['xlsx', 'json'] as const;

export class GstRegisterFileQueryDto extends FinanceMonthQueryDto {
  @ApiProperty({
    enum: GST_REGISTER_FILES,
    description: 'xlsx: the GSTR-1 sheets; json: the GSTN offline-tool file',
  })
  @IsIn(GST_REGISTER_FILES)
  format!: (typeof GST_REGISTER_FILES)[number];
}

export class BooksExportDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(MONTH, { message: MONTH_MESSAGE })
  month!: string;

  @ApiProperty({ enum: BOOKS_FORMATS })
  @IsIn(BOOKS_FORMATS)
  format!: BooksFormat;
}

const LEDGER = { minLength: 1, maxLength: 100 };

export class UpdateBooksSettingsDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ example: 'Professional Fees' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEDGER.maxLength)
  sales?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEDGER.maxLength)
  outputCgst?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEDGER.maxLength)
  outputSgst?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEDGER.maxLength)
  outputIgst?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEDGER.maxLength)
  tdsReceivable?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEDGER.maxLength)
  bank?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEDGER.maxLength)
  cash?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEDGER.maxLength)
  badDebts?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEDGER.maxLength)
  adjustment?: string;
}

export class BankMatchDto {
  @ApiProperty({ example: 'statement-oct-2026.csv' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  filename!: string;

  @ApiProperty({ description: 'File bytes, base64-encoded. Read once and never stored.' })
  @IsBase64()
  contentBase64!: string;
}
