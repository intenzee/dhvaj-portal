import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type AcceptanceSignoffView } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditAcceptanceSignoffService } from './audit-acceptance-signoff.service';
import {
  ApproveAcceptanceDto,
  ReopenAcceptanceDto,
  SubmitAcceptanceRecommendationDto,
} from './dto/acceptance-signoff.dto';

/**
 * Statutory Audit — Section 01.8 Final Acceptance & Partner Approval
 * (spec §12): readiness summary, Manager recommendation, Engagement Partner
 * conclusion and controlled reopen.
 */
@ApiTags('engagements')
@Controller('engagements/:id/statutory-audit/:workflowInstanceId/acceptance')
export class AuditAcceptanceSignoffController {
  constructor(private readonly signoff: AuditAcceptanceSignoffService) {}

  @Get('signoff')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Section 01 header, readiness summary, recommendation and decisions' })
  view(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
  ): Promise<AcceptanceSignoffView> {
    return this.signoff.view(rlsContextFromPrincipal(principal), id, wf);
  }

  @Post('recommend')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'FINAL-01 — submit the Manager recommendation to the Engagement Partner',
  })
  recommend(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: SubmitAcceptanceRecommendationDto,
  ): Promise<AcceptanceSignoffView> {
    return this.signoff.recommend(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post('approve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'FINAL-02 — Engagement Partner conclusion (approval completes Section 01, unlocks 02)',
    description:
      'Engagement Partner only; needs a submitted recommendation. Approving conclusions are rejected while anything blocks acceptance.',
  })
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: ApproveAcceptanceDto,
  ): Promise<AcceptanceSignoffView> {
    return this.signoff.decide(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post('reopen')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Controlled reopen of an approved Section 01 (reason + audit trail)' })
  reopen(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: ReopenAcceptanceDto,
  ): Promise<AcceptanceSignoffView> {
    return this.signoff.reopen(rlsContextFromPrincipal(principal), id, wf, dto);
  }
}
