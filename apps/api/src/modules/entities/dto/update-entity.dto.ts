import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ActivitiesDto } from './activities.dto';
import {
  ACCOUNTING_FRAMEWORKS,
  ENTITY_STATUSES,
  LEGAL_STATUSES,
  LISTING_STATUSES,
  PAN_REGEX,
  REGULATORY_PROFILE_STATUSES,
  type AccountingFramework,
  type EntityStatus,
  type LegalStatus,
  type ListingStatus,
  type RegulatoryProfileStatus,
} from '@hsdg/contracts';

/** All fields optional — a partial update. */
export class UpdateEntityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legalName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  displayName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  typeSlug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  officeCode?: string;

  @ApiPropertyOptional({ nullable: true, example: 'AAACA1234A' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(PAN_REGEX, { message: 'pan must be a valid PAN (e.g. AAACA1234A)' })
  pan?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  parentEntityId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Owning client relationship id (§2).' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  clientId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  tradeName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  shortName?: string | null;

  @ApiPropertyOptional({ example: 'IN' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{2}$/, { message: 'countryOfIncorporation must be a 2-letter code' })
  countryOfIncorporation?: string;

  @ApiPropertyOptional({ enum: ENTITY_STATUSES })
  @IsOptional()
  @IsIn(ENTITY_STATUSES)
  status?: EntityStatus;

  @ApiPropertyOptional({ nullable: true, enum: LEGAL_STATUSES })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(LEGAL_STATUSES)
  legalStatus?: LegalStatus | null;

  @ApiPropertyOptional({ enum: REGULATORY_PROFILE_STATUSES })
  @IsOptional()
  @IsIn(REGULATORY_PROFILE_STATUSES)
  regulatoryProfileStatus?: RegulatoryProfileStatus;

  @ApiPropertyOptional({ enum: LISTING_STATUSES })
  @IsOptional()
  @IsIn(LISTING_STATUSES)
  listingStatus?: ListingStatus;

  @ApiPropertyOptional({ enum: ACCOUNTING_FRAMEWORKS })
  @IsOptional()
  @IsIn(ACCOUNTING_FRAMEWORKS)
  currentAccountingFramework?: AccountingFramework;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  roc?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  authorisedCapital?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  paidUpCapital?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  llpContribution?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  businessDescription?: string | null;

  @ApiPropertyOptional({ type: ActivitiesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ActivitiesDto)
  activities?: ActivitiesDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  incorporationDate?: string | null;

  @ApiPropertyOptional({
    description: 'Expected version for optimistic concurrency (stale ⇒ 409).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
