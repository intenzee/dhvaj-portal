import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ENTITY_STATUSES, PAN_REGEX, type EntityStatus } from '@hsdg/contracts';
import { RegistrationDto } from './add-registration.dto';
import { ContactDto } from './add-contact.dto';

export class CreateEntityDto {
  @ApiProperty({ example: 'Acme Manufacturing Pvt Ltd' })
  @IsString()
  @MaxLength(300)
  legalName!: string;

  @ApiPropertyOptional({ example: 'Acme' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ example: 'private_limited', description: 'Entity type slug.' })
  @IsString()
  typeSlug!: string;

  @ApiProperty({ example: 'NORTH', description: 'Home office code.' })
  @IsString()
  officeCode!: string;

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
}
