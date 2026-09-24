import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FRAMEWORK_AREA_KEY,
  FRAMEWORK_BASELINE_STATUS,
  FRAMEWORK_DECIDED_STATES,
  SUB_SECTION_KEY,
  computeFrameworkGates,
  type ApproveFrameworkInput,
  type ConfirmFrameworkInput,
  type DownstreamPreviewItem,
  type FrameworkBaselineRecord,
  type FrameworkState,
  type FrameworkSummaryMatter,
  type FrameworkSummarySection,
  type FrameworkTriggeredSa,
  type ReopenFrameworkInput,
  type StatutoryAuditFrameworkSummary,
  type SubSectionKey,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';

/** The six Section-02 sub-sections the summary aggregates, in dashboard order. */
const SECTIONS: Array<{ sub: SubSectionKey; area: string; title: string }> = [
  {
    sub: SUB_SECTION_KEY.financialReporting,
    area: FRAMEWORK_AREA_KEY.financialReportingFramework,
    title: 'Applicable Financial Reporting Framework',
  },
  {
    sub: SUB_SECTION_KEY.scheduleIii,
    area: FRAMEWORK_AREA_KEY.scheduleIii,
    title: 'Schedule III & Presentation Framework',
  },
  { sub: SUB_SECTION_KEY.caro, area: FRAMEWORK_AREA_KEY.caro, title: 'CARO 2020 Applicability' },
  {
    sub: SUB_SECTION_KEY.icfr,
    area: FRAMEWORK_AREA_KEY.ifc,
    title: 'Internal Financial Controls / ICFR Reporting',
  },
  {
    sub: SUB_SECTION_KEY.consolidation,
    area: FRAMEWORK_AREA_KEY.cfs,
    title: 'Consolidation / Group Audit Framework',
  },
  {
    sub: SUB_SECTION_KEY.otherReporting,
    area: FRAMEWORK_AREA_KEY.otherRegulatory,
    title: 'Other Companies Act & Statutory Reporting',
  },
];

const DECIDED = new Set<string>(FRAMEWORK_DECIDED_STATES);

interface BaselineRow {
  id: string;
  version: string;
  status: string;
  methodology_version: string | null;
  memo_document_id: string | null;
  reopen_reason: string | null;
  manager_confirmed_by_name: string | null;
  manager_confirmed_at: Date | null;
  ep_approved_by_name: string | null;
  ep_approved_at: Date | null;
  record_version: number;
}

/**
 * 02.8 Audit Framework Summary & Approval service (Guide §9.8, §13). Aggregates
 * the 02.2–02.7 sub-assessments and the 02.1 profile into a read-only dashboard,
 * and drives the two approval gates (AF-01 Manager confirmation, AF-02 EP
 * approval) with baseline versioning + a controlled reopen. It writes only its
 * own baseline record and (on approval/reopen) the sub-assessment states.
 */
@Injectable()
export class AuditFrameworkSummaryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read / aggregate ─────────────────────────────────────────────────────────

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditFrameworkSummary[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: shells } = await client.query<{ id: string; engagement_service_id: string }>(
        `SELECT id, engagement_service_id FROM hsdg.service_workflow_instances WHERE engagement_id = $1
          ORDER BY created_at ASC`,
        [engagementId],
      );
      const out: StatutoryAuditFrameworkSummary[] = [];
      for (const s of shells)
        out.push(await this.build(client, engagementId, s.id, s.engagement_service_id));
      return out;
    });
  }

  private async build(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    engagementServiceId: string,
  ): Promise<StatutoryAuditFrameworkSummary> {
    const sections = await this.sections(client, workflowInstanceId);
    const profileConfirmed = await this.profileConfirmed(client, workflowInstanceId);
    const triggeredSAs = await this.triggeredSAs(client, workflowInstanceId, sections);
    const matters = await this.matters(client, workflowInstanceId);
    const baseline = await this.currentBaseline(client, workflowInstanceId);
    const downstreamPreview = this.downstreamPreview(sections);

    const hasBlockingMatter = matters.some((m) => m.blocking);
    const gates = computeFrameworkGates({
      sections,
      profileConfirmed,
      hasBlockingMatter,
      baselineStatus: baseline?.status ?? null,
    });
    const isApproved = baseline?.status === FRAMEWORK_BASELINE_STATUS.approved;

    return {
      workflowInstanceId,
      engagementServiceId,
      engagementId,
      profileConfirmed,
      sections,
      triggeredSAs,
      matters,
      downstreamPreview,
      baseline,
      gates,
      planningUnlocked: isApproved,
      recordVersion: baseline?.recordVersion ?? 0,
    };
  }

  private async sections(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<FrameworkSummarySection[]> {
    const { rows } = await client.query<{
      sub_section_key: string;
      area_key: string;
      title: string;
      state: FrameworkState;
      system_outcome: string | null;
      conclusion: string | null;
      rule_version_id: string | null;
      authority_provision_id: string | null;
      needs_reevaluation: boolean;
    }>(
      `SELECT sub_section_key, area_key, title, state, system_outcome, conclusion,
              rule_version_id, authority_provision_id, needs_reevaluation
         FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const byKey = new Map(rows.map((r) => [`${r.sub_section_key}|${r.area_key}`, r]));
    return SECTIONS.map(({ sub, area, title }) => {
      const r = byKey.get(`${sub}|${area}`);
      const state: FrameworkState = (r?.state ?? 'not_assessed') as FrameworkState;
      return {
        subSectionKey: sub,
        areaKey: area,
        title,
        state,
        systemOutcome: r?.system_outcome ?? null,
        conclusion: r?.conclusion ?? null,
        ruleVersionId: r?.rule_version_id ?? null,
        authorityProvisionId: r?.authority_provision_id ?? null,
        needsReevaluation: r?.needs_reevaluation ?? false,
        decided: r != null && DECIDED.has(state),
      };
    });
  }

  private async profileConfirmed(client: PoolClient, workflowInstanceId: string): Promise<boolean> {
    const { rows } = await client.query<{ state: string }>(
      `SELECT state FROM hsdg.audit_entity_profile WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return rows[0]?.state === 'confirmed';
  }

  private async triggeredSAs(
    client: PoolClient,
    workflowInstanceId: string,
    sections: FrameworkSummarySection[],
  ): Promise<FrameworkTriggeredSa[]> {
    const out: FrameworkTriggeredSa[] = [];
    const { rows } = await client.query<{
      sa510_flag: boolean;
      sa402_flag: boolean;
      sa299_flag: boolean;
    }>(
      `SELECT sa510_flag, sa402_flag, sa299_flag FROM hsdg.audit_entity_profile
        WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    const p = rows[0];
    if (p?.sa510_flag)
      out.push({ code: 'SA 510', source: '02.1 profile', basis: 'Initial (first-year) audit.' });
    if (p?.sa402_flag)
      out.push({
        code: 'SA 402',
        source: '02.1 profile',
        basis: 'A service organisation is in the accounting environment.',
      });
    if (p?.sa299_flag) out.push({ code: 'SA 299', source: '02.1 profile', basis: 'Joint audit.' });

    // SA 600 / CFS come from the 02.6 consolidation detail.
    const cfs = sections.find((s) => s.subSectionKey === SUB_SECTION_KEY.consolidation);
    if (cfs) {
      const { rows: cfsRows } = await client.query<{
        system_detail: { usesOtherAuditors?: boolean } | null;
      }>(
        `SELECT system_detail FROM hsdg.audit_framework_subassessment
          WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
        [workflowInstanceId, SUB_SECTION_KEY.consolidation, FRAMEWORK_AREA_KEY.cfs],
      );
      if (cfsRows[0]?.system_detail?.usesOtherAuditors)
        out.push({
          code: 'SA 600',
          source: '02.6 consolidation',
          basis: 'A component is audited by another auditor.',
        });
      if (cfs.systemOutcome === 'cfs_required' || cfs.conclusion === 'cfs_required')
        out.push({
          code: 'CFS',
          source: '02.6 consolidation',
          basis: 'Consolidated financial statements are required.',
        });
    }
    return out;
  }

  private async matters(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<FrameworkSummaryMatter[]> {
    const { rows } = await client.query<{
      category: string;
      severity: string | null;
      title: string;
      source: string;
      is_blocking: boolean;
      status: string;
    }>(
      `SELECT category, severity, title, source, is_blocking, status
         FROM hsdg.audit_matter
        WHERE workflow_instance_id = $1
        ORDER BY created_at ASC`,
      [workflowInstanceId],
    );
    return rows.map((r) => ({
      code: r.category,
      severity: r.severity,
      message: r.title,
      source: r.source,
      blocking: r.is_blocking && r.status !== 'resolved' && r.status !== 'accepted_with_approval',
    }));
  }

  /** Derive the downstream configuration preview from the concluded outcomes. */
  private downstreamPreview(sections: FrameworkSummarySection[]): DownstreamPreviewItem[] {
    const out: DownstreamPreviewItem[] = [];
    const outcomeOf = (sub: SubSectionKey): string | null => {
      const s = sections.find((x) => x.subSectionKey === sub);
      return s?.conclusion ?? s?.systemOutcome ?? null;
    };
    if (outcomeOf(SUB_SECTION_KEY.caro) === 'applicable')
      out.push({
        area: 'Audit Areas',
        action: 'activate',
        description: 'Instantiate the CARO 2020 clause work programme.',
      });
    else if (outcomeOf(SUB_SECTION_KEY.caro) === 'not_applicable_exempt')
      out.push({
        area: 'Audit Areas',
        action: 'deactivate',
        description: 'CARO clause programme not required (exempt).',
      });
    if (outcomeOf(SUB_SECTION_KEY.icfr) === 'applicable')
      out.push({
        area: 'Controls',
        action: 'activate',
        description: 'Configure the ICFR reporting workstream.',
      });
    if (outcomeOf(SUB_SECTION_KEY.consolidation) === 'cfs_required')
      out.push({
        area: 'Consolidation',
        action: 'create',
        description: 'Create the consolidation / group work programme.',
      });
    return out;
  }

  private async currentBaseline(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<FrameworkBaselineRecord | null> {
    const { rows } = await client.query<BaselineRow>(
      `SELECT b.id, b.version, b.status, b.methodology_version, b.memo_document_id, b.reopen_reason,
              mc.full_name AS manager_confirmed_by_name, b.manager_confirmed_at,
              ep.full_name AS ep_approved_by_name, b.ep_approved_at, b.record_version
         FROM hsdg.audit_framework_baseline b
         LEFT JOIN hsdg.employees mc ON mc.id = b.manager_confirmed_by_employee_id
         LEFT JOIN hsdg.employees ep ON ep.id = b.ep_approved_by_employee_id
        WHERE b.workflow_instance_id = $1 AND b.status <> 'superseded'
        ORDER BY b.created_at DESC
        LIMIT 1`,
      [workflowInstanceId],
    );
    return rows[0] ? mapBaseline(rows[0]) : null;
  }

  // ── AF-01 Manager confirmation ────────────────────────────────────────────────

  async confirmManager(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ConfirmFrameworkInput,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.lockBaseline(client, workflowInstanceId);
      const summary = await this.build(client, engagementId, workflowInstanceId, '');
      if (!summary.gates.canConfirm) {
        throw new BadRequestException(this.blockedReason(summary));
      }
      const existing = await this.rawCurrent(client, workflowInstanceId);
      if (existing && existing.status === 'draft') {
        if (existing.record_version !== input.recordVersion) throw staleConflict();
        await client.query(
          `UPDATE hsdg.audit_framework_baseline
              SET status = 'manager_confirmed', manager_confirmed_by_employee_id = $2,
                  manager_confirmed_at = now(), reopen_reason = COALESCE($3, reopen_reason),
                  record_version = record_version + 1
            WHERE id = $1`,
          [existing.id, ctx.employeeId ?? null, input.note?.trim() || null],
        );
      } else if (!existing) {
        await client.query(
          `INSERT INTO hsdg.audit_framework_baseline
             (workflow_instance_id, engagement_id, version, status,
              manager_confirmed_by_employee_id, manager_confirmed_at)
           VALUES ($1, $2, '1.0', 'manager_confirmed', $3, now())`,
          [workflowInstanceId, engagementId, ctx.employeeId ?? null],
        );
      } else {
        throw new ConflictException('The framework baseline is already confirmed or approved.');
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_manager_confirmed',
        objectType: 'audit_framework_baseline',
        objectId: workflowInstanceId,
      });
      return this.build(client, engagementId, workflowInstanceId, summary.engagementServiceId);
    });
  }

  // ── AF-02 Engagement Partner approval — freezes the baseline ───────────────────

  async approve(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ApproveFrameworkInput,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.lockBaseline(client, workflowInstanceId);
      const existing = await this.rawCurrent(client, workflowInstanceId);
      if (!existing || existing.status !== 'manager_confirmed') {
        throw new BadRequestException('AF-02 requires a Manager-confirmed (AF-01) baseline.');
      }
      if (existing.record_version !== input.recordVersion) throw staleConflict();
      const summary = await this.build(client, engagementId, workflowInstanceId, '');
      if (summary.gates.hasBlockingMatter) {
        throw new BadRequestException('A blocking matter prevents framework approval.');
      }
      const ruleVersionIds = summary.sections
        .map((s) => s.ruleVersionId)
        .filter((v): v is string => v != null);
      const methodologyVersion =
        input.methodologyVersion?.trim() || `Audit Framework v${existing.version}`;
      const snapshot = {
        generatedAt: new Date().toISOString(),
        sections: summary.sections,
        triggeredSAs: summary.triggeredSAs,
        downstreamPreview: summary.downstreamPreview,
      };
      await client.query(
        `UPDATE hsdg.audit_framework_baseline
            SET status = 'approved', methodology_version = $2, snapshot = $3::jsonb,
                rule_version_ids = $4::uuid[], ep_approved_by_employee_id = $5,
                ep_approved_at = now(), record_version = record_version + 1
          WHERE id = $1`,
        [
          existing.id,
          methodologyVersion,
          JSON.stringify(snapshot),
          ruleVersionIds,
          ctx.employeeId ?? null,
        ],
      );
      // Set Section 02 approved: freeze each decided sub-assessment as approved.
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET state = 'approved'
          WHERE workflow_instance_id = $1
            AND state IN ('applicable','not_applicable','overridden')`,
        [workflowInstanceId],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_ep_approved',
        objectType: 'audit_framework_baseline',
        objectId: workflowInstanceId,
        after: { version: existing.version, methodologyVersion },
      });
      return this.build(client, engagementId, workflowInstanceId, summary.engagementServiceId);
    });
  }

  // ── Controlled reopen (§13) — preserves v1.0, opens v1.1 ───────────────────────

  async reopen(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ReopenFrameworkInput,
  ): Promise<StatutoryAuditFrameworkSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.lockBaseline(client, workflowInstanceId);
      const reason = input.reason?.trim();
      if (!reason) throw new BadRequestException('A reason is required to reopen the framework.');
      const existing = await this.rawCurrent(client, workflowInstanceId);
      if (!existing || existing.status !== 'approved') {
        throw new BadRequestException('Only an approved framework baseline can be reopened.');
      }
      if (existing.record_version !== input.recordVersion) throw staleConflict();

      await client.query(
        `UPDATE hsdg.audit_framework_baseline SET status = 'superseded', record_version = record_version + 1 WHERE id = $1`,
        [existing.id],
      );
      const nextVersion = bumpMinor(existing.version);
      await client.query(
        `INSERT INTO hsdg.audit_framework_baseline
           (workflow_instance_id, engagement_id, version, status, reopen_reason)
         VALUES ($1, $2, $3, 'draft', $4)`,
        [workflowInstanceId, engagementId, nextVersion, reason],
      );
      // Change-impact: flag every sub-assessment for re-evaluation; an approved
      // one drops back to reassessment_required. Completed downstream work is kept.
      await client.query(
        `UPDATE hsdg.audit_framework_subassessment
            SET needs_reevaluation = true,
                state = CASE WHEN state = 'approved' THEN 'reassessment_required' ELSE state END
          WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_reopened',
        objectType: 'audit_framework_baseline',
        objectId: workflowInstanceId,
        after: { from: existing.version, to: nextVersion, reason },
      });
      const svc = await client.query<{ engagement_service_id: string }>(
        `SELECT engagement_service_id FROM hsdg.service_workflow_instances WHERE id = $1`,
        [workflowInstanceId],
      );
      return this.build(
        client,
        engagementId,
        workflowInstanceId,
        svc.rows[0]?.engagement_service_id ?? '',
      );
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /**
   * AF-01 / AF-02 / reopen read the current baseline, check it, then write: a
   * per-audit-file transaction lock makes that atomic (a double-submit cannot
   * create two v1.0 / v1.1 rows or approve twice). Advisory, so RLS-agnostic.
   */
  private async lockBaseline(client: PoolClient, workflowInstanceId: string): Promise<void> {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('audit_framework_baseline:' || $1))`,
      [workflowInstanceId],
    );
  }

  private async rawCurrent(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<{ id: string; version: string; status: string; record_version: number } | null> {
    const { rows } = await client.query<{
      id: string;
      version: string;
      status: string;
      record_version: number;
    }>(
      `SELECT id, version, status, record_version FROM hsdg.audit_framework_baseline
        WHERE workflow_instance_id = $1 AND status <> 'superseded'
        ORDER BY created_at DESC LIMIT 1`,
      [workflowInstanceId],
    );
    return rows[0] ?? null;
  }

  private async assertShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.service_workflow_instances WHERE id = $1 AND engagement_id = $2`,
      [workflowInstanceId, engagementId],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    }
  }

  private blockedReason(s: StatutoryAuditFrameworkSummary): string {
    if (!s.gates.profileConfirmed) return 'Confirm the 02.1 Entity & Regulatory Profile first.';
    if (!s.gates.allSectionsDecided)
      return 'Every Section 02 sub-assessment must be decided before AF-01.';
    if (s.gates.hasBlockingMatter) return 'A blocking matter prevents AF-01 confirmation.';
    return 'The framework baseline is already approved.';
  }
}

function bumpMinor(version: string): string {
  const [major, minor] = version.split('.').map((n) => Number(n));
  return `${major}.${(minor ?? 0) + 1}`;
}

function staleConflict(): ConflictException {
  return new ConflictException(
    'The framework baseline changed since you loaded it; refresh and retry.',
  );
}

function mapBaseline(r: BaselineRow): FrameworkBaselineRecord {
  return {
    id: r.id,
    version: r.version,
    status: r.status as FrameworkBaselineRecord['status'],
    methodologyVersion: r.methodology_version,
    managerConfirmedByName: r.manager_confirmed_by_name,
    managerConfirmedAt: r.manager_confirmed_at ? r.manager_confirmed_at.toISOString() : null,
    epApprovedByName: r.ep_approved_by_name,
    epApprovedAt: r.ep_approved_at ? r.ep_approved_at.toISOString() : null,
    memoDocumentId: r.memo_document_id,
    reopenReason: r.reopen_reason,
    recordVersion: r.record_version,
  };
}
