import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { StartExitInput } from '@hsdg/contracts';

/** POST /people/employees/:id/exit. */
export class StartExitDto implements StartExitInput {
  @ApiProperty({ example: '2026-11-30', description: 'Last day (YYYY-MM-DD).' })
  @IsDateString({ strict: true })
  dateOfExit!: string;

  @ApiPropertyOptional({ description: 'Why — kept on the audit entry only.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: 'The employee version you loaded (409 if stale).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
