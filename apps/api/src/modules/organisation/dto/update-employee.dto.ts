import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { EMPLOYMENT_STATUSES, GRADE, type EmploymentStatus, type GradeSlug } from '@hsdg/contracts';

const GRADE_SLUGS = Object.values(GRADE);

/** All fields optional — a partial update. */
export class UpdateEmployeeDto {
  @ApiPropertyOptional({ example: 'Ravi Kumar' })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({ enum: GRADE_SLUGS })
  @IsOptional()
  @IsIn(GRADE_SLUGS)
  gradeSlug?: GradeSlug;

  @ApiPropertyOptional({ example: 'SOUTH' })
  @IsOptional()
  @IsString()
  officeCode?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Manager employee id, or null to clear.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  reportsToId?: string | null;

  @ApiPropertyOptional({ enum: EMPLOYMENT_STATUSES })
  @IsOptional()
  @IsIn(EMPLOYMENT_STATUSES)
  employmentStatus?: EmploymentStatus;

  @ApiPropertyOptional({ nullable: true, description: 'Date of exit (YYYY-MM-DD), or null.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  dateOfExit?: string | null;

  @ApiPropertyOptional({
    description: 'Expected current version for optimistic concurrency. Stale ⇒ 409.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
