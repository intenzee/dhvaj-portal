import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CARO_CONCLUSIONS,
  CARO_OUTCOME,
  FRAMEWORK_AREA_KEY,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type CaroCapturedFacts,
  type CaroDetail,
  type CaroFacts,
  type CaroOutcome,
  type CaroResult,
  type FrameworkState,
  type FrameworkSubAssessment,
  type RecordCaroDecisionInput,
  type SetCaroFactsInput,
  type StatutoryAuditCaro,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { assessCaro } from './caro';

const SUB = SUB_SECTION_KEY.caro;
const AREA = FRAMEWORK_AREA_KEY.caro;
const TITLE = 'CARO 2020 Applicability';

/** Outcomes the system can decisively suggest (so a differing conclusion is an override). */
const DECISIVE = new Set<string>(CARO_CONCLUSIONS);

const DEFAULT_CAPTURED: CaroCapturedFacts = {
  isHoldingOrSubsidiaryOfPublic: false,
  capitalPlusReserves: null,
  peakBankFiBorrowings: null,
  totalRevenue: null,
};

interface SubRow {
  id: string;
  workflow_instance_id: string;
  engagement_service_id: string;
  engagement_id: string;
  state: FrameworkState;
  system_outcome: string | null;
  system_basis: string | null;
  system_detail: CaroDetail | null;
  rule_version_id: string | null;
  authority_provision_id: string | null;
  conclusion: string | null;
  is_overridden: boolean;
  basis: string | null;
  impact: string | null;
  facts: Partial<CaroCapturedFacts> | null;
  needs_reevaluation: boolean;
  decided_by_name: string | null;
  decided_at: Date | null;
  version: number;
}

/**
 * 02.4 CARO 2020 Applicability service (Implementation Guide §9.4). Assembles the
 * direct-exemption and classification facts from the confirmed 02.1 profile +
 * masters (never recomputing them), captures the four CARO-measurement facts,
 * runs the pure engine to decide Level-1 applicability, freezes the CARO 2020
 * provision period-correct, and records the professional conclusion (override
 * keeps both + basis). Reuses the shared sub-assessment table (guide §6).
 */
@Injectable()
export class AuditCaroService {
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
       SELECT $1::uuid, $2::uuid, $3::text, $4::text, $5::text
        WHERE hsdg.is_engagement_lead($2::uuid) -- lead-only insert (RLS); others read or 404
       ON CONFLICT (workflow_instance_id, sub_section_key, area_key) DO NOTHING`,
      [workflowInstanceId, engagementId, SUB, AREA, TITLE],
    );
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  async listForEngagement(ctx: RlsContext, engagementId: string): Promise<StatutoryAuditCaro[]> {
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

  private async read(client: PoolClient, engagementId: string): Promise<StatutoryAuditCaro[]> {
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

    const out: StatutoryAuditCaro[] = [];
    for (const r of rows) {
      const captured = { ...DEFAULT_CAPTURED, ...(r.facts ?? {}) };
      const { facts, upstreamReady } = await this.assembleFacts(
        client,
        engagementId,
        r.workflow_instance_id,
        captured,
      );

      let assessment: FrameworkSubAssessment;
      let detail: CaroDetail | null;
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

  // ── Capture the 02.4-specific facts (guide §9.4) ────────────────────────────

  async setFacts(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: SetCaroFactsInput,
  ): Promise<StatutoryAuditCaro> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const merged: CaroCapturedFacts = {
        ...DEFAULT_CAPTURED,
        ...(row.facts ?? {}),
        ...(input.isHoldingOrSubsidiaryOfPublic !== undefined && {
          isHoldingOrSubsidiaryOfPublic: input.isHoldingOrSubsidiaryOfPublic,
        }),
        ...(input.capitalPlusReserves !== undefined && {
          capitalPlusReserves: input.capitalPlusReserves,
        }),
        ...(input.peakBankFiBorrowings !== undefined && {
          peakBankFiBorrowings: input.peakBankFiBorrowings,
        }),
        ...(input.totalRevenue !== undefined && { totalRevenue: input.totalRevenue }),
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
        action: 'statutory_audit.caro_facts_set',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: merged,
      });
      const [caro] = await this.readForShell(client, engagementId, workflowInstanceId);
      return caro!;
    });
  }

  // ── Run the suggestion engine (§9.4) ────────────────────────────────────────

  async runSuggestions(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditCaro> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const captured = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
      await this.persistSuggestion(client, engagementId, row.id, captured);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_suggestions_run',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
      });
      const [caro] = await this.readForShell(client, engagementId, workflowInstanceId);
      return caro!;
    });
  }

  // ── Professional decision (§19) ─────────────────────────────────────────────

  async recordDecision(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordCaroDecisionInput,
  ): Promise<StatutoryAuditCaro> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (!CARO_CONCLUSIONS.includes(input.conclusion)) {
        throw new BadRequestException('Not a valid CARO conclusion.');
      }

      const captured = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
      const { facts } = await this.assembleFacts(
        client,
        engagementId,
        workflowInstanceId,
        captured,
      );
      const res = await this.runEngine(client, engagementId, facts);

      const isOverridden =
        DECISIVE.has(res.outcome) && input.conclusion !== (res.outcome as CaroOutcome);
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
                decided_by_employee_id = $13, decided_at = now(), needs_reevaluation = false,
                version = version + 1
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
        action: 'statutory_audit.caro_decision',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { conclusion: input.conclusion, isOverridden },
      });
      const [caro] = await this.readForShell(client, engagementId, workflowInstanceId);
      return caro!;
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Run the pure engine and freeze the period-correct CARO 2020 provision. */
  private async runEngine(
    client: PoolClient,
    engagementId: string,
    facts: CaroFacts,
  ): Promise<CaroResult> {
    const auditPeriodStart = await this.auditPeriodStart(client, engagementId);
    const resolve = await this.rules.buildResolverOn(client, auditPeriodStart);
    const res = assessCaro(facts, resolve);
    if (
      res.outcome === CARO_OUTCOME.applicable ||
      res.outcome === CARO_OUTCOME.notApplicableExempt
    ) {
      const prov = await this.rules.resolveProvisionOn(client, 'CARO_2020', auditPeriodStart);
      res.authorityProvisionId = prov?.id ?? null;
    }
    return res;
  }

  private async persistSuggestion(
    client: PoolClient,
    engagementId: string,
    rowId: string,
    captured: CaroCapturedFacts,
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
  ): Promise<StatutoryAuditCaro[]> {
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
        'The framework is approved; a controlled reassessment must reopen it before editing 02.4.',
      );
    }
  }

  /** Assemble the base facts from the confirmed 02.1 profile + masters + captured facts. */
  private async assembleFacts(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    captured: CaroCapturedFacts,
  ): Promise<{ facts: CaroFacts; upstreamReady: boolean }> {
    let isCompany: boolean | null = null;
    let isPrivateCompany: boolean | null = null;
    let isOpc = false;
    const type = await client.query<{ slug: string; category: string }>(
      `SELECT et.slug, et.category
         FROM hsdg.engagements e
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
        WHERE e.id = $1`,
      [engagementId],
    );
    if (type.rows[0]) {
      isCompany = type.rows[0].category === 'company';
      isPrivateCompany = isCompany ? ['private_limited', 'opc'].includes(type.rows[0].slug) : false;
      isOpc = type.rows[0].slug === 'opc';
    }

    const profile = await client.query<{
      special_entity_types: string[];
      state: string;
      small_company_outcome: string | null;
    }>(
      `SELECT special_entity_types, state, small_company_outcome
         FROM hsdg.audit_entity_profile
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const special = profile.rows[0]?.special_entity_types ?? [];
    const profileConfirmed = profile.rows[0]?.state === 'confirmed';

    return {
      facts: {
        isCompany,
        isPrivateCompany,
        isBanking: special.includes('bank'),
        isInsurance: special.includes('insurance'),
        isSection8: special.includes('section_8'),
        isOpc,
        isSmallCompany: profileConfirmed && profile.rows[0]?.small_company_outcome === 'small',
        isHoldingOrSubsidiaryOfPublic: captured.isHoldingOrSubsidiaryOfPublic,
        capitalPlusReserves: captured.capitalPlusReserves,
        peakBankFiBorrowings: captured.peakBankFiBorrowings,
        totalRevenue: captured.totalRevenue,
      },
      upstreamReady: profileConfirmed,
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

function isDecided(state: FrameworkState): boolean {
  return (
    state === 'applicable' ||
    state === 'not_applicable' ||
    state === 'overridden' ||
    state === 'approved'
  );
}

/** Map a decisive CARO conclusion to the stored framework state. */
function decisiveState(conclusion: CaroOutcome): FrameworkState {
  if (conclusion === CARO_OUTCOME.notApplicableExempt) return 'not_applicable';
  if (conclusion === CARO_OUTCOME.furtherAssessment) return 'professional_judgement_required';
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

function liveAssessment(r: SubRow, res: CaroResult): FrameworkSubAssessment {
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
