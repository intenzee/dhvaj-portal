import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PERMISSION, type ChangeLogEntry, type ChangeLogOp, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { PaginationQueryDto, paginate } from '../../common/pagination/pagination.dto';
import { ChangeLogService } from './change-log.service';

class ChangeLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() engagementId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) table?: string;
  @ApiPropertyOptional({ enum: ['insert', 'update', 'delete'] })
  @IsOptional()
  @IsIn(['insert', 'update', 'delete'])
  op?: ChangeLogOp;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

@ApiTags('audit')
@Controller('change-log')
export class ChangeLogController {
  constructor(private readonly changes: ChangeLogService) {}

  @Get()
  @RequirePermissions(PERMISSION.auditRead)
  @ApiOperation({
    summary: 'Every add, edit and removal on clients and engagements (most recent first)',
    description:
      'Requires audit.read; Row Level Security shows the log to the Managing Partner and administrators only. Kept by the database; nobody edits or deletes it.',
  })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ChangeLogQueryDto,
  ): Promise<Paginated<ChangeLogEntry>> {
    const { limit, offset, ...filter } = query;
    const page = { limit, offset };
    const result = await this.changes.list(rlsContextFromPrincipal(principal), filter, page);
    return paginate(result, query);
  }
}
