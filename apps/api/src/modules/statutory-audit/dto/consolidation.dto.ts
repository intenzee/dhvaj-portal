import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CONSOLIDATION_CONCLUSIONS, type ConsolidationOutcome } from '@hsdg/contracts';

/** One investee in the consolidation perimeter (guide §9.6). */
export class InvesteeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Ownership / voting %.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  @Max(100)
  ownershipPercent?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Captured control judgment (overrides the ownership presumption); null = use presumption.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  hasControl?: boolean | null;

  @ApiPropertyOptional({ description: 'A contractual joint arrangement.' })
  @IsOptional()
  @IsBoolean()
  isJointArrangement?: boolean;

  @ApiPropertyOptional({ description: 'A joint operation (line-by-line), not a joint venture.' })
  @IsOptional()
  @IsBoolean()
  jointArrangementIsOperation?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      '20% significant-influence rebuttal: true = rebutted; false = SI despite <20%; null = presumption.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  significantInfluenceRebutted?: boolean | null;

  @ApiPropertyOptional({ description: 'Component audited by another auditor → SA 600.' })
  @IsOptional()
  @IsBoolean()
  auditedByOtherAuditor?: boolean;
}

/** Capture the 02.6-specific facts (guide §9.6). */
export class SetConsolidationFactsDto {
  @ApiPropertyOptional({
    type: [InvesteeDto],
    description: 'Replaces the whole investee perimeter.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvesteeDto)
  investees?: InvesteeDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isWhollyOwnedSubsidiary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPartiallyOwnedSubsidiary?: boolean;

  @ApiPropertyOptional({
    description: 'All other members intimated in writing and no objection (proof).',
  })
  @IsOptional()
  @IsBoolean()
  otherMembersIntimatedNoObjection?: boolean;

  @ApiPropertyOptional({ description: 'Securities listed or in the process of listing.' })
  @IsOptional()
  @IsBoolean()
  securitiesListedOrInProcess?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'An intermediate/ultimate parent files compliant CFS (null = unknown).',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsBoolean()
  parentFilesCompliantCfs?: boolean | null;

  @ApiPropertyOptional({
    description: 'The entity has branches (§143(8) branch-auditor framework).',
  })
  @IsOptional()
  @IsBoolean()
  hasBranches?: boolean;

  @ApiProperty({ description: 'Optimistic-concurrency version last seen.' })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Record the professional CFS conclusion for 02.6 (override needs a basis, §19). */
export class RecordConsolidationDecisionDto {
  @ApiProperty({ enum: CONSOLIDATION_CONCLUSIONS })
  @IsIn(CONSOLIDATION_CONCLUSIONS)
  conclusion!: ConsolidationOutcome;

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
