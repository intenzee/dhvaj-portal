import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CERTIFICATE_STATUSES,
  type CertificateFigures,
  type CertificateStatus,
  type CreateCertificateInput,
  type RecordForm15caInput,
  type ReviewCertificateInput,
  type RevokeCertificateInput,
  type SignCertificateInput,
  type UpdateCertificateInput,
} from '@hsdg/contracts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class VersionDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class CreateCertificateDto implements CreateCertificateInput {
  @ApiProperty({ example: 'CERT_NET_WORTH' })
  @IsString()
  @Matches(/^CERT_[A-Z0-9_]{2,40}$/)
  templateCode!: string;

  @ApiProperty({ example: 'Visa application' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  purpose!: string;

  @ApiProperty({ example: 'The Consulate General of …' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  addressee!: string;

  @ApiProperty({ type: Object })
  @IsObject()
  figures!: CertificateFigures;

  @ApiPropertyOptional({ description: 'Chooses the template version (default today).' })
  @IsOptional()
  @Matches(DATE)
  asOnDate?: string;
}

export class UpdateCertificateDto extends VersionDto implements UpdateCertificateInput {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  purpose?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  addressee?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  figures?: CertificateFigures;
}

export class CertificateVersionDto extends VersionDto {}

export class ReviewCertificateDto extends VersionDto implements ReviewCertificateInput {
  @ApiProperty({ enum: ['approve', 'return'] })
  @IsIn(['approve', 'return'])
  decision!: 'approve' | 'return';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class SignCertificateDto extends VersionDto implements SignCertificateInput {
  @ApiProperty({ example: '26123456ABCDEF1234' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  udin!: string;

  @ApiPropertyOptional({ description: 'Default today.' })
  @IsOptional()
  @Matches(DATE)
  signedOn?: string;

  @ApiPropertyOptional({
    description: 'When the UDIN was generated on the ICAI portal (default today).',
  })
  @IsOptional()
  @Matches(DATE)
  udinGeneratedOn?: string;
}

export class RevokeCertificateDto extends VersionDto implements RevokeCertificateInput {
  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class RecordForm15caDto extends VersionDto implements RecordForm15caInput {
  @ApiProperty({ example: '123456789012345' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  ackNo!: string;

  @ApiProperty()
  @Matches(DATE)
  filedOn!: string;
}

export class CertificateRegisterQueryDto {
  @ApiPropertyOptional({ enum: CERTIFICATE_STATUSES })
  @IsOptional()
  @IsIn(CERTIFICATE_STATUSES)
  status?: CertificateStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^CERT_[A-Z0-9_]{2,40}$/)
  template?: string;

  @ApiPropertyOptional({ description: 'Client name, certificate no. or UDIN.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
