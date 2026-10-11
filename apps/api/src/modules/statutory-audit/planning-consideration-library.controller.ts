import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type PlanningConsiderationRuleRecord } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { CreatePlanningConsiderationRuleVersionDto } from './dto/planning-consideration-rule.dto';
import { PlanningConsiderationLibraryService } from './planning-consideration-rules';

/**
 * Strategic Consideration Library administration (DHVAJ 03.1 §13.2–13.3, §21).
 * Insert-only: every change appends a rule version; a generated consideration
 * keeps the version it came from.
 */
@ApiTags('planning-consideration-rules')
@Controller('planning-consideration-rules')
export class PlanningConsiderationLibraryController {
  constructor(private readonly library: PlanningConsiderationLibraryService) {}

  @Get()
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Every Strategic Consideration Library rule version (latest first)' })
  list(@CurrentPrincipal() principal: Principal): Promise<PlanningConsiderationRuleRecord[]> {
    return this.library.list(rlsContextFromPrincipal(principal));
  }

  @Post()
  @RequirePermissions(PERMISSION.serviceManage)
  @ApiOperation({ summary: 'Append a rule version (or the first version of a new rule)' })
  addVersion(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreatePlanningConsiderationRuleVersionDto,
  ): Promise<PlanningConsiderationRuleRecord> {
    return this.library.addVersion(rlsContextFromPrincipal(principal), dto);
  }
}
