import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  isApprovingConclusion,
  partnerConclusionError,
  recommendationNeedsComment,
  section01CompletionChecks,
  type AcceptanceConclusion,
  type AcceptanceDecisionRecord,
  type AcceptanceFileStatus,
  type AcceptanceRecommendation,
  type AcceptanceRecommendationRecord,
  type AcceptanceSignoffView,
  type DecideAcceptanceInput,
  type ReopenAcceptanceInput,
  type SubmitAcceptanceRecommendationInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditAcceptanceService } from './audit-acceptance.service';
import { AuditAcceptanceFilesService } from './audit-acceptance-files.service';
import { acceptanceMemoFor } from './section-packs';
import { deriveSignoff, type SignoffDerived } from './acceptance-signoff';

interface Gathered {
  derived: SignoffDerived;
  recommendation: AcceptanceRecommendationRecord | null;
  decisions: AcceptanceDecisionRecord[];
  draftMemo: string;
  isEngagementPartner: boolean;
  isLead: boolean;
  hasEngagementPartner: boolean;
}

/**
 * Section 01.8 — Final Acceptance & Partner Approval (spec §12, §14).
 *
 * The Manager submits a recommendation (FINAL-01); the Engagement Partner —
 * and only the EP — concludes (FINAL-02) from the readiness summary without
 * repeating the questionnaire. An approving conclusion records partner +
 * time + conclusion, completes Section 01, locks its records and documents and
 * unlocks Section 02. Return sends the file back; Decline keeps Section 02
 * locked. A later material change needs a controlled Reopen with a reason,
 * which supersedes (never edits or deletes) the approval and flags Section 02
 * for reassessment.
 */
@Injectable()
export class AuditAcceptanceSignoffService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly acceptance: AuditAcceptanceService,
    private readonly files: AuditAcceptanceFilesService,
  ) {}

  async view(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<AcceptanceSignoffView> {
    return this.db.withRlsContext(ctx, async (client) =>
      toView(workflowInstanceId, await this.gather(client, ctx, engagementId, workflowInstanceId)),
    );
  }

  // ── FINAL-01 — Manager recommendation ───────────────────────────────────

  async recommend(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: SubmitAcceptanceRecommendationInput,
  ): Promise<AcceptanceSignoffView> {
    return this.db.withRlsContext(ctx, async (client) => {
      const g = await this.gather(client, ctx, engagementId, workflowInstanceId);
      if (!g.isLead) {
        throw new ForbiddenException('Only the engagement team leads can submit to the partner.');
      }
      if (g.derived.liveApproval) {
        throw new ConflictException('Section 01 is already approved; it must be reopened first.');
      }
      if (g.recommendation?.status === 'submitted') {
        throw new ConflictException('A recommendation is already with the Engagement Partner.');
      }
      const comments = input.comments?.trim() || null;
      if (recommendationNeedsComment(input.recommendation) && !comments) {
        throw new BadRequestException(
          'Comments are required when recommending safeguards, partner review or declining.',
        );
      }
      if (
        (input.recommendation === 'accept' || input.recommendation === 'continue') &&
        g.derived.blockers.length > 0
      ) {
        throw new BadRequestException(
          `Engagement cannot yet be accepted. ${g.derived.blockers.length} matter${g.derived.blockers.length === 1 ? '' : 's'} require attention: ${g.derived.blockers.join(' ')}`,
        );
      }
      const { rows } = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(cycle), 0) + 1 AS next
           FROM hsdg.audit_acceptance_recommendations WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      try {
        await client.query(
          `INSERT INTO hsdg.audit_acceptance_recommendations
             (workflow_instance_id, engagement_id, cycle, recommendation, comments,
              submitted_by_employee_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            workflowInstanceId,
            engagementId,
            rows[0]!.next,
            input.recommendation,
            comments,
            ctx.employeeId ?? null,
          ],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException('A recommendation was submitted at the same time; refresh.');
        }
        throw err;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.acceptance_recommendation_submitted',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { cycle: rows[0]!.next, recommendation: input.recommendation },
      });
      return toView(
        workflowInstanceId,
        await this.gather(client, ctx, engagementId, workflowInstanceId),
      );
    });
  }

  // ── FINAL-02 — Engagement Partner conclusion ────────────────────────────

  async decide(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: DecideAcceptanceInput,
  ): Promise<AcceptanceSignoffView> {
    return this.db.withRlsContext(ctx, async (client) => {
      // Matters raised by the answers must be current before the gate reads them.
      await this.acceptance.reconcileMatters(client, ctx, engagementId, workflowInstanceId);
      const g = await this.gather(client, ctx, engagementId, workflowInstanceId);
      this.assertPartner(g);
      if (g.derived.liveApproval) {
        throw new ConflictException('Section 01 is already approved.');
      }
      if (g.recommendation?.status !== 'submitted') {
        throw new BadRequestException(
          'The Manager has not submitted a recommendation yet (FINAL-01 — Submit to Engagement Partner).',
        );
      }
      const ruleError = partnerConclusionError(input);
      if (ruleError) throw new BadRequestException(ruleError);
      const approving = isApprovingConclusion(input.conclusion);
      if (approving && g.derived.blockers.length > 0) {
        throw new BadRequestException(
          `Engagement cannot yet be accepted. ${g.derived.blockers.length} matter${g.derived.blockers.length === 1 ? '' : 's'} require attention: ${g.derived.blockers.join(' ')}`,
        );
      }

      const memo =
        input.memo?.trim() ||
        (approving || input.conclusion === 'decline'
          ? acceptanceMemoFor(g.draftMemo, input.conclusion)
          : null);
      const { rows: verRows } = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next
           FROM hsdg.audit_acceptance_approvals WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      const version = verRows[0]!.next;
      const { rows: answerSnap } = await client.query(
        `SELECT s.segment_key, a.question_key, a.answer
           FROM hsdg.audit_acceptance_answers a
           JOIN hsdg.audit_acceptance_segments s ON s.id = a.segment_id
          WHERE s.workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      const fileSnap = await this.files.slotStatusesOn(client, workflowInstanceId);
      try {
        await client.query(
          `INSERT INTO hsdg.audit_acceptance_approvals
             (workflow_instance_id, engagement_id, version, conclusion, memo, reason, safeguards,
              recommendation_id, snapshot, approved_by_employee_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
          [
            workflowInstanceId,
            engagementId,
            version,
            input.conclusion,
            memo,
            input.reason?.trim() || null,
            input.safeguards?.trim() || null,
            g.recommendation.id,
            JSON.stringify({ answers: answerSnap, files: fileSnap }),
            ctx.employeeId ?? null,
          ],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException(
            'A decision was recorded at the same time; refresh and retry.',
          );
        }
        throw err;
      }
      await client.query(
        `UPDATE hsdg.audit_acceptance_recommendations
            SET status = $2, closed_at = now(), version = version + 1
          WHERE id = $1`,
        [g.recommendation.id, input.conclusion === 'return' ? 'returned' : 'decided'],
      );

      if (approving) {
        await client.query(
          `UPDATE hsdg.audit_acceptance_segments
              SET state = 'complete', decided_at = now(), decided_by_employee_id = $2,
                  version = version + 1
            WHERE workflow_instance_id = $1 AND segment_key = 'final_acceptance'`,
          [workflowInstanceId, ctx.employeeId ?? null],
        );
        await client.query(
          `UPDATE hsdg.audit_workflow_phases SET state = 'complete'
            WHERE workflow_instance_id = $1 AND phase_key = 'acceptance'`,
          [workflowInstanceId],
        );
        // §12.2: approval unlocks Section 02 — Audit Framework.
        await client.query(
          `UPDATE hsdg.audit_workflow_phases SET state = 'in_progress'
            WHERE workflow_instance_id = $1 AND phase_key = 'framework'
              AND state IN ('locked', 'not_started')`,
          [workflowInstanceId],
        );
        await this.files.setSectionLockOn(client, workflowInstanceId, true);
      } else if (input.conclusion === 'decline') {
        await client.query(
          `UPDATE hsdg.audit_workflow_phases SET state = 'needs_attention'
            WHERE workflow_instance_id = $1 AND phase_key = 'acceptance'`,
          [workflowInstanceId],
        );
      }

      await this.audit.recordWith(client, ctx, {
        action: approving
          ? 'statutory_audit.acceptance_approved'
          : input.conclusion === 'return'
            ? 'statutory_audit.acceptance_returned'
            : 'statutory_audit.acceptance_declined',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: {
          version,
          conclusion: input.conclusion,
          reason: input.reason ?? null,
          safeguards: input.safeguards ?? null,
          recommendation: g.recommendation.recommendation,
        },
      });
      return toView(
        workflowInstanceId,
        await this.gather(client, ctx, engagementId, workflowInstanceId),
      );
    });
  }

  // ── Controlled reopen ───────────────────────────────────────────────────

  async reopen(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ReopenAcceptanceInput,
  ): Promise<AcceptanceSignoffView> {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException('Give the reason for reopening Section 01.');
    return this.db.withRlsContext(ctx, async (client) => {
      const g = await this.gather(client, ctx, engagementId, workflowInstanceId);
      this.assertPartner(g);
      const live = g.derived.liveApproval;
      if (!live)
        throw new ConflictException('Section 01 is not approved; there is nothing to reopen.');

      await client.query(
        `UPDATE hsdg.audit_acceptance_approvals
            SET reopened_at = now(), reopened_by_employee_id = $2, reopen_reason = $3
          WHERE id = $1 AND reopened_at IS NULL`,
        [live.id, ctx.employeeId ?? null, reason],
      );
      await client.query(
        `UPDATE hsdg.audit_acceptance_recommendations
            SET status = 'superseded', version = version + 1
          WHERE workflow_instance_id = $1 AND status = 'decided'`,
        [workflowInstanceId],
      );
      await client.query(
        `UPDATE hsdg.audit_acceptance_segments
            SET state = 'not_started', decided_at = NULL, decided_by_employee_id = NULL,
                version = version + 1
          WHERE workflow_instance_id = $1 AND segment_key = 'final_acceptance'`,
        [workflowInstanceId],
      );
      await client.query(
        `UPDATE hsdg.audit_workflow_phases SET state = 'in_progress'
          WHERE workflow_instance_id = $1 AND phase_key = 'acceptance'`,
        [workflowInstanceId],
      );
      // Section 02 was built on the acceptance being reopened — reassess it.
      const { rowCount: flagged } = await client.query(
        `UPDATE hsdg.audit_workflow_phases SET state = 'needs_attention'
          WHERE workflow_instance_id = $1 AND phase_key = 'framework'
            AND state IN ('in_progress', 'complete')`,
        [workflowInstanceId],
      );
      await this.files.setSectionLockOn(client, workflowInstanceId, false);
      // Re-derive 01.1–01.7 now that they are no longer frozen.
      await this.acceptance.refreshSegmentStates(client, engagementId, workflowInstanceId);

      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.acceptance_reopened',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        before: { approvalVersion: live.version, conclusion: live.conclusion },
        after: { reason, frameworkFlaggedForReassessment: (flagged ?? 0) > 0 },
      });
      return toView(
        workflowInstanceId,
        await this.gather(client, ctx, engagementId, workflowInstanceId),
      );
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private assertPartner(g: Gathered): void {
    if (!g.hasEngagementPartner) {
      throw new BadRequestException('Assign an Engagement Partner to the engagement first.');
    }
    if (!g.isEngagementPartner) {
      throw new ForbiddenException(
        'Only the Engagement Partner can conclude or reopen Section 01.',
      );
    }
  }

  private async gather(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<Gathered> {
    const [acc] = await this.acceptance.readForShell(client, engagementId, workflowInstanceId);
    if (!acc) throw new NotFoundException('Statutory-audit workflow not found on this engagement.');

    const { rows: people } = await client.query<{
      partner_id: string | null;
      partner_name: string | null;
      manager_name: string | null;
      is_lead: boolean;
    }>(
      `SELECT e.engagement_partner_id AS partner_id, ep.full_name AS partner_name,
              em.full_name AS manager_name, hsdg.is_engagement_lead(e.id) AS is_lead
         FROM hsdg.engagements e
         LEFT JOIN hsdg.employees ep ON ep.id = e.engagement_partner_id
         LEFT JOIN hsdg.employees em ON em.id = e.engagement_manager_id
        WHERE e.id = $1`,
      [engagementId],
    );
    const p = people[0];

    const { rows: matters } = await client.query<{
      id: string;
      seq: number;
      title: string;
      source: string;
      severity: string | null;
      is_blocking: boolean;
    }>(
      `SELECT id, seq, title, source, severity, is_blocking
         FROM hsdg.audit_matter
        WHERE workflow_instance_id = $1 AND section = 'acceptance'
          AND status IN ('open','under_review','blocking')
        ORDER BY is_blocking DESC, seq ASC`,
      [workflowInstanceId],
    );

    const slots = await this.files.slotStatusesOn(client, workflowInstanceId);
    const letter = slots.find((s) => s.slotKey === 'engagement_letter');

    const { rows: recs } = await client.query<{
      id: string;
      cycle: number;
      recommendation: AcceptanceRecommendation;
      comments: string | null;
      status: AcceptanceRecommendationRecord['status'];
      submitted_by_name: string | null;
      submitted_at: Date;
    }>(
      `SELECT r.id, r.cycle, r.recommendation, r.comments, r.status,
              emp.full_name AS submitted_by_name, r.submitted_at
         FROM hsdg.audit_acceptance_recommendations r
         LEFT JOIN hsdg.employees emp ON emp.id = r.submitted_by_employee_id
        WHERE r.workflow_instance_id = $1
        ORDER BY r.cycle DESC LIMIT 1`,
      [workflowInstanceId],
    );
    const rec = recs[0];
    const recommendation: AcceptanceRecommendationRecord | null = rec
      ? {
          id: rec.id,
          cycle: rec.cycle,
          recommendation: rec.recommendation,
          comments: rec.comments,
          status: rec.status,
          submittedByName: rec.submitted_by_name,
          submittedAt: rec.submitted_at.toISOString(),
        }
      : null;

    const { rows: dec } = await client.query<{
      id: string;
      version: number;
      conclusion: AcceptanceConclusion;
      reason: string | null;
      safeguards: string | null;
      memo: string | null;
      decided_by_name: string | null;
      approved_at: Date;
      reopened_at: Date | null;
      reopened_by_name: string | null;
      reopen_reason: string | null;
    }>(
      `SELECT a.id, a.version, a.conclusion, a.reason, a.safeguards, a.memo,
              d.full_name AS decided_by_name, a.approved_at,
              a.reopened_at, r.full_name AS reopened_by_name, a.reopen_reason
         FROM hsdg.audit_acceptance_approvals a
         LEFT JOIN hsdg.employees d ON d.id = a.approved_by_employee_id
         LEFT JOIN hsdg.employees r ON r.id = a.reopened_by_employee_id
        WHERE a.workflow_instance_id = $1
        ORDER BY a.version DESC`,
      [workflowInstanceId],
    );
    const decisions: AcceptanceDecisionRecord[] = dec.map((d) => ({
      id: d.id,
      version: d.version,
      conclusion: d.conclusion,
      reason: d.reason,
      safeguards: d.safeguards,
      memo: d.memo,
      decidedByName: d.decided_by_name,
      decidedAt: d.approved_at.toISOString(),
      reopenedAt: d.reopened_at ? d.reopened_at.toISOString() : null,
      reopenedByName: d.reopened_by_name,
      reopenReason: d.reopen_reason,
    }));

    const derived = deriveSignoff({
      segments: acc.segments.map((s) => ({
        segmentKey: s.segmentKey,
        title: s.title,
        state: s.state,
        hasAnswers: s.answers.some((a) => a.answer !== null),
      })),
      openMatters: matters.map((m) => ({
        id: m.id,
        seq: m.seq,
        title: m.title,
        source: m.source,
        severity: m.severity,
        isBlocking: m.is_blocking,
      })),
      engagementLetterStatus: (letter?.status as AcceptanceFileStatus | undefined) ?? null,
      recommendation,
      decisions,
      completionFailures: section01CompletionChecks({
        segments: acc.segments,
        declarationsPending: acc.context.independence.pending,
      }),
      preparedByName: recommendation?.submittedByName ?? p?.manager_name ?? null,
      engagementPartnerName: p?.partner_name ?? null,
    });

    return {
      derived,
      recommendation,
      decisions,
      draftMemo: acc.pack.draftMemo ?? '',
      isEngagementPartner: !!ctx.employeeId && p?.partner_id === ctx.employeeId,
      isLead: p?.is_lead ?? false,
      hasEngagementPartner: !!p?.partner_id,
    };
  }
}

function toView(workflowInstanceId: string, g: Gathered): AcceptanceSignoffView {
  const live = g.derived.liveApproval;
  return {
    workflowInstanceId,
    header: g.derived.header,
    finalSegmentState: g.derived.finalSegmentState,
    readiness: g.derived.readiness,
    openMatters: g.derived.openMatters,
    blockers: g.derived.blockers,
    recommendation: g.recommendation,
    decisions: g.decisions,
    callerIsEngagementPartner: g.isEngagementPartner,
    canSubmit: g.isLead && !live && g.recommendation?.status !== 'submitted',
    canDecide: g.isEngagementPartner && !live && g.recommendation?.status === 'submitted',
    canReopen: g.isEngagementPartner && !!live,
    draftMemo: g.draftMemo,
  };
}
