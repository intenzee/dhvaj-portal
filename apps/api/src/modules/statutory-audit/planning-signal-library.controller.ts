import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type PlanningSignalRuleRecord } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { CreatePlanningSignalRuleVersionDto } from './dto/planning-signal-rule.dto';
import { PlanningSignalLibraryService } from './planning-signal-rules';

/**
 * Planning Signal Library administration (DHVAJ 03.1 §21). Insert-only: every
 * change appends a rule version; a fired signal keeps the version it fired under.
 */
@ApiTags('planning-signal-rules')
@Controller('planning-signal-rules')
export class PlanningSignalLibraryController {
  constructor(private readonly library: PlanningSignalLibraryService) {}

  @Get()
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Every Planning Signal Library rule version (latest first)' })
  list(@CurrentPrincipal() principal: Principal): Promise<PlanningSignalRuleRecord[]> {
    return this.library.list(rlsContextFromPrincipal(principal));
  }

  @Post()
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Append a rule version (or the first version of a new rule)' })
  addVersion(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreatePlanningSignalRuleVersionDto,
  ): Promise<PlanningSignalRuleRecord> {
    return this.library.addVersion(rlsContextFromPrincipal(principal), dto);
  }
}
