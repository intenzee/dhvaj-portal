import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  REGISTRATION_STATUSES,
  REGISTRATION_TYPES,
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
}
