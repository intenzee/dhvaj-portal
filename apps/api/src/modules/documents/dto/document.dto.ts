import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBase64,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  DOCUMENT_CLASSIFICATIONS,
  DOCUMENT_SENSITIVITIES,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  type DocumentClassification,
  type DocumentSensitivity,
  type DocumentStatus,
  type DocumentType,
} from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class CreateDocumentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title!: string;

  @ApiPropertyOptional({ enum: DOCUMENT_TYPES })
  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  documentType?: DocumentType;

  @ApiPropertyOptional({ enum: DOCUMENT_CLASSIFICATIONS })
  @IsOptional()
  @IsIn(DOCUMENT_CLASSIFICATIONS)
  classification?: DocumentClassification;

  @ApiPropertyOptional({ enum: DOCUMENT_SENSITIVITIES })
  @IsOptional()
  @IsIn(DOCUMENT_SENSITIVITIES)
  sensitivity?: DocumentSensitivity;

  @ApiPropertyOptional({ example: '2034-03-31', description: 'Retention-until date (ISO).' })
  @IsOptional()
  @IsDateString()
  retentionUntil?: string;

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

export class AddVersionDto {
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

  @ApiPropertyOptional({ description: 'Why a new version was uploaded.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({ enum: DOCUMENT_TYPES })
  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  documentType?: DocumentType;

  @ApiPropertyOptional({ enum: DOCUMENT_CLASSIFICATIONS })
  @IsOptional()
  @IsIn(DOCUMENT_CLASSIFICATIONS)
  classification?: DocumentClassification;

  @ApiPropertyOptional({ enum: DOCUMENT_SENSITIVITIES })
  @IsOptional()
  @IsIn(DOCUMENT_SENSITIVITIES)
  sensitivity?: DocumentSensitivity;

  @ApiPropertyOptional({ nullable: true, description: 'null clears the retention date.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  retentionUntil?: string | null;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class ArchiveDocumentDto {
  @ApiProperty({ description: 'Reason for archiving/restoring (audited).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class DocumentListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DOCUMENT_STATUSES })
  @IsOptional()
  @IsIn(DOCUMENT_STATUSES)
  status?: DocumentStatus;

  @ApiPropertyOptional({ enum: DOCUMENT_TYPES })
  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  documentType?: DocumentType;

  @ApiPropertyOptional({ enum: DOCUMENT_CLASSIFICATIONS })
  @IsOptional()
  @IsIn(DOCUMENT_CLASSIFICATIONS)
  classification?: DocumentClassification;

  @ApiPropertyOptional({ description: 'Case-insensitive title search.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
