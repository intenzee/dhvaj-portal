import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  CARO_REPORT_CONTEXT,
  FRAMEWORK_AREA_KEY,
  SUB_SECTION_KEY,
  type AddCaroComponentInput,
  type CaroAnnexureDraft,
  type CaroApprovedResult,
  type CaroClauseConclusion,
  type CaroClauseEvidenceLink,
  type CaroClauseItem,
  type CaroClauseLibraryView,
  type CaroClauseProcedure,
  type CaroClauseReviewInput,
  type CaroComponent,
  type CaroComponentApplicable,
  type CaroFinding,
  type CaroFindingSeverity,
  type CaroLibraryClause,
  type CaroOrderVersion,
  type CaroPriorClause,
  type CaroPriorYearContext,
  type CaroProgrammeLevel1,
  type CaroProgrammeRecord,
  type CaroRelevance,
  type CaroReportContext,
  type CaroReportingSummary,
  type CaroReviewState,
  type CreateCaroFindingInput,
  type LinkCaroClauseEvidenceInput,
  type StatutoryAuditCaroProgramme,
  type UpdateCaroClauseInput,
  type UpdateCaroComponentInput,
  type UpdateCaroFindingInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { AuditCaroService } from './audit-caro.service';
import {
  approvalBlockers,
  buildAnnexure,
  clausesInForce,
  planClauseProcedures,
  planProgramme,
  scheduleIiiRequirementCodes,
  type PlannedClauseProcedure,
  summarise,
  workClauses,
  type ProgrammePlan,
} from './caro-programme';
import { isEngagementLead, readPriorAuditFile } from './master-facts';

/** The Section 06 work area every CARO clause procedure lives in. */
const CARO_WORK_AREA_KEY = 'caro';

/** 02.6 perimeter relationships whose entities are companies included in the CFS (3(xxi)). */
const CFS_COMPONENT_RELATIONSHIPS = new Set(['subsidiary', 'associate', 'joint_venture']);

const DIVISION: Record<string, string> = {
  division_i: 'I',
  division_ii: 'II',
  division_iii: 'III',
};

interface ProgrammeRow {
  id: string;
  order_version_id: string | null;
  order_code: string;
  order_title: string;
  order_version_label: string;
  period_start: string;
  status: 'active' | 'withdrawn';
  withdrawn_at: Date | null;
  withdrawn_reason: string | null;
  created_at: Date;
}

interface ItemRow {
  id: string;
  clause_code: string;
  parent_clause_code: string | null;
  clause_ref: string;
  parent_title: string | null;
  title: string;
  requirement: string;
  report_context: CaroReportContext;
  provision_code: string;
  guidance_provision_code: string | null;
  guidance_reference: string | null;
  relevance_hint: string | null;
  schedule_iii_keys: string[];
  audit_area_codes: string[];
  procedures: CaroClauseProcedure[];
  requires_partner_review: boolean;
  sort_order: number;
  relevance: CaroRelevance;
  relevance_reason: string | null;
  work_performed: string | null;
  management_response: string | null;
  draft_reporting: string | null;
  conclusion: CaroClauseConclusion | null;
  conclusion_note: string | null;
  review_state: CaroReviewState;
  return_note: string | null;
  submitted_by_name: string | null;
  submitted_at: Date | null;
  submitted_by_employee_id: string | null;
  approved_by_name: string | null;
  approved_at: Date | null;
  partner_reviewed_by_name: string | null;
  partner_reviewed_at: Date | null;
  procedure_id: string | null;
  procedure_ref: string | null;
  status: 'active' | 'withdrawn';
  version: number;
}

const ITEM_SELECT = `
  SELECT i.id, i.clause_code, i.parent_clause_code, i.clause_ref, i.parent_title, i.title,
         i.requirement, i.report_context, i.provision_code, i.guidance_provision_code,
         i.guidance_reference, i.relevance_hint, i.schedule_iii_keys, i.audit_area_codes,
         i.procedures, i.requires_partner_review, i.sort_order, i.relevance, i.relevance_reason,
         i.work_performed, i.management_response, i.draft_reporting, i.conclusion,
         i.conclusion_note, i.review_state, i.return_note,
         se.full_name AS submitted_by_name, i.submitted_at, i.submitted_by_employee_id,
         ae.full_name AS approved_by_name, i.approved_at,
         pe.full_name AS partner_reviewed_by_name, i.partner_reviewed_at,
         i.procedure_id, pr.procedure_ref, i.status, i.version
    FROM hsdg.audit_caro_clause_item i
    LEFT JOIN hsdg.employees se ON se.id = i.submitted_by_employee_id
    LEFT JOIN hsdg.employees ae ON ae.id = i.approved_by_employee_id
    LEFT JOIN hsdg.employees pe ON pe.id = i.partner_reviewed_by_employee_id
    LEFT JOIN hsdg.audit_procedures pr ON pr.id = i.procedure_id`;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const dateOnly = (d: string | Date) =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
const trimOrNull = (s: string | null | undefined) => (s == null ? null : s.trim() || null);

function stale(): ConflictException {
  return new ConflictException('This clause changed since you loaded it; refresh and retry.');
}

/**
 * 02.4 CARO 2020 — the Level-2 clause work programme (DHVAJ 02.4 spec §11–§15,
 * §18). Reads the approved 02.4 Level-1 result through
 * {@link AuditCaroService.readResultOn} (never the other way round), and on
 * read idempotently instantiates the clause library version in force for the
 * audit period — the standalone paragraph-3 items when CARO applies to the
 * standalone report, only clause 3(xxi) for the consolidated report — or
 * withdraws them when 02.4 later concludes CARO does not apply. Rows are never
 * deleted. The clause work (relevance, procedures, evidence links, findings,
 * management response, draft reporting, conclusion and its review) is stored
 * per item; approved conclusions build the draft CARO annexure.
 */
@Injectable()
export class AuditCaroProgrammeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly caro: AuditCaroService,
  ) {}

  // ── Read ───────────────────────────────────────────────────────────────

  async view(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      const plan = await this.ensureOn(client, ctx, engagementId, workflowInstanceId);
      return this.readView(client, engagementId, workflowInstanceId, plan);
    });
  }

  /** The library in force on a date (methodology view; spec §11). */
  async library(ctx: RlsContext, on: string): Promise<CaroClauseLibraryView> {
    return this.db.withRlsContext(ctx, async (client) => {
      const orderVersion = await this.orderVersionOn(client, on);
      const clauses = orderVersion
        ? clausesInForce(await this.loadLibrary(client, orderVersion.orderCode), on)
        : [];
      return { on, orderVersion, clauses };
    });
  }

  /** The draft CARO annexure per report context (spec §18 → Section 08 / completion). */
  async annexure(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<CaroReportingSummary> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      await this.ensureOn(client, ctx, engagementId, workflowInstanceId);
      return this.reportingOn(client, workflowInstanceId);
    });
  }

  /**
   * The draft annexure, inside the caller's transaction (completion / Section
   * 08 read it). Null per context when no live programme item exists for it.
   */
  async reportingOn(client: PoolClient, workflowInstanceId: string): Promise<CaroReportingSummary> {
    const programme = await this.loadProgramme(client, workflowInstanceId);
    if (!programme) return { standalone: null, consolidated: null };
    const { rows } = await client.query<ItemRow>(
      `${ITEM_SELECT} WHERE i.programme_id = $1 AND i.status = 'active'`,
      [programme.id],
    );
    const items = rows.map((r) => ({
      clauseCode: r.clause_code,
      clauseRef: r.clause_ref,
      title: r.title,
      reportContext: r.report_context,
      conclusion: r.conclusion,
      draftReporting: r.draft_reporting,
      reviewState: r.review_state,
      withdrawn: false,
      sortOrder: r.sort_order,
    }));
    const order = { title: programme.order_title, versionLabel: programme.order_version_label };
    const draft = (c: CaroReportContext): CaroAnnexureDraft | null =>
      items.some((i) => i.reportContext === c)
        ? buildAnnexure(workflowInstanceId, items, c, order)
        : null;
    return {
      standalone: draft(CARO_REPORT_CONTEXT.standalone),
      consolidated: draft(CARO_REPORT_CONTEXT.consolidated),
    };
  }

  // ── Section 06 (spec §18) ──────────────────────────────────────────────

  /**
   * The Section 06 procedures the clause programme calls for — one per live,
   * relevant clause — after bringing the programme in line with 02.4. Work
   * generation reads this in its own transaction.
   */
  async clauseProceduresOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<PlannedClauseProcedure[]> {
    await this.ensureOn(client, ctx, engagementId, workflowInstanceId);
    const { rows } = await client.query<ItemRow>(
      `${ITEM_SELECT} WHERE i.workflow_instance_id = $1 ORDER BY i.sort_order`,
      [workflowInstanceId],
    );
    return planClauseProcedures(
      rows.map((r) => ({
        clauseCode: r.clause_code,
        clauseRef: r.clause_ref,
        title: r.title,
        requirement: r.requirement,
        relevance: r.relevance,
        reportContext: r.report_context,
        procedures: r.procedures ?? [],
        withdrawn: r.status === 'withdrawn',
      })),
    );
  }

  /** Point each clause at the Section 06 procedure generated for it. */
  async linkProceduresOn(client: PoolClient, workflowInstanceId: string): Promise<void> {
    await client.query(
      `UPDATE hsdg.audit_caro_clause_item i
          SET procedure_id = p.id
         FROM hsdg.audit_procedures p
        WHERE i.workflow_instance_id = $1 AND i.procedure_id IS NULL
          AND p.workflow_instance_id = $1 AND p.source_key = 'caro:' || i.clause_code`,
      [workflowInstanceId],
    );
  }

  // ── Clause work (spec §13) ─────────────────────────────────────────────

  async updateClause(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    itemId: string,
    input: UpdateCaroClauseInput,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const item = await this.loadItem(client, workflowInstanceId, itemId);
      assertLive(item);
      if (item.review_state === 'approved' || item.review_state === 'submitted') {
        throw new ConflictException(
          item.review_state === 'approved'
            ? 'This clause conclusion is approved; reopen it before changing it.'
            : 'This clause is with the reviewer; it can change once returned.',
        );
      }
      const sets: string[] = [];
      const params: unknown[] = [item.id, input.version];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.relevance !== undefined) set('relevance', input.relevance);
      if (input.relevanceReason !== undefined)
        set('relevance_reason', trimOrNull(input.relevanceReason));
      if (input.workPerformed !== undefined) set('work_performed', trimOrNull(input.workPerformed));
      if (input.managementResponse !== undefined)
        set('management_response', trimOrNull(input.managementResponse));
      if (input.draftReporting !== undefined)
        set('draft_reporting', trimOrNull(input.draftReporting));
      if (input.conclusion !== undefined) set('conclusion', input.conclusion);
      if (input.conclusionNote !== undefined)
        set('conclusion_note', trimOrNull(input.conclusionNote));
      if (sets.length === 0) return;
      const res = await client.query(
        `UPDATE hsdg.audit_caro_clause_item
            SET ${sets.join(', ')}, version = version + 1
          WHERE id = $1 AND version = $2`,
        params,
      );
      if (res.rowCount === 0) throw stale();
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_clause_updated',
        objectType: 'audit_caro_clause_item',
        objectId: item.id,
        before: {
          relevance: item.relevance,
          conclusion: item.conclusion,
        },
        after: { clauseRef: item.clause_ref, ...stripVersion(input) },
      });
    });
  }

  async review(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    itemId: string,
    input: CaroClauseReviewInput,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const item = await this.loadItem(client, workflowInstanceId, itemId);
      assertLive(item);
      if (item.version !== input.version) throw stale();
      const blockers = await this.blockersFor(client, item, input.action === 'submit');
      let sql: string;
      const params: unknown[] = [item.id];
      const me = () => {
        params.push(ctx.employeeId ?? null);
        return `$${params.length}`;
      };
      switch (input.action) {
        case 'submit':
          if (item.review_state !== 'open' && item.review_state !== 'returned')
            throw new ConflictException('Only an open or returned clause can be submitted.');
          if (blockers.length) throw new BadRequestException(blockers.join(' '));
          sql = `review_state = 'submitted', submitted_by_employee_id = ${me()}, submitted_at = now(),
                 return_note = NULL`;
          break;
        case 'approve':
          if (item.review_state !== 'submitted')
            throw new ConflictException('Submit the clause conclusion for review first.');
          if (blockers.length) throw new BadRequestException(blockers.join(' '));
          sql = `review_state = 'approved', approved_by_employee_id = ${me()}, approved_at = now()`;
          break;
        case 'return':
          if (item.review_state !== 'submitted')
            throw new ConflictException('Only a submitted clause can be returned.');
          if (!trimOrNull(input.note))
            throw new BadRequestException('Say what needs to change when returning a clause.');
          params.push(trimOrNull(input.note));
          sql = `review_state = 'returned', return_note = $2`;
          break;
        case 'reopen':
          if (item.review_state !== 'approved')
            throw new ConflictException('Only an approved clause can be reopened.');
          // Controlled reopen: the approval falls away; the trail keeps it.
          sql = `review_state = 'open', approved_by_employee_id = NULL, approved_at = NULL,
                 partner_reviewed_by_employee_id = NULL, partner_reviewed_at = NULL`;
          break;
        case 'partner_review': {
          if (!item.requires_partner_review)
            throw new BadRequestException('This clause does not need Partner review.');
          const partner = await this.engagementPartner(client, engagementId);
          if (!ctx.employeeId || ctx.employeeId !== partner)
            throw new ForbiddenException(
              'Only the Engagement Partner can record the Partner review.',
            );
          if (item.review_state === 'approved')
            throw new ConflictException('This clause conclusion is already approved.');
          sql = `partner_reviewed_by_employee_id = ${me()}, partner_reviewed_at = now()`;
          break;
        }
        default:
          throw new BadRequestException('Unknown review action.');
      }
      await client.query(
        `UPDATE hsdg.audit_caro_clause_item SET ${sql}, version = version + 1 WHERE id = $1`,
        params,
      );
      await this.audit.recordWith(client, ctx, {
        action: `statutory_audit.caro_clause_${input.action}`,
        objectType: 'audit_caro_clause_item',
        objectId: item.id,
        before: { reviewState: item.review_state },
        after: {
          clauseRef: item.clause_ref,
          conclusion: item.conclusion,
          note: input.note ?? null,
        },
      });
    });
  }

  // ── Evidence: link existing, never re-upload (spec §13) ────────────────

  async linkEvidence(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    itemId: string,
    input: LinkCaroClauseEvidenceInput,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const item = await this.loadItem(client, workflowInstanceId, itemId);
      assertLive(item);
      assertNotApproved(item);
      if (!!input.documentId === !!input.auditEvidenceId)
        throw new BadRequestException('Link either an engagement document or an evidence record.');
      if (input.documentId) {
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2 AND deleted_at IS NULL`,
          [input.documentId, engagementId],
        );
        if (!rows[0]) throw new BadRequestException('That document is not on this engagement.');
      } else {
        const { rows } = await client.query(
          `SELECT 1 FROM hsdg.audit_evidence WHERE id = $1 AND workflow_instance_id = $2`,
          [input.auditEvidenceId, workflowInstanceId],
        );
        if (!rows[0]) throw new BadRequestException('That evidence is not in this audit file.');
      }
      try {
        await client.query(
          `INSERT INTO hsdg.audit_caro_clause_evidence
             (item_id, engagement_id, document_id, audit_evidence_id, note, linked_by_employee_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            item.id,
            engagementId,
            input.documentId ?? null,
            input.auditEvidenceId ?? null,
            trimOrNull(input.note),
            ctx.employeeId ?? null,
          ],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new ConflictException('That evidence is already linked to this clause.');
        throw err;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_evidence_linked',
        objectType: 'audit_caro_clause_item',
        objectId: item.id,
        after: {
          clauseRef: item.clause_ref,
          documentId: input.documentId ?? null,
          auditEvidenceId: input.auditEvidenceId ?? null,
        },
      });
    });
  }

  async unlinkEvidence(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    itemId: string,
    linkId: string,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const item = await this.loadItem(client, workflowInstanceId, itemId);
      assertNotApproved(item);
      const res = await client.query(
        `UPDATE hsdg.audit_caro_clause_evidence
            SET removed_at = now(), removed_by_employee_id = $3
          WHERE id = $1 AND item_id = $2 AND removed_at IS NULL`,
        [linkId, item.id, ctx.employeeId ?? null],
      );
      if (res.rowCount === 0) throw new NotFoundException('That evidence is not linked here.');
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_evidence_unlinked',
        objectType: 'audit_caro_clause_item',
        objectId: item.id,
        before: { linkId },
      });
    });
  }

  // ── Findings: created once, linked to clause, area and reporting ───────

  async createFinding(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    itemId: string,
    input: CreateCaroFindingInput,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const item = await this.loadItem(client, workflowInstanceId, itemId);
      assertLive(item);
      assertNotApproved(item);
      if (!input.description?.trim()) throw new BadRequestException('Describe the finding.');
      await this.assertFindingLinks(
        client,
        workflowInstanceId,
        input.workAreaKey,
        input.procedureId,
      );
      const { rows: seq } = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM hsdg.audit_caro_finding
          WHERE workflow_instance_id = $1`,
        [workflowInstanceId],
      );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.audit_caro_finding
           (item_id, workflow_instance_id, engagement_id, seq, description, severity,
            work_area_key, procedure_id, amount, include_in_report, management_response,
            raised_by_employee_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          item.id,
          workflowInstanceId,
          engagementId,
          seq[0]!.next,
          input.description.trim(),
          input.severity ?? 'medium',
          input.workAreaKey ?? CARO_WORK_AREA_KEY,
          input.procedureId ?? item.procedure_id,
          input.amount ?? null,
          input.includeInReport ?? true,
          trimOrNull(input.managementResponse),
          ctx.employeeId ?? null,
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_finding_created',
        objectType: 'audit_caro_finding',
        objectId: rows[0]!.id,
        after: { clauseRef: item.clause_ref, description: input.description.trim() },
      });
    });
  }

  async updateFinding(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    findingId: string,
    input: UpdateCaroFindingInput,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const { rows } = await client.query<{
        id: string;
        item_id: string;
        version: number;
        description: string;
        status: string;
      }>(
        `SELECT f.id, f.item_id, f.version, f.description, f.status
           FROM hsdg.audit_caro_finding f
          WHERE f.id = $1 AND f.workflow_instance_id = $2`,
        [findingId, workflowInstanceId],
      );
      const f = rows[0];
      if (!f) throw new NotFoundException('Finding not found in this audit file.');
      const item = await this.loadItem(client, workflowInstanceId, f.item_id);
      assertNotApproved(item);
      if (f.version !== input.version) throw stale();
      if (input.description !== undefined && !input.description.trim())
        throw new BadRequestException('Describe the finding.');
      if (input.status === 'resolved' && !trimOrNull(input.resolution))
        throw new BadRequestException('Record how the finding was resolved.');
      await this.assertFindingLinks(
        client,
        workflowInstanceId,
        input.workAreaKey,
        input.procedureId,
      );
      const sets: string[] = [];
      const params: unknown[] = [f.id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.description !== undefined) set('description', input.description.trim());
      if (input.severity !== undefined) set('severity', input.severity);
      if (input.workAreaKey !== undefined) set('work_area_key', input.workAreaKey);
      if (input.procedureId !== undefined) set('procedure_id', input.procedureId);
      if (input.amount !== undefined) set('amount', input.amount);
      if (input.includeInReport !== undefined) set('include_in_report', input.includeInReport);
      if (input.managementResponse !== undefined)
        set('management_response', trimOrNull(input.managementResponse));
      if (input.status !== undefined) set('status', input.status);
      if (input.resolution !== undefined) set('resolution', trimOrNull(input.resolution));
      if (sets.length === 0) return;
      await client.query(
        `UPDATE hsdg.audit_caro_finding SET ${sets.join(', ')}, version = version + 1 WHERE id = $1`,
        params,
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_finding_updated',
        objectType: 'audit_caro_finding',
        objectId: f.id,
        before: { description: f.description, status: f.status },
        after: stripVersion(input),
      });
    });
  }

  // ── Clause 3(xxi) components (spec §14) ────────────────────────────────

  async addComponent(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    itemId: string,
    input: AddCaroComponentInput,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const item = await this.loadItem(client, workflowInstanceId, itemId);
      assertLive(item);
      assertNotApproved(item);
      if (item.report_context !== CARO_REPORT_CONTEXT.consolidated)
        throw new BadRequestException('Components belong to the consolidated clause 3(xxi) only.');
      const name = input.componentName?.trim();
      if (!name) throw new BadRequestException('Name the company included in the CFS.');
      try {
        await client.query(
          `INSERT INTO hsdg.audit_caro_component
             (item_id, engagement_id, source, source_key, component_name, relationship, sort_order)
           VALUES ($1, $2, 'manual', $3, $4, $5,
                   (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM hsdg.audit_caro_component WHERE item_id = $1))`,
          [item.id, engagementId, componentKey(name), name, trimOrNull(input.relationship)],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new ConflictException('That company is already listed.');
        throw err;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_component_added',
        objectType: 'audit_caro_clause_item',
        objectId: item.id,
        after: { componentName: name },
      });
    });
  }

  async updateComponent(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    componentId: string,
    input: UpdateCaroComponentInput,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.mutate(ctx, engagementId, workflowInstanceId, async (client) => {
      const { rows } = await client.query<{ id: string; item_id: string; version: number }>(
        `SELECT c.id, c.item_id, c.version
           FROM hsdg.audit_caro_component c
           JOIN hsdg.audit_caro_clause_item i ON i.id = c.item_id
          WHERE c.id = $1 AND i.workflow_instance_id = $2`,
        [componentId, workflowInstanceId],
      );
      const c = rows[0];
      if (!c) throw new NotFoundException('Component not found in this audit file.');
      const item = await this.loadItem(client, workflowInstanceId, c.item_id);
      assertNotApproved(item);
      if (c.version !== input.version) throw stale();
      if (input.auditorReportDocumentId) {
        const { rows: d } = await client.query(
          `SELECT 1 FROM hsdg.documents WHERE id = $1 AND engagement_id = $2 AND deleted_at IS NULL`,
          [input.auditorReportDocumentId, engagementId],
        );
        if (!d[0]) throw new BadRequestException('That document is not on this engagement.');
      }
      const sets: string[] = [];
      const params: unknown[] = [c.id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.caroApplicable !== undefined) set('caro_applicable', input.caroApplicable);
      if (input.auditorName !== undefined) set('auditor_name', trimOrNull(input.auditorName));
      if (input.auditorReportDocumentId !== undefined)
        set('auditor_report_document_id', input.auditorReportDocumentId);
      if (input.qualificationIdentified !== undefined)
        set('qualification_identified', input.qualificationIdentified);
      if (input.paragraphRefs !== undefined) set('paragraph_refs', trimOrNull(input.paragraphRefs));
      if (input.remarks !== undefined) set('remarks', trimOrNull(input.remarks));
      if (sets.length === 0) return;
      await client.query(
        `UPDATE hsdg.audit_caro_component SET ${sets.join(', ')}, version = version + 1 WHERE id = $1`,
        params,
      );
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_component_updated',
        objectType: 'audit_caro_component',
        objectId: c.id,
        after: stripVersion(input),
      });
    });
  }

  // ── Instantiation (spec §11, §12, §14) ─────────────────────────────────

  /**
   * Bring the programme in line with the 02.4 Level-1 result: instantiate the
   * library version in force for the audit period, configure 3(xxi), withdraw
   * what is no longer required, sync the 3(xxi) components from 02.6 and
   * link the Section 06 procedure of each clause. Idempotent; only a lead
   * writes (RLS) — anyone else reads what exists.
   */
  async ensureOn(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<ProgrammePlan & { level1: CaroProgrammeLevel1 | null }> {
    const level1 = toLevel1(await this.caro.readResultOn(client, workflowInstanceId));
    const existing = await this.loadProgramme(client, workflowInstanceId);
    const periodStart = existing ? dateOnly(existing.period_start) : (level1?.periodStart ?? null);
    const orderVersion = periodStart ? await this.orderVersionOn(client, periodStart) : null;
    const plan = planProgramme(level1, existing, orderVersion !== null);
    if (!(await isEngagementLead(client, engagementId))) return { ...plan, level1 };

    const contexts: Array<[CaroReportContext, ProgrammePlan['standalone']]> = [
      [CARO_REPORT_CONTEXT.standalone, plan.standalone],
      [CARO_REPORT_CONTEXT.consolidated, plan.consolidated],
    ];
    let programmeId = existing?.id ?? null;
    const changes: Record<string, number> = {};

    if (contexts.some(([, a]) => a === 'ensure') && orderVersion && level1) {
      programmeId = await this.upsertProgramme(
        client,
        ctx,
        engagementId,
        workflowInstanceId,
        orderVersion,
        existing ? dateOnly(existing.period_start) : level1.periodStart,
      );
      const library = clausesInForce(
        await this.loadLibrary(client, orderVersion.orderCode),
        existing ? dateOnly(existing.period_start) : level1.periodStart,
      );
      for (const [context, action] of contexts) {
        if (action !== 'ensure') continue;
        changes[`${context}_ensured`] = await this.ensureItems(
          client,
          programmeId,
          engagementId,
          workflowInstanceId,
          workClauses(library, context),
        );
      }
    }
    if (programmeId) {
      for (const [context, action] of contexts) {
        if (action !== 'withdraw') continue;
        const res = await client.query(
          `UPDATE hsdg.audit_caro_clause_item
              SET status = 'withdrawn', withdrawn_at = now(), version = version + 1
            WHERE programme_id = $1 AND report_context = $2 AND status = 'active'`,
          [programmeId, context],
        );
        if (res.rowCount) changes[`${context}_withdrawn`] = res.rowCount;
      }
      const { rows: live } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM hsdg.audit_caro_clause_item
          WHERE programme_id = $1 AND status = 'active'`,
        [programmeId],
      );
      if (live[0]!.n === 0 && existing?.status === 'active' && plan.state === 'withdrawn') {
        await client.query(
          `UPDATE hsdg.audit_caro_programme
              SET status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = $2
            WHERE id = $1`,
          [programmeId, plan.reason],
        );
        changes.programme_withdrawn = 1;
      }
      await this.syncComponents(client, engagementId, workflowInstanceId, programmeId);
      await this.linkProceduresOn(client, workflowInstanceId);
    }
    const touched = Object.entries(changes).filter(([, n]) => n > 0);
    if (touched.length) {
      await this.audit.recordWith(client, ctx, {
        action: 'statutory_audit.caro_programme_synced',
        objectType: 'service_workflow_instance',
        objectId: workflowInstanceId,
        after: { ...Object.fromEntries(touched), state: plan.state, outcome: level1?.outcome },
      });
    }
    return { ...plan, level1 };
  }

  private async upsertProgramme(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    v: CaroOrderVersion,
    periodStart: string,
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO hsdg.audit_caro_programme
         (workflow_instance_id, engagement_id, order_version_id, order_code, order_title,
          order_version_label, period_start, instantiated_by_employee_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (workflow_instance_id) DO UPDATE
          SET status = 'active', withdrawn_at = NULL, withdrawn_reason = NULL
        WHERE hsdg.audit_caro_programme.status = 'withdrawn'
       RETURNING id`,
      [
        workflowInstanceId,
        engagementId,
        v.id,
        v.orderCode,
        v.title,
        v.versionLabel,
        periodStart,
        ctx.employeeId ?? null,
      ],
    );
    if (rows[0]) return rows[0].id;
    const existing = await this.loadProgramme(client, workflowInstanceId);
    return existing!.id;
  }

  /** Insert missing clause items; reactivate withdrawn ones. Returns rows touched. */
  private async ensureItems(
    client: PoolClient,
    programmeId: string,
    engagementId: string,
    workflowInstanceId: string,
    clauses: ReturnType<typeof workClauses>,
  ): Promise<number> {
    let touched = 0;
    for (const c of clauses) {
      const res = await client.query(
        `INSERT INTO hsdg.audit_caro_clause_item
           (programme_id, workflow_instance_id, engagement_id, library_clause_id, clause_code,
            parent_clause_code, clause_ref, parent_title, title, requirement, report_context,
            provision_code, guidance_provision_code, guidance_reference, relevance_hint,
            schedule_iii_keys, audit_area_codes, procedures, requires_partner_review, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (programme_id, clause_code) DO UPDATE
            SET status = 'active', withdrawn_at = NULL, version = audit_caro_clause_item.version + 1
          WHERE audit_caro_clause_item.status = 'withdrawn'`,
        [
          programmeId,
          workflowInstanceId,
          engagementId,
          c.id,
          c.clauseCode,
          c.parentClauseCode,
          c.clauseRef,
          c.parentTitle,
          c.title,
          c.requirement,
          c.reportContext,
          c.provisionCode,
          c.guidanceProvisionCode,
          c.guidanceReference,
          c.relevanceHint,
          c.scheduleIiiKeys,
          c.auditAreaCodes,
          JSON.stringify(c.procedures),
          c.requiresPartnerReview,
          c.sortOrder,
        ],
      );
      touched += res.rowCount ?? 0;
    }
    return touched;
  }

  /** 3(xxi): one row per company in the 02.6 perimeter (one source — no re-entry). */
  private async syncComponents(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    programmeId: string,
  ): Promise<void> {
    const { rows: items } = await client.query<{ id: string }>(
      `SELECT id FROM hsdg.audit_caro_clause_item
        WHERE programme_id = $1 AND report_context = 'consolidated' AND status = 'active'`,
      [programmeId],
    );
    if (!items[0]) return;
    const itemId = items[0].id;
    const { rows } = await client.query<{
      perimeter: Array<{ name: string; relationship: string; method: string }> | null;
    }>(
      `SELECT system_detail -> 'perimeter' AS perimeter
         FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
      [workflowInstanceId, SUB_SECTION_KEY.consolidation, FRAMEWORK_AREA_KEY.cfs],
    );
    const perimeter = (rows[0]?.perimeter ?? []).filter(
      (p) => p?.name?.trim() && CFS_COMPONENT_RELATIONSHIPS.has(p.relationship),
    );
    const keys: string[] = [];
    let order = 0;
    for (const p of perimeter) {
      const key = componentKey(p.name);
      keys.push(key);
      order += 1;
      await client.query(
        `INSERT INTO hsdg.audit_caro_component
           (item_id, engagement_id, source, source_key, component_name, relationship, sort_order)
         VALUES ($1, $2, '02.6', $3, $4, $5, $6)
         ON CONFLICT (item_id, source_key) DO UPDATE
            SET relationship = EXCLUDED.relationship, withdrawn_at = NULL
          WHERE audit_caro_component.source = '02.6'
            AND (audit_caro_component.withdrawn_at IS NOT NULL
                 OR audit_caro_component.relationship IS DISTINCT FROM EXCLUDED.relationship)`,
        [itemId, engagementId, key, p.name.trim(), p.relationship.replace(/_/g, ' '), order],
      );
    }
    await client.query(
      `UPDATE hsdg.audit_caro_component
          SET withdrawn_at = now()
        WHERE item_id = $1 AND source = '02.6' AND withdrawn_at IS NULL
          AND NOT (source_key = ANY($2::text[]))`,
      [itemId, keys],
    );
  }

  // ── View assembly ──────────────────────────────────────────────────────

  private async readView(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
    plan: ProgrammePlan & { level1: CaroProgrammeLevel1 | null },
  ): Promise<StatutoryAuditCaroProgramme> {
    const programme = await this.loadProgramme(client, workflowInstanceId);
    const readOnly = !(await isEngagementLead(client, engagementId));
    const orderVersion = programme?.order_version_id
      ? await this.orderVersionById(client, programme.order_version_id)
      : null;
    const items = programme ? await this.readItems(client, workflowInstanceId, programme.id) : [];
    // A withdrawn programme still shows its (withdrawn) items for the record.
    const show = (i: CaroClauseItem) => !i.withdrawn || programme?.status === 'withdrawn';
    const standalone = items.filter(
      (i) => i.reportContext === CARO_REPORT_CONTEXT.standalone && show(i),
    );
    const consolidated =
      items.find((i) => i.reportContext === CARO_REPORT_CONTEXT.consolidated && !i.withdrawn) ??
      null;
    return {
      workflowInstanceId,
      engagementId,
      state: programme && plan.state === 'awaiting_conclusion' ? programme.status : plan.state,
      reason: plan.reason,
      level1: plan.level1,
      programme: programme ? mapProgramme(programme) : null,
      orderVersion,
      standalone,
      consolidatedState: consolidated ? plan.consolidatedState : 'not_required',
      consolidated,
      summary: summarise(
        items.map((i) => ({
          relevance: i.relevance,
          conclusion: i.conclusion,
          reviewState: i.reviewState,
          withdrawn: i.withdrawn,
          openFindings: i.findings.filter((f) => f.status === 'open' && !f.withdrawn).length,
        })),
      ),
      priorYear: await this.priorYearContext(client, workflowInstanceId),
      readOnly,
    };
  }

  private async readItems(
    client: PoolClient,
    workflowInstanceId: string,
    programmeId: string,
  ): Promise<CaroClauseItem[]> {
    const { rows } = await client.query<ItemRow>(
      `${ITEM_SELECT} WHERE i.programme_id = $1 ORDER BY i.sort_order, i.clause_ref`,
      [programmeId],
    );
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [evidence, findings, components, areas, division, prior] = await Promise.all([
      this.readEvidence(client, ids),
      this.readFindings(client, ids),
      this.readComponents(client, ids),
      this.readWorkAreas(client, workflowInstanceId),
      this.readDivision(client, workflowInstanceId),
      this.readPriorClauses(client, workflowInstanceId),
    ]);
    const areaTitle = new Map(areas.map((a) => [a.work_area_key, a.title]));
    return rows.map((r) => {
      const itemFindings = (findings.get(r.id) ?? []).map((f) => ({
        ...f,
        clauseRef: r.clause_ref,
        workAreaTitle: f.workAreaKey ? (areaTitle.get(f.workAreaKey) ?? null) : null,
      }));
      const itemComponents = components.get(r.id) ?? [];
      const related = areas
        .filter(
          (a) =>
            a.work_area_key === CARO_WORK_AREA_KEY ||
            (a.origin_area_key != null && r.audit_area_codes.includes(a.origin_area_key)),
        )
        .map((a) => ({ workAreaKey: a.work_area_key, title: a.title }));
      return {
        id: r.id,
        clauseCode: r.clause_code,
        parentClauseCode: r.parent_clause_code,
        clauseRef: r.clause_ref,
        parentTitle: r.parent_title,
        title: r.title,
        requirement: r.requirement,
        reportContext: r.report_context,
        provisionCode: r.provision_code,
        guidanceProvisionCode: r.guidance_provision_code,
        guidanceReference: r.guidance_reference,
        relevanceHint: r.relevance_hint,
        scheduleIiiKeys: r.schedule_iii_keys,
        scheduleIiiRequirementCodes: scheduleIiiRequirementCodes(r.schedule_iii_keys, division),
        auditAreaCodes: r.audit_area_codes,
        relatedWorkAreas: related,
        procedures: r.procedures ?? [],
        requiresPartnerReview: r.requires_partner_review,
        relevance: r.relevance,
        relevanceReason: r.relevance_reason,
        workPerformed: r.work_performed,
        managementResponse: r.management_response,
        draftReporting: r.draft_reporting,
        conclusion: r.conclusion,
        conclusionNote: r.conclusion_note,
        reviewState: r.review_state,
        returnNote: r.return_note,
        submittedByName: r.submitted_by_name,
        submittedAt: iso(r.submitted_at),
        approvedByName: r.approved_by_name,
        approvedAt: iso(r.approved_at),
        partnerReviewedByName: r.partner_reviewed_by_name,
        partnerReviewedAt: iso(r.partner_reviewed_at),
        procedureId: r.procedure_id,
        procedureRef: r.procedure_ref,
        withdrawn: r.status === 'withdrawn',
        evidence: evidence.get(r.id) ?? [],
        findings: itemFindings,
        components: itemComponents,
        priorYear: prior?.get(r.clause_code) ?? null,
        approvalBlockers:
          r.review_state === 'approved'
            ? []
            : approvalBlockers({
                relevance: r.relevance,
                relevanceReason: r.relevance_reason,
                conclusion: r.conclusion,
                draftReporting: r.draft_reporting,
                requiresPartnerReview: r.requires_partner_review,
                partnerReviewed: r.partner_reviewed_at != null,
                findings: itemFindings,
                components: itemComponents,
              }),
        version: r.version,
      };
    });
  }

  private async readEvidence(
    client: PoolClient,
    itemIds: string[],
  ): Promise<Map<string, CaroClauseEvidenceLink[]>> {
    const { rows } = await client.query<{
      id: string;
      item_id: string;
      document_id: string | null;
      audit_evidence_id: string | null;
      title: string | null;
      filename: string | null;
      in_sharepoint: boolean | null;
      note: string | null;
      linked_by_name: string | null;
      linked_at: Date;
    }>(
      `SELECT l.id, l.item_id, COALESCE(l.document_id, ev.document_id) AS document_id,
              l.audit_evidence_id, COALESCE(d.title, ev.title) AS title, cv.filename,
              (d.m365_live_item_id IS NOT NULL) AS in_sharepoint, l.note,
              lb.full_name AS linked_by_name, l.linked_at
         FROM hsdg.audit_caro_clause_evidence l
         LEFT JOIN hsdg.audit_evidence ev ON ev.id = l.audit_evidence_id
         LEFT JOIN hsdg.documents d ON d.id = COALESCE(l.document_id, ev.document_id)
                                   AND d.deleted_at IS NULL
         LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
         LEFT JOIN hsdg.employees lb ON lb.id = l.linked_by_employee_id
        WHERE l.item_id = ANY($1::uuid[]) AND l.removed_at IS NULL
        ORDER BY l.linked_at`,
      [itemIds],
    );
    const out = new Map<string, CaroClauseEvidenceLink[]>();
    for (const r of rows) {
      const list = out.get(r.item_id) ?? [];
      list.push({
        id: r.id,
        documentId: r.document_id,
        auditEvidenceId: r.audit_evidence_id,
        title: r.title ?? 'Removed document',
        filename: r.filename,
        inSharePoint: r.in_sharepoint === true,
        note: r.note,
        linkedByName: r.linked_by_name,
        linkedAt: r.linked_at.toISOString(),
      });
      out.set(r.item_id, list);
    }
    return out;
  }

  private async readFindings(
    client: PoolClient,
    itemIds: string[],
  ): Promise<Map<string, Omit<CaroFinding, 'clauseRef' | 'workAreaTitle'>[]>> {
    const { rows } = await client.query<{
      id: string;
      item_id: string;
      seq: number;
      description: string;
      severity: CaroFindingSeverity;
      work_area_key: string | null;
      procedure_id: string | null;
      procedure_ref: string | null;
      amount: string | null;
      include_in_report: boolean;
      management_response: string | null;
      status: 'open' | 'resolved';
      resolution: string | null;
      raised_by_name: string | null;
      withdrawn_at: Date | null;
      created_at: Date;
      version: number;
    }>(
      `SELECT f.id, f.item_id, f.seq, f.description, f.severity, f.work_area_key, f.procedure_id,
              p.procedure_ref, f.amount, f.include_in_report, f.management_response, f.status,
              f.resolution, e.full_name AS raised_by_name, f.withdrawn_at, f.created_at, f.version
         FROM hsdg.audit_caro_finding f
         LEFT JOIN hsdg.audit_procedures p ON p.id = f.procedure_id
         LEFT JOIN hsdg.employees e ON e.id = f.raised_by_employee_id
        WHERE f.item_id = ANY($1::uuid[])
        ORDER BY f.seq`,
      [itemIds],
    );
    const out = new Map<string, Omit<CaroFinding, 'clauseRef' | 'workAreaTitle'>[]>();
    for (const r of rows) {
      const list = out.get(r.item_id) ?? [];
      list.push({
        id: r.id,
        code: `CF-${String(r.seq).padStart(3, '0')}`,
        itemId: r.item_id,
        description: r.description,
        severity: r.severity,
        workAreaKey: r.work_area_key,
        procedureId: r.procedure_id,
        procedureRef: r.procedure_ref,
        amount: r.amount == null ? null : Number(r.amount),
        includeInReport: r.include_in_report,
        managementResponse: r.management_response,
        status: r.status,
        resolution: r.resolution,
        raisedByName: r.raised_by_name,
        withdrawn: r.withdrawn_at != null,
        createdAt: r.created_at.toISOString(),
        version: r.version,
      });
      out.set(r.item_id, list);
    }
    return out;
  }

  private async readComponents(
    client: PoolClient,
    itemIds: string[],
  ): Promise<Map<string, CaroComponent[]>> {
    const { rows } = await client.query<{
      id: string;
      item_id: string;
      source: '02.6' | 'manual';
      component_name: string;
      relationship: string | null;
      caro_applicable: CaroComponentApplicable;
      auditor_name: string | null;
      auditor_report_document_id: string | null;
      auditor_report_title: string | null;
      qualification_identified: boolean | null;
      paragraph_refs: string | null;
      remarks: string | null;
      withdrawn_at: Date | null;
      version: number;
    }>(
      `SELECT c.id, c.item_id, c.source, c.component_name, c.relationship, c.caro_applicable,
              c.auditor_name, c.auditor_report_document_id, d.title AS auditor_report_title,
              c.qualification_identified, c.paragraph_refs, c.remarks, c.withdrawn_at, c.version
         FROM hsdg.audit_caro_component c
         LEFT JOIN hsdg.documents d ON d.id = c.auditor_report_document_id AND d.deleted_at IS NULL
        WHERE c.item_id = ANY($1::uuid[])
        ORDER BY (c.withdrawn_at IS NOT NULL), c.sort_order, c.component_name`,
      [itemIds],
    );
    const out = new Map<string, CaroComponent[]>();
    for (const r of rows) {
      const list = out.get(r.item_id) ?? [];
      list.push({
        id: r.id,
        source: r.source,
        componentName: r.component_name,
        relationship: r.relationship,
        caroApplicable: r.caro_applicable,
        auditorName: r.auditor_name,
        auditorReportDocumentId: r.auditor_report_document_id,
        auditorReportTitle: r.auditor_report_title,
        qualificationIdentified: r.qualification_identified,
        paragraphRefs: r.paragraph_refs,
        remarks: r.remarks,
        withdrawn: r.withdrawn_at != null,
        version: r.version,
      });
      out.set(r.item_id, list);
    }
    return out;
  }

  private async readWorkAreas(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<Array<{ work_area_key: string; title: string; origin_area_key: string | null }>> {
    const { rows } = await client.query<{
      work_area_key: string;
      title: string;
      origin_area_key: string | null;
    }>(
      `SELECT work_area_key, title, origin_area_key
         FROM hsdg.audit_work_areas WHERE workflow_instance_id = $1 AND is_active
        ORDER BY sort_order`,
      [workflowInstanceId],
    );
    return rows;
  }

  /** The Schedule III Division the 02.3 conclusion (else suggestion) routes to. */
  private async readDivision(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<string | null> {
    const { rows } = await client.query<{ outcome: string | null }>(
      `SELECT COALESCE(conclusion, system_outcome) AS outcome
         FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
      [workflowInstanceId, SUB_SECTION_KEY.scheduleIii, FRAMEWORK_AREA_KEY.scheduleIii],
    );
    return DIVISION[rows[0]?.outcome ?? ''] ?? null;
  }

  // ── Prior year (spec §15) — reference only, never auto-concluded ───────

  private async readPriorClauses(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<Map<string, CaroPriorClause> | null> {
    const prior = await readPriorAuditFile(client, workflowInstanceId);
    if (!prior) return null;
    const { rows } = await client.query<{
      clause_code: string;
      conclusion: CaroClauseConclusion | null;
      draft_reporting: string | null;
      review_state: string;
      findings: string[] | null;
    }>(
      `SELECT i.clause_code, i.conclusion, i.draft_reporting, i.review_state,
              ARRAY(SELECT f.description FROM hsdg.audit_caro_finding f
                     WHERE f.item_id = i.id AND f.withdrawn_at IS NULL ORDER BY f.seq) AS findings
         FROM hsdg.audit_caro_clause_item i
        WHERE i.workflow_instance_id = $1 AND i.status = 'active'`,
      [prior.workflowInstanceId],
    );
    return new Map(
      rows.map((r) => [
        r.clause_code,
        {
          financialYear: prior.financialYear,
          conclusion: r.conclusion,
          reportingLanguage: r.review_state === 'approved' ? r.draft_reporting : null,
          findings: r.findings ?? [],
        },
      ]),
    );
  }

  private async priorYearContext(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<CaroPriorYearContext | null> {
    const prior = await readPriorAuditFile(client, workflowInstanceId);
    if (!prior) return null;
    const { rows: sub } = await client.query<{ outcome: string | null }>(
      `SELECT COALESCE(conclusion, system_outcome) AS outcome
         FROM hsdg.audit_framework_subassessment
        WHERE workflow_instance_id = $1 AND sub_section_key = $2 AND area_key = $3`,
      [prior.workflowInstanceId, SUB_SECTION_KEY.caro, FRAMEWORK_AREA_KEY.caro],
    );
    const { rows } = await client.query<{
      clause_ref: string;
      title: string;
      draft_reporting: string | null;
      review_state: string;
    }>(
      `SELECT clause_ref, title, draft_reporting, review_state
         FROM hsdg.audit_caro_clause_item
        WHERE workflow_instance_id = $1 AND status = 'active' AND conclusion = 'reportable_matter'
        ORDER BY sort_order`,
      [prior.workflowInstanceId],
    );
    if (!sub[0] && rows.length === 0) return null;
    return {
      financialYear: prior.financialYear,
      applicability: sub[0]?.outcome ?? null,
      reportableClauses: rows.map((r) => ({
        clauseRef: r.clause_ref,
        title: r.title,
        reportingLanguage: r.review_state === 'approved' ? r.draft_reporting : null,
      })),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Run a change for a lead, then return the refreshed programme. */
  private async mutate(
    ctx: RlsContext,
    engagementId: string,
    workflowInstanceId: string,
    fn: (client: PoolClient) => Promise<void>,
  ): Promise<StatutoryAuditCaroProgramme> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.assertShell(client, engagementId, workflowInstanceId);
      if (!(await isEngagementLead(client, engagementId)))
        throw new ForbiddenException('Only the engagement leads can change the CARO programme.');
      await fn(client);
      const plan = await this.ensureOn(client, ctx, engagementId, workflowInstanceId);
      return this.readView(client, engagementId, workflowInstanceId, plan);
    });
  }

  private async blockersFor(client: PoolClient, item: ItemRow, forSubmit: boolean) {
    const [findings, components] = await Promise.all([
      this.readFindings(client, [item.id]),
      this.readComponents(client, [item.id]),
    ]);
    return approvalBlockers(
      {
        relevance: item.relevance,
        relevanceReason: item.relevance_reason,
        conclusion: item.conclusion,
        draftReporting: item.draft_reporting,
        requiresPartnerReview: item.requires_partner_review,
        partnerReviewed: item.partner_reviewed_at != null,
        findings: findings.get(item.id) ?? [],
        components: components.get(item.id) ?? [],
      },
      forSubmit,
    );
  }

  private async assertFindingLinks(
    client: PoolClient,
    workflowInstanceId: string,
    workAreaKey: string | null | undefined,
    procedureId: string | null | undefined,
  ): Promise<void> {
    if (workAreaKey) {
      const { rows } = await client.query(
        `SELECT 1 FROM hsdg.audit_work_areas WHERE workflow_instance_id = $1 AND work_area_key = $2`,
        [workflowInstanceId, workAreaKey],
      );
      // The CARO area may not be generated yet; any other key must exist.
      if (!rows[0] && workAreaKey !== CARO_WORK_AREA_KEY)
        throw new BadRequestException('That audit area is not in this audit file.');
    }
    if (procedureId) {
      const { rows } = await client.query(
        `SELECT 1 FROM hsdg.audit_procedures WHERE id = $1 AND workflow_instance_id = $2`,
        [procedureId, workflowInstanceId],
      );
      if (!rows[0]) throw new BadRequestException('That procedure is not in this audit file.');
    }
  }

  private async engagementPartner(
    client: PoolClient,
    engagementId: string,
  ): Promise<string | null> {
    const { rows } = await client.query<{ engagement_partner_id: string | null }>(
      `SELECT engagement_partner_id FROM hsdg.engagements WHERE id = $1`,
      [engagementId],
    );
    return rows[0]?.engagement_partner_id ?? null;
  }

  private async loadProgramme(
    client: PoolClient,
    workflowInstanceId: string,
  ): Promise<ProgrammeRow | null> {
    const { rows } = await client.query<ProgrammeRow>(
      `SELECT id, order_version_id, order_code, order_title, order_version_label,
              period_start::text AS period_start, status, withdrawn_at, withdrawn_reason, created_at
         FROM hsdg.audit_caro_programme WHERE workflow_instance_id = $1`,
      [workflowInstanceId],
    );
    return rows[0] ?? null;
  }

  private async loadItem(
    client: PoolClient,
    workflowInstanceId: string,
    itemId: string,
  ): Promise<ItemRow> {
    const { rows } = await client.query<ItemRow>(
      `${ITEM_SELECT} WHERE i.id = $1 AND i.workflow_instance_id = $2`,
      [itemId, workflowInstanceId],
    );
    if (!rows[0]) throw new NotFoundException('CARO clause not found in this audit file.');
    return rows[0];
  }

  private async orderVersionOn(client: PoolClient, on: string): Promise<CaroOrderVersion | null> {
    const { rows } = await client.query<OrderVersionRow>(
      `${ORDER_SELECT}
        WHERE effective_from <= $1::date AND (effective_to IS NULL OR effective_to >= $1::date)
        ORDER BY effective_from DESC LIMIT 1`,
      [on],
    );
    return rows[0] ? mapOrderVersion(rows[0]) : null;
  }

  private async orderVersionById(client: PoolClient, id: string): Promise<CaroOrderVersion | null> {
    const { rows } = await client.query<OrderVersionRow>(`${ORDER_SELECT} WHERE id = $1`, [id]);
    return rows[0] ? mapOrderVersion(rows[0]) : null;
  }

  private async loadLibrary(client: PoolClient, orderCode: string): Promise<CaroLibraryClause[]> {
    const { rows } = await client.query<{
      id: string;
      order_code: string;
      clause_code: string;
      parent_clause_code: string | null;
      clause_ref: string;
      title: string;
      requirement: string;
      report_context: CaroReportContext;
      provision_code: string;
      guidance_provision_code: string | null;
      guidance_reference: string | null;
      relevance_hint: string | null;
      schedule_iii_keys: string[];
      audit_area_codes: string[];
      procedures: CaroClauseProcedure[];
      requires_partner_review: boolean;
      sort_order: number;
      effective_from: string;
      effective_to: string | null;
    }>(
      `SELECT id, order_code, clause_code, parent_clause_code, clause_ref, title, requirement,
              report_context, provision_code, guidance_provision_code, guidance_reference,
              relevance_hint, schedule_iii_keys, audit_area_codes, procedures,
              requires_partner_review, sort_order,
              effective_from::text AS effective_from, effective_to::text AS effective_to
         FROM hsdg.caro_clause_library WHERE order_code = $1
        ORDER BY sort_order`,
      [orderCode],
    );
    return rows.map((r) => ({
      id: r.id,
      orderCode: r.order_code,
      clauseCode: r.clause_code,
      parentClauseCode: r.parent_clause_code,
      clauseRef: r.clause_ref,
      title: r.title,
      requirement: r.requirement,
      reportContext: r.report_context,
      provisionCode: r.provision_code,
      guidanceProvisionCode: r.guidance_provision_code,
      guidanceReference: r.guidance_reference,
      relevanceHint: r.relevance_hint,
      scheduleIiiKeys: r.schedule_iii_keys,
      auditAreaCodes: r.audit_area_codes,
      procedures: r.procedures ?? [],
      requiresPartnerReview: r.requires_partner_review,
      sortOrder: r.sort_order,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
    }));
  }

  private async assertShell(
    client: PoolClient,
    engagementId: string,
    workflowInstanceId: string,
  ): Promise<void> {
    const { rows } = await client.query(
      `SELECT 1 FROM hsdg.service_workflow_instances
        WHERE id = $1 AND engagement_id = $2 AND status <> 'cancelled'`,
      [workflowInstanceId, engagementId],
    );
    if (!rows[0])
      throw new NotFoundException('Statutory-audit workflow not found on this engagement.');
  }
}

interface OrderVersionRow {
  id: string;
  order_code: string;
  title: string;
  version_label: string;
  effective_from: string;
  effective_to: string | null;
  notification_reference: string | null;
  provision_code: string;
  applicability_provision_code: string | null;
  guidance_provision_code: string | null;
  guidance_version: string | null;
}

const ORDER_SELECT = `
  SELECT id, order_code, title, version_label, effective_from::text AS effective_from,
         effective_to::text AS effective_to, notification_reference, provision_code,
         applicability_provision_code, guidance_provision_code, guidance_version
    FROM hsdg.caro_order_version`;

function mapOrderVersion(r: OrderVersionRow): CaroOrderVersion {
  return {
    id: r.id,
    orderCode: r.order_code,
    title: r.title,
    versionLabel: r.version_label,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    notificationReference: r.notification_reference,
    provisionCode: r.provision_code,
    applicabilityProvisionCode: r.applicability_provision_code,
    guidanceProvisionCode: r.guidance_provision_code,
    guidanceVersion: r.guidance_version,
  };
}

function mapProgramme(p: ProgrammeRow): CaroProgrammeRecord {
  return {
    id: p.id,
    orderCode: p.order_code,
    orderTitle: p.order_title,
    orderVersionLabel: p.order_version_label,
    periodStart: dateOnly(p.period_start),
    status: p.status,
    withdrawnAt: iso(p.withdrawn_at),
    withdrawnReason: p.withdrawn_reason,
    instantiatedAt: p.created_at.toISOString(),
  };
}

/** The 02.4 approved result as the programme acts on it. */
export function toLevel1(r: CaroApprovedResult | null): CaroProgrammeLevel1 | null {
  if (!r) return null;
  return {
    outcome: r.outcome,
    decided: r.decided,
    complete: r.complete,
    standaloneApplies: r.standalone.applies,
    consolidatedApplies: r.consolidated.applies,
    consolidatedStatus: r.consolidated.status,
    cfsInScope: r.consolidated.cfsInScope,
    financialYear: r.financialYear,
    periodStart: r.periodStart,
  };
}

function componentKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function assertLive(item: { status: string }): void {
  if (item.status === 'withdrawn')
    throw new ConflictException(
      'This clause was withdrawn when CARO was concluded not applicable.',
    );
}

function assertNotApproved(item: { review_state: string }): void {
  if (item.review_state === 'approved')
    throw new ConflictException(
      'This clause conclusion is approved; reopen it before changing it.',
    );
}

function stripVersion<T extends { version?: number }>(input: T): Omit<T, 'version'> {
  const rest: Partial<T> = { ...input };
  delete rest.version;
  return rest as Omit<T, 'version'>;
}
