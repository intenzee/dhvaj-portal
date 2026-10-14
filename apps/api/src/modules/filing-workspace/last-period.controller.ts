import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type LastPeriodView } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { LastPeriodService } from './last-period.service';

/** Staff Workflow WF-303 — last period beside this one. Members read; RLS scopes it. */
@ApiTags('filing-workspace')
@Controller('compliance-instances')
export class LastPeriodController {
  constructor(private readonly lastPeriod: LastPeriodService) {}

  @Get(':id/last-period')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary:
      'The previous period of the same filing, read-only: uploads, checklist, filed reference, review points',
  })
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<LastPeriodView> {
    return this.lastPeriod.get(rlsContextFromPrincipal(principal), id);
  }
}
