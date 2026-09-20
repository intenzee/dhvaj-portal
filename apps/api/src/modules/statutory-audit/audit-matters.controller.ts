import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  MATTER_SECTIONS,
  PERMISSION,
  type AuditMatterRecord,
  type MatterSection,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditMattersService } from './audit-matters.service';
import { UpdateMatterDto } from './dto/matter.dto';

/**
 * Statutory Audit — Matters / Exceptions endpoints (Implementation Guide §10).
 * The compact Matters panel reads here; matters are generated (sync) and
 * resolved in place. Reads gated by `engagement.read`, mutations by
 * `engagement.manage`; RLS does the real gating (members read; leads mutate).
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditMattersController {
  constructor(private readonly matters: AuditMattersService) {}

  @Get(':id/statutory-audit/:workflowInstanceId/matters')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "A statutory-audit shell's matters (Acceptance + Framework)" })
  @ApiQuery({ name: 'section', required: false, enum: MATTER_SECTIONS })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Query('section') section?: MatterSection,
  ): Promise<AuditMatterRecord[]> {
    return this.matters.listForInstance(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      MATTER_SECTIONS.includes(section as MatterSection) ? section : undefined,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/matters/sync-framework')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({
    summary: 'Regenerate Framework Matters from the current assessment states (§10)',
    description: 'Idempotent: upserts by source, reopens returned conditions, auto-closes cleared.',
  })
  syncFramework(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<AuditMatterRecord[]> {
    return this.matters.syncFramework(rlsContextFromPrincipal(principal), id, workflowInstanceId);
  }

  @Post(':id/statutory-audit/matters/:matterId')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Update / resolve / accept a matter in place (§10)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('matterId', new ParseUUIDPipe()) matterId: string,
    @Body() dto: UpdateMatterDto,
  ): Promise<AuditMatterRecord> {
    return this.matters.updateMatter(rlsContextFromPrincipal(principal), id, matterId, {
      status: dto.status,
      resolution: dto.resolution,
      ownerEmployeeId: dto.ownerEmployeeId,
      dueDate: dto.dueDate,
      documentId: dto.documentId,
      note: dto.note,
      version: dto.version,
    });
  }
}
