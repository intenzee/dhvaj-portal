import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import {
  CREDENTIAL_ACCOUNT,
  CREDENTIAL_PORTAL,
  type CredentialAccount,
  type CredentialPortal,
} from '@hsdg/contracts';

export class CredentialListQueryDto {
  @ApiPropertyOptional({ description: 'Every login of this client' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ description: 'The logins of one registration (a GSTIN or TAN)' })
  @IsOptional()
  @IsUUID()
  registrationId?: string;
}

export class SaveCredentialDto {
  @ApiProperty()
  @IsUUID()
  entityId!: string;

  @ApiPropertyOptional({ description: 'The GSTIN (GST) or TAN (TAN / deductor login) it is for' })
  @IsOptional()
  @IsUUID()
  registrationId?: string | null;

  @ApiProperty({ enum: Object.values(CREDENTIAL_PORTAL) })
  @IsIn(Object.values(CREDENTIAL_PORTAL))
  portal!: CredentialPortal;

  @ApiPropertyOptional({ enum: Object.values(CREDENTIAL_ACCOUNT), default: 'main' })
  @IsOptional()
  @IsIn(Object.values(CREDENTIAL_ACCOUNT))
  account?: CredentialAccount;

  @ApiPropertyOptional({ description: 'A GST login without its GSTIN: the state code, e.g. 07' })
  @IsOptional()
  @Matches(/^\d{2}$/)
  stateCode?: string | null;

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
