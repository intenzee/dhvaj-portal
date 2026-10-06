import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/** Set (upsert) a person's planned-hours allocation on the audit file (§21, §24). */
export class SetTeamAllocationDto {
  @ApiProperty({ description: 'The employee this allocation is for.' })
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ description: 'Planned effort hours (zero or more).' })
  @IsNumber()
  @Min(0)
  plannedHours!: number;

  @ApiPropertyOptional({ description: 'Free-text responsibility, e.g. "Revenue lead".' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  responsibility?: string | null;
}

/** Apply "Balance the work" — all proposed moves, or those for these procedures. */
export class ApplyTeamBalanceDto {
  @ApiPropertyOptional({ type: [String], description: 'Only these procedures (default: all).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  procedureIds?: string[];
}
