import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  TAX_AUDIT_OBSERVATION_KINDS,
  TAX_AUDIT_REVIEW_LEVELS,
  type DecideTaxAuditObservationInput,
  type EditTaxAuditObservationInput,
  type FlagTaxAuditObservationInput,
  type RaiseTaxAuditReviewPointInput,
  type RespondTaxAuditReviewPointInput,
  type SignOffTaxAuditReviewInput,
  type TaxAuditObservationKind,
  type TaxAuditReviewLevel,
} from '@hsdg/contracts';
import { TaxAuditVersionDto } from './tax-audit-workspace.dto';

export class SignOffTaxAuditReviewDto
  extends TaxAuditVersionDto
  implements SignOffTaxAuditReviewInput
{
  @ApiProperty({ enum: TAX_AUDIT_REVIEW_LEVELS })
  @IsIn(TAX_AUDIT_REVIEW_LEVELS)
  level!: TaxAuditReviewLevel;
}

export class RaiseTaxAuditReviewPointDto implements RaiseTaxAuditReviewPointInput {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;

  @ApiPropertyOptional({ description: 'The clause’s working paper; leave out for the report.' })
  @IsOptional()
  @IsUUID()
  workingPaperId?: string;
}

export class RespondTaxAuditReviewPointDto
  extends TaxAuditVersionDto
  implements RespondTaxAuditReviewPointInput
{
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  response!: string;
}

export class FlagTaxAuditObservationDto implements FlagTaxAuditObservationInput {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  wording!: string;

  @ApiPropertyOptional({ description: 'The clause’s working paper; leave out for the report.' })
  @IsOptional()
  @IsUUID()
  workingPaperId?: string;
}

export class EditTaxAuditObservationDto
  extends TaxAuditVersionDto
  implements EditTaxAuditObservationInput
{
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  wording!: string;
}

const OUTCOMES = [...TAX_AUDIT_OBSERVATION_KINDS, 'dropped'] as const;

export class DecideTaxAuditObservationDto
  extends TaxAuditVersionDto
  implements DecideTaxAuditObservationInput
{
  @ApiProperty({ enum: OUTCOMES })
  @IsIn(OUTCOMES)
  outcome!: TaxAuditObservationKind | 'dropped';

  @ApiPropertyOptional({ description: 'Required when it stays out of the report.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
