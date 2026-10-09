import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditScheduleIii } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditScheduleIiiService } from './audit-schedule-iii.service';
import {
  PartnerApproveScheduleIiiDto,
  RecordScheduleIiiDecisionDto,
  SetScheduleIiiFactsDto,
} from './dto/schedule-iii.dto';

/**
 * Statutory Audit — 02.3 Schedule III & Presentation Framework endpoints
 * (Guide §9.3; DHVAJ 02.3 spec). Reads gated by `engagement.read`, mutations
 * by `engagement.manage`; RLS does the real gating (members read; only leads
 * mutate the audit file). Partner approval is further limited to the
 * engagement's Engagement Partner in the service.
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

  @Post(':id/statutory-audit/:workflowInstanceId/schedule-iii/facts')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      'Record the SCH-02 specialised format, SCH-04 comparatives and SCH-05 rounding answers',
  })
  setFacts(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: SetScheduleIiiFactsDto,
  ): Promise<StatutoryAuditScheduleIii> {
    return this.scheduleIii.setFacts(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/schedule-iii/decision')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'SCH-06: confirm, override (reason + technical basis) or mark Information Pending',
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
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/schedule-iii/partner-approve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'SCH-06: Engagement Partner approval of a significant override' })
  partnerApprove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: PartnerApproveScheduleIiiDto,
  ): Promise<StatutoryAuditScheduleIii> {
    return this.scheduleIii.partnerApprove(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }
}
