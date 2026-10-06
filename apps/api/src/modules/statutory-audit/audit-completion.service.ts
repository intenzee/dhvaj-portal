import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  canApproveCompletion,
  canArchive,
  canSignOff,
  sectionResolved,
  PBC_OUTSTANDING_STATUSES,
  type AuditCompletionItem,
  type AuditWorkflowStatus,
  type CompletionGate,
  type CompletionItemState,
  type CompletionSection,
  type CompletionSuggestionResult,
  type FrameworkConclusion,
  type StatutoryAuditCompletion,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import {
  planCompletionItems,
  type CompletionFacts,
  type CompletionProcedure,
  type PlannedCompletionItem,
} from './completion-automation';
import { isEngagementLead } from './master-facts';
import { planSignOff, type SignOffFacts } from './sign-off-automation';

interface ShellRow {
  id: string;
  engagement_service_id: string;
  engagement_id: string;
  status: AuditWorkflowStatus;
  completion_approved_at: Date | null;
  completion_approved_by_name: string | null;
  completion_memo: string | null;
  signed_off_at: Date | null;
  signed_off_by_name: string | null;
  signoff_memo: string | null;
  archived_at: Date | null;
  archived_by_name: string | null;
  archive_note: string | null;
}

type SignOffExtras = Pick<
  SignOffFacts,
  'blockingNotes' | 'pbcOutstanding' | 'pbcOverdue' | 'openReassessments' | 'engagementPartnerName'
>;

interface ItemRow {
  id: string;
  workflow_instance_id: string;
  section: CompletionSection;
  item_key: string;
  title: string;
  state: CompletionItemState;
  note: string | null;
  version: number;
  updated_at: Date;
  state_suggested: boolean;
  note_suggested: boolean;
}

/**
 * Statutory Audit — Completion / Reporting / Sign-off / Archive (Audit Spec
 * §27–§29). SA-8 closes the ten-phase file.
 *
 * Completion (§27.07) and Reporting (§27.08) are professional checklists carried
 * through not_started → in_progress → complete / not_applicable. Partner sign-off
 * (§27.09) is GATED server-side (§28 "the UI must not permit an action merely
 * because a button is visible"): no OPEN BLOCKING review note (§29), every active
 * audit area concluded, both checklists resolved. Archiving (§27.10) flips the
 * shell to `archived` and every further write is then rejected — professional
 * history is immutable (§37). All gate maths lives in the shared pure helpers so
 * it is unit-tested independent of the DB.
 */
@Injectable()
export class AuditCompletionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  async listForEngagement(
    ctx: RlsContext,
    engagementId: string,
  ): Promise<StatutoryAuditCompletion[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      // A lead opening the checklist brings it up to date with the file.
      if (await isEngagementLead(client, engagementId)) {
        await this.syncEngagement(client, engagementId);
      }
      return this.readCompletion(client, engagementId);
    });
  }

  /** "Refresh from the file" — re-draft every untouched item now. */
  async suggest(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<CompletionSuggestionResult> {
    return this.db.withRlsContext(ctx, async (client) => {
      if (!(await isEngagementLead(client, engagementId))) {
        throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
      }
      const itemsUpdated = await this.syncEngagement(client, engagementId, workflowInstanceId);
      return {
        completion: await this.readOne(client, engagementId, workflowInstanceId),
        itemsUpdated,
      };
    });
  }

  /**
   * Bring the untouched checklist items in line with the file: a state nobody
   * has set follows the evidence; a blank or still-drafted note takes the
   * draft. Never touches what a person set, a signed-off / archived file, or
   * the Completion section once completion is approved.
   */
  private async syncEngagement(
    client: PoolClient,
    engagementId: string,
    onlyShell?: string,
  ): Promise<number> {
    const { rows: shells } = await client.query<{
      id: string;
      completion_approved: boolean;
      frozen: boolean;
    }>(
      `SELECT id, completion_approved_at IS NOT NULL AS completion_approved,
              (signed_off_at IS NOT NULL OR archived_at IS NOT NULL
                OR status IN ('archived','cancelled')) AS frozen
         FROM hsdg.service_workflow_instances
        WHERE engagement_id = $1 AND workflow_key = 'statutory_audit'`,
      [engagementId],
    );
    let updated = 0;
    for (const shell of shells) {
      if (onlyShell && shell.id !== onlyShell) continue;
      if (onlyShell && shell.frozen) {
        throw new ConflictException('This audit file is signed off; the checklist is final.');
      }
      if (shell.frozen) continue;
      // Completion approved → Section 09 is under way.
      if (shell.completion_approved) await this.unlockPhase(client, shell.id, 'sign_off');
      const plan = planCompletionItems(await this.loadFacts(client, engagementId, shell.id));
      const { rows: items } = await client.query<ItemRow>(
        `SELECT * FROM hsdg.audit_completion_items WHERE workflow_instance_id = $1`,
        [shell.id],
      );
      for (const item of items) {
        if (item.section === 'completion' && shell.completion_approved) continue;
        const p = plan.get(item.item_key);
        if (!p) continue;
        const sets: string[] = [];
        const params: unknown[] = [item.id, item.version];
        if (item.state_suggested && p.evidence.suggestedState !== item.state) {
          params.push(p.evidence.suggestedState);
          sets.push(`state = $${params.length}`);
        }
        const draft = p.draftNote;
        if (draft && (item.note == null || item.note_suggested) && draft !== item.note) {
          params.push(draft);
          sets.push(`note = $${params.length}`, 'note_suggested = true');
        }
        if (sets.length === 0) continue;
        const r = await client.query(
          `UPDATE hsdg.audit_completion_items
              SET ${sets.join(', ')}, version = version + 1
            WHERE id = $1 AND version = $2`,
          params,
        );
        updated += r.rowCount ?? 0;
      }
    }
    return updated;
  }

  /** Everything the checklist reads from the rest of the file, for one shell. */
  private async loadFacts(
    client: PoolClient,
    engagementId: string,
    wi: string,
  ): Promise<CompletionFacts> {
    const eng = await client.query<{ financial_year: string | null }>(
      `SELECT financial_year FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    const fw = await client.query<{
      area_key: string;
      conclusion: FrameworkConclusion | null;
      basis: string | null;
    }>(
      `SELECT area_key, conclusion, basis FROM hsdg.audit_framework_assessments
          WHERE workflow_instance_id = $1`,
      [wi],
    );
    const areas = await client.query<{
      work_area_key: string;
      title: string;
      conclusion_state: string;
    }>(
      `SELECT work_area_key, title, conclusion_state FROM hsdg.audit_work_areas
          WHERE workflow_instance_id = $1 AND is_active ORDER BY sort_order`,
      [wi],
    );
    const procs = await client.query<{
      procedure_ref: string;
      title: string;
      state: CompletionProcedure['state'];
      source_key: string | null;
      risk_id: string | null;
      work_area_key: string;
      work_area_title: string;
    }>(
      `SELECT p.procedure_ref, p.title, p.state, p.source_key, p.risk_id,
                a.work_area_key, a.title AS work_area_title
           FROM hsdg.audit_procedures p
           JOIN hsdg.audit_work_areas a ON a.id = p.work_area_id
          WHERE p.workflow_instance_id = $1
          ORDER BY p.procedure_ref`,
      [wi],
    );
    const risks = await client.query<{
      id: string;
      risk_ref: string;
      description: string;
      fs_area: string | null;
      source_key: string | null;
      is_significant: boolean;
      status: string;
    }>(
      `SELECT id, risk_ref, description, fs_area, source_key, is_significant, status
           FROM hsdg.audit_risks WHERE workflow_instance_id = $1 ORDER BY created_at`,
      [wi],
    );
    const exceptions = await client.query<{
      status: 'open' | 'resolved' | 'carried_forward';
      severity: 'low' | 'medium' | 'high';
      description: string;
      procedure_ref: string;
    }>(
      `SELECT x.status, x.severity, x.description, p.procedure_ref
           FROM hsdg.audit_exceptions x
           JOIN hsdg.audit_procedures p ON p.id = x.procedure_id
          WHERE x.workflow_instance_id = $1
          ORDER BY x.created_at`,
      [wi],
    );
    const mat = await client.query<{ om: string | null; pm: string | null; ctt: string | null }>(
      `SELECT selected_om::text AS om, selected_pm::text AS pm, selected_ctt::text AS ctt
           FROM hsdg.audit_materiality_determination
          WHERE workflow_instance_id = $1 ORDER BY version_no DESC LIMIT 1`,
      [wi],
    );
    const num = (v: string | null): number | null => (v == null ? null : Number(v));
    return {
      financialYear: eng.rows[0]?.financial_year ?? null,
      framework: new Map(
        fw.rows.map((r) => [r.area_key, { conclusion: r.conclusion, basis: r.basis }]),
      ),
      areas: areas.rows.map((a) => ({
        key: a.work_area_key,
        title: a.title,
        concluded: a.conclusion_state === 'submitted',
      })),
      procedures: procs.rows.map((p) => ({
        ref: p.procedure_ref,
        title: p.title,
        state: p.state,
        sourceKey: p.source_key,
        riskId: p.risk_id,
        workAreaKey: p.work_area_key,
        workAreaTitle: p.work_area_title,
      })),
      risks: risks.rows.map((r) => ({
        id: r.id,
        ref: r.risk_ref,
        description: r.description,
        fsArea: r.fs_area,
        sourceKey: r.source_key,
        isSignificant: r.is_significant,
        status: r.status,
      })),
      exceptions: exceptions.rows.map((x) => ({
        status: x.status,
        severity: x.severity,
        description: x.description,
        procedureRef: x.procedure_ref,
      })),
      materiality: mat.rows[0]
        ? { om: num(mat.rows[0].om), pm: num(mat.rows[0].pm), ctt: num(mat.rows[0].ctt) }
        : null,
    };
  }

  private async readCompletion(
    client: PoolClient,
    engagementId: string,
  ): Promise<StatutoryAuditCompletion[]> {
    const { rows: shells } = await client.query<ShellRow>(
      `SELECT wi.id, wi.engagement_service_id, wi.engagement_id, wi.status,
              wi.completion_approved_at, ca.full_name AS completion_approved_by_name,
              wi.completion_memo,
              wi.signed_off_at, sa.full_name AS signed_off_by_name, wi.signoff_memo,
              wi.archived_at, aa.full_name AS archived_by_name, wi.archive_note
         FROM hsdg.service_workflow_instances wi
         LEFT JOIN hsdg.employees ca ON ca.id = wi.completion_approved_by_employee_id
         LEFT JOIN hsdg.employees sa ON sa.id = wi.signed_off_by_employee_id
         LEFT JOIN hsdg.employees aa ON aa.id = wi.archived_by_employee_id
        WHERE wi.engagement_id = $1 AND wi.status <> 'cancelled'
        ORDER BY wi.created_at ASC`,
      [engagementId],
    );
    if (shells.length === 0) return [];
    const shellIds = shells.map((s) => s.id);

    const { rows: items } = await client.query<ItemRow>(
      `SELECT id, workflow_instance_id, section, item_key, title, state, note, version, updated_at,
              state_suggested, note_suggested
         FROM hsdg.audit_completion_items
        WHERE workflow_instance_id = ANY($1::uuid[])
        ORDER BY section ASC, sort_order ASC`,
      [shellIds],
    );

    // Blocking-note and open-area counts per shell — the derived §29 gate inputs.
    const { rows: blocking } = await client.query<{ workflow_instance_id: string; n: string }>(
      `SELECT workflow_instance_id, COUNT(*)::text AS n
         FROM hsdg.audit_review_notes
        WHERE workflow_instance_id = ANY($1::uuid[])
          AND is_blocking = true AND status IN ('open','responded')
        GROUP BY workflow_instance_id`,
      [shellIds],
    );
    const { rows: openAreas } = await client.query<{ workflow_instance_id: string; n: string }>(
      `SELECT workflow_instance_id, COUNT(*)::text AS n
         FROM hsdg.audit_work_areas
        WHERE workflow_instance_id = ANY($1::uuid[])
          AND is_active = true AND conclusion_state <> 'submitted'
        GROUP BY workflow_instance_id`,
      [shellIds],
    );
    const blockingByShell = new Map(blocking.map((b) => [b.workflow_instance_id, Number(b.n)]));
    const openAreasByShell = new Map(openAreas.map((a) => [a.workflow_instance_id, Number(a.n)]));

    const plans = new Map<string, Map<string, PlannedCompletionItem>>();
    const facts = new Map<string, CompletionFacts>();
    for (const shell of shells) {
      const f = await this.loadFacts(client, engagementId, shell.id);
      facts.set(shell.id, f);
      plans.set(shell.id, planCompletionItems(f));
    }
    const extras = new Map<string, SignOffExtras>();
    for (const shell of shells) {
      extras.set(shell.id, await this.loadSignOffExtras(client, engagementId, shell.id));
    }

    return shells.map((shell) => {
      const plan = plans.get(shell.id)!;
      const shellItems = items
        .filter((i) => i.workflow_instance_id === shell.id)
        .map((i) => mapItem(i, plan.get(i.item_key)));
      const gate: CompletionGate = {
        completionItemsResolved: sectionResolved(shellItems, 'completion'),
        reportingItemsResolved: sectionResolved(shellItems, 'reporting'),
        openBlockingNotes: blockingByShell.get(shell.id) ?? 0,
        areasOpen: openAreasByShell.get(shell.id) ?? 0,
        completionApproved: shell.completion_approved_at != null,
        signedOff: shell.signed_off_at != null,
        archived: shell.archived_at != null || shell.status === 'archived',
      };
      const signOffPack = planSignOff({
        ...facts.get(shell.id)!,
        ...extras.get(shell.id)!,
        items: shellItems,
        completionApprovedAt: shell.completion_approved_at,
        completionApprovedByName: shell.completion_approved_by_name,
      });
      return {
        workflowInstanceId: shell.id,
        engagementServiceId: shell.engagement_service_id,
        engagementId: shell.engagement_id,
        status: shell.status,
        items: shellItems,
        gate,
        completionApprovedAt: iso(shell.completion_approved_at),
        completionApprovedByName: shell.completion_approved_by_name,
        completionMemo: shell.completion_memo,
        signedOffAt: iso(shell.signed_off_at),
        signedOffByName: shell.signed_off_by_name,
        signoffMemo: shell.signoff_memo,
        archivedAt: iso(shell.archived_at),
        archivedByName: shell.archived_by_name,
        archiveNote: shell.archive_note,
        signOffPack,
      };
    });
  }

  /** What Section 09 reads beyond the completion facts, for one shell. */
  private async loadSignOffExtras(
    client: PoolClient,
    engagementId: string,
    wi: string,
  ): Promise<SignOffExtras> {
    const notes = await client.query<{ body: string; target_label: string | null }>(
      `SELECT n.body,
              COALESCE(p.procedure_ref || ' ' || p.title, a.title) AS target_label
         FROM hsdg.audit_review_notes n
         LEFT JOIN hsdg.audit_procedures p
                ON n.target_type = 'procedure' AND p.id = n.target_id
         LEFT JOIN hsdg.audit_work_areas a
                ON n.target_type = 'work_area' AND a.id = n.target_id
        WHERE n.workflow_instance_id = $1
          AND n.is_blocking AND n.status IN ('open','responded')
        ORDER BY n.created_at`,
      [wi],
    );
    const pbc = await client.query<{ outstanding: string; overdue: string }>(
      `SELECT COUNT(*)::text AS outstanding,
              COUNT(*) FILTER (WHERE due_date < current_date)::text AS overdue
         FROM hsdg.audit_pbc_items
        WHERE workflow_instance_id = $1 AND status = ANY($2::text[])`,
      [wi, PBC_OUTSTANDING_STATUSES],
    );
    const re = await client.query<{ change_type: string; reason: string }>(
      `SELECT change_type, reason FROM hsdg.audit_reassessments
        WHERE workflow_instance_id = $1 AND status = 'open' ORDER BY created_at`,
      [wi],
    );
    const partner = await client.query<{ full_name: string | null }>(
      `SELECT p.full_name FROM hsdg.engagements e
         LEFT JOIN hsdg.employees p ON p.id = e.engagement_partner_id
        WHERE e.id = $1`,
      [engagementId],
    );
    return {
      blockingNotes: notes.rows.map((n) => ({ body: n.body, targetLabel: n.target_label })),
      pbcOutstanding: Number(pbc.rows[0]?.outstanding ?? 0),
      pbcOverdue: Number(pbc.rows[0]?.overdue ?? 0),
      openReassessments: re.rows.map((r) => `${r.change_type.replace(/_/g, ' ')}: ${r.reason}`),
      engagementPartnerName: partner.rows[0]?.full_name ?? null,
    };
  }

  // ── Update a checklist item (§27.07/§27.08) ─────────────────────────────────

  async updateItem(
    ctx: RlsContext,
    engagementId: string,
    itemId: string,
    input: { state?: CompletionItemState; note?: string | null; version: number },
  ): Promise<StatutoryAuditCompletion> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ workflow_instance_id: string; archived: boolean }>(
        `SELECT ci.workflow_instance_id,
                (wi.archived_at IS NOT NULL OR wi.status = 'archived') AS archived
           FROM hsdg.audit_completion_items ci
           JOIN hsdg.service_workflow_instances wi ON wi.id = ci.workflow_instance_id
          WHERE ci.id = $1 AND ci.engagement_id = $2`,
        [itemId, engagementId],
      );
      if (!rows[0]) throw new NotFoundException('Completion item not found on this engagement.');
      if (rows[0].archived) throw new ConflictException('This audit file is archived and locked.');

      const params: unknown[] = [itemId, input.version];
      const sets: string[] = [];
      const set = (col: string, value: unknown): void => {
        params.push(value);
        sets.push(`${col} = $${params.length}`);
      };
      // Whatever a person sets is theirs — the file never re-drafts it.
      if (input.state !== undefined) {
        set('state', input.state);
        sets.push('state_suggested = false');
      }
      if (input.note !== undefined) {
        set('note', input.note?.trim() || null);
        sets.push('note_suggested = false');
      }
      if (sets.length === 0) {
        const [completion] = await this.readCompletion(client, engagementId);
        return completion!;
      }
      params.push(ctx.employeeId ?? null);
      sets.push(`updated_by_employee_id = $${params.length}`);
      const result = await client.query(
        `UPDATE hsdg.audit_completion_items
            SET ${sets.join(', ')}, content_updated_at = now(), version = version + 1
          WHERE id = $1 AND version = $2`,
        params,
      );
      this.assertRowChanged(result.rowCount, 'completion item');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.completion_item_updated',
        objectType: 'audit_completion_item',
        objectId: itemId,
        after: { state: input.state ?? null },
      });
      const [completion] = await this.readCompletion(client, engagementId);
      return completion!;
    });
  }

  // ── Approve Completion (§28) ────────────────────────────────────────────────

  /** Approve the Completion phase: gate satisfied, freeze it, unlock Reporting. */
  async approveCompletion(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { memo?: string | null },
  ): Promise<StatutoryAuditCompletion> {
    return this.db.withRlsContext(ctx, async (client) => {
      const gate = await this.loadGate(client, engagementId, workflowInstanceId);
      if (!canApproveCompletion(gate)) {
        throw new BadRequestException(
          'Completion cannot be approved yet: resolve every completion item and clear all blocking review notes (§28).',
        );
      }
      // Guarded write — concurrent approval loses the race (approved_at set once).
      const result = await client.query(
        `UPDATE hsdg.service_workflow_instances
            SET completion_approved_at = now(),
                completion_approved_by_employee_id = $2,
                completion_memo = $3
          WHERE id = $1 AND completion_approved_at IS NULL`,
        [
          workflowInstanceId,
          ctx.employeeId ?? null,
          input.memo?.trim() || (await this.memoItem(client, workflowInstanceId)),
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('Completion was approved concurrently; refresh and retry.');
      }
      // Phase 07 complete; unlock Phase 08 (Reporting) — §7 progressive unlock.
      await this.setPhase(client, workflowInstanceId, 'completion', 'complete');
      await this.unlockPhase(client, workflowInstanceId, 'reporting');
      // Section 09 starts: the sign-off pack is now what the partner works.
      await this.unlockPhase(client, workflowInstanceId, 'sign_off');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.completion_approved',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
      });
      return this.readOne(client, engagementId, workflowInstanceId);
    });
  }

  // ── Partner sign-off (§27.09, §29) ──────────────────────────────────────────

  async signOff(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { memo?: string | null },
  ): Promise<StatutoryAuditCompletion> {
    return this.db.withRlsContext(ctx, async (client) => {
      const shell = await this.loadShell(client, engagementId, workflowInstanceId);
      const gate = shell.gate;
      if (!canSignOff(gate)) {
        throw new BadRequestException(
          'Sign-off prerequisites are not met: completion must be approved, every reporting item resolved, all audit areas concluded, and no blocking review note open (§28, §29).',
        );
      }
      const result = await client.query(
        `UPDATE hsdg.service_workflow_instances
            SET signed_off_at = now(),
                signed_off_by_employee_id = $2,
                signoff_memo = $3,
                status = 'completed'
          WHERE id = $1 AND signed_off_at IS NULL`,
        [
          workflowInstanceId,
          ctx.employeeId ?? null,
          // No memo typed → the drafted Section 09 sign-off memo is recorded.
          input.memo?.trim() || shell.signOffPack.draftMemo,
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('The file was signed off concurrently; refresh and retry.');
      }
      // Phases 08/09 complete; unlock Phase 10 (Archiving).
      await this.setPhase(client, workflowInstanceId, 'reporting', 'complete');
      await this.setPhase(client, workflowInstanceId, 'sign_off', 'complete');
      await this.unlockPhase(client, workflowInstanceId, 'archiving');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.signed_off',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
      });
      return this.readOne(client, engagementId, workflowInstanceId);
    });
  }

  // ── Archive + lock (§27.10, §37) ────────────────────────────────────────────

  async archive(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    input: { note?: string | null },
  ): Promise<StatutoryAuditCompletion> {
    return this.db.withRlsContext(ctx, async (client) => {
      const gate = await this.loadGate(client, engagementId, workflowInstanceId);
      if (!canArchive(gate)) {
        throw new BadRequestException('Archive requires the file to be signed off first (§27.10).');
      }
      const result = await client.query(
        `UPDATE hsdg.service_workflow_instances
            SET archived_at = now(),
                archived_by_employee_id = $2,
                archive_note = $3,
                status = 'archived'
          WHERE id = $1 AND archived_at IS NULL`,
        [workflowInstanceId, ctx.employeeId ?? null, input.note?.trim() || null],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new ConflictException('The file was archived concurrently; refresh and retry.');
      }
      // Phase 10 complete — the file is now locked (§37).
      await this.setPhase(client, workflowInstanceId, 'archiving', 'complete');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.archived',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
      });
      return this.readOne(client, engagementId, workflowInstanceId);
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** The Completion Memo item's note — the default approval memo. */
  private async memoItem(client: PoolClient, workflowInstanceId: string): Promise<string | null> {
    const { rows } = await client.query<{ note: string | null }>(
      `SELECT note FROM hsdg.audit_completion_items
        WHERE workflow_instance_id = $1 AND item_key = 'completion_memo'`,
      [workflowInstanceId],
    );
    return rows[0]?.note?.trim() || null;
  }

  /** Load the §29 gate for one shell, asserting it exists on this engagement. */
  private async loadGate(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<CompletionGate> {
    return (await this.loadShell(client, engagementId, workflowInstanceId)).gate;
  }

  /** One shell's completion view, asserting it exists on this engagement. */
  private async loadShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditCompletion> {
    const all = await this.readCompletion(client, engagementId);
    const shell = all.find((c) => c.workflowInstanceId === workflowInstanceId);
    if (!shell) {
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
    }
    return shell;
  }

  /** Re-read the engagement and return the mutated shell (post-mutation view). */
  private async readOne(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditCompletion> {
    const all = await this.readCompletion(client, engagementId);
    const shell = all.find((c) => c.workflowInstanceId === workflowInstanceId);
    return shell ?? all[0]!;
  }

  private async setPhase(
    client: PoolClient,
    workflowInstanceId: string,
    phaseKey: string,
    state: string,
  ): Promise<void> {
    await client.query(
      `UPDATE hsdg.audit_workflow_phases
          SET state = $3
        WHERE workflow_instance_id = $1 AND phase_key = $2`,
      [workflowInstanceId, phaseKey, state],
    );
  }

  /** Lift a phase's lock only (locked → in_progress); never downgrade progress. */
  private async unlockPhase(
    client: PoolClient,
    workflowInstanceId: string,
    phaseKey: string,
  ): Promise<void> {
    await client.query(
      `UPDATE hsdg.audit_workflow_phases
          SET state = 'in_progress'
        WHERE workflow_instance_id = $1 AND phase_key = $2 AND state IN ('locked', 'not_started')`,
      [workflowInstanceId, phaseKey],
    );
  }

  private assertRowChanged(rowCount: number | null, what: string): void {
    if ((rowCount ?? 0) === 0) {
      throw new ConflictException(`This ${what} changed since you loaded it; refresh and retry.`);
    }
  }
}

function mapItem(r: ItemRow, plan: PlannedCompletionItem | undefined): AuditCompletionItem {
  return {
    id: r.id,
    section: r.section,
    itemKey: r.item_key,
    title: r.title,
    state: r.state,
    note: r.note,
    version: r.version,
    updatedAt: r.updated_at.toISOString(),
    stateSuggested: r.state_suggested,
    noteSuggested: r.note_suggested,
    evidence: plan?.evidence ?? { facts: [], suggestedState: r.state, ready: false, goTo: null },
  };
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}
