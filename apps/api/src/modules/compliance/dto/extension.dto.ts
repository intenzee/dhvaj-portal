import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

/** Create (import) a government extension (§19) — a firm-wide overlay record. */
export class CreateGovernmentExtensionDto {
  @ApiProperty({
    example: 'GST_GSTR3B',
    description: 'The compliance rule this extension revises.',
  })
  @Matches(/^[A-Z0-9_]{2,50}$/, { message: 'complianceRuleCode must be UPPER_SNAKE' })
  complianceRuleCode!: string;

  @ApiProperty({ example: '2026-01-20', description: 'The original statutory date (retained).' })
  @IsDateString()
  originalDueDate!: string;

  @ApiProperty({ example: '2026-01-31', description: 'The revised operative date.' })
  @IsDateString()
  revisedDueDate!: string;

  @ApiProperty({
    example: 'CBIC Notification 01/2026',
    description: 'Authority / source reference.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  notificationReference!: string;

  @ApiProperty({
    example: 'All GSTR-3B filers, turnover ≤ ₹5cr',
    description: 'Who the extension applies to (§19 applicable population).',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  applicablePopulation!: string;

  @ApiProperty({ example: '2026-01-18', description: 'When the extension becomes operative.' })
  @IsDateString()
  effectiveDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** `?complianceRuleCode=` filter on the government-extension list. */
export class GovernmentExtensionListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by the compliance rule code the extension revises.' })
  @IsOptional()
  @IsString()
  complianceRuleCode?: string;
}
