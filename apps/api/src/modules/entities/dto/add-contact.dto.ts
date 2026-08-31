import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CONTACT_TYPES, type ContactType } from '@hsdg/contracts';

export class ContactDto {
  @ApiProperty({ example: 'Ramesh Gupta' })
  @IsString()
  @MaxLength(200)
  fullName!: string;

  @ApiPropertyOptional({ example: 'Director' })
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiPropertyOptional({ example: 'ramesh@acme.example' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+91 98xxxxxxx0' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isSignatory?: boolean;

  @ApiPropertyOptional({ example: 'Finance' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ enum: CONTACT_TYPES })
  @IsOptional()
  @IsIn(CONTACT_TYPES)
  contactType?: ContactType;

  @ApiPropertyOptional({ default: false, description: 'Whether this contact is a portal user.' })
  @IsOptional()
  @IsBoolean()
  isPortalUser?: boolean;

  @ApiPropertyOptional({ description: 'Portal role — only when isPortalUser.' })
  @IsOptional()
  @IsString()
  portalRole?: string;
}
