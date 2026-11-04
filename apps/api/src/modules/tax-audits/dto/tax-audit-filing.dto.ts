import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBase64,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type {
  FileTaxAuditReportInput,
  RecordTaxAuditAcceptanceInput,
  RecordTaxAuditRejectionInput,
  RecordTaxAuditUploadInput,
  ReviseTaxAuditReportInput,
  SignTaxAuditReportInput,
  WithdrawTaxAuditSignatureInput,
} from '@hsdg/contracts';
import { TaxAuditVersionDto } from './tax-audit-workspace.dto';

export class SignTaxAuditReportDto extends TaxAuditVersionDto implements SignTaxAuditReportInput {
  @ApiProperty({ example: '26123456ABCDEF1234' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  udin!: string;

  @ApiProperty({ description: 'The signed report’s file name.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  filename!: string;

  @ApiPropertyOptional({ description: 'MIME type; defaults to application/octet-stream.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contentType?: string;

  @ApiProperty({ description: 'File bytes, base64-encoded.' })
  @IsBase64()
  contentBase64!: string;
}

export class TaxAuditReasonDto
  extends TaxAuditVersionDto
  implements WithdrawTaxAuditSignatureInput, ReviseTaxAuditReportInput
{
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class RecordTaxAuditUploadDto
  extends TaxAuditVersionDto
  implements RecordTaxAuditUploadInput
{
  @ApiProperty({ example: '2026-10-20' })
  @IsDateString()
  uploadedOn!: string;
}

export class RecordTaxAuditAcceptanceDto
  extends TaxAuditVersionDto
  implements RecordTaxAuditAcceptanceInput
{
  @ApiProperty({ example: '2026-10-22' })
  @IsDateString()
  acceptedOn!: string;
}

export class RecordTaxAuditRejectionDto
  extends TaxAuditVersionDto
  implements RecordTaxAuditRejectionInput
{
  @ApiProperty({ example: '2026-10-22' })
  @IsDateString()
  rejectedOn!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class FileTaxAuditReportDto extends TaxAuditVersionDto implements FileTaxAuditReportInput {
  @ApiProperty({ example: '123456789012345' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  acknowledgementNo!: string;

  @ApiProperty({ example: '2026-10-25' })
  @IsDateString()
  filedOn!: string;

  @ApiPropertyOptional({ description: 'The acknowledgement’s file name.' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  filename?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contentType?: string;

  @ApiPropertyOptional({ description: 'The acknowledgement, base64-encoded.' })
  @IsOptional()
  @IsBase64()
  contentBase64?: string;
}
