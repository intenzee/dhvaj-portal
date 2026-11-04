import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBase64,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsNotEmpty,
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
  TAX_AUDIT_FORMS,
  TAX_AUDIT_PRESUMPTIVE_SCHEMES,
  type SaveTaxAuditAcceptanceInput,
  type SaveTaxAuditMilestoneInput,
  type TaxAuditAcceptanceStepInput,
  type TaxAuditForm,
  type UploadPreviousAuditorLetterInput,
  type SaveTaxAuditApplicabilityInput,
  type TaxAuditApplicabilityInput,
  type TaxAuditPresumptiveScheme,
} from '@hsdg/contracts';

/** ₹10,000 crore: well past any client, and inside numeric(14,2). */
const MAX_RUPEES = 1e11;

export class TaxAuditApplicabilityInputDto implements TaxAuditApplicabilityInput {
  @ApiPropertyOptional({ nullable: true, description: 'Business turnover, ₹ (null: no business).' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_RUPEES)
  businessTurnover!: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Professional receipts, ₹ (null: none).' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_RUPEES)
  professionReceipts!: number | null;

  @ApiProperty({ description: 'Cash receipts and cash payments each within 5%.' })
  @IsBoolean()
  cashWithinFivePercent!: boolean;

  @ApiPropertyOptional({ enum: TAX_AUDIT_PRESUMPTIVE_SCHEMES, nullable: true })
  @IsOptional()
  @IsIn(TAX_AUDIT_PRESUMPTIVE_SCHEMES)
  presumptiveScheme!: TaxAuditPresumptiveScheme | null;

  @ApiProperty({ description: 'Declares less profit than the scheme deems.' })
  @IsBoolean()
  profitBelowPresumptive!: boolean;

  @ApiProperty({ description: 'Total income over the basic exemption limit.' })
  @IsBoolean()
  incomeAboveExemption!: boolean;

  @ApiProperty({ description: 'Left s.44AD within five years of opting in (s.44AD(4)).' })
  @IsBoolean()
  optedOutOf44AD!: boolean;
}

export class TaxAuditOverrideDto {
  @ApiProperty()
  @IsBoolean()
  applicable!: boolean;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  @Matches(/\S/, { message: 'Give the reason for overriding the calculator.' })
  reason!: string;
}

export class SaveTaxAuditApplicabilityDto implements SaveTaxAuditApplicabilityInput {
  @ApiProperty({ type: TaxAuditApplicabilityInputDto })
  @ValidateNested()
  @Type(() => TaxAuditApplicabilityInputDto)
  inputs!: TaxAuditApplicabilityInputDto;

  @ApiPropertyOptional({ type: TaxAuditOverrideDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TaxAuditOverrideDto)
  override!: TaxAuditOverrideDto | null;

  @ApiPropertyOptional({ description: 'The decision’s version, when changing it.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class TaxAuditRadarQueryDto {
  @ApiProperty({ example: '2026-27' })
  @Matches(/^[0-9]{4}-[0-9]{2}$/, { message: 'The financial year must look like 2026-27.' })
  financialYear!: string;

  @ApiPropertyOptional({
    description: 'Every Compliance year, not only the likely ones — to work one out.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  all?: boolean;
}

/** F-3: PUT …/acceptance — any subset, with the version read. */
export class SaveTaxAuditAcceptanceDto implements SaveTaxAuditAcceptanceInput {
  @ApiProperty({ description: 'The tax audit’s version; a stale one is a 409.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ enum: TAX_AUDIT_FORMS, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(TAX_AUDIT_FORMS)
  formType?: TaxAuditForm | null;

  @ApiPropertyOptional({ nullable: true, description: 'A partner with a valid COP and room.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  signingPartnerId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Another firm signed last year’s report (null: not answered).',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsBoolean()
  previousAuditorChanged?: boolean | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(200)
  previousAuditorName?: string | null;
}

/** F-3: the written communication to the previous auditor. */
export class UploadPreviousAuditorLetterDto implements UploadPreviousAuditorLetterInput {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

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

/** F-3: make the appointment letter / accept. */
export class TaxAuditAcceptanceStepDto implements TaxAuditAcceptanceStepInput {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ description: 'A template variant, when the firm has several.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  variantKey?: string;
}

/** F-9: PUT …/milestones/:milestone — tick or untick, and/or name its owner. */
export class SaveTaxAuditMilestoneDto implements SaveTaxAuditMilestoneInput {
  @ApiPropertyOptional({ description: 'Done (true) or not yet (false).' })
  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The person who answers for it; null puts it back to the role’s person.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  ownerId?: string | null;
}

/** F-9: GET /tax-audits/board. */
export class TaxAuditBoardQueryDto {
  @ApiProperty({ example: '2025-26' })
  @Matches(/^[0-9]{4}-[0-9]{2}$/, { message: 'The financial year must look like 2025-26.' })
  financialYear!: string;
}
