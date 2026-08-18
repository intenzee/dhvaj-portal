import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, type Paginated } from '@hsdg/contracts';

/** Reusable `?limit=&offset=` query for list endpoints. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: DEFAULT_PAGE_LIMIT, maximum: MAX_PAGE_LIMIT, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

/** Limit/offset a service method reads. */
export interface PageParams {
  limit: number;
  offset: number;
}

/** What a paginated service method returns: the page plus the pre-limit total. */
export interface PageResult<T> {
  items: T[];
  total: number;
}

/** Assemble the standard paginated envelope from a service result. */
export function paginate<T>(result: PageResult<T>, page: PaginationQueryDto): Paginated<T> {
  return { items: result.items, total: result.total, limit: page.limit, offset: page.offset };
}
