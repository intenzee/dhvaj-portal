import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type DashboardSummary } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { DashboardService } from './dashboard.service';

/**
 * Home dashboard (Phase 12). One RLS-scoped summary drives every role's cards —
 * the counts reflect only what the caller can see (`engagement.read` is held by
 * all staff).
 */
@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Role-scoped counts for the Home dashboard cards' })
  summary(
    @CurrentPrincipal() principal: Principal,
    @Query('dueSoonDays', new DefaultValuePipe(7), new ParseIntPipe()) dueSoonDays: number,
  ): Promise<DashboardSummary> {
    const days = Math.min(Math.max(dueSoonDays, 1), 90);
    return this.dashboard.summary(rlsContextFromPrincipal(principal), days);
  }
}
