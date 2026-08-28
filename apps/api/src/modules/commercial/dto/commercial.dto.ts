import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BILLING_FREQUENCIES,
  INVOICE_STATUSES,
  type BillingFrequency,
  type InvoiceStatus,
} from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class UpsertCommercialDto {
  @ApiPropertyOptional({ enum: BILLING_FREQUENCIES })
  @IsOptional()
  @IsIn(BILLING_FREQUENCIES)
  billingFrequency?: BillingFrequency;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string | null;

  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional({ description: 'Retainer amount as a decimal string.', example: '50000.00' })
  @IsOptional()
  @IsNumberString()
  retainerAmount?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  scopeNotes?: string | null;
}

export class InvoiceLineDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ example: '1', default: '1' })
  @IsOptional()
  @IsNumberString()
  quantity?: string;

  @ApiPropertyOptional({ example: '10000.00', default: '0' })
  @IsOptional()
  @IsNumberString()
  unitAmount?: string;

  @ApiPropertyOptional({ description: 'Configured component this line bills (optional).' })
  @IsOptional()
  @IsUUID()
  engagementComponentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateInvoiceDto {
  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ example: '2026-05-15' })
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional({ example: '1800.00', description: 'Tax amount as a decimal string.' })
  @IsOptional()
  @IsNumberString()
  taxAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ type: [InvoiceLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines?: InvoiceLineDto[];
}

export class UpdateInvoiceDto {
  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  issueDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional({ example: '1800.00' })
  @IsOptional()
  @IsNumberString()
  taxAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class SetInvoiceStatusDto {
  @ApiProperty({ enum: INVOICE_STATUSES })
  @IsIn(INVOICE_STATUSES)
  status!: InvoiceStatus;

  @ApiPropertyOptional({ description: 'Issue date (defaults to today when issuing).' })
  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class InvoiceListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus;
}

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Query for the firm-wide Billing & Collections invoice list. */
export class GlobalInvoiceListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus;

  @ApiPropertyOptional({ description: 'Only issued invoices past their due date.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overdueOnly?: boolean;

  @ApiPropertyOptional({ description: 'Case-insensitive number / client / engagement search.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
