import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  CALCULATION_BASES,
  COMPLIANCE_CATEGORIES,
  DUE_DATE_CATEGORIES,
  DUE_DATE_SOURCES,
  WORKING_DAY_ADJUSTMENTS,
  type CalculationBasis,
  type ComplianceCategory,
  type DueDateCategory,
  type DueDateSource,
  type WorkingDayAdjustment,
} from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

/** Parse a querystring boolean correctly — `Boolean('false')` is `true`, so coerce explicitly. */
const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreateComplianceRuleDto {
  @ApiProperty({ example: 'ITR_FILING_IND' })
  @Matches(/^[A-Z0-9_]{2,50}$/, { message: 'code must be UPPER_SNAKE (2–50 chars)' })
  code!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Link the obligation to a service by code.' })
  @IsOptional()
  @IsString()
  serviceCode?: string;

  @ApiPropertyOptional({ enum: COMPLIANCE_CATEGORIES })
  @IsOptional()
  @IsIn(COMPLIANCE_CATEGORIES)
  category?: ComplianceCategory;

  @ApiPropertyOptional({
    enum: DUE_DATE_CATEGORIES,
    default: 'NO_FIXED_DATE',
    description: 'Frozen due-date category (§2) — how the deadline is generated.',
  })
  @IsOptional()
  @IsIn(DUE_DATE_CATEGORIES)
  dueDateCategory?: DueDateCategory;

  @ApiPropertyOptional({
    enum: DUE_DATE_SOURCES,
    description: 'Due-date source (§3) — where the deadline’s authority comes from.',
  })
  @IsOptional()
  @IsIn(DUE_DATE_SOURCES)
  dueDateSource?: DueDateSource;
}

/** Amend a rule's due-date classification (§2 category / §3 source). */
export class UpdateComplianceRuleClassificationDto {
  @ApiPropertyOptional({ enum: DUE_DATE_CATEGORIES })
  @IsOptional()
  @IsIn(DUE_DATE_CATEGORIES)
  dueDateCategory?: DueDateCategory;

  @ApiPropertyOptional({
    enum: DUE_DATE_SOURCES,
    nullable: true,
    description: 'Set or clear (null) the due-date source.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(DUE_DATE_SOURCES)
  dueDateSource?: DueDateSource | null;
}

export class AddRuleVersionDto {
  @ApiProperty({ example: '2020-04-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({ example: '2027-03-31' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiProperty({ enum: CALCULATION_BASES })
  @IsIn(CALCULATION_BASES)
  calculationBasis!: CalculationBasis;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-120)
  @Max(120)
  offsetMonths?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-366)
  @Max(366)
  offsetDays?: number;

  @ApiPropertyOptional({ description: 'For fixed_date basis (1–12).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  fixedMonth?: number;

  @ApiPropertyOptional({ description: 'For fixed_date basis (1–31).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  fixedDay?: number;

  @ApiPropertyOptional({ enum: WORKING_DAY_ADJUSTMENTS, default: 'next' })
  @IsOptional()
  @IsIn(WORKING_DAY_ADJUSTMENTS)
  workingDayAdjustment?: WorkingDayAdjustment;

  @ApiPropertyOptional({
    default: 0,
    description: 'Buffer days before statutory for the internal SLA.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(366)
  internalSlaOffsetDays?: number;

  @ApiPropertyOptional({
    description:
      'Configurable conditional applicability, e.g. {"field":"turnover","op":">","value":10000000}.',
  })
  @IsOptional()
  @IsObject()
  condition?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class SetRuleActiveDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

export class ComplianceRuleListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: COMPLIANCE_CATEGORIES })
  @IsOptional()
  @IsIn(COMPLIANCE_CATEGORIES)
  category?: ComplianceCategory;

  @ApiPropertyOptional({
    enum: DUE_DATE_CATEGORIES,
    description: 'Filter by due-date category (§2).',
  })
  @IsOptional()
  @IsIn(DUE_DATE_CATEGORIES)
  dueDateCategory?: DueDateCategory;

  @ApiPropertyOptional({ enum: DUE_DATE_SOURCES, description: 'Filter by due-date source (§3).' })
  @IsOptional()
  @IsIn(DUE_DATE_SOURCES)
  dueDateSource?: DueDateSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serviceCode?: string;

  @ApiPropertyOptional({ description: 'Only active rules.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  activeOnly?: boolean;

  @ApiPropertyOptional({ description: 'Case-insensitive match on rule code or name.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class AddHolidayDto {
  @ApiProperty({ example: '2026-08-15' })
  @IsDateString()
  date!: string;

  @ApiProperty({ example: 'Independence Day' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;
}
