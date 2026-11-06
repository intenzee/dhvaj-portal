import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ATTENDANCE_ROW_MAX_MINUTES,
  INTERNAL_WORK_CATEGORIES,
  LEAVE_HALVES,
  LEAVE_TYPES,
  WORK_LOCATIONS,
  type LeaveHalf,
  type LeaveType,
  type OtherTimeCategory,
  type WorkLocation,
} from '@hsdg/contracts';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class LogWorkDto {
  @ApiProperty()
  @IsUUID()
  engagementId!: string;

  @ApiPropertyOptional({ description: 'The stream (engagement service).' })
  @IsOptional()
  @IsUUID()
  engagementServiceId?: string;

  @ApiPropertyOptional({
    description: 'The task worked on (a filing’s task puts the hours on it).',
  })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiProperty({ minimum: 1, maximum: ATTENDANCE_ROW_MAX_MINUTES })
  @IsInt()
  @Min(1)
  @Max(ATTENDANCE_ROW_MAX_MINUTES)
  minutes!: number;

  @ApiProperty({ enum: WORK_LOCATIONS })
  @IsIn(WORK_LOCATIONS)
  location!: WorkLocation;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class LogInternalDto {
  @ApiProperty({ enum: INTERNAL_WORK_CATEGORIES })
  @IsIn(INTERNAL_WORK_CATEGORIES)
  category!: OtherTimeCategory;

  @ApiProperty({ minimum: 1, maximum: ATTENDANCE_ROW_MAX_MINUTES })
  @IsInt()
  @Min(1)
  @Max(ATTENDANCE_ROW_MAX_MINUTES)
  minutes!: number;

  @ApiProperty({ enum: WORK_LOCATIONS })
  @IsIn(WORK_LOCATIONS)
  location!: WorkLocation;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class DayLocationDto {
  @ApiProperty({ enum: WORK_LOCATIONS })
  @IsIn(WORK_LOCATIONS)
  location!: WorkLocation;
}

export class UpdateDayEntryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: ATTENDANCE_ROW_MAX_MINUTES })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ATTENDANCE_ROW_MAX_MINUTES)
  minutes?: number;

  @ApiPropertyOptional({ enum: WORK_LOCATIONS })
  @IsOptional()
  @IsIn(WORK_LOCATIONS)
  location?: WorkLocation;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class PickEngagementsQueryDto {
  @ApiPropertyOptional({ description: 'Client name or engagement code.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class PickTasksQueryDto {
  @ApiProperty()
  @IsUUID()
  engagementId!: string;
}

export class ApplyLeaveDto {
  @ApiProperty({ enum: LEAVE_TYPES })
  @IsIn(LEAVE_TYPES)
  type!: LeaveType;

  @ApiProperty({ example: '2026-11-20' })
  @Matches(DAY)
  fromDay!: string;

  @ApiProperty({ example: '2026-11-21' })
  @Matches(DAY)
  toDay!: string;

  @ApiPropertyOptional({ enum: LEAVE_HALVES, description: 'A half day (one day only).' })
  @IsOptional()
  @IsIn(LEAVE_HALVES)
  half?: LeaveHalf;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class DecideLeaveDto {
  @ApiProperty()
  @IsBoolean()
  approve!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class HolidaysQueryDto {
  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class AddHolidayDto {
  @ApiProperty({ example: '2026-11-08' })
  @Matches(DAY)
  day!: string;

  @ApiProperty({ example: 'Diwali' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

class AllowancesDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  casual?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  sick?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  earned?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  unpaid?: number | null;
}

export class AttendanceSettingsDto {
  @ApiProperty({ minimum: 60, maximum: 960 })
  @IsInt()
  @Min(60)
  @Max(960)
  presentMinutes!: number;

  @ApiProperty({ minimum: 30, maximum: 900 })
  @IsInt()
  @Min(30)
  @Max(900)
  halfDayMinutes!: number;

  @ApiProperty({ type: AllowancesDto })
  @ValidateNested()
  @Type(() => AllowancesDto)
  allowances!: AllowancesDto;
}
