import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OTHER_REPORTING_CONCLUSIONS, type OtherReportingOutcome } from '@hsdg/contracts';

/** One accounting software/module assessed for the Rule 11(g) audit trail. */
export class SoftwareSystemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasAuditTrailFeature?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  auditTrailOperatedAllYear?: boolean;
}

/** Capture the 02.7-specific facts (guide §9.7). */
export class SetOtherReportingFactsDto {
  @ApiPropertyOptional({ type: [SoftwareSystemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SoftwareSystemDto)
  softwareSystems?: SoftwareSystemDto[];

  @ApiPropertyOptional({ nullable: true, description: 'Managerial remuneration paid (₹).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  managerialRemunerationPaid?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Section 198 net profit (₹).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  section198NetProfit?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasManagingOrWholeTimeDirector?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  fraudIdentified?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Fraud amount (₹).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  fraudAmount?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Legally relevant fraud event date (ISO).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  fraudEventDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  intermediaryFundsAdvanced?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ultimateBeneficiaryFundsReceived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  fundingRepresentationsObtained?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  dividendCompliesSec123?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  pendingLitigationDisclosed?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  foreseeableLossesProvided?: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  iepfTransferDelay?: boolean | null;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Record the professional conclusion for 02.7 (override needs a basis, §19). */
export class RecordOtherReportingDecisionDto {
  @ApiProperty({ enum: OTHER_REPORTING_CONCLUSIONS })
  @IsIn(OTHER_REPORTING_CONCLUSIONS)
  conclusion!: OtherReportingOutcome;

  @ApiPropertyOptional({
    description: 'Required when the conclusion overrides the system suggestion.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  basis?: string;

  @ApiPropertyOptional({ description: 'Downstream impact note.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  impact?: string;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}
