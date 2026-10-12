import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION, type ScopeApproachSummary, type ScopeHandoff } from '@hsdg/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditScopeApproachService } from './audit-scope-approach.service';
import {
  ConvertScopeMapAreaDto,
  FlagScopeReassessmentDto,
  LinkScopeMapAreaDto,
  NewSpecialistDto,
  PartnerScopeActionDto,
  RespondPartnerActionDto,
  SaveScopeConsiderationDto,
  SaveScopeDecisionDto,
  ScopeDependencyDto,
  ScopeLimitationDto,
  ScopeMapItemDto,
  ScopeUnitDto,
  ServiceOrgDto,
  StartScopeRevisionDto,
  UpdateScopeApproachDto,
} from './dto/scope-approach.dto';
import {
  PlanningCapabilityRequired,
  PlanningGovernanceGuard,
  PlanningLockExempt,
  PlanningScope,
} from './planning-governance.guard';
import { Section03LockGuard } from './section-03-lock.guard';

const BASE = ':id/statutory-audit/:workflowInstanceId/scope-approach';

/**
 * Statutory Audit — 03.4 Audit Scope & Approach. §30 on every write
 * (PlanningGovernanceGuard): Article / Senior prepare population facts, unit
 * indicators, service-organisation facts, dependencies, decisions and the
 * approach-map strategy as a draft; the Engagement Manager concludes scope,
 * AP-01 / OB-01 / SO-01 / IA-01 / DT-01 / SL-01, includes or excludes map
 * areas and completes AP-02; the Engagement Partner reviews (§26). Field-level
 * checks live in the service; RLS is the backstop. 03.4 keeps its own
 * versioning (§27), so the 03.12 approval lock on 03.1 does not freeze it.
 */
@ApiTags('engagements')
@Controller('engagements')
@UseGuards(Section03LockGuard, PlanningGovernanceGuard)
@PlanningScope('03.4')
@PlanningLockExempt()
export class AuditScopeApproachController {
  constructor(private readonly scope: AuditScopeApproachService) {}

  @Get(BASE)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({ summary: '03.4 — scope intelligence, population, approach, map, checks' })
  summary(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
  ): Promise<ScopeApproachSummary> {
    return this.scope.getSummary(rlsContextFromPrincipal(p), id, wi);
  }

  @Post(BASE)
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts', 'assess')
  @ApiOperation({
    summary: 'Update the 03.4 record (SC-01/02, AP-01, EC-01, OB-01, IA-01, DT-01, SL-01, AP-02)',
  })
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: UpdateScopeApproachDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.update(rlsContextFromPrincipal(p), id, wi, dto);
  }

  @Post(`${BASE}/generate`)
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts', 'assess')
  @ApiOperation({
    summary: 'Refresh population, map areas and prompts from Section 02 / 03.1–03.3 (idempotent)',
  })
  generate(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
  ): Promise<ScopeApproachSummary> {
    return this.scope.generate(rlsContextFromPrincipal(p), id, wi);
  }

  @Post(`${BASE}/conclusion-draft`)
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired()
  @ApiOperation({ summary: 'Generate the §25 scope & approach conclusion (not persisted)' })
  conclusionDraft(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
  ): Promise<{ draft: string }> {
    return this.scope.draftConclusion(rlsContextFromPrincipal(p), id, wi);
  }

  @Post(`${BASE}/units`)
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts', 'assess')
  @ApiOperation({ summary: 'Add a unit to the Audit Population (SC-03)' })
  addUnit(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: ScopeUnitDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.saveUnit(rlsContextFromPrincipal(p), id, wi, null, dto);
  }

  @Post(`${BASE}/units/:unitId`)
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts', 'assess')
  @ApiOperation({ summary: 'Assess a unit (significance, auditor, scope conclusion)' })
  updateUnit(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('unitId', new ParseUUIDPipe()) unitId: string,
    @Body() dto: ScopeUnitDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.saveUnit(rlsContextFromPrincipal(p), id, wi, unitId, dto);
  }

  @Post(`${BASE}/decisions/:kind`)
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts', 'assess')
  @ApiOperation({ summary: 'Add a custom cycle / timing area / technology use' })
  addDecision(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('kind') kind: string,
    @Body() dto: SaveScopeDecisionDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.saveDecision(rlsContextFromPrincipal(p), id, wi, kind, null, dto);
  }

  @Post(`${BASE}/decisions/:kind/:itemKey`)
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts', 'assess')
  @ApiOperation({ summary: 'Record a controls / timing / evidence / technology decision' })
  saveDecision(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('kind') kind: string,
    @Param('itemKey') itemKey: string,
    @Body() dto: SaveScopeDecisionDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.saveDecision(rlsContextFromPrincipal(p), id, wi, kind, itemKey, dto);
  }

  @Post(`${BASE}/service-orgs`)
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts', 'assess')
  @ApiOperation({ summary: 'Add a service organisation card (SO-01)' })
  addServiceOrg(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: ServiceOrgDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.saveServiceOrg(rlsContextFromPrincipal(p), id, wi, null, dto);
  }

  @Post(`${BASE}/service-orgs/:orgId`)
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts', 'assess')
  @ApiOperation({ summary: 'Update a service organisation card' })
  updateServiceOrg(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Body() dto: ServiceOrgDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.saveServiceOrg(rlsContextFromPrincipal(p), id, wi, orgId, dto);
  }

  @Post(`${BASE}/considerations/:considerationId`)
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Respond to a special-approach implication or specialist prompt' })
  saveConsideration(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('considerationId', new ParseUUIDPipe()) cid: string,
    @Body() dto: SaveScopeConsiderationDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.saveConsideration(rlsContextFromPrincipal(p), id, wi, cid, dto);
  }

  @Post(`${BASE}/specialists`)
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Add a specialist need not raised by a signal (§17)' })
  addSpecialist(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: NewSpecialistDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.addSpecialist(rlsContextFromPrincipal(p), id, wi, dto);
  }

  @Post(`${BASE}/dependencies`)
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts', 'assess')
  @ApiOperation({ summary: 'Add a Scope Dependency (§21)' })
  addDependency(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: ScopeDependencyDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.saveDependency(rlsContextFromPrincipal(p), id, wi, null, dto);
  }

  @Post(`${BASE}/dependencies/:depId`)
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts', 'assess')
  @ApiOperation({ summary: 'Update a Scope Dependency' })
  updateDependency(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('depId', new ParseUUIDPipe()) depId: string,
    @Body() dto: ScopeDependencyDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.saveDependency(rlsContextFromPrincipal(p), id, wi, depId, dto);
  }

  @Post(`${BASE}/limitations`)
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({
    summary: 'Record a potential scope limitation (SL-01) — Immediate Partner Attention',
  })
  addLimitation(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: ScopeLimitationDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.saveLimitation(rlsContextFromPrincipal(p), id, wi, null, dto);
  }

  @Post(`${BASE}/limitations/:limId`)
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Update a potential scope limitation' })
  updateLimitation(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('limId', new ParseUUIDPipe()) limId: string,
    @Body() dto: ScopeLimitationDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.saveLimitation(rlsContextFromPrincipal(p), id, wi, limId, dto);
  }

  @Post(`${BASE}/map`)
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts', 'assess')
  @ApiOperation({ summary: 'Add a preliminary area to the Approach Map (§23)' })
  addMapItem(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: ScopeMapItemDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.saveMapItem(rlsContextFromPrincipal(p), id, wi, null, dto);
  }

  @Post(`${BASE}/map/:itemId`)
  @RequirePermissions(PERMISSION.engagementRead)
  @PlanningCapabilityRequired('addFacts', 'assess')
  @ApiOperation({ summary: 'Update a preliminary area on the Approach Map' })
  updateMapItem(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() dto: ScopeMapItemDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.saveMapItem(rlsContextFromPrincipal(p), id, wi, itemId, dto);
  }

  @Post(`${BASE}/partner-actions`)
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('partnerReview')
  @ApiOperation({
    summary: 'Partner Planning View action — Agree / Challenge / Request / Add signal (→ 03.12)',
  })
  partnerAction(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: PartnerScopeActionDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.partnerAction(rlsContextFromPrincipal(p), id, wi, dto);
  }

  @Post(`${BASE}/partner-actions/:actionId`)
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('respondToChallenge')
  @ApiOperation({ summary: 'Respond to a Partner challenge / request' })
  respondPartnerAction(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('actionId', new ParseUUIDPipe()) actionId: string,
    @Body() dto: RespondPartnerActionDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.respondPartnerAction(rlsContextFromPrincipal(p), id, wi, actionId, dto);
  }

  @Post(`${BASE}/revisions`)
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({
    summary: 'Start a controlled revision (v1.0 → v1.1) preserving the approved baseline',
  })
  startRevision(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: StartScopeRevisionDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.startRevision(rlsContextFromPrincipal(p), id, wi, dto);
  }

  @Post(`${BASE}/reassessment`)
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess', 'partnerReview')
  @ApiOperation({
    summary: 'Flag Reassessment Required (Section 05 reliance not supported, Manager, other)',
  })
  flagReassessment(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Body() dto: FlagScopeReassessmentDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.flagReassessment(rlsContextFromPrincipal(p), id, wi, dto);
  }

  @Get(`${BASE}/handoff`)
  @RequirePermissions(PERMISSION.engagementRead)
  @ApiOperation({
    summary:
      'What 03.8 / 03.9 / 03.11 read from 03.4 (specialists, auditors, timing, dependencies)',
  })
  handoff(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
  ): Promise<ScopeHandoff> {
    return this.scope.getHandoff(rlsContextFromPrincipal(p), id, wi);
  }

  @Post(`${BASE}/map/:itemId/link`)
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({
    summary: 'Link an Approach Map area to an existing 03.5 area (null unlinks) — §23',
  })
  linkMapArea(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() dto: LinkScopeMapAreaDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.linkMapArea(rlsContextFromPrincipal(p), id, wi, itemId, dto);
  }

  @Post(`${BASE}/map/:itemId/convert`)
  @RequirePermissions(PERMISSION.engagementManage)
  @PlanningCapabilityRequired('assess')
  @ApiOperation({ summary: 'Create a 03.5 custom area from an Approach Map area — §23' })
  convertMapArea(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('workflowInstanceId', new ParseUUIDPipe()) wi: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() dto: ConvertScopeMapAreaDto,
  ): Promise<ScopeApproachSummary> {
    return this.scope.convertMapArea(rlsContextFromPrincipal(p), id, wi, itemId, dto);
  }
}
