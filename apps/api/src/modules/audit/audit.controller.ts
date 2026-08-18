import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type Paginated } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { PaginationQueryDto, paginate } from '../../common/pagination/pagination.dto';
import { AuditService } from './audit.service';
import type { AuditEventRecord } from '../identity/identity.types';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSION.auditRead)
  @ApiOperation({
    summary: 'List audit events (most recent first)',
    description:
      'Requires audit.read. Row Level Security further restricts visibility to firm-wide roles; the audit trail is append-only and cannot be modified.',
  })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query() page: PaginationQueryDto,
  ): Promise<Paginated<AuditEventRecord>> {
    const result = await this.audit.list(rlsContextFromPrincipal(principal), page);
    return paginate(result, page);
  }
}
