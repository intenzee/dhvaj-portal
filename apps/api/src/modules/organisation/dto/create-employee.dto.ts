import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { EMPLOYMENT_STATUSES, GRADE, type EmploymentStatus, type GradeSlug } from '@hsdg/contracts';

const GRADE_SLUGS = Object.values(GRADE);

export class CreateEmployeeDto {
  @ApiProperty({ example: 'EMP009', description: 'Unique employee code (A–Z, 0–9, -, _).' })
  @Matches(/^[A-Z0-9_-]{2,20}$/)
  employeeCode!: string;

  @ApiProperty({ example: 'Ravi Kumar' })
  @IsString()
  fullName!: string;

  @ApiProperty({ enum: GRADE_SLUGS, example: GRADE.senior })
  @IsIn(GRADE_SLUGS)
  gradeSlug!: GradeSlug;

  @ApiProperty({ example: 'NORTH', description: 'Office code.' })
  @IsString()
  officeCode!: string;

  @ApiProperty({ example: '2024-06-01', description: 'Date of joining (YYYY-MM-DD).' })
  @IsDateString()
  dateOfJoining!: string;

  @ApiPropertyOptional({ description: 'Link to an auth user id.' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Manager (reporting line) employee id.' })
  @IsOptional()
  @IsUUID()
  reportsToId?: string;

  @ApiPropertyOptional({ enum: EMPLOYMENT_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(EMPLOYMENT_STATUSES)
  employmentStatus?: EmploymentStatus;
}
