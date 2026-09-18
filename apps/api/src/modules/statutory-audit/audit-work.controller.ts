import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditWorkGeneration } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditWorkService } from './audit-work.service';
import { UpdateAreaDetailDto } from './dto/area.dto';

/**
 * Statutory Audit — Framework → Dynamic Work Generation endpoints (Audit Spec §20).
 * Reads are gated by `engagement.read`, generation by `engagement.manage` — RLS
 * does the real gating (members read; only leads generate).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditWorkController {
  constructor(private readonly work: AuditWorkService) {}

  @Get(':id/statutory-audit/work-areas')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's generated statutory-audit work areas (§20)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditWorkGeneration[]> {
    return this.work.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/work-areas/generate')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Generate applicable work areas from the approved framework (§20)',
    description:
      'Idempotent — re-running never duplicates and never deletes existing work; areas no ' +
      'longer applicable are deactivated. Rejected (409) until the Framework Memo is approved.',
  })
  generate(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditWorkGeneration> {
    return this.work.generate(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/areas/:workAreaId/detail')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Update an audit area’s §11 professional detail (SA-5)',
    description:
      'Ownership, risk, materiality, timing, financial data and conclusion (draft / submitted). ' +
      'Optimistic-locked on detailVersion; preserved across framework regeneration.',
  })
  updateAreaDetail(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workAreaId', new ParseUUIDPipe()) workAreaId: string,
    @Body() dto: UpdateAreaDetailDto,
  ): Promise<StatutoryAuditWorkGeneration> {
    return this.work.updateAreaDetail(rlsContextFromPrincipal(principal), id, workAreaId, dto);
  }
}
