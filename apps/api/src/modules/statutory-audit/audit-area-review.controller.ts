import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type AuditAreaReviewSummary } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditAreaReviewService } from './audit-area-review.service';
import {
  AddCustomAreaDto,
  AddLibraryAreasDto,
  AreaCommentDto,
  AreaLinkDto,
  AssertionActionDto,
  CompleteAreaReviewDto,
  RemoveAuditAreaDto,
  ReopenAreaReviewDto,
  RespondAreaCommentDto,
  RestoreAuditAreaDto,
  SignalResolutionDto,
  UpdateAuditAreaDto,
} from './dto/area-review.dto';

const BASE = ':id/statutory-audit/:workflowInstanceId/audit-areas';

/**
 * Statutory Audit — 03.5 Audit Areas & Assertions (§29 services). Reads gated
 * by `engagement.read`, mutations by `engagement.manage`; RLS does the real
 * gating (members read; EP/manager leads mutate).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditAreaReviewController {
  constructor(private readonly areas: AuditAreaReviewService) {}

  @Get(BASE)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: '03.5 — areas, indicators, assertions, signals, validations, matrix' })
  summary(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.getSummary(rlsContextFromPrincipal(p), id, wi);
  }

  @Post(`${BASE}/populate`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Create the engagement population from the applicable library (idempotent)',
  })
  populate(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.populate(rlsContextFromPrincipal(p), id, wi);
  }

  @Post(`${BASE}/library`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add Audit Area(s) from the DHVAJ library' })
  addFromLibrary(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: AddLibraryAreasDto,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.addFromLibrary(rlsContextFromPrincipal(p), id, wi, dto);
  }

  @Post(`${BASE}/custom`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add an engagement-only custom Audit Area' })
  addCustom(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: AddCustomAreaDto,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.addCustom(rlsContextFromPrincipal(p), id, wi, dto);
  }

  @Post(`${BASE}/areas/:areaId`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update attention / manual amount / owner / resolutions on an area' })
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('areaId', new ParseUUIDPipe()) areaId: string,
    @Body() dto: UpdateAuditAreaDto,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.updateArea(rlsContextFromPrincipal(p), id, wi, areaId, dto);
  }

  @Post(`${BASE}/areas/:areaId/remove`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Remove an Audit Area (never deletes; reason required)' })
  remove(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('areaId', new ParseUUIDPipe()) areaId: string,
    @Body() dto: RemoveAuditAreaDto,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.removeArea(rlsContextFromPrincipal(p), id, wi, areaId, dto);
  }

  @Post(`${BASE}/areas/:areaId/restore`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Restore a removed Audit Area' })
  restore(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('areaId', new ParseUUIDPipe()) areaId: string,
    @Body() dto: RestoreAuditAreaDto,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.restoreArea(rlsContextFromPrincipal(p), id, wi, areaId, dto);
  }

  @Post(`${BASE}/areas/:areaId/assertions/:assertionId`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Add / remove / restore an assertion or change its attention' })
  assertion(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('areaId', new ParseUUIDPipe()) areaId: string,
    @Param('assertionId') assertionId: string,
    @Body() dto: AssertionActionDto,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.assertionAction(rlsContextFromPrincipal(p), id, wi, areaId, assertionId, dto);
  }

  @Post(`${BASE}/areas/:areaId/links`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Link / unlink a Planning Signal or specific-materiality matter' })
  link(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('areaId', new ParseUUIDPipe()) areaId: string,
    @Body() dto: AreaLinkDto,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.link(rlsContextFromPrincipal(p), id, wi, areaId, dto);
  }

  @Post(`${BASE}/signal-resolutions`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'VAL-05 — document "no Audit Area mapping required" for a signal' })
  resolveSignal(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: SignalResolutionDto,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.resolveSignal(rlsContextFromPrincipal(p), id, wi, dto);
  }

  @Post(`${BASE}/complete`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'AA-01 — complete 03.5 and generate the immutable matrix version' })
  complete(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: CompleteAreaReviewDto,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.complete(rlsContextFromPrincipal(p), id, wi, dto);
  }

  @Post(`${BASE}/reopen`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Reopen a completed / update-required 03.5 as the next version' })
  reopen(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: ReopenAreaReviewDto,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.reopen(rlsContextFromPrincipal(p), id, wi, dto);
  }

  @Post(`${BASE}/methodology-update`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Controlled refresh to the current Audit Area Library version' })
  methodologyUpdate(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.applyMethodologyUpdate(rlsContextFromPrincipal(p), id, wi);
  }

  @Post(`${BASE}/comments`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Partner review comment / challenge / reassessment request' })
  comment(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: AreaCommentDto,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.addComment(rlsContextFromPrincipal(p), id, wi, dto);
  }

  @Post(`${BASE}/comments/:commentId`)
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Respond to (address) a review comment' })
  respond(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('commentId', new ParseUUIDPipe()) commentId: string,
    @Body() dto: RespondAreaCommentDto,
  ): Promise<AuditAreaReviewSummary> {
    return this.areas.respondComment(rlsContextFromPrincipal(p), id, wi, commentId, dto);
  }
}
