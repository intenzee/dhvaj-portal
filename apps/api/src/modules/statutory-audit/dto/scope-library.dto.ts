import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  SCOPE_METHODOLOGY_KINDS,
  SCOPE_METHODOLOGY_STATUSES,
  type CreateScopeMethodologyItemVersionInput,
  type ScopeDecisionKind,
} from '@hsdg/contracts';
import { AnalyticsLibraryVersionDto } from './analytics-library.dto';

/** Append a version of a 03.4 Methodology Library item (03.4 §31). */
export class CreateScopeMethodologyItemVersionDto
  extends AnalyticsLibraryVersionDto
  implements CreateScopeMethodologyItemVersionInput
{
  @ApiProperty({ example: 'SMI-030' })
  @Matches(/^SMI-[0-9]{3}$/, { message: 'itemCode must look like SMI-001.' })
  itemCode!: string;

  @ApiProperty({ enum: SCOPE_METHODOLOGY_KINDS })
  @IsIn(SCOPE_METHODOLOGY_KINDS)
  kind!: ScopeDecisionKind;

  @ApiProperty({ example: 'fixed_assets' })
  @Matches(/^[a-z][a-z0-9_]{1,59}$/, { message: 'itemKey must be lower_snake_case.' })
  itemKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @ApiProperty({ isArray: true, enum: SCOPE_METHODOLOGY_STATUSES })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  @IsIn(SCOPE_METHODOLOGY_STATUSES, { each: true })
  options!: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  hint?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  guidance?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
