import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type StatutoryAuditReassessment } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditReassessmentService } from './audit-reassessment.service';
import { RaiseReassessmentDto, ResolveReassessmentDto } from './dto/reassessment.dto';

/**
 * Statutory Audit — Change-Impact / Reassessment endpoints (Audit Spec §29, §30).
 * Reads gated by `engagement.read`, mutations by `engagement.manage`; RLS does
 * the real gating (members read; only leads mutate). The controlled downstream
 * impact and the archived-file lock are enforced in the service.
 */
@ApiTags('engagements')
@Controller('engagements')
export class AuditReassessmentController {
  constructor(private readonly reassessment: AuditReassessmentService) {}

  @Get(':id/statutory-audit/reassessments')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: "An engagement's change-impact / reassessment register (§30)" })
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<StatutoryAuditReassessment[]> {
    return this.reassessment.listForEngagement(rlsContextFromPrincipal(principal), id);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/reassessments')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Raise a controlled reassessment and flag affected work (§30)' })
  raise(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: RaiseReassessmentDto,
  ): Promise<StatutoryAuditReassessment> {
    return this.reassessment.raise(rlsContextFromPrincipal(principal), id, workflowInstanceId, dto);
  }

  @Post(':id/statutory-audit/reassessments/:reassessmentId/resolve')
  @RequirePermissions(PERMISSION.engagementManage)
  @ApiOperation({ summary: 'Resolve a reassessment once the flagged work is addressed (§30)' })
  resolve(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('reassessmentId', new ParseUUIDPipe()) reassessmentId: string,
    @Body() dto: ResolveReassessmentDto,
  ): Promise<StatutoryAuditReassessment> {
    return this.reassessment.resolve(rlsContextFromPrincipal(principal), id, reassessmentId, dto);
  }
}
