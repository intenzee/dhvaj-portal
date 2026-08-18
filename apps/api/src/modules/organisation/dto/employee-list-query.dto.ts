import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { EMPLOYMENT_STATUSES, type EmploymentStatus } from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

/** Pagination + filters for GET /employees (all params whitelisted). */
export class EmployeeListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EMPLOYMENT_STATUSES })
  @IsOptional()
  @IsIn(EMPLOYMENT_STATUSES)
  status?: EmploymentStatus;

  @ApiPropertyOptional({ description: 'Grade slug filter.' })
  @IsOptional()
  @IsString()
  grade?: string;

  @ApiPropertyOptional({ description: 'Office code filter.' })
  @IsOptional()
  @IsString()
  office?: string;
}
