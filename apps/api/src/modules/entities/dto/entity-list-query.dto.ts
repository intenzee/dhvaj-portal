import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { ENTITY_STATUSES, type EntityStatus, type WorkSection } from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import { SectionQuery } from '../../../common/sections';

/** Pagination + filters for GET /entities (all params whitelisted). */
export class EntityListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ENTITY_STATUSES })
  @IsOptional()
  @IsIn(ENTITY_STATUSES)
  status?: EntityStatus;

  @ApiPropertyOptional({ description: 'Entity type slug filter.' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Home office code filter.' })
  @IsOptional()
  @IsString()
  office?: string;

  @ApiPropertyOptional({ description: 'Free-text search over name / code / PAN.' })
  @IsOptional()
  @IsString()
  search?: string;

  /** Clients with a live engagement in any of these sections (GST, Statutory Audit, …). */
  @SectionQuery()
  section?: WorkSection[];
}
