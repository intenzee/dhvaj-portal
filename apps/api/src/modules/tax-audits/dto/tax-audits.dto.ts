import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  TAX_AUDIT_PRESUMPTIVE_SCHEMES,
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
