import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  REGISTRATION_APPLICABILITIES,
  REGISTRATION_SOURCES,
  REGISTRATION_STATUSES,
  type RegistrationApplicability,
  type RegistrationSource,
  type RegistrationStatus,
} from '@hsdg/contracts';

/**
 * Partial update to an existing registration — the §34 "obtained later" flow:
 * enter the issued number/dates/jurisdiction and flip Pending → Active. Nullable
 * fields may be explicitly cleared. registration_type is immutable (create a new
 * registration for a different type).
 */
export class UpdateRegistrationDto {
  @ApiPropertyOptional({ example: '27AAACA1234A1Z5' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @MaxLength(40)
  registrationNumber?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  stateCode?: string | null;

  @ApiPropertyOptional({ enum: REGISTRATION_STATUSES })
  @IsOptional()
  @IsIn(REGISTRATION_STATUSES)
  status?: RegistrationStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  validFrom?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  validTo?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  jurisdiction?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  registrationDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  issuingAuthority?: string | null;

  @ApiPropertyOptional({ enum: REGISTRATION_SOURCES })
  @IsOptional()
  @IsIn(REGISTRATION_SOURCES)
  source?: RegistrationSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrincipal?: boolean;

  @ApiPropertyOptional({ enum: REGISTRATION_APPLICABILITIES })
  @IsOptional()
  @IsIn(REGISTRATION_APPLICABILITIES)
  applicability?: RegistrationApplicability;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  documentRef?: string | null;
}
