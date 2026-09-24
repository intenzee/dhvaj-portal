import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  REPORTING_FRAMEWORK_OUTCOME,
  SCHEDULE_III_CONCLUSIONS,
  SUB_SECTION_KEY,
  auditPeriodStartFromFinancialYear,
  type FrameworkState,
  type FrameworkSubAssessment,
  type ReportingFrameworkOutcome,
  type RecordScheduleIiiDecisionInput,
  type ScheduleIiiDetail,
  type ScheduleIiiFacts,
  type ScheduleIiiOutcome,
  type ScheduleIiiResult,
  type StatutoryAuditScheduleIii,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { assessScheduleIii } from './schedule-iii';

const SUB = SUB_SECTION_KEY.scheduleIii;
const AREA = FRAMEWORK_AREA_KEY.scheduleIii;
const TITLE = 'Schedule III & Presentation Framework';

const FR_SUB = SUB_SECTION_KEY.financialReporting;
const FR_AREA = FRAMEWORK_AREA_KEY.financialReportingFramework;

/** Outcomes the system can decisively suggest (so a differing conclusion is an override). */
const DECISIVE = new Set<string>(SCHEDULE_III_CONCLUSIONS);

/** 02.2 states from which its conclusion is authoritative enough to route 02.3. */
const FR_DECIDED = new Set<string>(['applicable', 'overridden', 'approved']);

interface SubRow {
  id: string;
  workflow_instance_id: string;
  engagement_service_id: string;
  engagement_id: string;
  state: FrameworkState;
  system_outcome: string | null;
  system_basis: string | null;
  system_detail: ScheduleIiiDetail | null;
  rule_version_id: string | null;
  authority_provision_id: string | null;
  conclusion: string | null;
  is_overridden: boolean;
  basis: string | null;
  impact: string | null;
  needs_reevaluation: boolean;
  decided_by_name: string | null;
  decided_at: Date | null;
  version: number;
}

/**
 * 02.3 Schedule III & Presentation Framework service (Implementation Guide §9.3).
 * Routes the Schedule III Division from the concluded 02.2 assessment and the
 * confirmed 02.1 profile — never re-asking a fact — runs the pure engine to
 * suggest the Division / specialised format, freezes the Division's Schedule III
 * provision period-correct, and records the professional conclusion (override
 * keeps both + basis). Reuses the shared sub-assessment table (guide §6).
 */
@Injectable()
export class AuditScheduleIiiService {
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

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditScheduleIii[]> {
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
  ): Promise<StatutoryAuditScheduleIii[]> {
    const { rows } = await client.query<SubRow>(
      `SELECT s.id, s.workflow_instance_id, swi.engagement_service_id, s.engagement_id, s.state,
              s.system_outcome, s.system_basis, s.system_detail, s.rule_version_id,
              s.authority_provision_id, s.conclusion, s.is_overridden, s.basis, s.impact,
              s.needs_reevaluation, emp.full_name AS decided_by_name, s.decided_at, s.version
         FROM hsdg.audit_framework_subassessment s
         JOIN hsdg.service_workflow_instances swi ON swi.id = s.workflow_instance_id
         LEFT JOIN hsdg.employees emp ON emp.id = s.decided_by_employee_id
        WHERE s.engagement_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3
        ORDER BY swi.created_at ASC`,
      [engagementId, SUB, AREA],
    );

    const out: StatutoryAuditScheduleIii[] = [];
    for (const r of rows) {
      const { facts, upstreamReady } = await this.assembleFacts(
        client,
        engagementId,
        r.workflow_instance_id,
      );

      let assessment: FrameworkSubAssessment;
      let detail: ScheduleIiiDetail | null;
      if (isDecided(r.state)) {
        assessment = mapAssessment(r);
        detail = r.system_detail;
      } else {
        const res = await this.runEngine(client, engagementId, facts, r.workflow_instance_id);
        assessment = liveAssessment(r, res);
        detail = res.detail;
      }

      out.push({
        workflowInstanceId: r.workflow_instance_id,
        engagementServiceId: r.engagement_service_id,
        engagementId: r.engagement_id,
        assessment,
        detail,
        baseFacts: facts,
        upstreamReady,
      });
    }
    return out;
  }

  // ── Run the suggestion engine (§9.3) ────────────────────────────────────────

  async runSuggestions(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditScheduleIii> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      await this.persistSuggestion(client, engagementId, row.id, workflowInstanceId);
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.schedule_iii_suggestions_run',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
      });
      const [sch] = await this.readForShell(client, engagementId, workflowInstanceId);
      return sch!;
    });
  }

  // ── Professional decision (§19) ─────────────────────────────────────────────

  async recordDecision(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: RecordScheduleIiiDecisionInput,
  ): Promise<StatutoryAuditScheduleIii> {
    return this.db.withRlsContext(ctx, async (client) => {
      const row = await this.loadRow(client, engagementId, workflowInstanceId);
      this.assertNotApproved(row);
      if (!SCHEDULE_III_CONCLUSIONS.includes(input.conclusion)) {
        throw new BadRequestException('Not a valid Schedule III conclusion.');
      }

      const { facts } = await this.assembleFacts(client, engagementId, workflowInstanceId);
      const res = await this.runEngine(client, engagementId, facts, workflowInstanceId);

      const isOverridden =
        DECISIVE.has(res.outcome) && input.conclusion !== (res.outcome as ScheduleIiiOutcome);
      const basis = input.basis?.trim() || null;
      if (isOverridden && !basis) {
        throw new BadRequestException(
          'A basis is required when the conclusion overrides the system suggestion.',
        );
      }
      const state: FrameworkState = isOverridden ? 'overridden' : 'applicable';

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
        action: 'statutory_audit.schedule_iii_decision',
        objectType: 'audit_framework_subassessment',
        objectId: row.id,
        after: { conclusion: input.conclusion, isOverridden },
      });
      const [sch] = await this.readForShell(client, engagementId, workflowInstanceId);
      return sch!;
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Run the pure engine and freeze the period-correct provisions onto the result. */
  private async runEngine(
    client: PoolClient,
    engagementId: string,
    facts: ScheduleIiiFacts,
    workflowInstanceId: string,
  ): Promise<ScheduleIiiResult> {
    void engagementId;
    void workflowInstanceId;
    const auditPeriodStart = await this.auditPeriodStart(client, engagementId);
    const resolve = await this.rules.buildResolverOn(client, auditPeriodStart);
    const res = assessScheduleIii(facts, resolve);

    // Freeze the Division's Schedule III provision (period-correct version).
    if (res.detail.divisionProvisionCode) {
      const prov = await this.rules.resolveProvisionOn(
        client,
        res.detail.divisionProvisionCode,
        auditPeriodStart,
      );
      res.authorityProvisionId = prov?.id ?? null;
    }
    // Cite the §2(40) proviso when the cash-flow statement is exempt.
    if (!res.detail.cashFlowRequired && res.detail.cashFlowExemptionReason) {
      const cf = await this.rules.resolveProvisionOn(client, 'COS_ACT_2_40', auditPeriodStart);
      res.detail.cashFlowProvisionId = cf?.id ?? null;
    }
    return res;
  }

  private async persistSuggestion(
    client: PoolClient,
    engagementId: string,
    rowId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    // Never overwrite a professional conclusion (§19).
    const { rows } = await client.query<{ state: FrameworkState }>(
      `SELECT state FROM hsdg.audit_framework_subassessment WHERE id = $1`,
      [rowId],
    );
    if (rows[0] && isDecided(rows[0].state)) return;
    const { facts } = await this.assembleFacts(client, engagementId, workflowInstanceId);
    const res = await this.runEngine(client, engagementId, facts, workflowInstanceId);
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
  ): Promise<StatutoryAuditScheduleIii[]> {
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
              s.needs_reevaluation, NULL::text AS decided_by_name, s.decided_at, s.version
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
        'The framework is approved; a controlled reassessment must reopen it before editing 02.3.',
      );
    }
  }

  /**
   * Assemble the base facts from the confirmed 02.1 profile and the concluded
   * 02.2 assessment for THIS workflow instance. Nothing is captured on 02.3.
   */
  private async assembleFacts(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<{ facts: ScheduleIiiFacts; upstreamReady: boolean }> {
    // 02.1 profile: special entities + small-company outcome + confirmation.
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
    const isNbfc = special.includes('nbfc') || special.includes('hfc');
    const isBankOrInsurance = special.includes('bank') || special.includes('insurance');
    const isDormant = special.includes('dormant');
    const profileConfirmed = profile.rows[0]?.state === 'confirmed';
    const isSmallCompany = profileConfirmed && profile.rows[0]?.small_company_outcome === 'small';

    // OPC comes from the entity-type master (Card A) — cash-flow exemption input.
    const type = await client.query<{ slug: string }>(
      `SELECT et.slug
         FROM hsdg.engagements e
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
        WHERE e.id = $1`,
      [engagementId],
    );
    const isOpc = type.rows[0]?.slug === 'opc';

    // 02.2 conclusion routes the Division; its detail carries first-time Ind AS.
    const fr = await client.query<{
      state: string;
      conclusion: string | null;
      system_detail: { firstTimeIndAs?: boolean } | null;
    }>(
      `SELECT state, conclusion, system_detail
         FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
      [workflowInstanceId, FR_SUB, FR_AREA],
    );
    let reportingFramework: ReportingFrameworkOutcome | null = null;
    let firstTimeIndAs = false;
    const frRow = fr.rows[0];
    if (frRow && FR_DECIDED.has(frRow.state) && frRow.conclusion) {
      reportingFramework = frRow.conclusion as ReportingFrameworkOutcome;
      if (reportingFramework === REPORTING_FRAMEWORK_OUTCOME.indAs) {
        firstTimeIndAs = frRow.system_detail?.firstTimeIndAs === true;
      }
    }

    // Turnover (02.1 captured, else the entity master) selects the rounding band.
    const turnover = await this.turnover(client, engagementId);

    return {
      facts: {
        reportingFramework,
        isNbfc,
        isBankOrInsurance,
        isOpc,
        isSmallCompany,
        isDormant,
        firstTimeIndAs,
        turnover,
      },
      upstreamReady: profileConfirmed && reportingFramework != null,
    };
  }

  private async turnover(client: PoolClient, engagementId: string): Promise<number | null> {
    const captured = await client.query<{ current_value: string | null }>(
      `SELECT f.current_value::text
         FROM hsdg.audit_profile_financials f
         JOIN hsdg.audit_entity_profile p ON p.id = f.profile_id
         JOIN hsdg.service_workflow_instances swi ON swi.id = p.workflow_instance_id
        WHERE swi.engagement_id = $1 AND f.parameter = 'turnover'
        LIMIT 1`,
      [engagementId],
    );
    const fromProfile = num(captured.rows[0]?.current_value ?? null);
    if (fromProfile != null) return fromProfile;
    const fin = await client.query<{ turnover: string | null }>(
      `SELECT fp.turnover
         FROM hsdg.entity_financial_profiles fp
         JOIN hsdg.engagements e ON e.entity_id = fp.entity_id
        WHERE e.id = $1 AND fp.is_current LIMIT 1`,
      [engagementId],
    );
    return num(fin.rows[0]?.turnover ?? null);
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
    facts: null,
    needsReevaluation: r.needs_reevaluation,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    version: r.version,
  };
}

/** Build the display assessment for an undecided row from a fresh engine run. */
function liveAssessment(r: SubRow, res: ScheduleIiiResult): FrameworkSubAssessment {
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
    facts: null,
    needsReevaluation: r.needs_reevaluation,
    decidedByName: null,
    decidedAt: null,
    version: r.version,
  };
}

function num(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
