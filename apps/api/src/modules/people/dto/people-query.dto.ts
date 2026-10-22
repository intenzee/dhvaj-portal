import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, Matches } from 'class-validator';

/** GET /people/attendance, /me/attendance — an IST date range (at most 93 days). */
export class AttendanceQueryDto {
  @ApiProperty({ example: '2026-10-01', description: 'First day (YYYY-MM-DD, IST).' })
  @IsDateString({ strict: true })
  from!: string;

  @ApiProperty({ example: '2026-10-31', description: 'Last day (YYYY-MM-DD, IST).' })
  @IsDateString({ strict: true })
  to!: string;
}

/** GET /people/workload — the week the hours cover (any day in it; defaults to this week). */
export class WorkloadQueryDto {
  @ApiPropertyOptional({ example: '2026-10-19' })
  @IsOptional()
  @IsDateString({ strict: true })
  week?: string;
}

/** GET /people/reports/hours — one month. */
export class MonthlyHoursQueryDto {
  @ApiProperty({ example: '2026-10', description: 'YYYY-MM.' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month!: string;
}
