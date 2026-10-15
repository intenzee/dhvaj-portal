import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CREDENTIAL_PORTAL, type CredentialPortal } from '@hsdg/contracts';

export class CredentialListQueryDto {
  @ApiPropertyOptional({ description: 'Every login of this client' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ description: 'The logins of one registration (a GSTIN)' })
  @IsOptional()
  @IsUUID()
  registrationId?: string;
}

export class SaveCredentialDto {
  @ApiProperty()
  @IsUUID()
  registrationId!: string;

  @ApiPropertyOptional({ enum: Object.values(CREDENTIAL_PORTAL), default: 'gst' })
  @IsOptional()
  @IsIn(Object.values(CREDENTIAL_PORTAL))
  portal?: CredentialPortal;

  @ApiProperty({ example: 'bharat_traders' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  username!: string;

  @ApiProperty({ description: 'Sealed before it is stored; never logged or returned by lists.' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
