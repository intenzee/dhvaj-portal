import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ENGAGEMENT_STATUSES, type EngagementStatus } from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Pagination + filters for GET /engagements (all params whitelisted). */
export class EngagementListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ENGAGEMENT_STATUSES })
  @IsOptional()
  @IsIn(ENGAGEMENT_STATUSES)
  status?: EngagementStatus;

  @ApiPropertyOptional({ description: 'Filter by client entity id.' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ description: 'Filter by service code.' })
  @IsOptional()
  @IsString()
  serviceCode?: string;

  @ApiPropertyOptional({ description: 'Filter by servicing office code.' })
  @IsOptional()
  @IsString()
  officeCode?: string;

  @ApiPropertyOptional({ description: 'Only engagements the caller is assigned to.' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  mine?: boolean;
}
