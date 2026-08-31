import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ACCOUNTING_FRAMEWORKS,
  ENTITY_STATUSES,
  LEGAL_STATUSES,
  LISTING_STATUSES,
  PAN_REGEX,
  type AccountingFramework,
  type EntityStatus,
  type LegalStatus,
  type ListingStatus,
} from '@hsdg/contracts';
import { RegistrationDto } from './add-registration.dto';
import { ContactDto } from './add-contact.dto';
import { AddressDto } from './add-address.dto';
import { BusinessActivityDto } from './add-business-activity.dto';
import { ListingDto } from './add-listing.dto';
import { RegulatoryAttributeDto } from './add-regulatory-attribute.dto';
import { AddFinancialProfileDto } from './add-financial-profile.dto';
import { ActivitiesDto } from './activities.dto';

export class CreateEntityDto {
  @ApiProperty({ example: 'Acme Manufacturing Pvt Ltd' })
  @IsString()
  @MaxLength(300)
  legalName!: string;

  @ApiPropertyOptional({ example: 'Acme' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ example: 'Acme Corp', description: 'Trade / brand name.' })
  @IsOptional()
  @IsString()
  tradeName?: string;

  @ApiPropertyOptional({ description: 'Internal short name.' })
  @IsOptional()
  @IsString()
  shortName?: string;

  @ApiProperty({ example: 'private_limited', description: 'Entity type slug.' })
  @IsString()
  typeSlug!: string;

  @ApiProperty({ example: 'NORTH', description: 'Home office code.' })
  @IsString()
  officeCode!: string;

  @ApiPropertyOptional({ description: 'Owning client relationship id (§2).' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ example: 'IN', description: 'ISO-3166 alpha-2; default IN.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{2}$/, { message: 'countryOfIncorporation must be a 2-letter code' })
  countryOfIncorporation?: string;

  @ApiPropertyOptional({ enum: LEGAL_STATUSES })
  @IsOptional()
  @IsIn(LEGAL_STATUSES)
  legalStatus?: LegalStatus;

  @ApiPropertyOptional({ enum: LISTING_STATUSES, default: 'unlisted' })
  @IsOptional()
  @IsIn(LISTING_STATUSES)
  listingStatus?: ListingStatus;

  @ApiPropertyOptional({ enum: ACCOUNTING_FRAMEWORKS, default: 'not_assessed' })
  @IsOptional()
  @IsIn(ACCOUNTING_FRAMEWORKS)
  currentAccountingFramework?: AccountingFramework;

  @ApiPropertyOptional({ description: 'Registrar of Companies (company/LLP).' })
  @IsOptional()
  @IsString()
  roc?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  authorisedCapital?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  paidUpCapital?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  llpContribution?: number;

  @ApiPropertyOptional({ description: 'Business description (§18).' })
  @IsOptional()
  @IsString()
  businessDescription?: string;

  @ApiPropertyOptional({ type: ActivitiesDto, description: 'Business-activity flags (§18).' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ActivitiesDto)
  activities?: ActivitiesDto;

  @ApiPropertyOptional({ example: 'AAACA1234A', description: 'PAN (unique when set).' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(PAN_REGEX, { message: 'pan must be a valid PAN (e.g. AAACA1234A)' })
  pan?: string;

  @ApiPropertyOptional({ description: 'Parent/holding entity id (group structure).' })
  @IsOptional()
  @IsUUID()
  parentEntityId?: string;

  @ApiPropertyOptional({ enum: ENTITY_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(ENTITY_STATUSES)
  status?: EntityStatus;

  @ApiPropertyOptional({ example: '2015-04-10' })
  @IsOptional()
  @IsDateString()
  incorporationDate?: string;

  @ApiPropertyOptional({ type: [RegistrationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegistrationDto)
  registrations?: RegistrationDto[];

  @ApiPropertyOptional({ type: [ContactDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts?: ContactDto[];

  @ApiPropertyOptional({ type: [AddressDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddressDto)
  addresses?: AddressDto[];

  @ApiPropertyOptional({ type: [BusinessActivityDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BusinessActivityDto)
  businessActivities?: BusinessActivityDto[];

  @ApiPropertyOptional({ type: [ListingDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ListingDto)
  listings?: ListingDto[];

  @ApiPropertyOptional({ type: [RegulatoryAttributeDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegulatoryAttributeDto)
  regulatoryAttributes?: RegulatoryAttributeDto[];

  @ApiPropertyOptional({ type: [AddFinancialProfileDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddFinancialProfileDto)
  financialProfiles?: AddFinancialProfileDto[];
}
