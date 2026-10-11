import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type FileVersionHistory,
  type FrameworkImpactView,
  type FrameworkMemoCard,
  type FrameworkMemoHistoryItem,
  type FrameworkMemorandumCreated,
  type FrameworkSummaryMatter,
  type FrameworkSystemOverride,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditFrameworkRecordsService } from './audit-framework-records.service';
import {
  ConfirmFrameworkImpactDto,
  CreateFrameworkMemorandumDto,
  ReturnFrameworkMatterDto,
  UpdateFrameworkMatterDto,
} from './dto/framework-records.dto';

/**
 * Statutory Audit — 02.8 Track B records: the Audit Framework Memorandum, the
 * Framework Matter actions and the revision change-impact confirmation. Reads
 * gated by `engagement.read`, mutations by `engagement.manage`; the service
 * requires an engagement lead and RLS does the row gating.
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditFrameworkRecordsController {
  constructor(private readonly records: AuditFrameworkRecordsService) {}

  @Get(':id/statutory-audit/:workflowInstanceId/framework-summary/memos')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Every Audit Framework Memorandum of the file (current + superseded)' })
  memos(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<FrameworkMemoHistoryItem[]> {
    return this.records.memoHistory(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/framework-summary/memo')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Create the Audit Framework Memorandum from the approved DHVAJ template (after AF-01)',
  })
  createMemo(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CreateFrameworkMemorandumDto,
  ): Promise<FrameworkMemorandumCreated> {
    return this.records.createMemo(principal, id, workflowInstanceId, {
      variantKey: dto.variantKey,
    });
  }

  @Post(':id/statutory-audit/:workflowInstanceId/framework-summary/memo/:memoId/submit')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Submit the memorandum for Engagement Partner review (AF-02)' })
  submitMemo(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Param('memoId', new ParseUUIDPipe()) memoId: string,
  ): Promise<FrameworkMemoCard> {
    return this.records.submitMemo(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      memoId,
    );
  }

  @Get(':id/statutory-audit/:workflowInstanceId/framework-summary/memo/:memoId/versions')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "The memorandum file's version history" })
  memoVersions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Param('memoId', new ParseUUIDPipe()) memoId: string,
  ): Promise<FileVersionHistory> {
    return this.records.memoVersions(principal, id, workflowInstanceId, memoId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/framework-summary/matters/:matterId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Record impact / Partner attention / owner / due date / resolution' })
  updateMatter(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Param('matterId', new ParseUUIDPipe()) matterId: string,
    @Body() dto: UpdateFrameworkMatterDto,
  ): Promise<FrameworkSummaryMatter> {
    return this.records.updateMatter(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      matterId,
      {
        ...dto,
      },
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/framework-summary/matters/:matterId/return')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Return the matter to its source section (Under Review)' })
  returnMatter(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Param('matterId', new ParseUUIDPipe()) matterId: string,
    @Body() dto: ReturnFrameworkMatterDto,
  ): Promise<FrameworkSummaryMatter> {
    return this.records.returnMatter(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      matterId,
      {
        note: dto.note,
        ownerEmployeeId: dto.ownerEmployeeId,
      },
    );
  }

  @Get(':id/statutory-audit/:workflowInstanceId/framework-summary/overrides')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Every system result a professional overrode (§12 System Overrides)' })
  overrides(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<FrameworkSystemOverride[]> {
    return this.records.overrides(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Get(':id/statutory-audit/:workflowInstanceId/framework-summary/impact')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary: "A revision's change impact + the work kept against the superseded baseline",
  })
  impact(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<FrameworkImpactView> {
    return this.records.impact(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/framework-summary/impact/confirm')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Professionally confirm the system impact first pass (§15)' })
  confirmImpact(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ConfirmFrameworkImpactDto,
  ): Promise<FrameworkImpactView> {
    return this.records.confirmImpact(rlsContextFromPrincipal(principal), id, workflowInstanceId, {
      note: dto.note,
    });
  }
}
