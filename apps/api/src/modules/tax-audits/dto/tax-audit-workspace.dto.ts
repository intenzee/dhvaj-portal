import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBase64,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  TAX_AUDIT_INFO_ITEMS,
  type AddTaxAuditWpCommentInput,
  type MarkTaxAuditWorkingPaperNaInput,
  type RequestTaxAuditInformationInput,
  type ReviewTaxAuditWorkingPaperInput,
  type SaveTaxAuditFactsInput,
  type SaveTaxAuditWorkingPaperInput,
  type TaxAuditAnswer,
  type TaxAuditFacts,
  type TaxAuditInfoItem,
  type TaxAuditVersionInput,
  type UploadTaxAuditWpEvidenceInput,
} from '@hsdg/contracts';

export class TaxAuditVersionDto implements TaxAuditVersionInput {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class SaveTaxAuditFactsDto extends TaxAuditVersionDto implements SaveTaxAuditFactsInput {
  @ApiProperty({ description: 'Audit fact → true / false; a fact left out is not known.' })
  @IsObject()
  facts!: TaxAuditFacts;
}

export class RequestTaxAuditInformationDto implements RequestTaxAuditInformationInput {
  @ApiPropertyOptional({ enum: TAX_AUDIT_INFO_ITEMS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TAX_AUDIT_INFO_ITEMS.length)
  @IsIn(TAX_AUDIT_INFO_ITEMS, { each: true })
  items?: TaxAuditInfoItem[];
}

export class SaveTaxAuditWorkingPaperDto
  extends TaxAuditVersionDto
  implements SaveTaxAuditWorkingPaperInput
{
  @ApiProperty({ description: 'Sub-item key → text, yes / no, amount or date.' })
  @IsObject()
  answer!: TaxAuditAnswer;
}

export class MarkTaxAuditWorkingPaperNaDto
  extends TaxAuditVersionDto
  implements MarkTaxAuditWorkingPaperNaInput
{
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class ReviewTaxAuditWorkingPaperDto
  extends TaxAuditVersionDto
  implements ReviewTaxAuditWorkingPaperInput
{
  @ApiProperty({ enum: ['done', 'send_back'] })
  @IsIn(['done', 'send_back'])
  outcome!: 'done' | 'send_back';

  @ApiPropertyOptional({ description: 'Required when sending back.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string;
}

export class AddTaxAuditWpCommentDto implements AddTaxAuditWpCommentInput {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;
}

export class UploadTaxAuditWpEvidenceDto implements UploadTaxAuditWpEvidenceInput {
  @ApiProperty({ description: 'Original file name.' })
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
