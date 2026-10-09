import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  IND_AS_FIRST_TIME_WORK_AREA,
  WORK_AREA_BLUEPRINT,
  WORK_AREA_PROGRESSED_STATES,
  auditPeriodStartFromFinancialYear,
  planFinancialReportingDownstream,
  scheduleIiiDivisionFor,
  type FinancialReportingDownstreamView,
  type FrameworkDownstreamActionKey,
  type FrameworkDownstreamFacts,
  type FrameworkDownstreamItem,
  type PlannedDownstreamAction,
  type SmcRelaxation,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { readFinancialReportingResult } from './financial-reporting-result';

interface ActionRow {
  action_key: FrameworkDownstreamActionKey;
  status: 'activated' | 'withdrawn';
  activated_at: Date;
  activated_by_name: string | null;
}

/** The work areas the activated downstream actions add to Audit Areas. */
export interface DownstreamWorkArea {
  workAreaKey: string;
  title: string;
  scope: string;
  sortOrder: number;
  actionKey: FrameworkDownstreamActionKey;
}

/**
 * 02.2 downstream actions (DHVAJ 02.2 spec §5 "Downstream impact", §19).
 *
 * The plan is pure ({@link planFinancialReportingDownstream}); this service
 * makes it live when Section 02 is approved (02.9 AF-02 calls
 * {@link applyOn}) — activating the Ind AS / AS review framework, the SMC
 * relaxations and the Ind AS 101 transition work, withdrawing what an earlier
 * approval activated but the current conclusion no longer calls for — and
 * feeds work generation ({@link workAreasOn}, {@link smcRelaxationsOn}). The
 * 02.2 result is read only through the 02.2 result helper.
 */
@Injectable()
export class AuditFrameworkDownstreamService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── The "Downstream impact" panel ──────────────────────────────────────

  async view(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<FinancialReportingDownstreamView> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: shell } = await client.query<{ financial_year: string | null }>(
        `SELECT e.financial_year
           FROM hsdg.service_workflow_instances swi
           JOIN hsdg.engagements e ON e.id = swi.engagement_id
          WHERE swi.id = $1 AND swi.engagement_id = $2 AND swi.status <> 'cancelled'`,
        [workflowInstanceId, engagementId],
      );
      if (!shell[0]) {
        throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
      }
      const result = await readFinancialReportingResult(client, workflowInstanceId);
      const facts = downstreamFacts(result);
      const plan = planFinancialReportingDownstream(facts);
      const rows = await this.readRows(client, workflowInstanceId);
      const approved = result?.approved === true;
      const relaxations = plan.some((p) => p.key === 'smc_relaxations')
        ? await this.relaxationsFor(client, shell[0].financial_year)
        : [];

      const items: FrameworkDownstreamItem[] = plan.map((p) => {
        const row = rows.get(p.key);
        const live = approved && row?.status === 'activated';
        return {
          ...p,
          status: live ? 'activated' : 'pending',
          activatedAt: live ? row!.activated_at.toISOString() : null,
          activatedByName: live ? row!.activated_by_name : null,
          relaxations: p.key === 'smc_relaxations' ? relaxations : [],
        };
      });
      // What an earlier approval activated that the current plan drops.
      const planned = new Set(plan.map((p) => p.key));
      for (const [key, row] of rows) {
        if (planned.has(key) || row.status !== 'activated') continue;
        const was = WITHDRAWN_TITLES[key];
        items.push({
          key,
          title: was.title,
          detail: approved
            ? 'Activated by an earlier approval; the current conclusion no longer calls for it.'
            : 'Activated by the earlier approval; it is withdrawn when Section 02 is approved with the current conclusion.',
          target: was.target,
          provisionCode: null,
          workAreaKey: null,
          managedBy02_2: false,
          status: approved ? 'withdrawn' : 'pending',
          activatedAt: row.activated_at.toISOString(),
          activatedByName: row.activated_by_name,
          relaxations: [],
        });
      }
      return {
        workflowInstanceId,
        approved,
        framework: facts.framework,
        scheduleIiiDivision: scheduleIiiDivisionFor(facts),
        items,
      };
    });
  }

  // ── Activation (Section 02 approval, 02.9 AF-02) ───────────────────────

  /**
   * Make the approved 02.2 result's downstream actions live. Called inside the
   * AF-02 approval transaction, after the sub-assessments are frozen. A no-op
   * when 02.2 has no approved result. Idempotent: a repeat approval with the
   * same conclusion changes nothing.
   */
  async applyOn(client: PoolClient, ctx: RlsContext, workflowInstanceId: string): Promise<void> {
    const result = await readFinancialReportingResult(client, workflowInstanceId);
    if (!result || !result.approved) return;
    const plan = planFinancialReportingDownstream(downstreamFacts(result)).filter(
      (p) => !p.managedBy02_2,
    );
    const { rows: shell } = await client.query<{ engagement_id: string }>(
      `SELECT engagement_id FROM hsdg.service_workflow_instances WHERE id = $1`,
      [workflowInstanceId],
    );
    const engagementId = shell[0]?.engagement_id;
    if (!engagementId) return;
    const before = await this.readRows(client, workflowInstanceId);

    const activated: string[] = [];
    for (const p of plan) {
      const prior = before.get(p.key);
      if (prior?.status === 'activated') continue;
      await client.query(
        `INSERT INTO hsdg.audit_framework_downstream
           (workflow_instance_id, engagement_id, action_key, status, framework, provision_code,
            work_area_key, rule_version_id, activated_by_employee_id)
         VALUES ($1, $2, $3, 'activated', $4, $5, $6, $7, $8)
         ON CONFLICT (workflow_instance_id, action_key) DO UPDATE
           SET status = 'activated', framework = EXCLUDED.framework,
               provision_code = EXCLUDED.provision_code, work_area_key = EXCLUDED.work_area_key,
               rule_version_id = EXCLUDED.rule_version_id, activated_at = now(),
               activated_by_employee_id = EXCLUDED.activated_by_employee_id, withdrawn_at = NULL`,
        [
          workflowInstanceId,
          engagementId,
          p.key,
          result.framework,
          p.provisionCode,
          p.workAreaKey,
          result.ruleVersionId ?? null,
          ctx.employeeId ?? null,
        ],
      );
      activated.push(p.key);
    }
    const planned = new Set<string>(plan.map((p) => p.key));
    const withdrawn: string[] = [];
    for (const [key, row] of before) {
      if (planned.has(key) || row.status !== 'activated') continue;
      await client.query(
        `UPDATE hsdg.audit_framework_downstream
            SET status = 'withdrawn', withdrawn_at = now()
          WHERE workflow_instance_id = $1 AND action_key = $2`,
        [workflowInstanceId, key],
      );
      withdrawn.push(key);
    }
    // Work already generated: bring its downstream areas in line now (later
    // generation runs read the same rows).
    await this.syncWorkAreasOn(client, workflowInstanceId, engagementId);

    if (activated.length === 0 && withdrawn.length === 0) return;
    await this.audit.recordWith(client, ctx, {
      action: 'statutory_audit.framework_downstream_applied',
      objectType: 'service_workflow_instance',
      objectId: workflowInstanceId,
      after: {
        framework: result.framework,
        ruleVersionId: result.ruleVersionId ?? null,
        activated,
        withdrawn,
      },
    });
  }

  // ── Read by work generation ────────────────────────────────────────────

  /** Work areas the activated downstream actions add (none before approval). */
  async workAreasOn(client: PoolClient, workflowInstanceId: string): Promise<DownstreamWorkArea[]> {
    const rows = await this.readRows(client, workflowInstanceId);
    const live = (k: FrameworkDownstreamActionKey) => rows.get(k)?.status === 'activated';
    const blueprint = (key: string) => WORK_AREA_BLUEPRINT.find((b) => b.workAreaKey === key)!;
    const out: DownstreamWorkArea[] = [];
    if (live('ind_as_review')) {
      const b = blueprint('ind_as_review');
      out.push({ ...pickArea(b), actionKey: 'ind_as_review' });
    }
    if (live('as_review')) {
      const b = blueprint('schedule_iii_work');
      out.push({ ...pickArea(b), actionKey: 'as_review' });
    }
    if (live('ind_as_101_transition')) {
      out.push({ ...pickArea(IND_AS_FIRST_TIME_WORK_AREA), actionKey: 'ind_as_101_transition' });
    }
    return out;
  }

  /**
   * The SMC relaxations the AS review applies — only when the approved 02.2
   * result activated them, in the version in force for the audit period.
   */
  async smcRelaxationsOn(client: PoolClient, workflowInstanceId: string): Promise<SmcRelaxation[]> {
    const rows = await this.readRows(client, workflowInstanceId);
    if (rows.get('smc_relaxations')?.status !== 'activated') return [];
    const { rows: fy } = await client.query<{ financial_year: string | null }>(
      `SELECT e.financial_year FROM hsdg.service_workflow_instances swi
         JOIN hsdg.engagements e ON e.id = swi.engagement_id WHERE swi.id = $1`,
      [workflowInstanceId],
    );
    return this.relaxationsFor(client, fy[0]?.financial_year ?? null);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async syncWorkAreasOn(
    client: PoolClient,
    workflowInstanceId: string,
    engagementId: string,
  ): Promise<void> {
    const { rows: generated } = await client.query<{ v: number | null }>(
      `SELECT max(generated_from_version) AS v FROM hsdg.audit_work_areas
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    if (generated[0]?.v == null) return; // Not generated yet — generation picks them up.
    const wanted = await this.workAreasOn(client, workflowInstanceId);
    for (const a of wanted) {
      await client.query(
        `INSERT INTO hsdg.audit_work_areas
           (workflow_instance_id, engagement_id, work_area_key, title, scope, source,
            origin_area_key, sort_order, is_active, generated_from_version)
         VALUES ($1, $2, $3, $4, $5, $6, 'financial_reporting_framework', $7, true, $8)
         ON CONFLICT (workflow_instance_id, work_area_key) DO UPDATE
           SET is_active = true`,
        [
          workflowInstanceId,
          engagementId,
          a.workAreaKey,
          a.title,
          a.scope,
          `framework:02.2:${a.actionKey}`,
          a.sortOrder,
          generated[0]?.v ?? null,
        ],
      );
    }
    // A withdrawn action's area goes inactive — never deleted; progressed work
    // is flagged so the reviewer sees it.
    const keep = new Set(wanted.map((a) => a.workAreaKey));
    if (!keep.has(IND_AS_FIRST_TIME_WORK_AREA.workAreaKey)) {
      await client.query(
        `UPDATE hsdg.audit_work_areas
            SET is_active = false,
                state = CASE WHEN state = ANY($3::text[]) THEN 'needs_attention' ELSE state END
          WHERE workflow_instance_id = $1 AND work_area_key = $2 AND is_active`,
        [
          workflowInstanceId,
          IND_AS_FIRST_TIME_WORK_AREA.workAreaKey,
          [...WORK_AREA_PROGRESSED_STATES],
        ],
      );
    }
  }

  private async readRows(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<Map<FrameworkDownstreamActionKey, ActionRow>> {
    const { rows } = await client.query<ActionRow>(
      `SELECT d.action_key, d.status, d.activated_at, emp.full_name AS activated_by_name
         FROM hsdg.audit_framework_downstream d
         LEFT JOIN hsdg.employees emp ON emp.id = d.activated_by_employee_id
        WHERE d.workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return new Map(rows.map((r) => [r.action_key, r]));
  }

  private async relaxationsFor(
    client: PoolClient,
    financialYear: string | null,
  ): Promise<SmcRelaxation[]> {
    const on = /^\d{4}/.test(financialYear ?? '')
      ? auditPeriodStartFromFinancialYear(financialYear!)
      : new Date().toISOString().slice(0, 10);
    const { rows } = await client.query<{
      relaxation_key: string;
      standard_code: string;
      standard_label: string;
      kind: SmcRelaxation['kind'];
      paragraphs: string | null;
      relaxation: string;
      provision_code: string;
    }>(
      `SELECT relaxation_key, standard_code, standard_label, kind, paragraphs, relaxation,
              provision_code
         FROM hsdg.as_smc_relaxation
        WHERE effective_from <= $1::date AND (effective_to IS NULL OR effective_to >= $1::date)
        ORDER BY sort_order, relaxation_key`,
      [on],
    );
    return rows.map((r) => ({
      key: r.relaxation_key,
      standardCode: r.standard_code,
      standardLabel: r.standard_label,
      kind: r.kind,
      paragraphs: r.paragraphs,
      relaxation: r.relaxation,
      provisionCode: r.provision_code,
    }));
  }
}

function pickArea(a: {
  workAreaKey: string;
  title: string;
  scope: string;
  sortOrder: number;
}): Omit<DownstreamWorkArea, 'actionKey'> {
  return { workAreaKey: a.workAreaKey, title: a.title, scope: a.scope, sortOrder: a.sortOrder };
}

/** The facts the plan reads, from the 02.2 result helper (null → nothing planned). */
function downstreamFacts(
  r: Awaited<ReturnType<typeof readFinancialReportingResult>>,
): FrameworkDownstreamFacts {
  if (!r) return { framework: null, isNbfc: false, smcStatus: null, firstTimeAdoption: null };
  return {
    framework: r.framework,
    isNbfc: r.isNbfc,
    smcStatus: r.smcStatus,
    firstTimeAdoption: r.firstTimeAdoption,
  };
}

const WITHDRAWN_TITLES: Record<
  FrameworkDownstreamActionKey,
  Pick<PlannedDownstreamAction, 'title' | 'target'>
> = {
  ind_as_review: { title: 'Ind AS financial-statement review framework', target: '02.3' },
  nbfc_division_iii: { title: 'NBFC presentation and reporting', target: '02.3' },
  as_review: { title: 'Accounting Standards review framework', target: '02.3' },
  smc_relaxations: { title: 'SMC exemptions and relaxations', target: 'AS review methodology' },
  ind_as_101_transition: {
    title: 'First-time Ind AS adoption — Ind AS 101 transition work',
    target: 'Audit work',
  },
  framework_review: { title: 'Framework Review (blocking)', target: '02.2' },
};
