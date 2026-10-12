import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION,
  type DiscussionSignalCreated,
  type FileVersionHistory,
  type PlanningEvidenceView,
  type PlanningGovernanceView,
  type PlanningMatterRecord,
  type PlanningRevisionBaseline,
} from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditPlanningGovernanceService } from './audit-planning-governance.service';
import {
  AcknowledgePartnerAttentionDto,
  AddPlanningEvidenceDto,
  ChallengePartnerAttentionDto,
  CreateDiscussionActionDto,
  CreateDiscussionSignalDto,
  FlagPartnerAttentionDto,
  LinkPlanningEvidenceDto,
  PlanningEvidenceQueryDto,
  ReopenPlanningIntelligenceDto,
  RespondPartnerAttentionDto,
} from './dto/planning-governance.dto';
import {
  PlanningCapabilityRequired,
  PlanningGovernanceGuard,
  PlanningLockExempt,
} from './planning-governance.guard';
import { Section03LockGuard } from './section-03-lock.guard';

/**
 * Statutory Audit — 03.1 governance (DHVAJ 03.1 §10, §16, §19, §20, §23,
 * §24): access + Partner Attention queue, controlled revision, evidence and
 * the team discussion's actions / signals. Every write passes the §23
 * capability + 03.12 lock guard; RLS remains the backstop.
 */
@ApiTags('engagements')
@Controller('engagements/:id/statutory-audit/:workflowInstanceId')
@UseGuards(Section03LockGuard, PlanningGovernanceGuard)
export class AuditPlanningGovernanceController {
  constructor(private readonly governance: AuditPlanningGovernanceService) {}

  @Get('planning-governance')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: '03.1 access, Partner Attention queue, proposals, revision state' })
  view(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
  ): Promise<PlanningGovernanceView> {
    return this.governance.view(rlsContextFromPrincipal(principal), id, wf);
  }

  // ── §19 controlled revision ───────────────────────────────────────────────

  @Post('planning-governance/reopen')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('reopen')
  @PlanningLockExempt()
  @ApiOperation({ summary: 'Reopen 03.1 after Planning approval (v1.n → v1.n+1, baseline kept)' })
  reopen(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: ReopenPlanningIntelligenceDto,
  ): Promise<PlanningGovernanceView> {
    return this.governance.reopen(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Get('planning-governance/revisions/:revisionId')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'A 03.1 revision with its frozen approved baseline' })
  revision(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('revisionId', new ParseUUIDPipe()) revisionId: string,
  ): Promise<PlanningRevisionBaseline> {
    return this.governance.revision(rlsContextFromPrincipal(principal), id, wf, revisionId);
  }

  // ── §10 / §20 Partner Attention ───────────────────────────────────────────

  @Post('planning-attention/flag')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('partnerReview')
  @ApiOperation({ summary: 'EP flags a signal / focus area for Immediate Partner Attention' })
  flag(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: FlagPartnerAttentionDto,
  ): Promise<PlanningGovernanceView> {
    return this.governance.flag(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post('planning-attention/:attentionId/acknowledge')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('partnerReview')
  @PlanningLockExempt()
  @ApiOperation({ summary: 'EP acknowledges an Immediate Partner Attention item' })
  acknowledge(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('attentionId', new ParseUUIDPipe()) attentionId: string,
    @Body() dto: AcknowledgePartnerAttentionDto,
  ): Promise<PlanningGovernanceView> {
    return this.governance.acknowledge(
      rlsContextFromPrincipal(principal),
      id,
      wf,
      attentionId,
      dto,
    );
  }

  @Post('planning-attention/:attentionId/challenge')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('partnerReview')
  @PlanningLockExempt()
  @ApiOperation({ summary: 'EP challenges an Immediate Partner Attention item' })
  challenge(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('attentionId', new ParseUUIDPipe()) attentionId: string,
    @Body() dto: ChallengePartnerAttentionDto,
  ): Promise<PlanningGovernanceView> {
    return this.governance.challenge(rlsContextFromPrincipal(principal), id, wf, attentionId, dto);
  }

  @Post('planning-attention/:attentionId/respond')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('respondToChallenge')
  @PlanningLockExempt()
  @ApiOperation({ summary: 'Manager answers the EP’s challenge' })
  respond(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('attentionId', new ParseUUIDPipe()) attentionId: string,
    @Body() dto: RespondPartnerAttentionDto,
  ): Promise<PlanningGovernanceView> {
    return this.governance.respond(rlsContextFromPrincipal(principal), id, wf, attentionId, dto);
  }

  // ── §24 evidence ──────────────────────────────────────────────────────────

  @Get('planning-evidence')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Evidence files on a 03.1 record' })
  evidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Query() q: PlanningEvidenceQueryDto,
  ): Promise<PlanningEvidenceView> {
    return this.governance.evidence(
      rlsContextFromPrincipal(principal),
      id,
      wf,
      q.targetType,
      q.targetId,
    );
  }

  @Post('planning-evidence/add')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  // The service applies each record's own freeze (03.12 lock; 03.2 / 03.3 versions).
  @PlanningLockExempt()
  @ApiOperation({ summary: 'Add File — stored in the engagement workspace and linked here' })
  addEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: AddPlanningEvidenceDto,
  ): Promise<PlanningEvidenceView> {
    return this.governance.addEvidence(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post('planning-evidence/link')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  // The service applies each record's own freeze (03.12 lock; 03.2 / 03.3 versions).
  @PlanningLockExempt()
  @ApiOperation({ summary: 'Link Existing File — an engagement document, never copied' })
  linkEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: LinkPlanningEvidenceDto,
  ): Promise<PlanningEvidenceView> {
    return this.governance.linkEvidence(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post('planning-evidence/:evidenceId/unlink')
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts')
  // The service applies each record's own freeze (03.12 lock; 03.2 / 03.3 versions).
  @PlanningLockExempt()
  @ApiOperation({ summary: 'Remove a file from the 03.1 record (the document stays)' })
  unlinkEvidence(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('evidenceId', new ParseUUIDPipe()) evidenceId: string,
  ): Promise<PlanningEvidenceView> {
    return this.governance.unlinkEvidence(rlsContextFromPrincipal(principal), id, wf, evidenceId);
  }

  @Get('planning-evidence/:evidenceId/versions')
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: 'Version history of a 03.1 evidence file' })
  evidenceVersions(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Param('evidenceId', new ParseUUIDPipe()) evidenceId: string,
  ): Promise<FileVersionHistory> {
    return this.governance.evidenceVersions(principal, id, wf, evidenceId);
  }

  // ── 03.1.8 team discussion ────────────────────────────────────────────────

  @Post('planning-discussion/actions')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('discussion')
  @ApiOperation({ summary: 'Record a discussion action (Planning Matter, origin discussion)' })
  createAction(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: CreateDiscussionActionDto,
  ): Promise<PlanningMatterRecord> {
    return this.governance.createDiscussionAction(rlsContextFromPrincipal(principal), id, wf, dto);
  }

  @Post('planning-discussion/signals')
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('discussion')
  @ApiOperation({ summary: 'Create a Planning Signal from the team discussion' })
  createSignal(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wf: string,
    @Body() dto: CreateDiscussionSignalDto,
  ): Promise<DiscussionSignalCreated> {
    return this.governance.createDiscussionSignal(rlsContextFromPrincipal(principal), id, wf, dto);
  }
}
