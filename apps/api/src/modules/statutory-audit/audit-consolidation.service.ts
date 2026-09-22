import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CONSOLIDATION_CONCLUSIONS,
  CONSOLIDATION_OUTCOME,
  FRAMEWORK_AREA_KEY,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type ConsolidationCapturedFacts,
  type ConsolidationDetail,
  type ConsolidationFacts,
  type ConsolidationOutcome,
  type ConsolidationResult,
  type FrameworkState,
  type FrameworkSubAssessment,
  type RecordConsolidationDecisionInput,
  type ReportingFrameworkOutcome,
  type SetConsolidationFactsInput,
  type StatutoryAuditConsolidation,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { assessConsolidation } from './consolidation';

const SUB = SUB_SECTION_KEY.consolidation;
const AREA = FRAMEWORK_AREA_KEY.cfs;
const TITLE = 'Consolidation / Group Audit Framework';

const FR_SUB = SUB_SECTION_KEY.financialReporting;
const FR_AREA = FRAMEWORK_AREA_KEY.financialReportingFramework;

/** Outcomes the system can decisively suggest (so a differing conclusion is an override). */
const DECISIVE = new Set<string>(CONSOLIDATION_CONCLUSIONS);

/** 02.2 states from which its conclusion is authoritative enough to route 02.6. */
const FR_DECIDED = new Set<string>(['applicable', 'overridden', 'approved']);

const DEFAULT_CAPTURED: ConsolidationCapturedFacts = {
  investees: [],
  isWhollyOwnedSubsidiary: false,
  isPartiallyOwnedSubsidiary: false,
  otherMembersIntimatedNoObjection: false,
  securitiesListedOrInProcess: false,
  parentFilesCompliantCfs: null,
  hasBranches: false,
};

interface SubRow {
  id: string;
  workflow_instance_id: string;
  engagement_service_id: string;
  engagement_id: string;
  state: FrameworkState;
  system_outcome: string | null;
  system_basis: string | null;
  system_detail: ConsolidationDetail | null;
  rule_version_id: string | null;
  authority_provision_id: string | null;
  conclusion: string | null;
  is_overridden: boolean;
  basis: string | null;
  impact: string | null;
  facts: Partial<ConsolidationCapturedFacts> | null;
  needs_reevaluation: boolean;
  decided_by_name: string | null;
  decided_at: Date | null;
  version: number;
}

/**
 * 02.6 Consolidation / Group Audit Framework service (Guide §9.6). Routes the
 * consolidation standards from the concluded 02.2 assessment, captures the
 * investee perimeter and the Rule 6 / branch facts, runs the pure engine to
 * decide CFS required / exempt, freezes §129(3) period-correct, and records the
 * professional conclusion (override keeps both + basis). Reuses the shared
 * sub-assessment table (guide §6).
 */
@Injectable()
export class AuditConsolidationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly rules: AuditRulesService,
  ) {}

  // ── Seed (idempotent, self-healing) ─────────────────────────────────────────

  async seedOn(
    client: PoolClient,
    workflowInstanceId: string,
    engagementId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.audit_framework_subassessment
         (workflow_instance_id, engagement_id, sub_section_key, area_key, title)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workflow_instance_id, sub_section_key, area_key) DO NOTHING`,
      [workflowInstanceId, engagementId, SUB, AREA, TITLE],
    );
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditConsolidation[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: shells } = await client.query<{ id: string }>(
        `SELECT swi.id
           FROM hsdg.service_workflow_instances swi
          WHERE swi.engagement_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM hsdg.audit_framework_subassessment s
               WHERE s.workflow_instance_id = swi.id
                 AND s.sub_section_key = $2 AND s.area_key = $3)`,
        [engagementId, SUB, AREA],
      );
      for (const s of shells) await this.seedOn(client, s.id, engagementId);
      return this.read(client, engagementId);
    });
  }

  private async read(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditConsolidation[]> {
    const { rows } = await client.query<SubRow>(
      `SELECT s.id, s.workflow_instance_id, swi.engagement_service_id, s.engagement_id, s.state,
              s.system_outcome, s.system_basis, s.system_detail, s.rule_version_id,
              s.authority_provision_id, s.conclusion, s.is_overridden, s.basis, s.impact,
              s.facts, s.needs_reevaluation, emp.full_name AS decided_by_name, s.decided_at, s.version
         FROM hsdg.audit_framework_subassessment s
         JOIN hsdg.service_workflow_instances swi ON swi.id = s.workflow_instance_id
         LEFT JOIN hsdg.employees emp ON emp.id = s.decided_by_employee_id
        WHERE s.engagement_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
        ORDER BY swi.created_at ASC`,
      [engagementId, SUB, AREA],
    );

    const out: StatutoryAuditConsolidation[] = [];
    for (const r of rows) {
      const captured = mergeCaptured(r.facts);
      const { facts, upstreamReady } = await this.assembleFacts(
        client,
        engagementId,
        r.workflow_instance_id,
        captured,
      );

      let assessment: FrameworkSubAssessment;
      let detail: ConsolidationDetail | null;
      if (isDecided(r.state)) {
        assessment = mapAssessment(r);
        detail = r.system_detail;
      } else {
        const res = await this.runEngine(client, engagementId, facts);
        assessment = liveAssessment(r, res);
        detail = res.detail;
      }

      out.push({
        workflowInstanceId: r.workflow_instance_id,
        engagementServiceId: r.engagement_service_id,
        engagementId: r.engagement_id,
        assessment,
        detail,
        capturedFacts: captured,
        baseFacts: facts,
        upstreamReady,
      });
    }
    return out;
  }

  // ── Capture the 02.6-specific facts (guide §9.6) ────────────────────────────

  async setFacts(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: SetConsolidationFactsInput,
  ): Promise<StatutoryAuditConsolidation> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const current = mergeCaptured(row.facts);
      const merged: ConsolidationCapturedFacts = {
        investees: input.investees !== undefined ? input.investees : current.investees,
        isWhollyOwnedSubsidiary: input.isWhollyOwnedSubsidiary ?? current.isWhollyOwnedSubsidiary,
        isPartiallyOwnedSubsidiary:
          input.isPartiallyOwnedSubsidiary ?? current.isPartiallyOwnedSubsidiary,
        otherMembersIntimatedNoObjection:
          input.otherMembersIntimatedNoObjection ?? current.otherMembersIntimatedNoObjection,
        securitiesListedOrInProcess:
          input.securitiesListedOrInProcess ?? current.securitiesListedOrInProcess,
        parentFilesCompliantCfs:
          input.parentFilesCompliantCfs !== undefined
            ? input.parentFilesCompliantCfs
            : current.parentFilesCompliantCfs,
        hasBranches: input.hasBranches ?? current.hasBranches,
      };
      const result = await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET facts = $3::jsonb, version = version + 1
          WHERE id = $1 AND version = $2`,
        [row.id, input.version, JSON.stringify(merged)],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This assessment changed since you loaded it; refresh and retry.',
        );
      }
      await this.persistSuggestion(client, engagementId, row.id, merged);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.consolidation_facts_set',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: merged,
      });
      const [c] = await this.readForShell(client, engagementId, workflowInstanceId);
      return c!;
    });
  }

  // ── Run the suggestion engine (§9.6) ────────────────────────────────────────

  async runSuggestions(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditConsolidation> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      await this.persistSuggestion(client, engagementId, row.id, mergeCaptured(row.facts));
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.consolidation_suggestions_run',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
      });
      const [c] = await this.readForShell(client, engagementId, workflowInstanceId);
      return c!;
    });
  }

  // ── Professional decision (§19) ─────────────────────────────────────────────

  async recordDecision(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordConsolidationDecisionInput,
  ): Promise<StatutoryAuditConsolidation> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (!CONSOLIDATION_CONCLUSIONS.includes(input.conclusion)) {
        throw new BadRequestException('Not a valid consolidation conclusion.');
      }

      const { facts } = await this.assembleFacts(
        client,
        engagementId,
        workflowInstanceId,
        mergeCaptured(row.facts),
      );
      const res = await this.runEngine(client, engagementId, facts);

      const isOverridden =
        DECISIVE.has(res.outcome) && input.conclusion !== (res.outcome as ConsolidationOutcome);
      const basis = input.basis?.trim() || null;
      if (isOverridden && !basis) {
        throw new BadRequestException(
          'A basis is required when the conclusion overrides the system suggestion.',
        );
      }
      const state: FrameworkState = isOverridden ? 'overridden' : decisiveState(input.conclusion);

      const result = await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET conclusion = $3, is_overridden = $4, basis = $5, impact = $6, state = $7,
                system_outcome = $8, system_basis = $9, system_detail = $10::jsonb,
                rule_version_id = $11, authority_provision_id = $12,
                decided_by_employee_id = $13, decided_at = now(), version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          row.id,
          input.version,
          input.conclusion,
          isOverridden,
          basis,
          input.impact?.trim() || null,
          state,
          res.outcome,
          res.basis,
          JSON.stringify(res.detail),
          res.ruleVersionId,
          res.authorityProvisionId,
          ctx.employeeId ?? null,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This assessment changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.consolidation_decision',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { conclusion: input.conclusion, isOverridden },
      });
      const [c] = await this.readForShell(client, engagementId, workflowInstanceId);
      return c!;
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Run the pure engine and freeze the period-correct §129(3) provision. */
  private async runEngine(
    client: PoolClient,
    engagementId: string,
    facts: ConsolidationFacts,
  ): Promise<ConsolidationResult> {
    const auditPeriodStart = await this.auditPeriodStart(client, engagementId);
    const resolve = await this.rules.buildResolverOn(client, auditPeriodStart);
    const res = assessConsolidation(facts, resolve);
    if (
      res.outcome === CONSOLIDATION_OUTCOME.cfsRequired ||
      res.outcome === CONSOLIDATION_OUTCOME.cfsExempt ||
      res.outcome === CONSOLIDATION_OUTCOME.notApplicable
    ) {
      const prov = await this.rules.resolveProvisionOn(client, 'COS_ACT_129_3', auditPeriodStart);
      res.authorityProvisionId = prov?.id ?? null;
    }
    return res;
  }

  private async persistSuggestion(
    client: PoolClient,
    engagementId: string,
    rowId: string,
    captured: ConsolidationCapturedFacts,
  ): Promise<void> {
    const { rows } = await client.query<{ state: FrameworkState; workflow_instance_id: string }>(
      `SELECT state, workflow_instance_id FROM hsdg.audit_framework_subassessment WHERE id = $1`,
      [rowId],
    );
    if (!rows[0] || isDecided(rows[0].state)) return;
    const { facts } = await this.assembleFacts(
      client,
      engagementId,
      rows[0].workflow_instance_id,
      captured,
    );
    const res = await this.runEngine(client, engagementId, facts);
    await client.query(
      `UPDATE hsdg.audit_framework_subassessment
          SET system_outcome = $2, system_basis = $3, system_detail = $4::jsonb,
              rule_version_id = $5, authority_provision_id = $6, state = $7
        WHERE id = $1`,
      [
        rowId,
        res.outcome,
        res.basis,
        JSON.stringify(res.detail),
        res.ruleVersionId,
        res.authorityProvisionId,
        res.state,
      ],
    );
  }

  private async readForShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditConsolidation[]> {
    const all = await this.read(client, engagementId);
    return all.filter((f) => f.workflowInstanceId === workflowInstanceId);
  }

  private async loadRow(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<SubRow> {
    await this.seedOn(client, workflowInstanceId, engagementId);
    const { rows } = await client.query<SubRow>(
      `SELECT s.id, s.workflow_instance_id, swi.engagement_service_id, s.engagement_id, s.state,
              s.system_outcome, s.system_basis, s.system_detail, s.rule_version_id,
              s.authority_provision_id, s.conclusion, s.is_overridden, s.basis, s.impact,
              s.facts, s.needs_reevaluation, NULL::text AS decided_by_name, s.decided_at, s.version
         FROM hsdg.audit_framework_subassessment s
         JOIN hsdg.service_workflow_instances swi ON swi.id = s.workflow_instance_id
        WHERE s.workflow_instance_id = $1 AND s.engagement_id = $2
          AND s.sub_section_key = $3 AND s.area_key = $4`,
      [workflowInstanceId, engagementId, SUB, AREA],
    );
    if (!rows[0]) {
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    }
    return rows[0];
  }

  private assertNotApproved(row: SubRow): void {
    if (row.state === 'approved' && !row.needs_reevaluation) {
      throw new ConflictException(
        'The framework is approved; a controlled reassessment must reopen it before editing 02.6.',
      );
    }
  }

  /** Assemble the base facts: the 02.2 conclusion (framework) + the captured 02.6 facts. */
  private async assembleFacts(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    captured: ConsolidationCapturedFacts,
  ): Promise<{ facts: ConsolidationFacts; upstreamReady: boolean }> {
    void engagementId; // facts key off the workflow instance; engagementId kept for signature parity
    const fr = await client.query<{ state: string; conclusion: string | null }>(
      `SELECT state, conclusion
         FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
      [workflowInstanceId, FR_SUB, FR_AREA],
    );
    let reportingFramework: ReportingFrameworkOutcome | null = null;
    const frRow = fr.rows[0];
    if (frRow && FR_DECIDED.has(frRow.state) && frRow.conclusion) {
      reportingFramework = frRow.conclusion as ReportingFrameworkOutcome;
    }

    const profile = await client.query<{ state: string }>(
      `SELECT state FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const profileConfirmed = profile.rows[0]?.state === 'confirmed';

    return {
      facts: {
        reportingFramework,
        investees: captured.investees,
        isWhollyOwnedSubsidiary: captured.isWhollyOwnedSubsidiary,
        isPartiallyOwnedSubsidiary: captured.isPartiallyOwnedSubsidiary,
        otherMembersIntimatedNoObjection: captured.otherMembersIntimatedNoObjection,
        securitiesListedOrInProcess: captured.securitiesListedOrInProcess,
        parentFilesCompliantCfs: captured.parentFilesCompliantCfs,
        hasBranches: captured.hasBranches,
      },
      upstreamReady: profileConfirmed && reportingFramework != null,
    };
  }

  private async auditPeriodStart(client: PoolClient, engagementId: string): Promise<string> {
    const fy = await client.query<{ financial_year: string }>(
      `SELECT financial_year FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    return fy.rows[0]
      ? auditPeriodStartFromFinancialYear(fy.rows[0].financial_year)
      : new Date().toISOString().slice(0, 10);
  }
}

function mergeCaptured(
  facts: Partial<ConsolidationCapturedFacts> | null,
): ConsolidationCapturedFacts {
  return {
    ...DEFAULT_CAPTURED,
    ...(facts ?? {}),
    investees: facts?.investees ?? DEFAULT_CAPTURED.investees,
  };
}

function isDecided(state: FrameworkState): boolean {
  return (
    state === 'applicable' ||
    state === 'not_applicable' ||
    state === 'overridden' ||
    state === 'approved'
  );
}

/** Map a decisive consolidation conclusion to the stored framework state. */
function decisiveState(conclusion: ConsolidationOutcome): FrameworkState {
  if (
    conclusion === CONSOLIDATION_OUTCOME.cfsExempt ||
    conclusion === CONSOLIDATION_OUTCOME.notApplicable
  )
    return 'not_applicable';
  if (conclusion === CONSOLIDATION_OUTCOME.furtherAssessment)
    return 'professional_judgement_required';
  return 'applicable';
}

function mapAssessment(r: SubRow): FrameworkSubAssessment {
  return {
    id: r.id,
    subSectionKey: SUB,
    areaKey: AREA,
    title: TITLE,
    state: r.state,
    systemOutcome: r.system_outcome,
    systemBasis: r.system_basis,
    systemDetail: r.system_detail,
    ruleVersionId: r.rule_version_id,
    authorityProvisionId: r.authority_provision_id,
    conclusion: r.conclusion,
    isOverridden: r.is_overridden,
    basis: r.basis,
    impact: r.impact,
    facts: r.facts,
    needsReevaluation: r.needs_reevaluation,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    version: r.version,
  };
}

function liveAssessment(r: SubRow, res: ConsolidationResult): FrameworkSubAssessment {
  return {
    id: r.id,
    subSectionKey: SUB,
    areaKey: AREA,
    title: TITLE,
    state: res.state,
    systemOutcome: res.outcome,
    systemBasis: res.basis,
    systemDetail: res.detail,
    ruleVersionId: res.ruleVersionId,
    authorityProvisionId: res.authorityProvisionId,
    conclusion: null,
    isOverridden: false,
    basis: null,
    impact: null,
    facts: r.facts,
    needsReevaluation: r.needs_reevaluation,
    decidedByName: null,
    decidedAt: null,
    version: r.version,
  };
}
