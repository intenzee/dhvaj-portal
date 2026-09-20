import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditScheduleIii } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditScheduleIiiService } from './audit-schedule-iii.service';
import { RecordScheduleIiiDecisionDto } from './dto/schedule-iii.dto';

/**
 * Statutory Audit — 02.3 Schedule III & Presentation Framework endpoints
 * (Guide §9.3). Reads gated by `engagement.read`, mutations by
 * `engagement.manage`; RLS does the real gating (members read; only leads
 * mutate the audit file).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditScheduleIiiController {
  constructor(private readonly scheduleIii: AuditScheduleIiiService) {}

  @Get(':id/statutory-audit/schedule-iii')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's 02.3 Schedule III presentation assessment(s)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditScheduleIii[]> {
    return this.scheduleIii.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/schedule-iii/run-suggestions')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Route the Schedule III Division from 02.2 and persist the presentation suggestion',
  })
  runSuggestions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditScheduleIii> {
    return this.scheduleIii.runSuggestions(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/schedule-iii/decision')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Record the professional Schedule III conclusion (override needs a basis)',
  })
  decision(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: RecordScheduleIiiDecisionDto,
  ): Promise<StatutoryAuditScheduleIii> {
    return this.scheduleIii.recordDecision(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      {
        conclusion: dto.conclusion,
        basis: dto.basis,
        impact: dto.impact,
        version: dto.version,
      },
    );
  }
}
