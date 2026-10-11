import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  NOTIFICATION_TYPE,
  PARTNER_ATTENTION_STATUS,
  PLANNING_ACTOR_ROLE,
  PLANNING_ACTOR_ROLE_LABEL,
  PLANNING_ATTENTION,
  PLANNING_EVIDENCE_TARGETS,
  PLANNING_MATTER_CATEGORY,
  PLANNING_MATTER_ORIGIN,
  PLANNING_SIGNAL_SOURCE,
  planningVersionLabel,
  type AcknowledgePartnerAttentionInput,
  type AddPlanningEvidenceInput,
  type ChallengePartnerAttentionInput,
  type CreateDiscussionActionInput,
  type CreateDiscussionSignalInput,
  type DiscussionSignalCreated,
  type FileVersionHistory,
  type FlagPartnerAttentionInput,
  type LinkPlanningEvidenceInput,
  type PartnerAttentionItem,
  type PartnerAttentionQueue,
  type PartnerAttentionStatus,
  type PlanningAccess,
  type PlanningAttention,
  type PlanningEvidenceFile,
  type PlanningEvidenceTarget,
  type PlanningEvidenceView,
  type PlanningGovernanceView,
  type PlanningMatterRecord,
  type PlanningRevisionBaseline,
  type PlanningRevisionRecord,
  type PlanningSignalAssessment,
  type ReopenPlanningIntelligenceInput,
  type RespondPartnerAttentionInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { rlsContextFromPrincipal, type Principal } from '../auth/principal';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { M365Service } from '../documents/m365/m365.service';
import { AuditAreaReviewService } from './audit-area-review.service';
import { AuditPlanningStrategyService } from './audit-planning-strategy.service';
import { readDownstreamFlags } from './planning-downstream';
import {
  assertPlanningCapability,
  markRaisedByPartner,
  notifyPlanning,
  readPlanningLock,
  resolvePlanningActor,
  syncPlanningAttention,
  type PlanningActor,
} from './planning-governance';
import { assertShell, clean, displayCode, insertSignal } from './planning-shared';

/** The 03.1 record each evidence target lives in (all carry workflow_instance_id). */
const EVIDENCE_TARGET_SQL: Record<PlanningEvidenceTarget, string> = {
  signal: `SELECT 1 FROM hsdg.audit_planning_signal WHERE id = $1 AND workflow_instance_id = $2`,
  change: `SELECT 1 FROM hsdg.audit_planning_change WHERE id = $1 AND workflow_instance_id = $2`,
  prior_year: `SELECT 1 FROM hsdg.audit_prior_year_matter WHERE id = $1 AND workflow_instance_id = $2`,
  acceptance: `SELECT 1 FROM hsdg.audit_matter
                WHERE id = $1 AND workflow_instance_id = $2 AND section = 'acceptance'`,
  discussion: `SELECT 1 FROM hsdg.audit_planning_discussion WHERE id = $1 AND workflow_instance_id = $2`,
};

interface AttentionRow {
  id: string;
  signal_id: string | null;
  focus_id: string | null;
  seq: number;
  title: string;
  detail: string | null;
  attention: PlanningAttention | null;
  manager_assessment: PlanningSignalAssessment | null;
  partner_surfaced_at: Date | null;
  partner_status: PartnerAttentionStatus | null;
  raised_by_partner: boolean;
  partner_note: string | null;
  challenge: string | null;
  challenged_at: Date | null;
  manager_response: string | null;
  responded_by_name: string | null;
  responded_at: Date | null;
  reviewed_by_name: string | null;
  reviewed_at: Date | null;
  version: number;
}

interface RevisionRow {
  id: string;
  from_version_no: number;
  to_version_no: number;
  reason: string;
  status: 'open' | 'completed';
  opened_by_name: string | null;
  opened_at: Date;
  completed_by_name: string | null;
  completed_at: Date | null;
  baseline?: Record<string, unknown>;
}

interface EvidenceRow {
  id: string;
  target_type: PlanningEvidenceTarget;
  target_id: string;
  document_id: string;
  title: string;
  filename: string | null;
  current_version_no: number;
  last_edited_by: string | null;
  linked_by_employee_id: string | null;
  linked_by_name: string | null;
  linked_at: Date;
  in_sharepoint: boolean;
  edit_locked: boolean;
}

/**
 * 03.1 governance & dynamics (DHVAJ 03.1 §10, §16, §18–§20, §23, §24): the
 * acting user's access, the Engagement Partner's Immediate Partner Attention
 * queue (acknowledge / challenge / Manager response / flag), the controlled
 * revision of 03.1 after Planning approval (03.12), SharePoint-backed evidence
 * on 03.1 records, and the actions / signals raised in the team discussion.
 */
@Injectable()
export class AuditPlanningGovernanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly m365: M365Service,
    private readonly strategy: AuditPlanningStrategyService,
    private readonly areaReview: AuditAreaReviewService,
  ) {}

  // ── The governance read ─────────────────────────────────────────────────

  async view(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PlanningGovernanceView> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const actor = await resolvePlanningActor(client, engagementId);
      // Bring legacy registers (pre-governance rows) into the queue on first read.
      if (actor.role !== PLANNING_ACTOR_ROLE.none) {
        await syncPlanningAttention(client, engagementId, workflowInstanceId);
      }
      return this.readView(client, engagementId, workflowInstanceId, actor);
    });
  }

  private async readView(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    actor: PlanningActor,
  ): Promise<PlanningGovernanceView> {
    const { rows: proposals } = await client.query<{
      id: string;
      name: string | null;
      proposed_at: Date;
    }>(
      `SELECT s.id, emp.full_name AS name, s.proposed_at
         FROM hsdg.audit_planning_signal s
         LEFT JOIN hsdg.employees emp ON emp.id = s.proposed_by_employee_id
        WHERE s.workflow_instance_id = $1 AND s.proposed_at IS NOT NULL
          AND s.manager_assessment IS NULL AND s.status <> 'closed'`,
      [workflowInstanceId],
    );
    const { rows: counts } = await client.query<{ target_id: string; n: string }>(
      `SELECT target_id, count(*) AS n FROM hsdg.audit_planning_evidence
        WHERE workflow_instance_id = $1 AND removed_at IS NULL GROUP BY target_id`,
      [workflowInstanceId],
    );
    return {
      access: await this.readAccess(client, workflowInstanceId, actor),
      partnerAttention: await this.readQueue(client, engagementId, workflowInstanceId),
      proposals: Object.fromEntries(
        proposals.map((p) => [
          p.id,
          { proposedByName: p.name, proposedAt: p.proposed_at.toISOString() },
        ]),
      ),
      evidenceCounts: Object.fromEntries(counts.map((c) => [c.target_id, Number(c.n)])),
      downstreamFlags: await readDownstreamFlags(client, workflowInstanceId),
    };
  }

  private async readAccess(
    client: PoolClient,
    workflowInstanceId: string,
    actor: PlanningActor,
  ): Promise<PlanningAccess> {
    const lock = await readPlanningLock(client, workflowInstanceId);
    const revisions = await this.readRevisions(client, workflowInstanceId);
    return {
      role: actor.role,
      roleLabel: actor.actingAsManager
        ? `${PLANNING_ACTOR_ROLE_LABEL.partner} (acting as Manager)`
        : PLANNING_ACTOR_ROLE_LABEL[actor.role],
      actingAsManager: actor.actingAsManager,
      capabilities: actor.capabilities,
      approved: lock.approved,
      locked: lock.locked,
      lockReason: lock.lockReason,
      versionNo: lock.versionNo,
      versionLabel: planningVersionLabel(lock.versionNo),
      openRevision: revisions.find((r) => r.status === 'open') ?? null,
      revisions,
    };
  }

  private async readRevisions(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<PlanningRevisionRecord[]> {
    const { rows } = await client.query<RevisionRow>(
      `${REVISION_SELECT} WHERE r.workflow_instance_id = $1 ORDER BY r.to_version_no DESC`,
      [workflowInstanceId],
    );
    return rows.map(mapRevision);
  }

  // ── §10 / §20 Immediate Partner Attention queue ─────────────────────────

  private async readQueue(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PartnerAttentionQueue> {
    const { rows } = await client.query<AttentionRow>(
      `${ATTENTION_SELECT} WHERE a.workflow_instance_id = $1 AND a.partner_surfaced_at IS NOT NULL
        ORDER BY (a.partner_status = 'acknowledged'), (a.focus_id IS NOT NULL),
                 COALESCE(s.seq, f.seq)`,
      [workflowInstanceId],
    );
    const { rows: ep } = await client.query<{ name: string | null }>(
      `SELECT emp.full_name AS name FROM hsdg.engagements e
         LEFT JOIN hsdg.employees emp ON emp.id = e.engagement_partner_id
        WHERE e.id = $1`,
      [engagementId],
    );
    const items = rows.map(mapAttention);
    return {
      engagementPartnerName: ep[0]?.name ?? null,
      items,
      outstanding: items.filter((i) => i.status !== PARTNER_ATTENTION_STATUS.acknowledged).length,
    };
  }

  /** EP acknowledges an item in the queue (optionally with a note). */
  async acknowledge(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    attentionId: string,
    input: AcknowledgePartnerAttentionInput,
  ): Promise<PlanningGovernanceView> {
    return this.partnerStep(
      ctx,
      engagementId,
      workflowInstanceId,
      attentionId,
      async (client, row, actor) => {
        assertPlanningCapability(actor, 'partnerReview');
        const res = await client.query(
          `UPDATE hsdg.audit_planning_attention
            SET partner_status = 'acknowledged',
                partner_note = COALESCE($3, partner_note),
                reviewed_by_employee_id = $4, reviewed_at = now(), version = version + 1
          WHERE id = $1 AND version = $2 AND partner_surfaced_at IS NOT NULL`,
          [attentionId, input.version, clean(input.note), actor.employeeId],
        );
        if (!res.rowCount) throw staleItem();
        return { action: 'acknowledged', before: row.partner_status };
      },
    );
  }

  /** EP challenges an item: the Manager must answer before the EP acknowledges. */
  async challenge(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    attentionId: string,
    input: ChallengePartnerAttentionInput,
  ): Promise<PlanningGovernanceView> {
    const text = clean(input.challenge);
    if (!text) throw new BadRequestException('State the challenge for the Engagement Manager.');
    return this.partnerStep(
      ctx,
      engagementId,
      workflowInstanceId,
      attentionId,
      async (client, row, actor) => {
        assertPlanningCapability(actor, 'partnerReview');
        const res = await client.query(
          `UPDATE hsdg.audit_planning_attention
            SET partner_status = 'challenged', challenge = $3, challenged_at = now(),
                manager_response = NULL, responded_by_employee_id = NULL, responded_at = NULL,
                reviewed_by_employee_id = $4, reviewed_at = now(), version = version + 1
          WHERE id = $1 AND version = $2 AND partner_surfaced_at IS NOT NULL`,
          [attentionId, input.version, text, actor.employeeId],
        );
        if (!res.rowCount) throw staleItem();
        await notifyPlanning(client, [actor.managerId], {
          type: NOTIFICATION_TYPE.planningPartnerAttention,
          title: `EP challenged ${itemCode(row)} in 03.1`,
          body: text,
          engagementId,
          objectType: row.signal_id ? 'audit_planning_signal' : 'audit_area_of_focus',
          objectId: (row.signal_id ?? row.focus_id)!,
          dedup: `planning_challenge:${attentionId}:${row.version + 1}`,
          except: actor.employeeId,
        });
        return { action: 'challenged', before: row.partner_status };
      },
    );
  }

  /** The Manager answers the EP's challenge; the item returns to the EP. */
  async respond(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    attentionId: string,
    input: RespondPartnerAttentionInput,
  ): Promise<PlanningGovernanceView> {
    const text = clean(input.response);
    if (!text) throw new BadRequestException('Record the response to the Partner’s challenge.');
    return this.partnerStep(
      ctx,
      engagementId,
      workflowInstanceId,
      attentionId,
      async (client, row, actor) => {
        assertPlanningCapability(actor, 'respondToChallenge');
        if (row.partner_status !== PARTNER_ATTENTION_STATUS.challenged) {
          throw new ConflictException('Only a challenged item can be answered.');
        }
        const res = await client.query(
          `UPDATE hsdg.audit_planning_attention
            SET partner_status = 'responded', manager_response = $3,
                responded_by_employee_id = $4, responded_at = now(), version = version + 1
          WHERE id = $1 AND version = $2`,
          [attentionId, input.version, text, actor.employeeId],
        );
        if (!res.rowCount) throw staleItem();
        await notifyPlanning(client, [actor.partnerId], {
          type: NOTIFICATION_TYPE.planningPartnerAttention,
          title: `Manager responded on ${itemCode(row)} in 03.1`,
          body: text,
          engagementId,
          objectType: row.signal_id ? 'audit_planning_signal' : 'audit_area_of_focus',
          objectId: (row.signal_id ?? row.focus_id)!,
          dedup: `planning_response:${attentionId}:${row.version + 1}`,
          except: actor.employeeId,
        });
        return { action: 'responded', before: row.partner_status };
      },
    );
  }

  /** EP raises a signal to Immediate Partner Attention, or a focus area to Partner attention. */
  async flag(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: FlagPartnerAttentionInput,
  ): Promise<PlanningGovernanceView> {
    const note = clean(input.note);
    if (!note) throw new BadRequestException('Say why this needs Immediate Partner Attention.');
    if (!!input.signalId === !!input.focusId) {
      throw new BadRequestException('Flag exactly one signal or Area of Focus.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const actor = await resolvePlanningActor(client, engagementId);
      assertPlanningCapability(actor, 'partnerReview');
      let code: string;
      if (input.signalId) {
        const { rows } = await client.query<{ seq: number; attention: PlanningAttention }>(
          `SELECT seq, attention FROM hsdg.audit_planning_signal
            WHERE id = $1 AND workflow_instance_id = $2`,
          [input.signalId, workflowInstanceId],
        );
        if (!rows[0]) throw new NotFoundException('Planning Signal not found on this audit file.');
        code = displayCode('PS', rows[0].seq)!;
        if (rows[0].attention !== PLANNING_ATTENTION.immediatePartner) {
          await client.query(
            `UPDATE hsdg.audit_planning_signal
                SET attention = 'immediate_partner',
                    status = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
                    version = version + 1
              WHERE id = $1`,
            [input.signalId],
          );
        }
      } else {
        const { rows } = await client.query<{ seq: number }>(
          `UPDATE hsdg.audit_area_of_focus
              SET partner_attention = true,
                  status = CASE WHEN status = 'superseded' THEN 'open' ELSE status END,
                  version = version + 1
            WHERE id = $1 AND workflow_instance_id = $2
          RETURNING seq`,
          [input.focusId, workflowInstanceId],
        );
        if (!rows[0]) throw new NotFoundException('Area of Focus not found on this audit file.');
        code = displayCode('FA', rows[0].seq)!;
      }
      await syncPlanningAttention(client, engagementId, workflowInstanceId);
      await markRaisedByPartner(client, {
        signalId: input.signalId ?? undefined,
        focusId: input.focusId ?? undefined,
      });
      await client.query(
        `UPDATE hsdg.audit_planning_attention SET partner_note = $3, version = version + 1
          WHERE signal_id = $1::uuid OR focus_id = $2::uuid`,
        [input.signalId ?? null, input.focusId ?? null, note],
      );
      if (input.signalId) {
        await this.strategy.syncConsiderations(client, engagementId, workflowInstanceId);
        await this.areaReview.markImpacted(client, workflowInstanceId);
      }
      await notifyPlanning(client, [actor.managerId], {
        type: NOTIFICATION_TYPE.planningPartnerAttention,
        title: `EP flagged ${code} for Immediate Partner Attention`,
        body: note,
        engagementId,
        objectType: input.signalId ? 'audit_planning_signal' : 'audit_area_of_focus',
        objectId: (input.signalId ?? input.focusId)!,
        dedup: `planning_flag:${input.signalId ?? input.focusId}:${Date.now()}`,
        except: actor.employeeId,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_partner_flagged',
        objectType: input.signalId ? 'audit_planning_signal' : 'audit_area_of_focus',
        objectId: (input.signalId ?? input.focusId)!,
        after: { note },
      });
      return this.readView(client, engagementId, workflowInstanceId, actor);
    });
  }

  private async partnerStep(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    attentionId: string,
    step: (
      client: PoolClient,
      row: AttentionRow,
      actor: PlanningActor,
    ) => Promise<{ action: string; before: PartnerAttentionStatus | null }>,
  ): Promise<PlanningGovernanceView> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const { rows } = await client.query<AttentionRow>(
        `${ATTENTION_SELECT} WHERE a.id = $1 AND a.workflow_instance_id = $2`,
        [attentionId, workflowInstanceId],
      );
      const row = rows[0];
      if (!row || !row.partner_surfaced_at) {
        throw new NotFoundException('That item is not in the Partner Attention queue.');
      }
      const actor = await resolvePlanningActor(client, engagementId);
      const { action, before } = await step(client, row, actor);
      await this.audit.recordWith(client, ctx, {
        action: `statutory_audit.planning_partner_attention_${action}`,
        objectType: 'audit_planning_attention',
        objectId: attentionId,
        before: { status: before },
        after: { status: action },
      });
      return this.readView(client, engagementId, workflowInstanceId, actor);
    });
  }

  // ── §19 controlled revision after Planning approval ─────────────────────

  /**
   * Reopen 03.1 after 03.12 approval: freeze the approved 03.1 as the
   * baseline, open v1.(n) for revision, put 03.1 back into Manager Assessment
   * and Planning back to Needs Attention so 03.12 re-approval follows.
   */
  async reopen(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: ReopenPlanningIntelligenceInput,
  ): Promise<PlanningGovernanceView> {
    const reason = clean(input.reason);
    if (!reason) throw new BadRequestException('Give the reason 03.1 is being revised.');
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const actor = await resolvePlanningActor(client, engagementId);
      assertPlanningCapability(actor, 'reopen');
      const lock = await readPlanningLock(client, workflowInstanceId);
      if (!lock.approved) {
        throw new ConflictException(
          'Planning has not been approved in 03.12 — edit 03.1 directly; no revision is needed.',
        );
      }
      if (lock.openRevisionId) throw new ConflictException('A 03.1 revision is already open.');

      const { rows: base } = await client.query<{ baseline: Record<string, unknown> }>(
        BASELINE_SQL,
        [workflowInstanceId],
      );
      let revisionId: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.audit_planning_intelligence_revision
             (workflow_instance_id, engagement_id, from_version_no, to_version_no, reason,
              approval_id, baseline, opened_by_employee_id)
           VALUES ($1, $2, $3, $3 + 1, $4, $5, $6::jsonb, $7)
           RETURNING id`,
          [
            workflowInstanceId,
            engagementId,
            lock.versionNo,
            reason,
            lock.approvalId,
            JSON.stringify(base[0]!.baseline),
            actor.employeeId,
          ],
        );
        revisionId = rows[0]!.id;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictException('03.1 was reopened concurrently; refresh.');
        }
        throw err;
      }
      await client.query(
        `UPDATE hsdg.audit_planning_intelligence
            SET version_no = version_no + 1,
                status = CASE WHEN status IN ('complete','strategy_established')
                              THEN 'manager_assessment' ELSE status END,
                version = version + 1
          WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      await client.query(
        `UPDATE hsdg.audit_planning_items
            SET state = 'in_progress', updated_by_employee_id = $2, content_updated_at = now(),
                version = version + 1
          WHERE workflow_instance_id = $1 AND item_key = 'audit_strategy' AND state = 'complete'`,
        [workflowInstanceId, actor.employeeId],
      );
      // 03.12 re-approval is allowed once Planning is back to Needs Attention.
      await client.query(
        `UPDATE hsdg.audit_workflow_phases SET state = 'needs_attention'
          WHERE workflow_instance_id = $1 AND phase_key = 'planning' AND state = 'complete'`,
        [workflowInstanceId],
      );
      const to = planningVersionLabel(lock.versionNo + 1);
      await notifyPlanning(client, [actor.partnerId, actor.managerId], {
        type: NOTIFICATION_TYPE.planningStrategyReopened,
        title: `03.1 reopened for revision (${planningVersionLabel(lock.versionNo)} → ${to})`,
        body: `${reason}\nThe approved ${planningVersionLabel(lock.versionNo)} is preserved; Planning returns to 03.12 for re-approval.`,
        engagementId,
        objectType: 'audit_planning_intelligence_revision',
        objectId: revisionId,
        dedup: `planning_reopened:${revisionId}`,
        except: actor.employeeId,
      });
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_intelligence_reopened',
        objectType: 'audit_planning_intelligence_revision',
        objectId: revisionId,
        before: { version: planningVersionLabel(lock.versionNo) },
        after: { version: to, reason },
      });
      return this.readView(client, engagementId, workflowInstanceId, actor);
    });
  }

  /** One revision with its frozen baseline. */
  async revision(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    revisionId: string,
  ): Promise<PlanningRevisionBaseline> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const { rows } = await client.query<RevisionRow>(
        `${REVISION_SELECT} WHERE r.id = $1 AND r.workflow_instance_id = $2`,
        [revisionId, workflowInstanceId],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('Revision not found.');
      return { ...mapRevision(r), baseline: r.baseline ?? {} };
    });
  }

  // ── §24 SharePoint evidence ─────────────────────────────────────────────

  async evidence(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    targetType: PlanningEvidenceTarget,
    targetId: string,
  ): Promise<PlanningEvidenceView> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertTarget(client, engagementId, workflowInstanceId, targetType, targetId);
      return this.readEvidence(client, engagementId, workflowInstanceId, targetType, targetId);
    });
  }

  async addEvidence(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: AddPlanningEvidenceInput,
  ): Promise<PlanningEvidenceView> {
    await this.db.withRlsContext(ctx, async (client) => {
      await this.assertTarget(
        client,
        engagementId,
        workflowInstanceId,
        input.targetType,
        input.targetId,
      );
      const actor = await resolvePlanningActor(client, engagementId);
      if (!mayUpload(actor)) {
        throw new ForbiddenException(
          'New files are added by the Engagement Partner or Manager — link an existing engagement file instead.',
        );
      }
    });
    // Stored in the engagement workspace (SharePoint when Microsoft 365 is on).
    const doc = await this.documents.create(ctx, engagementId, {
      title: input.title?.trim() || input.filename.replace(/\.[^.]+$/, ''),
      filename: input.filename,
      contentType: input.contentType,
      contentBase64: input.contentBase64,
      documentType: 'evidence',
    });
    return this.db.withRlsContext(ctx, async (client) => {
      await this.insertEvidence(
        client,
        ctx,
        engagementId,
        workflowInstanceId,
        input,
        doc.id,
        'added',
      );
      return this.readEvidence(
        client,
        engagementId,
        workflowInstanceId,
        input.targetType,
        input.targetId,
      );
    });
  }

  async linkEvidence(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: LinkPlanningEvidenceInput,
  ): Promise<PlanningEvidenceView> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertTarget(
        client,
        engagementId,
        workflowInstanceId,
        input.targetType,
        input.targetId,
      );
      const { rows } = await client.query(
        `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2 AND deleted_at IS NULL`,
        [input.documentId, engagementId],
      );
      if (!rows[0]) throw new BadRequestException('That document is not on this engagement.');
      await this.insertEvidence(
        client,
        ctx,
        engagementId,
        workflowInstanceId,
        input,
        input.documentId,
        'linked',
      );
      return this.readEvidence(
        client,
        engagementId,
        workflowInstanceId,
        input.targetType,
        input.targetId,
      );
    });
  }

  /** Take a file off the 03.1 record (the document stays on the engagement). */
  async unlinkEvidence(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    evidenceId: string,
  ): Promise<PlanningEvidenceView> {
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const row = await this.loadEvidence(client, workflowInstanceId, evidenceId);
      const actor = await resolvePlanningActor(client, engagementId);
      if (!mayRemove(actor, row.linked_by_employee_id)) {
        throw new ForbiddenException(
          'Only the Engagement Partner / Manager or whoever linked the file may remove it.',
        );
      }
      await client.query(
        `UPDATE hsdg.audit_planning_evidence
            SET removed_at = now(), removed_by_employee_id = $2
          WHERE id = $1 AND removed_at IS NULL`,
        [evidenceId, actor.employeeId],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_evidence_unlinked',
        objectType: 'audit_planning_evidence',
        objectId: evidenceId,
        before: {
          targetType: row.target_type,
          targetId: row.target_id,
          documentId: row.document_id,
        },
      });
      return this.readEvidence(
        client,
        engagementId,
        workflowInstanceId,
        row.target_type,
        row.target_id,
      );
    });
  }

  /** The file's version history (SharePoint's when it holds the file). */
  async evidenceVersions(
    principal: Principal,
    engagementId: string,
    workflowInstanceId: string,
    evidenceId: string,
  ): Promise<FileVersionHistory> {
    const documentId = await this.db.withRlsContext(
      rlsContextFromPrincipal(principal),
      async (client) => {
        await assertShell(client, engagementId, workflowInstanceId);
        return (await this.loadEvidence(client, workflowInstanceId, evidenceId)).document_id;
      },
    );
    return this.m365.versionHistory(principal, engagementId, documentId);
  }

  private async assertTarget(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    targetType: PlanningEvidenceTarget,
    targetId: string,
  ): Promise<void> {
    await assertShell(client, engagementId, workflowInstanceId);
    if (!PLANNING_EVIDENCE_TARGETS.includes(targetType)) {
      throw new BadRequestException('Unknown 03.1 evidence target.');
    }
    const { rows } = await client.query(EVIDENCE_TARGET_SQL[targetType], [
      targetId,
      workflowInstanceId,
    ]);
    if (!rows[0]) throw new NotFoundException('That 03.1 record is not on this audit file.');
  }

  private async insertEvidence(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    target: { targetType: PlanningEvidenceTarget; targetId: string },
    documentId: string,
    how: 'added' | 'linked',
  ): Promise<void> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_planning_evidence
         (workflow_instance_id, engagement_id, target_type, target_id, document_id,
          linked_by_employee_id)
       VALUES ($1, $2, $3, $4, $5, hsdg.ctx_employee_id())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [workflowInstanceId, engagementId, target.targetType, target.targetId, documentId],
    );
    if (!rows[0]) throw new ConflictException('That file is already linked here.');
    await this.audit.recordWith(client, ctx, {
      action: `statutory_audit.planning_evidence_${how}`,
      objectType: 'audit_planning_evidence',
      objectId: rows[0].id,
      after: { targetType: target.targetType, targetId: target.targetId, documentId },
    });
  }

  private async loadEvidence(
    client: PoolClient,
    workflowInstanceId: string,
    evidenceId: string,
  ): Promise<{
    target_type: PlanningEvidenceTarget;
    target_id: string;
    document_id: string;
    linked_by_employee_id: string | null;
  }> {
    const { rows } = await client.query<{
      target_type: PlanningEvidenceTarget;
      target_id: string;
      document_id: string;
      linked_by_employee_id: string | null;
    }>(
      `SELECT target_type, target_id, document_id, linked_by_employee_id
         FROM hsdg.audit_planning_evidence
        WHERE id = $1 AND workflow_instance_id = $2 AND removed_at IS NULL`,
      [evidenceId, workflowInstanceId],
    );
    if (!rows[0]) throw new NotFoundException('That file is not linked here.');
    return rows[0];
  }

  private async readEvidence(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    targetType: PlanningEvidenceTarget,
    targetId: string,
  ): Promise<PlanningEvidenceView> {
    const { rows } = await client.query<EvidenceRow>(
      `SELECT ev.id, ev.target_type, ev.target_id, ev.document_id, d.title, cv.filename,
              d.current_version_no, ue.full_name AS last_edited_by,
              ev.linked_by_employee_id, lb.full_name AS linked_by_name, ev.linked_at,
              (d.m365_live_item_id IS NOT NULL) AS in_sharepoint, d.edit_locked
         FROM hsdg.audit_planning_evidence ev
         JOIN hsdg.documents d ON d.id = ev.document_id AND d.deleted_at IS NULL
         LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
         LEFT JOIN hsdg.employees ue ON ue.id = cv.uploaded_by_employee_id
         LEFT JOIN hsdg.employees lb ON lb.id = ev.linked_by_employee_id
        WHERE ev.workflow_instance_id = $1 AND ev.target_type = $2 AND ev.target_id = $3
          AND ev.removed_at IS NULL
        ORDER BY ev.linked_at ASC`,
      [workflowInstanceId, targetType, targetId],
    );
    const actor = await resolvePlanningActor(client, engagementId);
    const lock = await readPlanningLock(client, workflowInstanceId);
    const open = !lock.locked;
    return {
      targetType,
      targetId,
      files: rows.map((r): PlanningEvidenceFile => ({
        id: r.id,
        targetType: r.target_type,
        targetId: r.target_id,
        documentId: r.document_id,
        title: r.title,
        filename: r.filename,
        currentVersionNo: r.current_version_no,
        lastEditedBy: r.last_edited_by,
        linkedByName: r.linked_by_name,
        linkedAt: r.linked_at.toISOString(),
        inSharePoint: r.in_sharepoint,
        editLocked: r.edit_locked,
        removable: open && mayRemove(actor, r.linked_by_employee_id),
      })),
      canAdd: open && actor.capabilities.addFacts,
      canUpload: open && mayUpload(actor),
      m365Enabled: this.m365.enabled,
    };
  }

  // ── 03.1.8 team discussion: actions + signals ───────────────────────────

  /** An inline discussion action — a Planning Matter with origin `discussion`. */
  async createDiscussionAction(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateDiscussionActionInput,
  ): Promise<PlanningMatterRecord> {
    const title = clean(input.title);
    if (!title) throw new BadRequestException('Describe the action.');
    if (!input.ownerEmployeeId) throw new BadRequestException('Every action needs an owner.');
    await this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      assertPlanningCapability(await resolvePlanningActor(client, engagementId), 'discussion');
      const { rows } = await client.query(
        `SELECT 1 FROM hsdg.engagements e
          WHERE e.id = $1
            AND ($2::uuid IN (e.engagement_partner_id, e.engagement_manager_id)
                 OR EXISTS (SELECT 1 FROM hsdg.engagement_team t
                             WHERE t.engagement_id = e.id AND t.employee_id = $2::uuid))`,
        [engagementId, input.ownerEmployeeId],
      );
      if (!rows[0]) throw new BadRequestException('The owner must be on the engagement team.');
    });
    return this.strategy.createMatter(ctx, engagementId, workflowInstanceId, {
      origin: PLANNING_MATTER_ORIGIN.discussion,
      title,
      category: input.category ?? PLANNING_MATTER_CATEGORY.other,
      ownerEmployeeId: input.ownerEmployeeId,
      dueDate: input.dueDate ?? null,
      partnerAttention: input.partnerAttention ?? false,
      affectedModule: input.affectedModule ?? null,
    });
  }

  /** "Create Planning Signal" from inside the discussion — linked to it. */
  async createDiscussionSignal(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: CreateDiscussionSignalInput,
  ): Promise<DiscussionSignalCreated> {
    const observation = clean(input.observation);
    if (!observation) throw new BadRequestException('A signal needs a factual observation.');
    return this.db.withRlsContext(ctx, async (client) => {
      await assertShell(client, engagementId, workflowInstanceId);
      const actor = await resolvePlanningActor(client, engagementId);
      assertPlanningCapability(actor, 'discussion');
      const asPartner = actor.role === PLANNING_ACTOR_ROLE.partner && !actor.actingAsManager;
      const id = await insertSignal(client, engagementId, workflowInstanceId, {
        source: asPartner ? PLANNING_SIGNAL_SOURCE.partner : PLANNING_SIGNAL_SOURCE.manager,
        sourceLink: '03.1/discussion',
        observation,
        whyMayMatter: clean(input.whyMayMatter),
        attention: input.suggestedAttention ?? PLANNING_ATTENTION.standard,
      });
      if (asPartner) await markRaisedByPartner(client, { signalId: id });
      await client.query(
        `INSERT INTO hsdg.audit_planning_discussion (workflow_instance_id, engagement_id, signal_ids)
         VALUES ($1, $2, ARRAY[$3::uuid])
         ON CONFLICT (workflow_instance_id) DO UPDATE
           SET signal_ids = array_append(hsdg.audit_planning_discussion.signal_ids, $3::uuid),
               version = hsdg.audit_planning_discussion.version + 1`,
        [workflowInstanceId, engagementId, id],
      );
      await this.strategy.syncConsiderations(client, engagementId, workflowInstanceId);
      await this.areaReview.markImpacted(client, workflowInstanceId);
      const { rows } = await client.query<{ seq: number }>(
        `SELECT seq FROM hsdg.audit_planning_signal WHERE id = $1`,
        [id],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.planning_signal_created',
        objectType: 'audit_planning_signal',
        objectId: id,
        after: { source: asPartner ? 'partner' : 'manager', fromDiscussion: true },
      });
      return { id, signalCode: displayCode('PS', rows[0]!.seq)! };
    });
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Engagement documents are created by the EP / Manager (documents RLS: leads insert). */
function mayUpload(actor: PlanningActor): boolean {
  return actor.role === PLANNING_ACTOR_ROLE.partner || actor.role === PLANNING_ACTOR_ROLE.manager;
}

function mayRemove(actor: PlanningActor, linkedBy: string | null): boolean {
  return mayUpload(actor) || (!!actor.employeeId && actor.employeeId === linkedBy);
}

function staleItem(): ConflictException {
  return new ConflictException('This item changed since you loaded it; refresh and retry.');
}

function itemCode(r: Pick<AttentionRow, 'signal_id' | 'seq'>): string {
  return displayCode(r.signal_id ? 'PS' : 'FA', r.seq)!;
}

const ATTENTION_SELECT = `
  SELECT a.id, a.signal_id, a.focus_id, COALESCE(s.seq, f.seq) AS seq,
         COALESCE(s.observation, f.name) AS title,
         COALESCE(s.why_may_matter, f.why_requires_attention) AS detail,
         s.attention, s.manager_assessment, a.partner_surfaced_at, a.partner_status,
         a.raised_by_partner, a.partner_note, a.challenge, a.challenged_at, a.manager_response,
         rb.full_name AS responded_by_name, a.responded_at,
         vb.full_name AS reviewed_by_name, a.reviewed_at, a.version
    FROM hsdg.audit_planning_attention a
    LEFT JOIN hsdg.audit_planning_signal s ON s.id = a.signal_id
    LEFT JOIN hsdg.audit_area_of_focus f ON f.id = a.focus_id
    LEFT JOIN hsdg.employees rb ON rb.id = a.responded_by_employee_id
    LEFT JOIN hsdg.employees vb ON vb.id = a.reviewed_by_employee_id`;

function mapAttention(r: AttentionRow): PartnerAttentionItem {
  return {
    id: r.id,
    kind: r.signal_id ? 'signal' : 'focus_area',
    targetId: (r.signal_id ?? r.focus_id)!,
    code: itemCode(r),
    title: r.title,
    detail: r.detail,
    attention: r.attention,
    managerAssessment: r.manager_assessment,
    surfacedAt: r.partner_surfaced_at?.toISOString() ?? null,
    status: r.partner_status ?? PARTNER_ATTENTION_STATUS.surfaced,
    raisedByPartner: r.raised_by_partner,
    partnerNote: r.partner_note,
    challenge: r.challenge,
    challengedAt: r.challenged_at?.toISOString() ?? null,
    managerResponse: r.manager_response,
    respondedByName: r.responded_by_name,
    respondedAt: r.responded_at?.toISOString() ?? null,
    reviewedByName: r.reviewed_by_name,
    reviewedAt: r.reviewed_at?.toISOString() ?? null,
    version: r.version,
  };
}

const REVISION_SELECT = `
  SELECT r.id, r.from_version_no, r.to_version_no, r.reason, r.status, r.baseline,
         ob.full_name AS opened_by_name, r.opened_at,
         cb.full_name AS completed_by_name, r.completed_at
    FROM hsdg.audit_planning_intelligence_revision r
    LEFT JOIN hsdg.employees ob ON ob.id = r.opened_by_employee_id
    LEFT JOIN hsdg.employees cb ON cb.id = r.completed_by_employee_id`;

function mapRevision(r: RevisionRow): PlanningRevisionRecord {
  return {
    id: r.id,
    fromVersionLabel: planningVersionLabel(r.from_version_no),
    toVersionLabel: planningVersionLabel(r.to_version_no),
    reason: r.reason,
    status: r.status,
    openedByName: r.opened_by_name,
    openedAt: r.opened_at.toISOString(),
    completedByName: r.completed_by_name,
    completedAt: r.completed_at?.toISOString() ?? null,
  };
}

/** The whole 03.1 file as approved — frozen into the revision (never rewritten). */
const BASELINE_SQL = `
  SELECT jsonb_build_object(
    'record', (SELECT to_jsonb(r) FROM hsdg.audit_planning_intelligence r
                WHERE r.workflow_instance_id = $1),
    'signals', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.seq)
                FROM hsdg.audit_planning_signal s WHERE s.workflow_instance_id = $1), '[]'),
    'focusAreas', COALESCE((SELECT jsonb_agg(to_jsonb(f) || jsonb_build_object('signal_ids',
                  (SELECT COALESCE(jsonb_agg(fs.signal_id), '[]') FROM hsdg.audit_focus_signal fs
                    WHERE fs.focus_id = f.id)) ORDER BY f.seq)
                FROM hsdg.audit_area_of_focus f WHERE f.workflow_instance_id = $1), '[]'),
    'changes', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at)
                FROM hsdg.audit_planning_change c WHERE c.workflow_instance_id = $1), '[]'),
    'considerations', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at)
                FROM hsdg.audit_planning_consideration c WHERE c.workflow_instance_id = $1), '[]'),
    'priorYear', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.seq)
                FROM hsdg.audit_prior_year_matter p WHERE p.workflow_instance_id = $1), '[]'),
    'acceptance', COALESCE((SELECT jsonb_agg(to_jsonb(cf))
                FROM hsdg.audit_acceptance_carry_forward cf WHERE cf.workflow_instance_id = $1), '[]'),
    'discussion', (SELECT to_jsonb(d) FROM hsdg.audit_planning_discussion d
                WHERE d.workflow_instance_id = $1),
    'matters', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.seq)
                FROM hsdg.audit_planning_matter m WHERE m.workflow_instance_id = $1), '[]'),
    'partnerAttention', COALESCE((SELECT jsonb_agg(to_jsonb(a))
                FROM hsdg.audit_planning_attention a WHERE a.workflow_instance_id = $1), '[]'),
    'evidence', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.linked_at)
                FROM hsdg.audit_planning_evidence e
               WHERE e.workflow_instance_id = $1 AND e.removed_at IS NULL), '[]')
  ) AS baseline`;
