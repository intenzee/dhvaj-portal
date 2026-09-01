import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type ActiveTimer,
  type EngagementTimeReport,
  type TimeEntryRecord,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../../auth/principal';
import { TimeTrackingService } from './time-tracking.service';
import { StartTimerDto, StopTimerDto } from './dto/time-entry.dto';

/**
 * Engagement time tracking (ADR-0034). A manual stopwatch: staff start/stop
 * their own timer on engagements they are assigned to. Gated by `engagement.read`
 * — RLS does the real gating (only members can touch an engagement's time, and
 * only your own running entry). The timer never auto-stops on inactivity.
 */
@ApiTags('engagements')
@Controller('engagements')
export class TimeTrackingController {
  constructor(private readonly time: TimeTrackingService) {}

  // Declared before the `:id/time` routes so the static segment wins.
  @Get('time/active')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: "The caller's currently running timer, if any",
    description:
      'Powers the always-visible running-timer banner and the close prompt. null when none.',
  })
  active(@CurrentPrincipal() principal: Principal): Promise<ActiveTimer | null> {
    return this.time.activeForCaller(rlsContextFromPrincipal(principal));
  }

  @Get(':id/time')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: "An engagement's time entries and per-person totals",
    description: 'Visible to everyone assigned to the engagement (RLS-scoped).',
  })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EngagementTimeReport> {
    return this.time.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/time/start')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Start working — begin a timer on this engagement (audited)',
    description:
      'Rejected (409) if you already have a running timer elsewhere; one timer at a time.',
  })
  start(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: StartTimerDto,
  ): Promise<TimeEntryRecord> {
    return this.time.start(rlsContextFromPrincipal(principal), id, dto.note);
  }

  @Post(':id/time/stop')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Stop your running timer on this engagement (audited)' })
  stop(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: StopTimerDto,
  ): Promise<TimeEntryRecord> {
    return this.time.stop(rlsContextFromPrincipal(principal), id, dto.note);
  }
}
