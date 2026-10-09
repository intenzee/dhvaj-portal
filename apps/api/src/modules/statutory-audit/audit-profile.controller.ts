import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type StatutoryAuditEntityProfile,
  type StatutoryAuditEntityProfileMasterFillResult,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditProfileService } from './audit-profile.service';
import {
  AddProfileFileDto,
  CaptureProfileFinancialDto,
  ConfirmProfileCardDto,
  ConfirmProfileDto,
  LinkProfileFileDto,
  ReopenProfileDto,
  SmallCompanyDecisionDto,
  UpdateEntityProfileDto,
} from './dto/profile.dto';

/**
 * Statutory Audit — 02.1 Entity & Regulatory Profile endpoints (Guide §9.1;
 * DHVAJ 02.1 web developer specification). Reads gated by `engagement.read`,
 * mutations by `engagement.manage`; RLS does the real gating (members read;
 * only leads mutate the audit file). Every mutation returns the whole profile.
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditProfileController {
  constructor(private readonly profile: AuditProfileService) {}

  @Get(':id/statutory-audit/profile')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's 02.1 Entity & Regulatory Profile(s)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditEntityProfile[]> {
    return this.profile.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/profile')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Save Draft — the facts the audit team holds (Cards A/B/F/G/H/I)',
  })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: UpdateEntityProfileDto,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.profile.updateProfile(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/profile/cards/confirm')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Confirm one card (A/B/C/E/F/H/I) — records who/when and the facts confirmed',
    description: 'Rejected while the card still has Information Pending.',
  })
  confirmCard(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ConfirmProfileCardDto,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.profile.confirmCard(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/profile/small-company')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Card E — Confirm Assessment / Override (reason mandatory) / clear the override',
    description: 'The system assessment and the professional conclusion are kept separately.',
  })
  smallCompany(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: SmallCompanyDecisionDto,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.profile.decideSmallCompany(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/profile/fill-from-master')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Fill the 02.1 special entity types from the client master',
    description:
      'Adds the special entity types the client master shows (industries, regulatory facts, ' +
      'mandated name suffixes); never removes a type the team set. 409 once confirmed.',
  })
  fillFromMaster(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<StatutoryAuditEntityProfileMasterFillResult> {
    return this.profile.fillFromMaster(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/profile/financials')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Capture one financial parameter (current + prior FY) — the reusable block',
  })
  capture(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CaptureProfileFinancialDto,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.profile.captureFinancial(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      {
        parameter: dto.parameter,
        currentValue: dto.currentValue,
        priorValue: dto.priorValue,
        source: dto.source,
        preparer: dto.preparer,
        documentId: dto.documentId,
      },
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/profile/files/add')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Add File — store a new file in the engagement workspace and link it to a 02.1 field',
  })
  addFile(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: AddProfileFileDto,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.profile.addFile(rlsContextFromPrincipal(principal), id, workflowInstanceId, dto);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/profile/files/link')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Link Existing File — link an engagement document (never copied)' })
  linkFile(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: LinkProfileFileDto,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.profile.linkFile(rlsContextFromPrincipal(principal), id, workflowInstanceId, dto);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/profile/files/:fileId/unlink')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Unlink a file from a 02.1 field (the document itself is kept)' })
  unlinkFile(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.profile.unlinkFile(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      fileId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/profile/reopen')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Controlled reopen of a confirmed profile (reason required)',
    description:
      'Re-confirming after a correction marks the affected downstream 02.x assessments Needs Re-evaluation.',
  })
  reopen(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ReopenProfileDto,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.profile.reopen(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto.reason,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/profile/confirm')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      'CONFIRM PROFILE — freezes the fact set (small-company + SA flags + snapshot) for 02.2–02.9',
    description:
      'Requires the confirmation statement to be accepted; rejected while any blocking Card J item remains.',
  })
  confirm(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ConfirmProfileDto,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.profile.confirm(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      note: dto.note,
      acknowledged: dto.acknowledged,
    });
  }
}
