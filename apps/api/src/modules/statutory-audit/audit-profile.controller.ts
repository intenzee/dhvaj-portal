import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditEntityProfile } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditProfileService } from './audit-profile.service';
import {
  CaptureProfileFinancialDto,
  ConfirmProfileDto,
  UpdateEntityProfileDto,
} from './dto/profile.dto';

/**
 * Statutory Audit — 02.1 Entity & Regulatory Profile endpoints (Guide §9.1).
 * Reads gated by `engagement.read`, mutations by `engagement.manage`; RLS does
 * the real gating (members read; only leads mutate the audit file).
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
    summary:
      'Update the captured profile facts (special entity / initial / joint / accounting env)',
  })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: UpdateEntityProfileDto,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.profile.updateProfile(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      specialEntityTypes: dto.specialEntityTypes,
      initialAudit: dto.initialAudit,
      jointAudit: dto.jointAudit,
      accountingEnvironment: dto.accountingEnvironment,
      version: dto.version,
    });
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

  @Post(':id/statutory-audit/:workflowInstanceId/profile/confirm')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary:
      'CONFIRM PROFILE — freezes the fact set (small-company + SA flags + snapshot) for 02.2–02.9',
    description:
      'Rejected while a deciding fact is missing (classification / small-company inputs).',
  })
  confirm(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ConfirmProfileDto,
  ): Promise<StatutoryAuditEntityProfile> {
    return this.profile.confirm(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      note: dto.note,
    });
  }
}
