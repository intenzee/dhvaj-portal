import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Pagination + filters for GET /services (all params whitelisted). */
export class ServiceListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Service line code filter.' })
  @IsOptional()
  @IsString()
  serviceLine?: string;

  @ApiPropertyOptional({ description: 'Active flag filter.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Free-text search over name / code.' })
  @IsOptional()
  @IsString()
  search?: string;
}
