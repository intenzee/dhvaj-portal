import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  FRAMEWORK_DECIDED_STATES,
  auditPeriodStartFromFinancialYear,
  type FrameworkAreaKey,
  type FrameworkAssessment,
  type FrameworkConclusion,
  type FrameworkEvidence,
  type FrameworkState,
  type StatutoryAuditFramework,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditRulesService } from '../catalogue/audit-rules.service';
import { AuditMattersService } from './audit-matters.service';
import { suggestArea, type FrameworkFacts } from './framework-suggestions';

interface AssessmentRow {
  id: string;
  workflow_instance_id: string;
  area_key: string;
  title: string;
  kind: 'applicability' | 'descriptive';
  state: FrameworkState;
  system_suggestion: FrameworkConclusion | null;
  system_basis: string | null;
  conclusion: FrameworkConclusion | null;
  is_overridden: boolean;
  basis: string | null;
  impact: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  sort_order: number;
  version: number;
}

interface EvidenceRow {
  id: string;
  assessment_id: string;
  document_id: string | null;
  note: string | null;
  created_by_name: string | null;
  created_at: Date;
}

interface ApprovalRow {
  id: string;
  workflow_instance_id: string;
  version: number;
  memo: string | null;
  approved_by_name: string | null;
  approved_at: Date;
}

/**
 * Statutory Audit — Framework (Phase 02) service (Audit Spec §18–§20).
 *
 * The Framework determines WHAT applies. For each area the rule engine may offer
 * an advisory suggestion from entity facts (§19), but the professional records
 * the conclusion (with a basis, and — when it differs from the suggestion — an
 * explicit override). Approving the Framework Memo freezes the conclusions in a
 * versioned snapshot and marks Phase 02 complete.
 */
@Injectable()
export class AuditFrameworkService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly rules: AuditRulesService,
    private readonly matters: AuditMattersService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  /** The framework(s) for an engagement's statutory-audit shell(s). RLS-scoped. */
  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditFramework[]> {
    return this.db.withRlsContext(ctx, (client) => this.readFrameworks(client, engagementId));
  }

  private async readFrameworks(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditFramework[]> {
    const { rows: shells } = await client.query<{
      id: string;
      engagement_service_id: string;
      engagement_id: string;
    }>(
      `SELECT id, engagement_service_id, engagement_id
         FROM hsdg.service_workflow_instances
        WHERE engagement_id = $1
        ORDER BY created_at ASC`,
      [engagementId],
    );
    if (shells.length === 0) return [];

    const shellIds = shells.map((s) => s.id);
    const { rows: assessments } = await client.query<AssessmentRow>(
      `SELECT a.id, a.workflow_instance_id, a.area_key, a.title, a.kind, a.state,
              a.system_suggestion, a.system_basis, a.conclusion, a.is_overridden,
              a.basis, a.impact, emp.full_name AS decided_by_name, a.decided_at,
              a.sort_order, a.version
         FROM hsdg.audit_framework_assessments a
         LEFT JOIN hsdg.employees emp ON emp.id = a.decided_by_employee_id
        WHERE a.workflow_instance_id = ANY($1::uuid[])
        ORDER BY a.sort_order ASC`,
      [shellIds],
    );
    const assessmentIds = assessments.map((a) => a.id);
    const { rows: evidence } = assessmentIds.length
      ? await client.query<EvidenceRow>(
          `SELECT ev.id, ev.assessment_id, ev.document_id, ev.note,
                  emp.full_name AS created_by_name, ev.created_at
             FROM hsdg.audit_framework_evidence ev
             LEFT JOIN hsdg.employees emp ON emp.id = ev.created_by_employee_id
            WHERE ev.assessment_id = ANY($1::uuid[])
            ORDER BY ev.created_at ASC`,
          [assessmentIds],
        )
      : { rows: [] as EvidenceRow[] };
    const { rows: approvals } = await client.query<ApprovalRow>(
      `SELECT ap.id, ap.workflow_instance_id, ap.version, ap.memo,
              emp.full_name AS approved_by_name, ap.approved_at
         FROM hsdg.audit_framework_approvals ap
         LEFT JOIN hsdg.employees emp ON emp.id = ap.approved_by_employee_id
        WHERE ap.workflow_instance_id = ANY($1::uuid[])
        ORDER BY ap.version DESC`,
      [shellIds],
    );

    return shells.map((shell) => {
      const shellAssessments = assessments.filter((a) => a.workflow_instance_id === shell.id);
      const latestApproval = approvals.find((ap) => ap.workflow_instance_id === shell.id) ?? null;
      const undecidedCount = shellAssessments.filter(
        (a) => !FRAMEWORK_DECIDED_STATES.includes(a.state),
      ).length;
      return {
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        assessments: shellAssessments.map((a) => mapAssessment(a, evidence)),
        approval: latestApproval
          ? {
              id: latestApproval.id,
              version: latestApproval.version,
              memo: latestApproval.memo,
              approvedByName: latestApproval.approved_by_name,
              approvedAt: latestApproval.approved_at.toISOString(),
            }
          : null,
        undecidedCount,
      };
    });
  }

  // ── Suggestion engine (§19) ────────────────────────────────────────────────

  /**
   * Run the advisory rule engine over the entity's facts and update every area
   * that the professional has NOT already decided. Never touches a decided or
   * approved area. Lead-only (engagement.manage).
   */
  async runSuggestions(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditFramework> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertFrameworkUnlocked(client, workflowInstanceId);
      const facts = await loadFacts(client, engagementId);

      // Resolve every statutory threshold from the Rules Library by the
      // engagement's audit period (guide §4) — no number is hard-coded.
      const fyRes = await client.query<{ financial_year: string }>(
        `SELECT financial_year FROM hsdg.engagements WHERE id = $1`,
        [engagementId],
      );
      const auditPeriodStart = fyRes.rows[0]
        ? auditPeriodStartFromFinancialYear(fyRes.rows[0].financial_year)
        : new Date().toISOString().slice(0, 10);
      const resolve = await this.rules.buildResolverOn(client, auditPeriodStart);

      const { rows } = await client.query<{ id: string; area_key: string; state: FrameworkState }>(
        `SELECT id, area_key, state
           FROM hsdg.audit_framework_assessments
          WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      let updated = 0;
      for (const row of rows) {
        // Never overwrite a professional conclusion (§19).
        if (FRAMEWORK_DECIDED_STATES.includes(row.state)) continue;
        const s = suggestArea(row.area_key as FrameworkAreaKey, facts, resolve);
        if (!s.suggestion && s.state === 'not_assessed') continue; // descriptive — leave alone
        await client.query(
          `UPDATE hsdg.audit_framework_assessments
              SET system_suggestion = $2, system_basis = $3, state = $4
            WHERE id = $1`,
          [row.id, s.suggestion, s.basis || null, s.state],
        );
        updated += 1;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_suggestions_run',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { updated },
      });
      // Generate/reconcile Framework Matters from the new states (§10).
      await this.matters.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
      const [framework] = await this.readFrameworks(client, engagementId);
      return framework!;
    });
  }

  // ── Professional decision (§19) ─────────────────────────────────────────────

  async recordDecision(
    ctx: RlsContext,
    engagementId: string,
    assessmentId: string,
    input: {
      conclusion: FrameworkConclusion;
      basis?: string | null;
      impact?: string | null;
      version: number;
    },
  ): Promise<StatutoryAuditFramework> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        state: FrameworkState;
        system_suggestion: FrameworkConclusion | null;
        workflow_instance_id: string;
      }>(
        `SELECT id, state, system_suggestion, workflow_instance_id
           FROM hsdg.audit_framework_assessments
          WHERE id = $1 AND engagement_id = $2`,
        [assessmentId, engagementId],
      );
      const current = rows[0];
      if (!current) throw new NotFoundException('Assessment not found.');
      await this.assertFrameworkUnlocked(client, current.workflow_instance_id);
      if (current.state === 'approved') {
        throw new ConflictException(
          'The framework is approved; reopen it before changing a conclusion.',
        );
      }

      const isOverridden =
        current.system_suggestion != null && input.conclusion !== current.system_suggestion;
      const basis = input.basis?.trim() || null;
      if (isOverridden && !basis) {
        throw new BadRequestException(
          'A basis is required when the conclusion overrides the system suggestion.',
        );
      }
      const state: FrameworkState = isOverridden ? 'overridden' : input.conclusion;

      const result = await client.query(
        `UPDATE hsdg.audit_framework_assessments
            SET conclusion = $3, is_overridden = $4, basis = $5, impact = $6,
                state = $7, decided_by_employee_id = $8, decided_at = now(),
                version = version + 1
          WHERE id = $1 AND version = $2`,
        [
          assessmentId,
          input.version,
          input.conclusion,
          isOverridden,
          basis,
          input.impact?.trim() || null,
          state,
          ctx.employeeId ?? null,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException(
          'This assessment changed since you loaded it; refresh and retry.',
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_decision',
        objectType: 'audit_framework_assessment',
        objectId: assessmentId,
        after: { conclusion: input.conclusion, isOverridden },
      });
      // Reconcile Framework Matters: a decision may clear a pending matter or
      // raise an override matter (§10).
      await this.matters.syncFrameworkOn(client, ctx, engagementId, current.workflow_instance_id);
      const [framework] = await this.readFrameworks(client, engagementId);
      return framework!;
    });
  }

  // ── Evidence (§18, §16 — link, never duplicate) ─────────────────────────────

  async addEvidence(
    ctx: RlsContext,
    engagementId: string,
    assessmentId: string,
    input: { documentId?: string | null; note?: string | null },
  ): Promise<StatutoryAuditFramework> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.audit_framework_assessments WHERE id = $1 AND engagement_id = $2`,
        [assessmentId, engagementId],
      );
      if (!rows[0]) throw new NotFoundException('Assessment not found.');
      const note = input.note?.trim() || null;
      if (!input.documentId && !note) {
        throw new BadRequestException('Evidence needs a linked document or a note.');
      }
      // A linked document must belong to THIS engagement (§16 — link within the
      // engagement's own document set, never a cross-engagement reference). RLS on
      // the evidence row only checks the evidence's engagement, not the target's.
      if (input.documentId) {
        const { rows: docRows } = await client.query(
          `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2`,
          [input.documentId, engagementId],
        );
        if (!docRows[0]) {
          throw new BadRequestException('The linked document does not belong to this engagement.');
        }
      }
      await client.query(
        `INSERT INTO hsdg.audit_framework_evidence
           (assessment_id, engagement_id, document_id, note, created_by_employee_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [assessmentId, engagementId, input.documentId ?? null, note, ctx.employeeId ?? null],
      );
      const [framework] = await this.readFrameworks(client, engagementId);
      return framework!;
    });
  }

  async removeEvidence(
    ctx: RlsContext,
    engagementId: string,
    evidenceId: string,
  ): Promise<StatutoryAuditFramework> {
    return this.db.withRlsContext(ctx, async (client) => {
      const result = await client.query(
        `DELETE FROM hsdg.audit_framework_evidence WHERE id = $1 AND engagement_id = $2`,
        [evidenceId, engagementId],
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Evidence not found.');
      const [framework] = await this.readFrameworks(client, engagementId);
      return framework!;
    });
  }

  // ── Framework Memo approval (§18, §30) ──────────────────────────────────────

  /**
   * Approve the Framework Memo: every area must carry a conclusion. Freezes the
   * conclusions in a versioned snapshot, marks all areas approved, and completes
   * Phase 02. Blocked if the framework is already approved (until a reassessment
   * reopens an area) — history is never rewritten.
   */
  async approveFramework(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { memo?: string | null },
  ): Promise<StatutoryAuditFramework> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.assertFrameworkUnlocked(client, workflowInstanceId);

      const { rows: areas } = await client.query<{
        area_key: string;
        state: FrameworkState;
        conclusion: FrameworkConclusion | null;
        is_overridden: boolean;
      }>(
        `SELECT area_key, state, conclusion, is_overridden
           FROM hsdg.audit_framework_assessments
          WHERE workflow_instance_id = $1
          ORDER BY sort_order ASC`,
        [workflowInstanceId],
      );
      if (areas.length === 0) throw new NotFoundException('Framework not initialised.');

      const undecided = areas.filter((a) => !FRAMEWORK_DECIDED_STATES.includes(a.state));
      if (undecided.length > 0) {
        throw new BadRequestException(
          `${undecided.length} framework area(s) still need a professional conclusion before approval.`,
        );
      }
      const reopened = areas.some((a) => a.state === 'reassessment_required');
      const alreadyApproved = areas.every((a) => a.state === 'approved');
      if (alreadyApproved && !reopened) {
        throw new ConflictException('The framework is already approved.');
      }

      // §10 — reconcile matters, then block approval on any open blocking matter.
      await this.matters.syncFrameworkOn(client, ctx, engagementId, workflowInstanceId);
      await this.matters.assertNoOpenBlockingMatters(client, workflowInstanceId, 'framework');

      const { rows: verRows } = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next
           FROM hsdg.audit_framework_approvals WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      const version = verRows[0]!.next;
      const snapshot = areas.map((a) => ({
        areaKey: a.area_key,
        conclusion: a.conclusion,
        isOverridden: a.is_overridden,
      }));

      try {
        await client.query(
          `INSERT INTO hsdg.audit_framework_approvals
             (workflow_instance_id, engagement_id, version, memo, snapshot, approved_by_employee_id)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [
            workflowInstanceId,
            engagementId,
            version,
            input.memo?.trim() || null,
            JSON.stringify(snapshot),
            ctx.employeeId ?? null,
          ],
        );
      } catch (err) {
        // Concurrent approval computed the same version (UNIQUE violation, 23505).
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException(
            'The framework was approved concurrently; refresh and retry.',
          );
        }
        throw err;
      }
      // Freeze conclusions.
      await client.query(
        `UPDATE hsdg.audit_framework_assessments
            SET state = 'approved'
          WHERE workflow_instance_id = $1 AND state <> 'approved'`,
        [workflowInstanceId],
      );
      // Mark Phase 02 complete (the SA-1 phase skeleton). Planning is already
      // available; risk/work stay locked until Planning approval (SA-4).
      await client.query(
        `UPDATE hsdg.audit_workflow_phases
            SET state = 'complete'
          WHERE workflow_instance_id = $1 AND phase_key = 'framework'`,
        [workflowInstanceId],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.framework_approved',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { version, areas: snapshot.length },
      });

      const [framework] = await this.readFrameworks(client, engagementId);
      return framework!;
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async assertShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.service_workflow_instances WHERE id = $1 AND engagement_id = $2`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0])
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
  }

  /**
   * §8.5 gate — the Framework is unavailable until Section 01 (Acceptance) is
   * approved (which sets this phase `in_progress`). Shells provisioned before
   * Section 01 existed are never `locked`, so the gate is backward-compatible.
   */
  private async assertFrameworkUnlocked(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query<{ state: string }>(
      `SELECT state FROM hsdg.audit_workflow_phases
        WHERE workflow_instance_id = $1 AND phase_key = 'framework'`,
      [workflowInstanceId],
    );
    if (rows[0]?.state === 'locked') {
      throw new ConflictException(
        'Section 01 (Acceptance) must be approved before the Framework is available.',
      );
    }
  }
}

function mapAssessment(a: AssessmentRow, evidence: EvidenceRow[]): FrameworkAssessment {
  return {
    id: a.id,
    areaKey: a.area_key,
    title: a.title,
    kind: a.kind,
    state: a.state,
    systemSuggestion: a.system_suggestion,
    systemBasis: a.system_basis,
    conclusion: a.conclusion,
    isOverridden: a.is_overridden,
    basis: a.basis,
    impact: a.impact,
    decidedByName: a.decided_by_name,
    decidedAt: a.decided_at ? a.decided_at.toISOString() : null,
    sortOrder: a.sort_order,
    version: a.version,
    evidence: evidence
      .filter((e) => e.assessment_id === a.id)
      .map((e): FrameworkEvidence => ({
        id: e.id,
        documentId: e.document_id,
        note: e.note,
        createdByName: e.created_by_name,
        createdAt: e.created_at.toISOString(),
      })),
  };
}

/** Load the entity facts the suggestion engine reads (best-effort; unknowns null). */
async function loadFacts(client: PoolClient, engagementId: string): Promise<FrameworkFacts> {
  const facts: FrameworkFacts = {
    isCompany: null,
    isPrivateCompany: null,
    isListed: null,
    hasSubsidiariesOrAssociates: null,
    isGovernmentCompany: null,
    acceptsPublicDeposits: null,
    regulatedSector: null,
    netWorth: null,
    turnover: null,
    netProfit: null,
    paidUpCapital: null,
    totalBorrowings: null,
    publicDeposits: null,
  };

  const type = await client.query<{ slug: string; category: string }>(
    `SELECT et.slug, et.category
       FROM hsdg.engagements e
       JOIN hsdg.entities ent ON ent.id = e.entity_id
       JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
      WHERE e.id = $1`,
    [engagementId],
  );
  if (type.rows[0]) {
    facts.isCompany = type.rows[0].category === 'company';
    facts.isPrivateCompany = ['private_limited', 'opc'].includes(type.rows[0].slug);
  }

  const fin = await client.query<{
    net_worth: string | null;
    turnover: string | null;
    net_profit: string | null;
    paid_up_capital: string | null;
    total_borrowings: string | null;
    public_deposits: string | null;
  }>(
    `SELECT fp.net_worth, fp.turnover, fp.net_profit, fp.paid_up_capital,
            fp.total_borrowings, fp.public_deposits
       FROM hsdg.entity_financial_profiles fp
       JOIN hsdg.engagements e ON e.entity_id = fp.entity_id
      WHERE e.id = $1 AND fp.is_current
      LIMIT 1`,
    [engagementId],
  );
  if (fin.rows[0]) {
    const r = fin.rows[0];
    facts.netWorth = num(r.net_worth);
    facts.turnover = num(r.turnover);
    facts.netProfit = num(r.net_profit);
    facts.paidUpCapital = num(r.paid_up_capital);
    facts.totalBorrowings = num(r.total_borrowings);
    facts.publicDeposits = num(r.public_deposits);
  }

  const listed = await client.query(
    `SELECT 1 FROM hsdg.entity_listings l
       JOIN hsdg.engagements e ON e.entity_id = l.entity_id
      WHERE e.id = $1 AND l.status = 'listed' LIMIT 1`,
    [engagementId],
  );
  facts.isListed = (listed.rowCount ?? 0) > 0;

  const subs = await client.query(
    `SELECT 1 FROM hsdg.entity_relationships r
       JOIN hsdg.engagements e ON e.entity_id = r.from_entity_id
      WHERE e.id = $1 AND r.status = 'active'
        AND r.relationship_type IN
            ('subsidiary','wholly_owned_subsidiary','associate','joint_venture','step_down_subsidiary','fellow_subsidiary')
      LIMIT 1`,
    [engagementId],
  );
  facts.hasSubsidiariesOrAssociates = (subs.rowCount ?? 0) > 0;

  const attrs = await client.query<{
    attribute_code: string;
    value_boolean: boolean | null;
    value_text: string | null;
  }>(
    `SELECT a.attribute_code, a.value_boolean, a.value_text
       FROM hsdg.entity_regulatory_attributes a
       JOIN hsdg.engagements e ON e.entity_id = a.entity_id
      WHERE e.id = $1
        AND a.attribute_code IN
            ('is_government_company','is_public_interest_entity','accepts_public_deposits','regulated_sector')`,
    [engagementId],
  );
  for (const a of attrs.rows) {
    if (a.attribute_code === 'is_government_company') facts.isGovernmentCompany = a.value_boolean;
    if (a.attribute_code === 'accepts_public_deposits')
      facts.acceptsPublicDeposits = a.value_boolean;
    if (a.attribute_code === 'regulated_sector') {
      facts.regulatedSector =
        a.value_boolean ?? (a.value_text ? a.value_text.trim().length > 0 : null);
    }
  }
  return facts;
}

function num(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
