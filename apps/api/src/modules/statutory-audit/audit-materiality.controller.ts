import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type MaterialitySummary, type RevisionImpactItem } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditMaterialityService } from './audit-materiality.service';
import {
  AssessBenchmarkDto,
  CloseMaterialityChallengeDto,
  CreateMaterialityChallengeDto,
  RequireMaterialityReassessmentDto,
  ResolveMaterialityReassessmentDto,
  RespondMaterialityChallengeDto,
  NormalisationAdjustmentDto,
  SaveQualitativeDto,
  SpecificMaterialityDto,
  StartRevisionDto,
  UpdateMaterialityDto,
  UpdateRevisionItemDto,
} from './dto/materiality.dto';
import {
  PlanningCapabilityRequired,
  PlanningGovernanceGuard,
  PlanningLockExempt,
  PlanningScope,
} from './planning-governance.guard';
import { Section03LockGuard } from './section-03-lock.guard';

/**
 * Statutory Audit — 03.3 Materiality. §23 on every write
 * (PlanningGovernanceGuard): Article / Senior prepare the source data, user
 * context, prior-year figures and the normalisation schedule; the Engagement
 * Manager assesses benchmarks, determines OM / PM / specific / clearly trivial
 * and completes; the Engagement Partner views, challenges, revises and may
 * require reassessment. Field-level checks live in the service; RLS is the
 * backstop. 03.3 keeps its own versioning (03.3.11 revision during the audit),
 * so the 03.12 approval lock on 03.1 does not freeze it.
 */
@ApiTags('engagements')
@Controller('engagements')
@UseGuards(Section03LockGuard, PlanningGovernanceGuard)
@PlanningScope('03.3')
@PlanningLockExempt()
export class AuditMaterialityController {
  constructor(private readonly materiality: AuditMaterialityService) {}

  @Get(':id/statutory-audit/:workflowInstanceId/materiality')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: '03.3 — determination, candidates, calculations and checklist' })
  summary(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
  ): Promise<MaterialitySummary> {
    return this.materiality.getSummary(rlsContextFromPrincipal(principal), id, wi);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/materiality')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts', 'assess')
  @ApiOperation({ summary: 'Update the current draft determination (MAT-01…MAT-08)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: UpdateMaterialityDto,
  ): Promise<MaterialitySummary> {
    return this.materiality.updateDetermination(rlsContextFromPrincipal(principal), id, wi, dto);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/materiality/conclusion-draft')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired()
  @ApiOperation({
    summary: 'Draft the materiality conclusion from structured judgments (not persisted)',
  })
  conclusionDraft(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
  ): Promise<{ draft: string }> {
    return this.materiality.draftConclusion(rlsContextFromPrincipal(principal), id, wi);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/materiality/benchmarks/:candidateKey')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Assess a candidate benchmark (03.3.2)' })
  assessBenchmark(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('candidateKey') candidateKey: string,
    @Body() dto: AssessBenchmarkDto,
  ): Promise<MaterialitySummary> {
    return this.materiality.assessBenchmark(
      rlsContextFromPrincipal(principal),
      id,
      wi,
      candidateKey,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/materiality/adjustments')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  @ApiOperation({ summary: 'Add a normalisation adjustment line (03.3.3)' })
  addAdjustment(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: NormalisationAdjustmentDto,
  ): Promise<MaterialitySummary> {
    return this.materiality.saveAdjustment(rlsContextFromPrincipal(principal), id, wi, null, dto);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/materiality/adjustments/:adjustmentId')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  @ApiOperation({ summary: 'Edit a normalisation adjustment line' })
  updateAdjustment(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('adjustmentId', new ParseUUIDPipe()) adjustmentId: string,
    @Body() dto: NormalisationAdjustmentDto,
  ): Promise<MaterialitySummary> {
    return this.materiality.saveAdjustment(
      rlsContextFromPrincipal(principal),
      id,
      wi,
      adjustmentId,
      dto,
    );
  }

  @Delete(':id/statutory-audit/:workflowInstanceId/materiality/adjustments/:adjustmentId')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  @ApiOperation({ summary: 'Remove a line from the draft normalisation schedule' })
  deleteAdjustment(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('adjustmentId', new ParseUUIDPipe()) adjustmentId: string,
  ): Promise<MaterialitySummary> {
    return this.materiality.deleteAdjustment(
      rlsContextFromPrincipal(principal),
      id,
      wi,
      adjustmentId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/materiality/specific')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Add a specific materiality record (MAT-06)' })
  addSpecific(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: SpecificMaterialityDto,
  ): Promise<MaterialitySummary> {
    return this.materiality.saveSpecific(rlsContextFromPrincipal(principal), id, wi, null, dto);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/materiality/specific/:specificId')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Edit a specific materiality record' })
  updateSpecific(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('specificId', new ParseUUIDPipe()) specificId: string,
    @Body() dto: SpecificMaterialityDto,
  ): Promise<MaterialitySummary> {
    return this.materiality.saveSpecific(
      rlsContextFromPrincipal(principal),
      id,
      wi,
      specificId,
      dto,
    );
  }

  @Delete(':id/statutory-audit/:workflowInstanceId/materiality/specific/:specificId')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Remove a specific materiality record from the draft' })
  deleteSpecific(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('specificId', new ParseUUIDPipe()) specificId: string,
  ): Promise<MaterialitySummary> {
    return this.materiality.deleteSpecific(rlsContextFromPrincipal(principal), id, wi, specificId);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/materiality/qualitative/:key')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Answer a qualitative materiality consideration (03.3.9)' })
  saveQualitative(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('key') key: string,
    @Body() dto: SaveQualitativeDto,
  ): Promise<MaterialitySummary> {
    return this.materiality.saveQualitative(rlsContextFromPrincipal(principal), id, wi, key, dto);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/materiality/revisions')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess', 'reopen')
  @ApiOperation({ summary: 'Start a revision (03.3.11) — creates the next version as a draft' })
  startRevision(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: StartRevisionDto,
  ): Promise<MaterialitySummary> {
    return this.materiality.startRevision(rlsContextFromPrincipal(principal), id, wi, dto);
  }

  @Post(':id/statutory-audit/materiality-revision-items/:itemId')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Assign / resolve an affected-work item flagged by a revision' })
  updateRevisionItem(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() dto: UpdateRevisionItemDto,
  ): Promise<RevisionImpactItem> {
    return this.materiality.updateRevisionItem(rlsContextFromPrincipal(principal), id, itemId, dto);
  }

  // ── §20 / §23 reassessment of a completed version ─────────────────────────

  @Post(':id/statutory-audit/:workflowInstanceId/materiality/require-reassessment')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('partnerReview')
  @ApiOperation({ summary: 'Engagement Partner requires reassessment of the completed 03.3' })
  requireReassessment(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: RequireMaterialityReassessmentDto,
  ): Promise<MaterialitySummary> {
    return this.materiality.requireReassessment(rlsContextFromPrincipal(principal), id, wi, dto);
  }

  @Post(':id/statutory-audit/:workflowInstanceId/materiality/resolve-reassessment')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Manager: reassessed — the version in force stands (reasoned)' })
  resolveReassessment(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: ResolveMaterialityReassessmentDto,
  ): Promise<MaterialitySummary> {
    return this.materiality.resolveReassessment(rlsContextFromPrincipal(principal), id, wi, dto);
  }

  // ── §23 Engagement Partner comments / challenges ───────────────────────────

  @Post(':id/statutory-audit/:workflowInstanceId/materiality/challenges')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('partnerReview')
  @ApiOperation({ summary: 'Engagement Partner comment or challenge on 03.3' })
  createChallenge(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: CreateMaterialityChallengeDto,
  ): Promise<MaterialitySummary> {
    return this.materiality.createChallenge(rlsContextFromPrincipal(principal), id, wi, dto);
  }

  @Post(':id/statutory-audit/materiality-challenges/:challengeId/respond')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('respondToChallenge')
  @ApiOperation({ summary: 'Engagement Manager response to a 03.3 challenge' })
  respondChallenge(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('challengeId', new ParseUUIDPipe()) challengeId: string,
    @Body() dto: RespondMaterialityChallengeDto,
  ): Promise<MaterialitySummary> {
    return this.materiality.respondChallenge(
      rlsContextFromPrincipal(principal),
      id,
      challengeId,
      dto,
    );
  }

  @Post(':id/statutory-audit/materiality-challenges/:challengeId/close')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('partnerReview')
  @ApiOperation({ summary: 'Engagement Partner closes a 03.3 comment / answered challenge' })
  closeChallenge(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('challengeId', new ParseUUIDPipe()) challengeId: string,
    @Body() dto: CloseMaterialityChallengeDto,
  ): Promise<MaterialitySummary> {
    return this.materiality.closeChallenge(
      rlsContextFromPrincipal(principal),
      id,
      challengeId,
      dto,
    );
  }
}
