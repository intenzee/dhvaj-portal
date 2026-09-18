import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

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
