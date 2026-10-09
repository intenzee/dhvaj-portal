import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { AddAuditRuleVersionInput } from '@hsdg/contracts';

/** Append a dated version to an audit rule (DHVAJ 02.2 spec §2). */
export class AddAuditRuleVersionDto implements AddAuditRuleVersionInput {
  @ApiProperty({ example: '2027-04-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'effectiveFrom must be YYYY-MM-DD.' })
  effectiveFrom!: string;

  @ApiProperty({
    nullable: true,
    description: 'Rupees for INR rules; null for condition-only rules.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  threshold!: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  thresholdHigh?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Structured parameters (JSON object).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsObject()
  condition?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(/^[a-z0-9_]{2,60}$/, { message: 'outcome must be a lower_snake_case key.' })
  outcome?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  authorityProvisionId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  guidanceReference?: string | null;

  @ApiProperty({ description: 'Why the rule changed — notification / amendment reference.' })
  @IsString()
  @MinLength(5, { message: 'Record why the rule changed (at least 5 characters).' })
  @MaxLength(2000)
  notes!: string;

  @ApiProperty()
  @IsInt()
  version!: number;
}
