import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  REPORTING_FRAMEWORK_CONCLUSIONS,
  REPORTING_FRAMEWORK_OUTCOME,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type FinancialReportingCapturedFacts,
  type FinancialReportingDetail,
  type FinancialReportingFacts,
  type FrameworkState,
  type FrameworkSubAssessment,
  type RecordFinancialReportingDecisionInput,
  type ReportingFrameworkOutcome,
  type SetFinancialReportingFactsInput,
  type StatutoryAuditFinancialReporting,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { assessFinancialReporting } from './financial-reporting';

const SUB = SUB_SECTION_KEY.financialReporting;
const AREA = FRAMEWORK_AREA_KEY.financialReportingFramework;
const TITLE = 'Applicable Financial Reporting Framework';

/** Outcomes the system can decisively suggest (so a differing conclusion is an override). */
const DECISIVE = new Set<string>([
  REPORTING_FRAMEWORK_OUTCOME.indAs,
  REPORTING_FRAMEWORK_OUTCOME.accountingStandards,
  REPORTING_FRAMEWORK_OUTCOME.specialised,
]);

interface SubRow {
  id: string;
  workflow_instance_id: string;
  engagement_service_id: string;
  engagement_id: string;
  state: FrameworkState;
  system_outcome: string | null;
  system_basis: string | null;
  system_detail: FinancialReportingDetail | null;
  rule_version_id: string | null;
  authority_provision_id: string | null;
  conclusion: string | null;
  is_overridden: boolean;
  basis: string | null;
  impact: string | null;
  facts: Partial<FinancialReportingCapturedFacts> | null;
  needs_reevaluation: boolean;
  decided_by_name: string | null;
  decided_at: Date | null;
  version: number;
  financial_year: string | null;
}

const DEFAULT_CAPTURED: FinancialReportingCapturedFacts = {
  isListedOnSmeExchange: false,
  priorIndAs: false,
  voluntaryIndAs: false,
  groupTriggersIndAs: false,
};

/**
 * 02.2 Financial Reporting Framework service (Implementation Guide §9.2). Reads
 * the confirmed 02.1 facts + masters (never re-asking them), captures the four
 * 02.2-specific facts, runs the pure Rule-4 roadmap engine to suggest Ind AS /
 * AS / specialised, and records the professional conclusion (override keeps both
 * + basis). Mirrors the framework service conventions.
 */
@Injectable()
export class AuditFinancialReportingService {
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
  ): Promise<StatutoryAuditFinancialReporting[]> {
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
  ): Promise<StatutoryAuditFinancialReporting[]> {
    const { rows } = await client.query<SubRow>(
      `SELECT s.id, s.workflow_instance_id, swi.engagement_service_id, s.engagement_id, s.state,
              s.system_outcome, s.system_basis, s.system_detail, s.rule_version_id,
              s.authority_provision_id, s.conclusion, s.is_overridden, s.basis, s.impact,
              s.facts, s.needs_reevaluation, emp.full_name AS decided_by_name, s.decided_at,
              s.version, e.financial_year
         FROM hsdg.audit_framework_subassessment s
         JOIN hsdg.service_workflow_instances swi ON swi.id = s.workflow_instance_id
         JOIN hsdg.engagements e ON e.id = s.engagement_id
         LEFT JOIN hsdg.employees emp ON emp.id = s.decided_by_employee_id
        WHERE s.engagement_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
        ORDER BY swi.created_at ASC`,
      [engagementId, SUB, AREA],
    );

    const out: StatutoryAuditFinancialReporting[] = [];
    for (const r of rows) {
      const captured = { ...DEFAULT_CAPTURED, ...(r.facts ?? {}) };
      const { facts, auditPeriodStart, profileConfirmed } = await this.assembleFacts(
        client,
        engagementId,
        captured,
      );

      // Show the STORED conclusion once decided; otherwise compute a live
      // suggestion for display (no write on a read).
      let assessment: FrameworkSubAssessment;
      let detail: FinancialReportingDetail | null;
      if (isDecided(r.state)) {
        assessment = mapAssessment(r);
        detail = r.system_detail;
      } else {
        const resolve = await this.rules.buildResolverOn(client, auditPeriodStart);
        const res = assessFinancialReporting(facts, resolve);
        assessment = {
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
          facts: captured,
          needsReevaluation: r.needs_reevaluation,
          decidedByName: null,
          decidedAt: null,
          version: r.version,
        };
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
        profileConfirmed,
      });
    }
    return out;
  }

  // ── Capture the 02.2-specific facts (guide §9.2) ────────────────────────────

  async setFacts(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: SetFinancialReportingFactsInput,
  ): Promise<StatutoryAuditFinancialReporting> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const merged: FinancialReportingCapturedFacts = {
        ...DEFAULT_CAPTURED,
        ...(row.facts ?? {}),
        ...(input.isListedOnSmeExchange !== undefined && {
          isListedOnSmeExchange: input.isListedOnSmeExchange,
        }),
        ...(input.priorIndAs !== undefined && { priorIndAs: input.priorIndAs }),
        ...(input.voluntaryIndAs !== undefined && { voluntaryIndAs: input.voluntaryIndAs }),
        ...(input.groupTriggersIndAs !== undefined && {
          groupTriggersIndAs: input.groupTriggersIndAs,
        }),
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
      // Refresh the persisted suggestion from the new facts (unless decided).
      await this.persistSuggestion(client, engagementId, row.id, workflowInstanceId, merged);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.financial_reporting_facts_set',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: merged,
      });
      const [fr] = await this.readForShell(client, engagementId, workflowInstanceId);
      return fr!;
    });
  }

  // ── Run the suggestion engine (§9.2) ────────────────────────────────────────

  async runSuggestions(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditFinancialReporting> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const captured = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
      await this.persistSuggestion(client, engagementId, row.id, workflowInstanceId, captured);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.financial_reporting_suggestions_run',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
      });
      const [fr] = await this.readForShell(client, engagementId, workflowInstanceId);
      return fr!;
    });
  }

  // ── Professional decision (§19) ─────────────────────────────────────────────

  async recordDecision(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordFinancialReportingDecisionInput,
  ): Promise<StatutoryAuditFinancialReporting> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (!REPORTING_FRAMEWORK_CONCLUSIONS.includes(input.conclusion)) {
        throw new BadRequestException('Not a valid reporting-framework conclusion.');
      }

      // Compute the current system suggestion to detect an override.
      const captured = { ...DEFAULT_CAPTURED, ...(row.facts ?? {}) };
      const { facts, auditPeriodStart } = await this.assembleFacts(client, engagementId, captured);
      const resolve = await this.rules.buildResolverOn(client, auditPeriodStart);
      const res = assessFinancialReporting(facts, resolve);

      const isOverridden =
        DECISIVE.has(res.outcome) &&
        input.conclusion !== (res.outcome as ReportingFrameworkOutcome);
      const basis = input.basis?.trim() || null;
      if (isOverridden && !basis) {
        throw new BadRequestException(
          'A basis is required when the conclusion overrides the system suggestion.',
        );
      }
      const state: FrameworkState = isOverridden ? 'overridden' : 'applicable';

      const result = await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET conclusion = $3,
                is_overridden = $4,
                basis = $5,
                impact = $6,
                state = $7,
                system_outcome = $8,
                system_basis = $9,
                system_detail = $10::jsonb,
                rule_version_id = $11,
                authority_provision_id = $12,
                decided_by_employee_id = $13,
                decided_at = now(),
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
        action: 'statutory_audit.financial_reporting_decision',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { conclusion: input.conclusion, isOverridden },
      });
      const [fr] = await this.readForShell(client, engagementId, workflowInstanceId);
      return fr!;
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private async persistSuggestion(
    client: PoolClient,
    engagementId: string,
    rowId: string,
    workflowInstanceId: string,
    captured: FinancialReportingCapturedFacts,
  ): Promise<void> {
    // Never overwrite a professional conclusion (§19).
    const { rows } = await client.query<{ state: FrameworkState }>(
      `SELECT state FROM hsdg.audit_framework_subassessment WHERE id = $1`,
      [rowId],
    );
    if (rows[0] && isDecided(rows[0].state)) return;
    const { facts, auditPeriodStart } = await this.assembleFacts(client, engagementId, captured);
    const resolve = await this.rules.buildResolverOn(client, auditPeriodStart);
    const res = assessFinancialReporting(facts, resolve);
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
    void workflowInstanceId;
  }

  private async readForShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditFinancialReporting[]> {
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
              s.facts, s.needs_reevaluation, NULL::text AS decided_by_name, s.decided_at,
              s.version, e.financial_year
         FROM hsdg.audit_framework_subassessment s
         JOIN hsdg.service_workflow_instances swi ON swi.id = s.workflow_instance_id
         JOIN hsdg.engagements e ON e.id = s.engagement_id
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
        'The framework is approved; a controlled reassessment must reopen it before editing 02.2.',
      );
    }
  }

  /** Assemble the base facts from confirmed 02.1 + masters + the captured facts. */
  private async assembleFacts(
    client: PoolClient,
    engagementId: string,
    captured: FinancialReportingCapturedFacts,
  ): Promise<{
    facts: FinancialReportingFacts;
    auditPeriodStart: string;
    profileConfirmed: boolean;
  }> {
    let isCompany: boolean | null = null;
    let isPrivateCompany: boolean | null = null;
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
    }

    const listed = await client.query(
      `SELECT 1 FROM hsdg.entity_listings l
         JOIN hsdg.engagements e ON e.entity_id = l.entity_id
        WHERE e.id = $1 AND l.status = 'listed' LIMIT 1`,
      [engagementId],
    );
    const isListed = (listed.rowCount ?? 0) > 0;

    // Special entities + FY come from the confirmed 02.1 profile.
    const profile = await client.query<{
      special_entity_types: string[];
      state: string;
    }>(
      `SELECT p.special_entity_types, p.state
         FROM hsdg.audit_entity_profile p
         JOIN hsdg.service_workflow_instances swi ON swi.id = p.workflow_instance_id
        WHERE swi.engagement_id = $1
        ORDER BY swi.created_at ASC
        LIMIT 1`,
      [engagementId],
    );
    const special = profile.rows[0]?.special_entity_types ?? [];
    const isNbfc = special.includes('nbfc') || special.includes('hfc');
    const isBankOrInsurance = special.includes('bank') || special.includes('insurance');
    const profileConfirmed = profile.rows[0]?.state === 'confirmed';

    // Deciding financials: prefer 02.1 captured figures, fall back to the master.
    const capturedFin = await client.query<{ parameter: string; current_value: string | null }>(
      `SELECT f.parameter, f.current_value::text
         FROM hsdg.audit_profile_financials f
         JOIN hsdg.audit_entity_profile p ON p.id = f.profile_id
         JOIN hsdg.service_workflow_instances swi ON swi.id = p.workflow_instance_id
        WHERE swi.engagement_id = $1`,
      [engagementId],
    );
    const byParam = new Map(capturedFin.rows.map((r) => [r.parameter, num(r.current_value)]));
    let netWorth = byParam.get('net_worth') ?? null;
    let turnover = byParam.get('turnover') ?? null;
    let borrowings = byParam.get('borrowings') ?? null;
    if (netWorth == null || turnover == null || borrowings == null) {
      const fin = await client.query<{
        net_worth: string | null;
        turnover: string | null;
        total_borrowings: string | null;
      }>(
        `SELECT fp.net_worth, fp.turnover, fp.total_borrowings
           FROM hsdg.entity_financial_profiles fp
           JOIN hsdg.engagements e ON e.entity_id = fp.entity_id
          WHERE e.id = $1 AND fp.is_current LIMIT 1`,
        [engagementId],
      );
      if (fin.rows[0]) {
        netWorth = netWorth ?? num(fin.rows[0].net_worth);
        turnover = turnover ?? num(fin.rows[0].turnover);
        borrowings = borrowings ?? num(fin.rows[0].total_borrowings);
      }
    }

    const fyRes = await client.query<{ financial_year: string }>(
      `SELECT financial_year FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    const auditPeriodStart = fyRes.rows[0]
      ? auditPeriodStartFromFinancialYear(fyRes.rows[0].financial_year)
      : new Date().toISOString().slice(0, 10);

    return {
      facts: {
        isCompany,
        isPrivateCompany,
        isListed,
        isListedOnSmeExchange: captured.isListedOnSmeExchange,
        isNbfc,
        isBankOrInsurance,
        priorIndAs: captured.priorIndAs,
        voluntaryIndAs: captured.voluntaryIndAs,
        groupTriggersIndAs: captured.groupTriggersIndAs,
        netWorth,
        turnover,
        borrowings,
      },
      auditPeriodStart,
      profileConfirmed,
    };
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

function num(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
