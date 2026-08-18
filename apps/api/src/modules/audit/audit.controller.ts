import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditService } from './audit.service';
import type { AuditEventRecord } from '../identity/identity.types';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSION.auditRead)
  @ApiOperation({
    summary: 'List recent audit events',
    description:
      'Requires audit.read. Row Level Security further restricts visibility to firm-wide roles; the audit trail is append-only and cannot be modified.',
  })
  list(@CurrentPrincipal() principal: Principal): Promise<AuditEventRecord[]> {
    return this.audit.list(rlsContextFromPrincipal(principal));
  }
}
