import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type ClockState,
  type HeartbeatResult,
  type TimeAdjustmentRecord,
  type TimeSummary,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../../auth/principal';
import { TimeAutoService } from './time-auto.service';
import {
  AdjustTimeDto,
  DecideAdjustmentDto,
  OtherTimeDto,
  TimeSummaryQueryDto,
} from './dto/time-auto.dto';

/**
 * Change 3 — the caller's automatic clock. Self-service: each route acts on the
 * caller's own entries (RLS: employee_id = ctx_employee_id), except approving a
 * correction, which is lead-only.
 */
@ApiTags('time')
@Controller('time')
export class TimeClockController {
  constructor(private readonly time: TimeAutoService) {}

  @Post('heartbeat')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: "Keep the caller's running entry alive (every 2 minutes while active)",
    description:
      'No heartbeat for 15 minutes closes the entry at the last heartbeat (idle) and pauses ' +
      'the task; the response carries `resumable` so the client can offer "resume?".',
  })
  heartbeat(@CurrentPrincipal() principal: Principal): Promise<HeartbeatResult> {
    return this.time.heartbeat(rlsContextFromPrincipal(principal));
  }

  @Get('clock')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "The caller's running entry and what can be resumed" })
  clock(@CurrentPrincipal() principal: Principal): Promise<ClockState> {
    return this.time.clock(rlsContextFromPrincipal(principal));
  }

  @Post('sign-out')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "Close the caller's automatic entry on sign-out (signed_out)" })
  signOut(@CurrentPrincipal() principal: Principal): Promise<ClockState> {
    return this.time.signOut(rlsContextFromPrincipal(principal));
  }

  @Post(':entryId/adjust')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Correct one of your own entries (within 3 days, with a reason)',
    description:
      'Writes a new row pointing at the original, which is never overwritten. Moves of more ' +
      'than 30 minutes wait for a lead’s approval.',
  })
  adjust(
    @CurrentPrincipal() principal: Principal,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @Body() dto: AdjustTimeDto,
  ): Promise<TimeAdjustmentRecord> {
    return this.time.adjust(rlsContextFromPrincipal(principal), entryId, dto);
  }

  @Post('adjustments/:id/approve')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Approve (or with approve=false reject) a time correction (lead)' })
  decide(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideAdjustmentDto,
  ): Promise<TimeAdjustmentRecord> {
    return this.time.decide(rlsContextFromPrincipal(principal), id, dto.approve !== false);
  }
}

/** Change 3 — engagement-scoped time: other time and the Activity → Time report. */
@ApiTags('engagements')
@Controller('engagements')
export class EngagementTimeAutoController {
  constructor(private readonly time: TimeAutoService) {}

  @Post(':id/time/other')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Log time not tied to a task (category, stream, minutes, date)' })
  other(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: OtherTimeDto,
  ): Promise<{ id: string }> {
    return this.time.addOther(rlsContextFromPrincipal(principal), id, dto);
  }

  @Get(':id/time/summary')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: 'Hours by person / stream / month / task, billable split, budget vs actual',
  })
  summary(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: TimeSummaryQueryDto,
  ): Promise<TimeSummary> {
    return this.time.summary(rlsContextFromPrincipal(principal), id, query.by ?? 'person');
  }

  @Get(':id/time/adjustments')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Time corrections awaiting approval on this engagement' })
  adjustments(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<TimeAdjustmentRecord[]> {
    return this.time.pendingAdjustments(rlsContextFromPrincipal(principal), id);
  }
}
