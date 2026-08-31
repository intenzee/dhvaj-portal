import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  REGISTRATION_APPLICABILITIES,
  REGISTRATION_SOURCES,
  REGISTRATION_STATUSES,
  REGISTRATION_TYPES,
  type RegistrationApplicability,
  type RegistrationSource,
  type RegistrationStatus,
  type RegistrationType,
} from '@hsdg/contracts';

export class RegistrationDto {
  @ApiProperty({ enum: REGISTRATION_TYPES, example: 'gstin' })
  @IsIn(REGISTRATION_TYPES)
  registrationType!: RegistrationType;

  @ApiProperty({ example: '27AAACA1234A1Z5' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @MaxLength(40)
  registrationNumber!: string;

  @ApiPropertyOptional({ example: '27', description: 'State code (GSTIN).' })
  @IsOptional()
  @IsString()
  stateCode?: string;

  @ApiPropertyOptional({ enum: REGISTRATION_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(REGISTRATION_STATUSES)
  status?: RegistrationStatus;

  @ApiPropertyOptional({ example: '2017-07-01' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validTo?: string;

  @ApiPropertyOptional({ description: 'Authority jurisdiction (broader than state).' })
  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @ApiPropertyOptional({ example: '2017-07-01', description: 'Date the registration was granted.' })
  @IsOptional()
  @IsDateString()
  registrationDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  issuingAuthority?: string;

  @ApiPropertyOptional({ enum: REGISTRATION_SOURCES, default: 'client' })
  @IsOptional()
  @IsIn(REGISTRATION_SOURCES)
  source?: RegistrationSource;

  @ApiPropertyOptional({
    default: true,
    description: 'Principal (vs additional) place of business.',
  })
  @IsOptional()
  @IsBoolean()
  isPrincipal?: boolean;

  @ApiPropertyOptional({
    enum: REGISTRATION_APPLICABILITIES,
    default: 'unknown',
    description: 'Applicability — a separate axis from status (§12).',
  })
  @IsOptional()
  @IsIn(REGISTRATION_APPLICABILITIES)
  applicability?: RegistrationApplicability;

  @ApiPropertyOptional({ description: 'Soft link to the certificate/evidence.' })
  @IsOptional()
  @IsString()
  documentRef?: string;
}
