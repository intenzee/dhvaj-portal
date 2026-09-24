import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  OTHER_REPORTING_CONCLUSIONS,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type FrameworkState,
  type FrameworkSubAssessment,
  type OtherReportingBaseFacts,
  type OtherReportingCapturedFacts,
  type OtherReportingDetail,
  type OtherReportingOutcome,
  type OtherReportingResult,
  type RecordOtherReportingDecisionInput,
  type SetOtherReportingFactsInput,
  type StatutoryAuditOtherReporting,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { assessOtherReporting } from './other-reporting';

const SUB = SUB_SECTION_KEY.otherReporting;
const AREA = FRAMEWORK_AREA_KEY.otherRegulatory;
const TITLE = 'Other Companies Act & Statutory Reporting';

const DECISIVE = new Set<string>(OTHER_REPORTING_CONCLUSIONS);

const DEFAULT_CAPTURED: OtherReportingCapturedFacts = {
  softwareSystems: [],
  managerialRemunerationPaid: null,
  section198NetProfit: null,
  hasManagingOrWholeTimeDirector: false,
  fraudIdentified: false,
  fraudAmount: null,
  fraudEventDate: null,
  intermediaryFundsAdvanced: false,
  ultimateBeneficiaryFundsReceived: false,
  fundingRepresentationsObtained: false,
  dividendCompliesSec123: null,
  pendingLitigationDisclosed: null,
  foreseeableLossesProvided: null,
  iepfTransferDelay: null,
};

interface SubRow {
  id: string;
  workflow_instance_id: string;
  engagement_service_id: string;
  engagement_id: string;
  state: FrameworkState;
  system_outcome: string | null;
  system_basis: string | null;
  system_detail: OtherReportingDetail | null;
  rule_version_id: string | null;
  authority_provision_id: string | null;
  conclusion: string | null;
  is_overridden: boolean;
  basis: string | null;
  impact: string | null;
  facts: Partial<OtherReportingCapturedFacts> | null;
  needs_reevaluation: boolean;
  decided_by_name: string | null;
  decided_at: Date | null;
  version: number;
}

/**
 * 02.7 Other Companies Act & Statutory Reporting service (Guide §9.7). Captures
 * the reporting-matrix facts, assembles the public-company classification and the
 * Rule 11(g) in-force flag (from the provision's effective date), runs the pure
 * engine to configure the matrix, freezes the §143(3) umbrella provision, and
 * records the professional conclusion. Reuses the shared sub-assessment table.
 */
@Injectable()
export class AuditOtherReportingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly rules: AuditRulesService,
  ) {}

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

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditOtherReporting[]> {
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
  ): Promise<StatutoryAuditOtherReporting[]> {
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

    const out: StatutoryAuditOtherReporting[] = [];
    for (const r of rows) {
      const captured = mergeCaptured(r.facts);
      const { facts, upstreamReady } = await this.assembleFacts(client, engagementId, captured);

      let assessment: FrameworkSubAssessment;
      let detail: OtherReportingDetail | null;
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

  async setFacts(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: SetOtherReportingFactsInput,
  ): Promise<StatutoryAuditOtherReporting> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      const c = mergeCaptured(row.facts);
      const opt = <T>(v: T | undefined, cur: T): T => (v !== undefined ? v : cur);
      const merged: OtherReportingCapturedFacts = {
        softwareSystems:
          input.softwareSystems !== undefined ? input.softwareSystems : c.softwareSystems,
        managerialRemunerationPaid: opt(
          input.managerialRemunerationPaid,
          c.managerialRemunerationPaid,
        ),
        section198NetProfit: opt(input.section198NetProfit, c.section198NetProfit),
        hasManagingOrWholeTimeDirector: opt(
          input.hasManagingOrWholeTimeDirector,
          c.hasManagingOrWholeTimeDirector,
        ),
        fraudIdentified: opt(input.fraudIdentified, c.fraudIdentified),
        fraudAmount: opt(input.fraudAmount, c.fraudAmount),
        fraudEventDate: opt(input.fraudEventDate, c.fraudEventDate),
        intermediaryFundsAdvanced: opt(
          input.intermediaryFundsAdvanced,
          c.intermediaryFundsAdvanced,
        ),
        ultimateBeneficiaryFundsReceived: opt(
          input.ultimateBeneficiaryFundsReceived,
          c.ultimateBeneficiaryFundsReceived,
        ),
        fundingRepresentationsObtained: opt(
          input.fundingRepresentationsObtained,
          c.fundingRepresentationsObtained,
        ),
        dividendCompliesSec123: opt(input.dividendCompliesSec123, c.dividendCompliesSec123),
        pendingLitigationDisclosed: opt(
          input.pendingLitigationDisclosed,
          c.pendingLitigationDisclosed,
        ),
        foreseeableLossesProvided: opt(
          input.foreseeableLossesProvided,
          c.foreseeableLossesProvided,
        ),
        iepfTransferDelay: opt(input.iepfTransferDelay, c.iepfTransferDelay),
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
        action: 'statutory_audit.other_reporting_facts_set',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: merged,
      });
      const [o] = await this.readForShell(client, engagementId, workflowInstanceId);
      return o!;
    });
  }

  async runSuggestions(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditOtherReporting> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      await this.persistSuggestion(client, engagementId, row.id, mergeCaptured(row.facts));
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.other_reporting_suggestions_run',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
      });
      const [o] = await this.readForShell(client, engagementId, workflowInstanceId);
      return o!;
    });
  }

  async recordDecision(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordOtherReportingDecisionInput,
  ): Promise<StatutoryAuditOtherReporting> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (!OTHER_REPORTING_CONCLUSIONS.includes(input.conclusion)) {
        throw new BadRequestException('Not a valid statutory-reporting conclusion.');
      }

      const { facts } = await this.assembleFacts(client, engagementId, mergeCaptured(row.facts));
      const res = await this.runEngine(client, engagementId, facts);

      const isOverridden =
        DECISIVE.has(res.outcome) && input.conclusion !== (res.outcome as OtherReportingOutcome);
      const basis = input.basis?.trim() || null;
      if (isOverridden && !basis) {
        throw new BadRequestException(
          'A basis is required when the conclusion overrides the system suggestion.',
        );
      }

      const result = await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET conclusion = $3, is_overridden = $4, basis = $5, impact = $6, state = 'applicable',
                system_outcome = $7, system_basis = $8, system_detail = $9::jsonb,
                rule_version_id = $10, authority_provision_id = $11,
                decided_by_employee_id = $12, decided_at = now(), needs_reevaluation = false,
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          row.id,
          input.version,
          input.conclusion,
          isOverridden,
          basis,
          input.impact?.trim() || null,
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
        action: 'statutory_audit.other_reporting_decision',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { conclusion: input.conclusion, isOverridden },
      });
      const [o] = await this.readForShell(client, engagementId, workflowInstanceId);
      return o!;
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private async runEngine(
    client: PoolClient,
    engagementId: string,
    facts: OtherReportingBaseFacts,
  ): Promise<OtherReportingResult> {
    const auditPeriodStart = await this.auditPeriodStart(client, engagementId);
    const resolve = await this.rules.buildResolverOn(client, auditPeriodStart);
    const res = assessOtherReporting(facts, resolve);
    const prov = await this.rules.resolveProvisionOn(client, 'COS_ACT_143_3', auditPeriodStart);
    res.authorityProvisionId = prov?.id ?? null;
    return res;
  }

  private async persistSuggestion(
    client: PoolClient,
    engagementId: string,
    rowId: string,
    captured: OtherReportingCapturedFacts,
  ): Promise<void> {
    const { rows } = await client.query<{ state: FrameworkState }>(
      `SELECT state FROM hsdg.audit_framework_subassessment WHERE id = $1`,
      [rowId],
    );
    if (!rows[0] || isDecided(rows[0].state)) return;
    const { facts } = await this.assembleFacts(client, engagementId, captured);
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
  ): Promise<StatutoryAuditOtherReporting[]> {
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
        'The framework is approved; a controlled reassessment must reopen it before editing 02.7.',
      );
    }
  }

  private async assembleFacts(
    client: PoolClient,
    engagementId: string,
    captured: OtherReportingCapturedFacts,
  ): Promise<{ facts: OtherReportingBaseFacts; upstreamReady: boolean }> {
    let isCompany: boolean | null = null;
    let isPublicCompany: boolean | null = null;
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
      isPublicCompany = isCompany ? !['private_limited', 'opc'].includes(type.rows[0].slug) : false;
    }

    const auditPeriodStart = await this.auditPeriodStart(client, engagementId);
    const trailProv = await this.rules.resolveProvisionOn(
      client,
      'AUDIT_RULE_11G',
      auditPeriodStart,
    );
    const auditTrailInForce = trailProv != null;

    return {
      facts: { ...captured, isPublicCompany, auditTrailInForce },
      upstreamReady: isCompany != null,
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
  facts: Partial<OtherReportingCapturedFacts> | null,
): OtherReportingCapturedFacts {
  return {
    ...DEFAULT_CAPTURED,
    ...(facts ?? {}),
    softwareSystems: facts?.softwareSystems ?? DEFAULT_CAPTURED.softwareSystems,
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

function liveAssessment(r: SubRow, res: OtherReportingResult): FrameworkSubAssessment {
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
