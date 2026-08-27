import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  COMPONENT_APPLICABILITY_DEFAULTS,
  DUE_DATE_CATEGORIES,
  DUE_DATE_SOURCES,
  RECURRENCES,
  type ComponentApplicabilityDefault,
  type DueDateCategory,
  type DueDateSource,
  type Recurrence,
} from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreateServiceComponentDto {
  @ApiProperty({ description: 'Service code the component belongs to.', example: 'GST_MONTHLY' })
  @IsString()
  @IsNotEmpty()
  serviceCode!: string;

  @ApiProperty({ example: 'GSTR1' })
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

  @ApiPropertyOptional({ enum: COMPONENT_APPLICABILITY_DEFAULTS, default: 'optional' })
  @IsOptional()
  @IsIn(COMPONENT_APPLICABILITY_DEFAULTS)
  defaultApplicability?: ComponentApplicabilityDefault;

  @ApiPropertyOptional({ enum: RECURRENCES, default: 'as_required' })
  @IsOptional()
  @IsIn(RECURRENCES)
  defaultFrequency?: Recurrence;

  @ApiPropertyOptional({
    enum: DUE_DATE_CATEGORIES,
    default: 'NO_FIXED_DATE',
    description: 'Frozen due-date category (§2/§6–§15) — how the deadline is generated.',
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

  @ApiPropertyOptional({ description: 'Link the component to a compliance rule by code.' })
  @IsOptional()
  @IsString()
  complianceRuleCode?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateServiceComponentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ enum: COMPONENT_APPLICABILITY_DEFAULTS })
  @IsOptional()
  @IsIn(COMPONENT_APPLICABILITY_DEFAULTS)
  defaultApplicability?: ComponentApplicabilityDefault;

  @ApiPropertyOptional({ enum: RECURRENCES })
  @IsOptional()
  @IsIn(RECURRENCES)
  defaultFrequency?: Recurrence;

  @ApiPropertyOptional({ enum: DUE_DATE_CATEGORIES })
  @IsOptional()
  @IsIn(DUE_DATE_CATEGORIES)
  dueDateCategory?: DueDateCategory;

  @ApiPropertyOptional({ enum: DUE_DATE_SOURCES, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(DUE_DATE_SOURCES)
  dueDateSource?: DueDateSource | null;

  @ApiPropertyOptional({ description: 'Set or clear (null) the linked compliance rule by code.' })
  @IsOptional()
  @IsString()
  complianceRuleCode?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ServiceComponentListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by service code.' })
  @IsOptional()
  @IsString()
  serviceCode?: string;

  @ApiPropertyOptional({ description: 'Filter by service id.' })
  @IsOptional()
  @IsString()
  serviceId?: string;

  @ApiPropertyOptional({ description: 'Only active components.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  activeOnly?: boolean;
}
