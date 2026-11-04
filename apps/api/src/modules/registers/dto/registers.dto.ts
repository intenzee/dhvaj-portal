import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
} from 'class-validator';
import { applyDecorators } from '@nestjs/common';
import {
  UDIN_DOCUMENT_KINDS,
  type CreateUdinInput,
  type RevokeUdinInput,
  type UdinDocumentKind,
  type UdinStatus,
} from '@hsdg/contracts';

/** A calendar date, YYYY-MM-DD (and a real one). */
export const IsDateOnly = () =>
  applyDecorators(
    Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '$property must be a date (YYYY-MM-DD)' }),
    IsISO8601({ strict: true }),
  );
export const IsFinancialYear = () =>
  Matches(/^\d{4}-\d{2}$/, { message: '$property must be a year like 2025-26' });

const STATUSES: UdinStatus[] = ['active', 'revoked'];

export class PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class UdinListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'UDIN, client, engagement, partner or description.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: UDIN_DOCUMENT_KINDS })
  @IsOptional()
  @IsIn(UDIN_DOCUMENT_KINDS)
  documentKind?: UdinDocumentKind;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: UdinStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsFinancialYear()
  financialYear?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ description: 'One entry (the work link).' })
  @IsOptional()
  @IsUUID()
  id?: string;
}

export class UdinPendingQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'overdue'] })
  @IsOptional()
  @IsIn(['all', 'overdue'])
  view?: 'all' | 'overdue';
}

export class CreateUdinDto implements CreateUdinInput {
  @ApiProperty({ example: '26123456ABCDEF1234' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  udin!: string;

  @ApiProperty({ enum: UDIN_DOCUMENT_KINDS })
  @IsIn(UDIN_DOCUMENT_KINDS)
  documentKind!: UdinDocumentKind;

  @ApiProperty()
  @IsUUID()
  entityId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  engagementId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  documentId?: string | null;

  @ApiProperty()
  @IsUUID()
  signingPartnerId!: string;

  @ApiProperty()
  @IsDateOnly()
  signedOn!: string;

  @ApiProperty()
  @IsDateOnly()
  generatedOn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsFinancialYear()
  financialYear?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class RevokeUdinDto implements RevokeUdinInput {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;
}
