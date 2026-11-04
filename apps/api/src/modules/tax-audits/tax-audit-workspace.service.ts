import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  TAX_AUDIT_FACT_KEYS,
  TAX_AUDIT_INFO_ITEM_LABEL,
  TAX_AUDIT_INFO_ITEMS,
  TAX_AUDIT_PACKAGE_LABEL,
  TAX_AUDIT_PACKAGES,
  TAX_AUDIT_WORK_STAGES,
  TAX_AUDIT_WP_STATUSES,
  answerProblems,
  openingStatus,
  sendForReviewBlockers,
  type AddTaxAuditWpCommentInput,
  type MarkTaxAuditWorkingPaperNaInput,
  type RequestTaxAuditInformationInput,
  type ReviewTaxAuditWorkingPaperInput,
  type SaveTaxAuditFactsInput,
  type SaveTaxAuditWorkingPaperInput,
  type TaxAuditAnswer,
  type TaxAuditCondition,
  type TaxAuditDraftSource,
  type TaxAuditFacts,
  type TaxAuditGrade,
  type TaxAuditInfoItem,
  type TaxAuditPackage,
  type TaxAuditStage,
  type TaxAuditSubItem,
  type TaxAuditVersionInput,
  type TaxAuditWorkingPaper,
  type TaxAuditWorkspace,
  type TaxAuditWpStatus,
  type UploadTaxAuditWpEvidenceInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { istToday } from '../engagements/time/auto-time';
import { libraryVersionForYear } from './tax-audit-clause-library.service';

const LEAD_ONLY = 'Only the engagement’s partner or manager does this.';
const NOT_YOURS =
  'Only the person the package is given to, the clause’s preparer or the engagement’s partner or manager works this clause.';
/** Roles that review a clause someone else prepared (F-7 adds the full chain). */
const REVIEWER_ROLES = ['senior', 'manager', 'partner', 'managing_partner', 'admin'];
const GRADE_RANK: Record<TaxAuditGrade, number> = { article: 0, senior: 1, manager: 2 };

interface AuditRow {
  id: string;
  engagement_id: string;
  financial_year: string;
  stage: TaxAuditStage;
  compliance_instance_id: string | null;
  clause_library_version_id: string | null;
  facts: TaxAuditFacts;
  clause_work_opened_at: Date | null;
  version: number;
}

interface PaperRow {
  id: string;
  package_id: string;
  clause_no: string;
  part: 'A' | 'B';
  title: string;
  sub_items: TaxAuditSubItem[];
  applies_when: TaxAuditCondition | null;
  library_reason: string | null;
  evidence: string[];
  partner_review: boolean;
  status: TaxAuditWpStatus;
  not_applicable_source: 'condition' | 'person' | null;
  not_applicable_reason: string | null;
  answer: TaxAuditAnswer;
  preparer_employee_id: string | null;
  preparer_name: string | null;
  reviewer_name: string | null;
  draft_source: TaxAuditDraftSource | null;
  draft_answer: TaxAuditAnswer | null;
  draft_note: string | null;
  draft_confirmed_at: Date | null;
  draft_confirmed_by_name: string | null;
  sent_for_review_at: Date | null;
  done_at: Date | null;
  done_by_name: string | null;
  task_id: string | null;
  task_assignee_id: string | null;
  task_reviewer_id: string | null;
  version: number;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const blank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** The grade a package goes to: the highest any of its clauses needs. */
export function packageGrade(grades: readonly TaxAuditGrade[]): TaxAuditGrade {
  return grades.reduce<TaxAuditGrade>(
    (top, g) => (GRADE_RANK[g] > GRADE_RANK[top] ? g : top),
    'article',
  );
}

/** "Tax audit FY 2025-26 — TDS and TCS (cl. 34)". */
export function packageTaskTitle(
  financialYear: string,
  pkg: TaxAuditPackage,
  clauseNos: readonly string[],
): string {
  const list =
    clauseNos.length > 6 ? `${clauseNos.slice(0, 6).join(', ')} …` : clauseNos.join(', ');
  return `Tax audit FY ${financialYear} — ${TAX_AUDIT_PACKAGE_LABEL[pkg]} (cl. ${list})`;
}

/** Audit facts as sent: known keys only, true or false. */
export function factsProblems(facts: Record<string, unknown>): string[] {
  return Object.entries(facts).flatMap(([k, v]) =>
    !(TAX_AUDIT_FACT_KEYS as readonly string[]).includes(k)
      ? [`"${k}" is not an audit fact.`]
      : typeof v !== 'boolean'
        ? [`${k} must be true or false.`]
        : [],
  );
}

/** Fill the blank fields of an answer from the portal's draft. */
export function withDraft(answer: TaxAuditAnswer, draft: TaxAuditAnswer | null): TaxAuditAnswer {
  const out: TaxAuditAnswer = { ...(draft ?? {}) };
  for (const [k, v] of Object.entries(answer)) if (!blank(v)) out[k] = v;
  return out;
}

/**
 * Form 3CD clause workspace (Phase 4, F-5). The engagement's partner or
 * manager opens the 3CD work on the library version published for the year,
 * sets what the audit knows about the assessee and sends the client the
 * standard information list. Each package is a task given out through Assign
 * work (C-3) whose status follows its clauses (a trigger). Whoever it is given
 * to prepares its clauses — the answer, evidence, Not applicable with a
 * reason — and sends each for review. A
 * Senior or above (not the preparer) marks it done or sends it back.
 */
@Injectable()
export class TaxAuditWorkspaceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
  ) {}

  async get(ctx: RlsContext, engagementId: string, auditId: string): Promise<TaxAuditWorkspace> {
    return this.db.withRlsContext(ctx, (client) => this.view(client, ctx, engagementId, auditId));
  }

  /** Open the 3CD work: the year's library version, its packages as tasks, a paper a clause. */
  async open(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: TaxAuditVersionInput,
  ): Promise<TaxAuditWorkspace> {
    return this.db.withRlsContext(ctx, async (client) => {
      const a = await this.lead(client, engagementId, auditId, input.version);
      if (a.clause_work_opened_at) throw new ConflictException('The 3CD work is already open.');
      if (a.stage === 'not_started' || a.stage === 'acceptance') {
        throw new BadRequestException('Accept the audit first: the 3CD work follows acceptance.');
      }
      const lib = await libraryVersionForYear(client, a.financial_year);
      if (!lib) {
        throw new BadRequestException(
          `No Form 3CD library version is published for FY ${a.financial_year}.`,
        );
      }
      const { rows: clauses } = await client.query<{
        id: string;
        clause_no: string;
        applies_when: TaxAuditCondition | null;
        not_applicable_reason: string | null;
        default_package: TaxAuditPackage;
        default_grade: TaxAuditGrade;
      }>(
        `SELECT id, clause_no, applies_when, not_applicable_reason, default_package, default_grade
           FROM hsdg.tax_audit_clause_library WHERE library_version_id = $1
          ORDER BY sort_order, clause_no`,
        [lib.id],
      );
      const byPackage = new Map<TaxAuditPackage, typeof clauses>();
      for (const c of clauses) {
        byPackage.set(c.default_package, [...(byPackage.get(c.default_package) ?? []), c]);
      }
      for (const pkg of TAX_AUDIT_PACKAGES.filter((p) => byPackage.has(p))) {
        const list = byPackage.get(pkg)!;
        const nos = list.map((c) => c.clause_no);
        const {
          rows: [task],
        } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.tasks (engagement_id, title, description, created_by_employee_id)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [
            engagementId,
            packageTaskTitle(a.financial_year, pkg, nos),
            `Form 3CD clauses ${nos.join(', ')}. Work them in the tax audit's 3CD workspace.`,
            ctx.employeeId ?? null,
          ],
        );
        const {
          rows: [p],
        } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.tax_audit_clause_packages (tax_audit_id, engagement_id, package, grade, task_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [auditId, engagementId, pkg, packageGrade(list.map((c) => c.default_grade)), task!.id],
        );
        for (const c of list) {
          const na = openingStatus(c.applies_when, a.facts) === 'not_applicable';
          await client.query(
            `INSERT INTO hsdg.tax_audit_working_papers
               (tax_audit_id, engagement_id, package_id, library_clause_id, clause_no,
                status, not_applicable_source, not_applicable_reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              auditId,
              engagementId,
              p!.id,
              c.id,
              c.clause_no,
              na ? 'not_applicable' : 'not_started',
              na ? 'condition' : null,
              na ? c.not_applicable_reason : null,
            ],
          );
        }
      }
      await client.query(
        `UPDATE hsdg.tax_audits
            SET clause_library_version_id = $2, clause_work_opened_at = now(),
                stage = 'clause_work', version = version + 1
          WHERE id = $1`,
        [auditId, lib.id],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.clause_work_opened',
        objectType: 'tax_audit',
        objectId: auditId,
        after: { libraryVersionNo: lib.versionNo, clauses: clauses.length },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  /** What the audit knows about the assessee; clauses it rules out fall away (and back). */
  async saveFacts(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: SaveTaxAuditFactsInput,
  ): Promise<TaxAuditWorkspace> {
    const problems = factsProblems(input.facts as Record<string, unknown>);
    if (problems.length) throw new BadRequestException(problems);
    return this.db.withRlsContext(ctx, async (client) => {
      const a = await this.lead(client, engagementId, auditId, input.version);
      await client.query(
        `UPDATE hsdg.tax_audits SET facts = $2::jsonb, version = version + 1 WHERE id = $1`,
        [auditId, JSON.stringify(input.facts)],
      );
      const { rows } = await client.query<{
        id: string;
        status: TaxAuditWpStatus;
        package_id: string;
        applies_when: TaxAuditCondition | null;
        not_applicable_reason: string | null;
      }>(
        `SELECT w.id, w.status, w.package_id, c.applies_when, c.not_applicable_reason
           FROM hsdg.tax_audit_working_papers w
           JOIN hsdg.tax_audit_clause_library c ON c.id = w.library_clause_id
          WHERE w.tax_audit_id = $1
            AND (w.status = 'not_started'
                 OR (w.status = 'not_applicable' AND w.not_applicable_source = 'condition'))
          FOR UPDATE OF w`,
        [auditId],
      );
      let changed = 0;
      for (const w of rows) {
        const next = openingStatus(w.applies_when, input.facts);
        if (next === w.status) continue;
        const na = next === 'not_applicable';
        await client.query(
          `UPDATE hsdg.tax_audit_working_papers
              SET status = $2, not_applicable_source = $3, not_applicable_reason = $4,
                  version = version + 1
            WHERE id = $1`,
          [w.id, next, na ? 'condition' : null, na ? w.not_applicable_reason : null],
        );
        changed += 1;
      }
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.facts_saved',
        objectType: 'tax_audit',
        objectId: auditId,
        before: { facts: a.facts },
        after: { facts: input.facts, clausesChanged: changed },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  /** The standard list to the client, as client requests; items already asked are skipped. */
  async requestInformation(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: RequestTaxAuditInformationInput,
  ): Promise<TaxAuditWorkspace> {
    return this.db.withRlsContext(ctx, async (client) => {
      const a = await this.row(client, engagementId, auditId, true);
      if (!(await this.isLead(client, engagementId))) throw new ForbiddenException(LEAD_ONLY);
      if (!TAX_AUDIT_WORK_STAGES.includes(a.stage)) {
        throw new BadRequestException(
          a.stage === 'not_started' || a.stage === 'acceptance'
            ? 'Accept the audit first: the client is asked once the audit is accepted.'
            : 'The report is signed; the information list is closed.',
        );
      }
      const items = input.items?.length ? [...new Set(input.items)] : [...TAX_AUDIT_INFO_ITEMS];
      const today = istToday();
      const asked: TaxAuditInfoItem[] = [];
      for (const item of items) {
        const { rowCount } = await client.query(
          `INSERT INTO hsdg.client_dependencies
             (engagement_id, requested_info, responsible_employee_id, created_by_employee_id,
              request_date, reminder_date, escalation_date, tax_audit_id, tax_audit_item)
           VALUES ($1, $2, $3, $3, $4::date, $4::date + 7, $4::date + 14, $5, $6)
           ON CONFLICT (tax_audit_id, tax_audit_item) WHERE tax_audit_id IS NOT NULL DO NOTHING`,
          [
            engagementId,
            `${TAX_AUDIT_INFO_ITEM_LABEL[item]} — tax audit FY ${a.financial_year}`,
            ctx.employeeId ?? null,
            today,
            auditId,
            item,
          ],
        );
        if (rowCount) asked.push(item);
      }
      if (asked.length) {
        await this.audit.recordWith(client, ctx, {
          action: 'tax_audit.information_requested',
          objectType: 'tax_audit',
          objectId: auditId,
          after: { items: asked },
        });
      }
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  async saveAnswer(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    paperId: string,
    input: SaveTaxAuditWorkingPaperInput,
  ): Promise<TaxAuditWorkspace> {
    return this.db.withRlsContext(ctx, async (client) => {
      const w = await this.preparing(client, ctx, engagementId, auditId, paperId, input.version);
      const problems = answerProblems(w.sub_items, input.answer as Record<string, unknown>);
      if (problems.length) throw new BadRequestException(problems);
      await client.query(
        `UPDATE hsdg.tax_audit_working_papers
            SET answer = $2::jsonb, status = 'in_progress',
                preparer_employee_id = coalesce(preparer_employee_id, $3), version = version + 1
          WHERE id = $1`,
        [paperId, JSON.stringify(input.answer), ctx.employeeId ?? null],
      );
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  /** The portal's first draft becomes the answer (its blank fields); F-6 writes the drafts. */
  async confirmDraft(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    paperId: string,
    input: TaxAuditVersionInput,
  ): Promise<TaxAuditWorkspace> {
    return this.db.withRlsContext(ctx, async (client) => {
      const w = await this.preparing(client, ctx, engagementId, auditId, paperId, input.version);
      if (!w.draft_source || w.draft_confirmed_at) {
        throw new BadRequestException('This clause has no draft from the portal to confirm.');
      }
      await client.query(
        `UPDATE hsdg.tax_audit_working_papers
            SET answer = $2::jsonb, status = 'in_progress', draft_confirmed_at = now(),
                draft_confirmed_by_employee_id = $3,
                preparer_employee_id = coalesce(preparer_employee_id, $3), version = version + 1
          WHERE id = $1`,
        [paperId, JSON.stringify(withDraft(w.answer, w.draft_answer)), ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit_wp.draft_confirmed',
        objectType: 'tax_audit_working_paper',
        objectId: paperId,
        after: { clauseNo: w.clause_no, draftSource: w.draft_source },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  async markNotApplicable(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    paperId: string,
    input: MarkTaxAuditWorkingPaperNaInput,
  ): Promise<TaxAuditWorkspace> {
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('Say why the clause is Not applicable.');
    return this.db.withRlsContext(ctx, async (client) => {
      const w = await this.preparing(client, ctx, engagementId, auditId, paperId, input.version);
      await client.query(
        `UPDATE hsdg.tax_audit_working_papers
            SET status = 'not_applicable', not_applicable_source = 'person',
                not_applicable_reason = $2,
                preparer_employee_id = coalesce(preparer_employee_id, $3), version = version + 1
          WHERE id = $1`,
        [paperId, reason, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit_wp.not_applicable',
        objectType: 'tax_audit_working_paper',
        objectId: paperId,
        after: { clauseNo: w.clause_no, reason },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  /**
   * Back to work: a Not applicable clause (by its preparer), one in review
   * (withdrawn by its preparer) or one done (by the partner or manager).
   */
  async reopen(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    paperId: string,
    input: TaxAuditVersionInput,
  ): Promise<TaxAuditWorkspace> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { w, lead } = await this.paperFor(client, engagementId, auditId, paperId);
      this.checkVersion(w.version, input.version);
      if (w.status === 'done') {
        if (!lead)
          throw new ForbiddenException('Only the partner or manager reopens a done clause.');
      } else if (w.status === 'not_applicable' || w.status === 'in_review') {
        if (!this.canPrepare(ctx, lead, w)) throw new ForbiddenException(NOT_YOURS);
      } else {
        throw new BadRequestException('The clause is already open.');
      }
      const worked = Object.values(w.answer).some((v) => !blank(v));
      await client.query(
        `UPDATE hsdg.tax_audit_working_papers
            SET status = $2, not_applicable_source = NULL, not_applicable_reason = NULL,
                sent_for_review_at = NULL, done_at = NULL, done_by_employee_id = NULL,
                version = version + 1
          WHERE id = $1`,
        [paperId, worked ? 'in_progress' : 'not_started'],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit_wp.reopened',
        objectType: 'tax_audit_working_paper',
        objectId: paperId,
        before: { status: w.status },
        after: { clauseNo: w.clause_no },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  async sendForReview(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    paperId: string,
    input: TaxAuditVersionInput,
  ): Promise<TaxAuditWorkspace> {
    return this.db.withRlsContext(ctx, async (client) => {
      const w = await this.preparing(client, ctx, engagementId, auditId, paperId, input.version);
      const blockers = sendForReviewBlockers({
        subItems: w.sub_items,
        answer: w.answer,
        evidenceRequired: w.evidence,
        evidenceCount: await this.evidenceCount(client, paperId),
        draftSource: w.draft_source,
        draftConfirmedAt: iso(w.draft_confirmed_at),
      });
      if (blockers.length) throw new BadRequestException(blockers);
      await client.query(
        `UPDATE hsdg.tax_audit_working_papers
            SET status = 'in_review', sent_for_review_at = now(), reviewer_employee_id = $3,
                preparer_employee_id = coalesce(preparer_employee_id, $2), version = version + 1
          WHERE id = $1`,
        [paperId, ctx.employeeId ?? null, w.task_reviewer_id],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit_wp.sent_for_review',
        objectType: 'tax_audit_working_paper',
        objectId: paperId,
        after: { clauseNo: w.clause_no },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  async review(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    paperId: string,
    input: ReviewTaxAuditWorkingPaperInput,
  ): Promise<TaxAuditWorkspace> {
    const comment = input.comment?.trim() ?? '';
    if (input.outcome === 'send_back' && !comment) {
      throw new BadRequestException('Say what to change when sending a clause back.');
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const { a, w, lead } = await this.paperFor(client, engagementId, auditId, paperId);
      this.requireWorkOpen(a);
      this.checkVersion(w.version, input.version);
      if (!this.canReview(ctx, lead, w)) {
        throw new ForbiddenException(
          'A Senior or above who did not prepare the clause reviews it.',
        );
      }
      if (w.status !== 'in_review') throw new BadRequestException('The clause is not in review.');
      if (input.outcome === 'done') {
        await client.query(
          `UPDATE hsdg.tax_audit_working_papers
              SET status = 'done', done_at = now(), done_by_employee_id = $2,
                  reviewer_employee_id = $2, version = version + 1
            WHERE id = $1`,
          [paperId, ctx.employeeId ?? null],
        );
      } else {
        await client.query(
          `UPDATE hsdg.tax_audit_working_papers
              SET status = 'in_progress', sent_for_review_at = NULL, reviewer_employee_id = $2,
                  version = version + 1
            WHERE id = $1`,
          [paperId, ctx.employeeId ?? null],
        );
      }
      if (comment) await this.insertComment(client, ctx, engagementId, paperId, comment);
      await this.audit.recordWith(client, ctx, {
        action: input.outcome === 'done' ? 'tax_audit_wp.reviewed' : 'tax_audit_wp.sent_back',
        objectType: 'tax_audit_working_paper',
        objectId: paperId,
        after: { clauseNo: w.clause_no, comment: comment || null },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  async addComment(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    paperId: string,
    input: AddTaxAuditWpCommentInput,
  ): Promise<TaxAuditWorkspace> {
    const body = input.body.trim();
    if (!body) throw new BadRequestException('Write the comment.');
    return this.db.withRlsContext(ctx, async (client) => {
      const { a } = await this.paperFor(client, engagementId, auditId, paperId);
      this.requireWorkOpen(a);
      await this.insertComment(client, ctx, engagementId, paperId, body);
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  /** Evidence is filed in the engagement's documents, under the package's task. */
  async addEvidence(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    paperId: string,
    input: UploadTaxAuditWpEvidenceInput,
  ): Promise<TaxAuditWorkspace> {
    const { a, w } = await this.db.withRlsContext(ctx, async (client) => {
      const found = await this.paperFor(client, engagementId, auditId, paperId);
      this.requirePreparing(ctx, found);
      return found;
    });
    const doc = await this.documents.create(ctx, engagementId, {
      title: `Form 3CD cl. ${w.clause_no} — FY ${a.financial_year} — ${input.filename}`,
      filename: input.filename,
      contentType: input.contentType,
      contentBase64: input.contentBase64,
      taskId: w.task_id,
      // The team files a filing's papers; the tax audit's filing carries its evidence.
      complianceInstanceId: a.compliance_instance_id,
      documentType: 'evidence',
      classification: 'confidential',
    });
    return this.db.withRlsContext(ctx, async (client) => {
      const found = await this.paperFor(client, engagementId, auditId, paperId);
      this.requirePreparing(ctx, found);
      await client.query(
        `INSERT INTO hsdg.tax_audit_working_paper_documents
           (working_paper_id, document_id, engagement_id, added_by_employee_id)
         VALUES ($1, $2, $3, $4)`,
        [paperId, doc.id, engagementId, ctx.employeeId ?? null],
      );
      await client.query(
        `UPDATE hsdg.tax_audit_working_papers
            SET status = 'in_progress', version = version + 1,
                preparer_employee_id = coalesce(preparer_employee_id, $2)
          WHERE id = $1 AND status = 'not_started'`,
        [paperId, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit_wp.evidence_added',
        objectType: 'tax_audit_working_paper',
        objectId: paperId,
        after: { clauseNo: w.clause_no, documentId: doc.id },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  /** Takes the file off the clause; it stays in the engagement's documents. */
  async removeEvidence(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    paperId: string,
    documentId: string,
  ): Promise<TaxAuditWorkspace> {
    return this.db.withRlsContext(ctx, async (client) => {
      const found = await this.paperFor(client, engagementId, auditId, paperId);
      this.requirePreparing(ctx, found);
      const { rowCount } = await client.query(
        `DELETE FROM hsdg.tax_audit_working_paper_documents
          WHERE working_paper_id = $1 AND document_id = $2`,
        [paperId, documentId],
      );
      if (!rowCount) throw new NotFoundException('That file is not on this clause.');
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit_wp.evidence_removed',
        objectType: 'tax_audit_working_paper',
        objectId: paperId,
        before: { documentId },
      });
      return this.view(client, ctx, engagementId, auditId);
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async row(
    client: PoolClient,
    engagementId: string,
    auditId: string,
    lock = false,
  ): Promise<AuditRow> {
    const { rows } = await client.query<AuditRow>(
      `SELECT id, engagement_id, financial_year, stage, compliance_instance_id,
              clause_library_version_id, facts, clause_work_opened_at, version
         FROM hsdg.tax_audits WHERE id = $1 AND engagement_id = $2${lock ? ' FOR UPDATE' : ''}`,
      [auditId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Tax audit not found.');
    return rows[0];
  }

  /** The audit, locked, for the lead's change while the 3CD work can still change. */
  private async lead(
    client: PoolClient,
    engagementId: string,
    auditId: string,
    version: number,
  ): Promise<AuditRow> {
    const a = await this.row(client, engagementId, auditId, true);
    if (!(await this.isLead(client, engagementId))) throw new ForbiddenException(LEAD_ONLY);
    if (a.stage === 'not_applicable' || this.signed(a.stage)) {
      throw new BadRequestException(
        a.stage === 'not_applicable'
          ? 'The audit is Not applicable this year.'
          : 'The report is signed; the 3CD work is closed.',
      );
    }
    this.checkVersion(a.version, version);
    return a;
  }

  private signed(stage: TaxAuditStage): boolean {
    return ['signed', 'uploaded', 'client_accepted', 'filed'].includes(stage);
  }

  private requireWorkOpen(a: AuditRow): void {
    if (!a.clause_work_opened_at) throw new BadRequestException('The 3CD work is not open yet.');
    if (!TAX_AUDIT_WORK_STAGES.includes(a.stage)) {
      throw new BadRequestException('The report is signed; the 3CD work is closed.');
    }
  }

  private checkVersion(actual: number, sent: number): void {
    if (actual !== sent) {
      throw new ConflictException('Someone else changed this meanwhile. Reload and try again.');
    }
  }

  private async isLead(client: PoolClient, engagementId: string): Promise<boolean> {
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT hsdg.is_engagement_lead($1) AS ok`,
      [engagementId],
    );
    return rows[0]?.ok === true;
  }

  private canPrepare(ctx: RlsContext, lead: boolean, w: PaperRow): boolean {
    const me = ctx.employeeId;
    return lead || (!!me && (w.task_assignee_id === me || w.preparer_employee_id === me));
  }

  private canReview(ctx: RlsContext, lead: boolean, w: PaperRow): boolean {
    const me = ctx.employeeId;
    if (!me || w.preparer_employee_id === me) return false;
    return lead || w.task_reviewer_id === me || REVIEWER_ROLES.includes(ctx.role);
  }

  private async paperFor(
    client: PoolClient,
    engagementId: string,
    auditId: string,
    paperId: string,
  ): Promise<{ a: AuditRow; w: PaperRow; lead: boolean }> {
    const a = await this.row(client, engagementId, auditId);
    const [w] = await this.papers(client, auditId, paperId);
    if (!w) throw new NotFoundException('Working paper not found.');
    return { a, w, lead: await this.isLead(client, engagementId) };
  }

  private requirePreparing(
    ctx: RlsContext,
    { a, w, lead }: { a: AuditRow; w: PaperRow; lead: boolean },
  ): void {
    this.requireWorkOpen(a);
    if (!this.canPrepare(ctx, lead, w)) throw new ForbiddenException(NOT_YOURS);
    if (w.status !== 'not_started' && w.status !== 'in_progress') {
      throw new BadRequestException(
        w.status === 'in_review'
          ? 'The clause is in review; withdraw it to change it.'
          : w.status === 'done'
            ? 'The clause is done; the partner or manager reopens it.'
            : 'The clause is Not applicable; reopen it to work it.',
      );
    }
  }

  /** The paper, locked, for its preparer's change at the version they read. */
  private async preparing(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    paperId: string,
    version: number,
  ): Promise<PaperRow> {
    const found = await this.paperFor(client, engagementId, auditId, paperId);
    this.requirePreparing(ctx, found);
    this.checkVersion(found.w.version, version);
    return found.w;
  }

  private async evidenceCount(client: PoolClient, paperId: string): Promise<number> {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hsdg.tax_audit_working_paper_documents l
         JOIN hsdg.documents d ON d.id = l.document_id AND d.deleted_at IS NULL
        WHERE l.working_paper_id = $1`,
      [paperId],
    );
    return rows[0]?.n ?? 0;
  }

  private async insertComment(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    paperId: string,
    body: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO hsdg.tax_audit_working_paper_comments
         (working_paper_id, engagement_id, author_employee_id, body)
       VALUES ($1, $2, $3, $4)`,
      [paperId, engagementId, ctx.employeeId ?? null, body],
    );
  }

  private async papers(client: PoolClient, auditId: string, paperId?: string): Promise<PaperRow[]> {
    const { rows } = await client.query<PaperRow>(
      `SELECT w.id, w.package_id, w.clause_no, c.part, c.title, c.sub_items, c.applies_when,
              c.not_applicable_reason AS library_reason, c.evidence, c.partner_review,
              w.status, w.not_applicable_source, w.not_applicable_reason, w.answer,
              w.preparer_employee_id, pe.full_name AS preparer_name, re.full_name AS reviewer_name,
              w.draft_source, w.draft_answer, w.draft_note, w.draft_confirmed_at,
              dc.full_name AS draft_confirmed_by_name, w.sent_for_review_at, w.done_at,
              de.full_name AS done_by_name, p.task_id,
              t.assigned_to_employee_id AS task_assignee_id,
              t.reviewer_employee_id AS task_reviewer_id, w.version
         FROM hsdg.tax_audit_working_papers w
         JOIN hsdg.tax_audit_clause_library c ON c.id = w.library_clause_id
         JOIN hsdg.tax_audit_clause_packages p ON p.id = w.package_id
         LEFT JOIN hsdg.tasks t ON t.id = p.task_id
         LEFT JOIN hsdg.employees pe ON pe.id = w.preparer_employee_id
         LEFT JOIN hsdg.employees re ON re.id = w.reviewer_employee_id
         LEFT JOIN hsdg.employees dc ON dc.id = w.draft_confirmed_by_employee_id
         LEFT JOIN hsdg.employees de ON de.id = w.done_by_employee_id
        WHERE w.tax_audit_id = $1 ${paperId ? 'AND w.id = $2' : ''}
        ORDER BY c.sort_order, w.clause_no`,
      paperId ? [auditId, paperId] : [auditId],
    );
    return rows;
  }

  private async view(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
  ): Promise<TaxAuditWorkspace> {
    const a = await this.row(client, engagementId, auditId);
    const lead = await this.isLead(client, engagementId);
    const editable = TAX_AUDIT_WORK_STAGES.includes(a.stage) && !!a.clause_work_opened_at;
    const papers = await this.papers(client, auditId);
    const ids = papers.map((p) => p.id);

    const { rows: docs } = await client.query<{
      working_paper_id: string;
      document_id: string;
      title: string;
      added_by_name: string | null;
      added_at: Date;
    }>(
      `SELECT l.working_paper_id, l.document_id, d.title, e.full_name AS added_by_name, l.added_at
         FROM hsdg.tax_audit_working_paper_documents l
         JOIN hsdg.documents d ON d.id = l.document_id AND d.deleted_at IS NULL
         LEFT JOIN hsdg.employees e ON e.id = l.added_by_employee_id
        WHERE l.working_paper_id = ANY($1::uuid[]) ORDER BY l.added_at`,
      [ids],
    );
    const { rows: comments } = await client.query<{
      id: string;
      working_paper_id: string;
      author_name: string | null;
      body: string;
      created_at: Date;
    }>(
      `SELECT c.id, c.working_paper_id, e.full_name AS author_name, c.body, c.created_at
         FROM hsdg.tax_audit_working_paper_comments c
         LEFT JOIN hsdg.employees e ON e.id = c.author_employee_id
        WHERE c.working_paper_id = ANY($1::uuid[]) ORDER BY c.created_at`,
      [ids],
    );
    const { rows: packages } = await client.query<{
      id: string;
      package: TaxAuditPackage;
      grade: TaxAuditGrade;
      task_id: string | null;
      task_status: string | null;
      assignee_id: string | null;
      assignee_name: string | null;
    }>(
      `SELECT p.id, p.package, p.grade, p.task_id, t.status AS task_status,
              t.assigned_to_employee_id AS assignee_id, e.full_name AS assignee_name
         FROM hsdg.tax_audit_clause_packages p
         LEFT JOIN hsdg.tasks t ON t.id = p.task_id
         LEFT JOIN hsdg.employees e ON e.id = t.assigned_to_employee_id
        WHERE p.tax_audit_id = $1
        ORDER BY array_position($2::text[], p.package)`,
      [auditId, [...TAX_AUDIT_PACKAGES]],
    );
    const { rows: requests } = await client.query<{
      id: string;
      tax_audit_item: TaxAuditInfoItem;
      status: string;
      request_date: string;
      reminder_date: string | null;
      received_date: string | null;
      documents: number;
    }>(
      `SELECT cd.id, cd.tax_audit_item, cd.status, cd.request_date::text,
              cd.reminder_date::text, cd.received_date::text,
              (SELECT count(*)::int FROM hsdg.documents d
                WHERE d.client_dependency_id = cd.id AND d.deleted_at IS NULL) AS documents
         FROM hsdg.client_dependencies cd
        WHERE cd.tax_audit_id = $1
        ORDER BY array_position($2::text[], cd.tax_audit_item)`,
      [auditId, [...TAX_AUDIT_INFO_ITEMS]],
    );
    const { rows: lib } = await client.query<{ version_no: number; label: string; act: string }>(
      `SELECT version_no, label, act FROM hsdg.tax_audit_clause_library_versions WHERE id = $1`,
      [a.clause_library_version_id],
    );

    const out: TaxAuditWorkingPaper[] = papers.map((w) => {
      const documents = docs
        .filter((d) => d.working_paper_id === w.id)
        .map((d) => ({
          documentId: d.document_id,
          title: d.title,
          addedByName: d.added_by_name,
          addedAt: d.added_at.toISOString(),
        }));
      const open = w.status === 'not_started' || w.status === 'in_progress';
      return {
        id: w.id,
        packageId: w.package_id,
        clauseNo: w.clause_no,
        part: w.part,
        title: w.title,
        subItems: w.sub_items,
        appliesWhen: w.applies_when,
        evidenceRequired: w.evidence,
        partnerReview: w.partner_review,
        status: w.status,
        notApplicableSource: w.not_applicable_source,
        notApplicableReason: w.not_applicable_reason,
        answer: w.answer,
        preparerId: w.preparer_employee_id,
        preparerName: w.preparer_name,
        reviewerName: w.reviewer_name,
        draftSource: w.draft_source,
        draftAnswer: w.draft_answer,
        draftNote: w.draft_note,
        draftConfirmedAt: iso(w.draft_confirmed_at),
        draftConfirmedByName: w.draft_confirmed_by_name,
        sentForReviewAt: iso(w.sent_for_review_at),
        doneAt: iso(w.done_at),
        doneByName: w.done_by_name,
        documents,
        comments: comments
          .filter((c) => c.working_paper_id === w.id)
          .map((c) => ({
            id: c.id,
            authorName: c.author_name,
            body: c.body,
            createdAt: c.created_at.toISOString(),
          })),
        blockers: open
          ? sendForReviewBlockers({
              subItems: w.sub_items,
              answer: w.answer,
              evidenceRequired: w.evidence,
              evidenceCount: documents.length,
              draftSource: w.draft_source,
              draftConfirmedAt: iso(w.draft_confirmed_at),
            })
          : [],
        canPrepare: editable && this.canPrepare(ctx, lead, w),
        canReview: editable && w.status === 'in_review' && this.canReview(ctx, lead, w),
        version: w.version,
      };
    });

    return {
      auditId: a.id,
      engagementId: a.engagement_id,
      financialYear: a.financial_year,
      stage: a.stage,
      library: lib[0]
        ? { versionNo: lib[0].version_no, label: lib[0].label, act: lib[0].act }
        : null,
      facts: a.facts,
      openedAt: iso(a.clause_work_opened_at),
      packages: packages.map((p) => {
        const mine = out.filter((w) => w.packageId === p.id);
        const counts = Object.fromEntries(TAX_AUDIT_WP_STATUSES.map((s) => [s, 0])) as Record<
          TaxAuditWpStatus,
          number
        >;
        for (const w of mine) counts[w.status] += 1;
        return {
          id: p.id,
          package: p.package,
          grade: p.grade,
          taskId: p.task_id,
          taskStatus: p.task_status,
          assigneeId: p.assignee_id,
          assigneeName: p.assignee_name,
          clauseNos: mine.map((w) => w.clauseNo),
          counts,
        };
      }),
      papers: out,
      requests: requests.map((r) => ({
        id: r.id,
        item: r.tax_audit_item,
        label: TAX_AUDIT_INFO_ITEM_LABEL[r.tax_audit_item],
        status: r.status,
        requestDate: r.request_date,
        reminderDate: r.reminder_date,
        receivedDate: r.received_date,
        documentCount: r.documents,
      })),
      canLead: lead,
      editable: a.stage !== 'not_applicable' && !this.signed(a.stage),
      version: a.version,
    };
  }
}
