import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  UNDERSTANDING_SECTIONS,
  type BusinessUnderstandingSummary,
  type CustomMetricRecord,
  type InvestigationCardRecord,
  type PlanningExpectationRecord,
  type UnderstandingRevisionDetail,
  type UnderstandingSectionKey,
  type UnderstandingSectionRecord,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditBusinessUnderstandingService } from './audit-business-understanding.service';
import {
  AddCustomMetricDto,
  AssessInvestigationDto,
  CloseUnderstandingChallengeDto,
  CreatePlanningExpectationDto,
  CreateUnderstandingChallengeDto,
  DecideIndustryConsiderationDto,
  ReopenUnderstandingDto,
  RespondUnderstandingChallengeDto,
  SaveFinancialValuesDto,
  UpdateBusinessUnderstandingDto,
  UpdateFinancialDatasetDto,
  UpdatePlanningExpectationDto,
  UpdateUnderstandingSectionDto,
} from './dto/business-understanding.dto';
import {
  PlanningCapabilityRequired,
  PlanningGovernanceGuard,
  PlanningLockExempt,
  PlanningScope,
} from './planning-governance.guard';
import { Section03LockGuard } from './section-03-lock.guard';

/**
 * Statutory Audit — 03.2 Business Understanding & Preliminary Analytics.
 * §23 on every write (PlanningGovernanceGuard): Article / Senior record facts,
 * figures, explanations and evidence; the Engagement Manager reviews,
 * assesses, links signals and completes; the Engagement Partner views and
 * challenges. Planning approval in 03.12 freezes 03.2 with the rest of
 * Planning; a completed 03.2 is frozen until reopened (the service enforces).
 */
@ApiTags('engagements')
@Controller('engagements')
@UseGuards(Section03LockGuard, PlanningGovernanceGuard)
@PlanningScope('03.2')
export class AuditBusinessUnderstandingController {
  constructor(private readonly understanding: AuditBusinessUnderstandingService) {}

  @Get(':id/statutory-audit/:workflowInstanceId/business-understanding')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: '03.2 — sections, dataset, analytics and completion checklist' })
  summary(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.getSummary(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/business-understanding')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Update the industry profile, conclusion and BA-01' })
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: UpdateBusinessUnderstandingDto,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.updateRecord(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/business-understanding/prefill')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  @ApiOperation({ summary: 'Fill 03.2 blanks from the client master (never overwrites)' })
  prefill(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.prefillFromMasters(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/business-understanding/conclusion-draft')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  @PlanningLockExempt()
  @ApiOperation({ summary: 'Draft the understanding & analytics conclusion (not persisted)' })
  conclusionDraft(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<{ draft: string }> {
    return this.understanding.draftConclusion(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/business-understanding/sections/:sectionKey')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  @ApiOperation({ summary: 'Save a 03.2.1–03.2.6 understanding section' })
  saveSection(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Param('sectionKey') sectionKey: string,
    @Body() dto: UpdateUnderstandingSectionDto,
  ): Promise<UnderstandingSectionRecord> {
    if (!UNDERSTANDING_SECTIONS.includes(sectionKey as UnderstandingSectionKey)) {
      throw new NotFoundException('Unknown 03.2 section.');
    }
    return this.understanding.saveSection(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      sectionKey as UnderstandingSectionKey,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/financial-dataset')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  @ApiOperation({ summary: 'Save the 03.2.7 dataset header (period, currency, units, sources)' })
  saveDataset(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: UpdateFinancialDatasetDto,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.saveDataset(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/financial-dataset/values')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  @ApiOperation({
    summary: 'Save dataset figures (manual; no TB import in v1)',
    description: 'Recalculates analytics and reopens affected Investigation Cards.',
  })
  saveValues(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: SaveFinancialValuesDto,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.saveValues(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/financial-dataset/custom-metrics')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  @ApiOperation({ summary: 'Add a Manager custom metric' })
  addCustomMetric(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: AddCustomMetricDto,
  ): Promise<CustomMetricRecord> {
    return this.understanding.addCustomMetric(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto.label,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/analytics/refresh')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  @ApiOperation({ summary: 'Re-run 03.2.8 analytics on the methodology versions now in force' })
  refreshAnalytics(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.refreshAnalytics(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Get(':id/statutory-audit/:workflowInstanceId/analytics-exceptions')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: '03.2.9 Investigation Cards' })
  listExceptions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<InvestigationCardRecord[]> {
    return this.understanding.listExceptions(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/analytics-exceptions/:cardId')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  @ApiOperation({
    summary: 'Record an investigation (explanation, assessment, signal decision)',
    description:
      'The team records the explanation, evidence and affected areas; the assessment, signal decision and owner / due date need the Engagement Manager.',
  })
  assessException(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Body() dto: AssessInvestigationDto,
  ): Promise<InvestigationCardRecord> {
    return this.understanding.assessException(rlsContextFromPrincipal(principal), id, cardId, dto);
  }

  @Get(':id/statutory-audit/:workflowInstanceId/planning-expectations')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: '§14 Expectation vs actual' })
  listExpectations(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
  ): Promise<PlanningExpectationRecord[]> {
    return this.understanding.listExpectations(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
    );
  }

  @Post(':id/statutory-audit/:workflowInstanceId/planning-expectations')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  @ApiOperation({ summary: 'Record a planning expectation' })
  createExpectation(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CreatePlanningExpectationDto,
  ): Promise<PlanningExpectationRecord> {
    return this.understanding.createExpectation(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/planning-expectations/:expectationId')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Confirm investigation need / planning conclusion' })
  updateExpectation(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('expectationId', new ParseUUIDPipe()) expectationId: string,
    @Body() dto: UpdatePlanningExpectationDto,
  ): Promise<PlanningExpectationRecord> {
    return this.understanding.updateExpectation(
      rlsContextFromPrincipal(principal),
      id,
      expectationId,
      dto,
    );
  }

  // ── §20 controlled revision ────────────────────────────────────────────────

  @Post(':id/statutory-audit/:workflowInstanceId/business-understanding/reopen')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('reopen')
  @ApiOperation({ summary: 'Reopen a completed 03.2 for a controlled revision (v1.0 → v1.1)' })
  reopen(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: ReopenUnderstandingDto,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.reopen(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Get(':id/statutory-audit/:workflowInstanceId/business-understanding/revisions/:revisionId')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'A 03.2 revision with what changed against its frozen baseline' })
  revision(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Param('revisionId', new ParseUUIDPipe()) revisionId: string,
  ): Promise<UnderstandingRevisionDetail> {
    return this.understanding.revisionDetail(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      revisionId,
    );
  }

  // ── §7 suggested industry considerations ──────────────────────────────────

  @Post(':id/statutory-audit/:workflowInstanceId/business-understanding/considerations')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Confirm whether a suggested industry consideration is relevant' })
  decideConsideration(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: DecideIndustryConsiderationDto,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.decideConsideration(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  // ── §23 Engagement Partner comments / challenges ───────────────────────────

  @Post(':id/statutory-audit/:workflowInstanceId/business-understanding/challenges')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('partnerReview')
  @PlanningLockExempt()
  @ApiOperation({ summary: 'Engagement Partner comment or challenge on 03.2' })
  createChallenge(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) workflowInstanceId: string,
    @Body() dto: CreateUnderstandingChallengeDto,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.createChallenge(
      rlsContextFromPrincipal(principal),
      id,
      workflowInstanceId,
      dto,
    );
  }

  @Post(':id/statutory-audit/understanding-challenges/:challengeId/respond')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('respondToChallenge')
  @PlanningLockExempt()
  @ApiOperation({ summary: 'Engagement Manager response to a 03.2 challenge' })
  respondChallenge(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('challengeId', new ParseUUIDPipe()) challengeId: string,
    @Body() dto: RespondUnderstandingChallengeDto,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.respondChallenge(
      rlsContextFromPrincipal(principal),
      id,
      challengeId,
      dto,
    );
  }

  @Post(':id/statutory-audit/understanding-challenges/:challengeId/close')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('partnerReview')
  @PlanningLockExempt()
  @ApiOperation({ summary: 'Engagement Partner closes a 03.2 comment / answered challenge' })
  closeChallenge(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('challengeId', new ParseUUIDPipe()) challengeId: string,
    @Body() dto: CloseUnderstandingChallengeDto,
  ): Promise<BusinessUnderstandingSummary> {
    return this.understanding.closeChallenge(
      rlsContextFromPrincipal(principal),
      id,
      challengeId,
      dto,
    );
  }
}
