import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { CLIENT_KINDS, CLIENT_STATUSES, type ClientKind, type ClientStatus } from '@hsdg/contracts';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

/** Pagination + filters for GET /clients (all params whitelisted). */
export class ClientListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CLIENT_STATUSES })
  @IsOptional()
  @IsIn(CLIENT_STATUSES)
  status?: ClientStatus;

  @ApiPropertyOptional({ enum: CLIENT_KINDS })
  @IsOptional()
  @IsIn(CLIENT_KINDS)
  kind?: ClientKind;

  @ApiPropertyOptional({ description: 'Home office code filter.' })
  @IsOptional()
  @IsString()
  office?: string;

  @ApiPropertyOptional({ description: 'Free-text search over name / code.' })
  @IsOptional()
  @IsString()
  search?: string;
}
