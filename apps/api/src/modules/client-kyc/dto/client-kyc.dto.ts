import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  KYC_GATES,
  KYC_RISK_RATINGS,
  KYC_STATUSES,
  type BeneficialOwner,
  type CompleteClientKycInput,
  type KycGate,
  type KycRiskRating,
  type KycStatus,
  type SaveClientKycInput,
  type UpdateKycSettingsInput,
} from '@hsdg/contracts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class BeneficialOwnerDto implements BeneficialOwner {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/, { message: 'A PAN is AAAAA9999A.' })
  pan!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^\d{1,3}(\.\d{1,2})?$/, { message: 'The holding is a percentage (up to 2 decimals).' })
  holdingPercent!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  role!: string | null;
}

export class SaveClientKycDto implements SaveClientKycInput {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  panVerified?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(DATE)
  panVerifiedOn?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  addressProofDocumentId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  identityProofDocumentIds?: string[];

  @ApiPropertyOptional({ type: [BeneficialOwnerDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BeneficialOwnerDto)
  beneficialOwners?: BeneficialOwnerDto[];

  @ApiPropertyOptional({ enum: KYC_RISK_RATINGS, nullable: true })
  @IsOptional()
  @IsIn([...KYC_RISK_RATINGS, null])
  riskRating?: KycRiskRating | null;

  @ApiPropertyOptional({ description: 'Checklist item code → done.' })
  @IsOptional()
  @IsObject()
  checklist?: Record<string, boolean>;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @ApiProperty({ description: '0 for the first save.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}

export class CompleteClientKycDto implements CompleteClientKycInput {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE)
  reviewedOn?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class UpdateKycSettingsDto implements UpdateKycSettingsInput {
  @ApiPropertyOptional({ enum: KYC_GATES })
  @IsOptional()
  @IsIn(KYC_GATES)
  gate?: KycGate;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  reviewYearsHigh?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  reviewYearsOther?: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class KycRegisterQueryDto {
  @ApiPropertyOptional({ enum: [...KYC_STATUSES, 'open'] })
  @IsOptional()
  @IsIn([...KYC_STATUSES, 'open'])
  status?: KycStatus | 'open';

  @ApiPropertyOptional({ enum: KYC_RISK_RATINGS })
  @IsOptional()
  @IsIn(KYC_RISK_RATINGS)
  risk?: KycRiskRating;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
