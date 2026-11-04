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
  DSC_CLASSES,
  DSC_USAGES,
  UDIN_DOCUMENT_KINDS,
  type CheckInDscInput,
  type CheckOutDscInput,
  type CreateDscTokenInput,
  type DscClass,
  type DscUsage,
  type DscView,
  type ReleaseDscInput,
  type SetDscPinInput,
  type UpdateDscTokenInput,
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

// ── PS-305 · DSC register ────────────────────────────────────────────────

const DSC_VIEWS: DscView[] = ['all', 'at_risk', 'out', 'expiring', 'gone'];
const PAN = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;
const DIN = /^[0-9]{8}$/;

export class DscListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Holder, PAN, DIN, token serial or client.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: DSC_VIEWS })
  @IsOptional()
  @IsIn(DSC_VIEWS)
  view?: DscView;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  officeId?: string;

  @ApiPropertyOptional({ description: 'One token (the work link).' })
  @IsOptional()
  @IsUUID()
  id?: string;
}

export class CreateDscTokenDto implements CreateDscTokenInput {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  holderName!: string;

  @ApiPropertyOptional({ example: 'ABCDE1234F' })
  @IsOptional()
  @Matches(PAN, { message: 'holderPan must be a PAN like ABCDE1234F' })
  holderPan?: string | null;

  @ApiPropertyOptional({ example: '01234567' })
  @IsOptional()
  @Matches(DIN, { message: 'din must be 8 digits' })
  din?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  officeId?: string | null;

  @ApiPropertyOptional({ enum: DSC_CLASSES })
  @IsOptional()
  @IsIn(DSC_CLASSES)
  class?: DscClass;

  @ApiPropertyOptional({ enum: DSC_USAGES })
  @IsOptional()
  @IsIn(DSC_USAGES)
  usage?: DscUsage;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  issuer?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateOnly()
  validFrom?: string | null;

  @ApiProperty()
  @IsDateOnly()
  validTo!: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  tokenSerial?: string | null;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string | null;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiPropertyOptional({ description: 'Kept in the logins vault, never in the register.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  pin?: string | null;
}

export class UpdateDscTokenDto implements UpdateDscTokenInput {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  holderName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(PAN, { message: 'holderPan must be a PAN like ABCDE1234F' })
  holderPan?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DIN, { message: 'din must be 8 digits' })
  din?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string | null;

  @ApiPropertyOptional({ enum: DSC_CLASSES })
  @IsOptional()
  @IsIn(DSC_CLASSES)
  class?: DscClass;

  @ApiPropertyOptional({ enum: DSC_USAGES })
  @IsOptional()
  @IsIn(DSC_USAGES)
  usage?: DscUsage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  issuer?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateOnly()
  validFrom?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateOnly()
  validTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  tokenSerial?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class CheckOutDscDto implements CheckOutDscInput {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  withEmployeeId?: string | null;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  withName?: string | null;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  purpose!: string;

  @ApiProperty()
  @IsDateOnly()
  expectedBackOn!: string;
}

export class CheckInDscDto implements CheckInDscInput {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string | null;
}

export class ReleaseDscDto implements ReleaseDscInput {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ enum: ['returned_to_holder', 'lost'] })
  @IsIn(['returned_to_holder', 'lost'])
  status!: 'returned_to_holder' | 'lost';

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class SetDscPinDto implements SetDscPinInput {
  @ApiProperty({ maxLength: 64 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  pin!: string;
}
