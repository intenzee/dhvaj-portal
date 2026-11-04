import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  checkUdin,
  type FileTaxAuditReportInput,
  type RecordTaxAuditAcceptanceInput,
  type RecordTaxAuditRejectionInput,
  type RecordTaxAuditUploadInput,
  type ReviseTaxAuditReportInput,
  type SignTaxAuditReportInput,
  type TaxAuditFiling,
  type TaxAuditStage,
  type WithdrawTaxAuditSignatureInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { istToday } from '../engagements/time/auto-time';
import { FilingWorkspaceService } from '../filing-workspace/filing-workspace.service';
import type { LodgeDto } from '../filing-workspace/dto/filing-workspace.dto';
import { supersedeSignoffs, TaxAuditReviewService } from './tax-audit-review.service';

interface AuditRow {
  id: string;
  engagement_id: string;
  financial_year: string;
  revision: number;
  revised_from_id: string | null;
  revision_reason: string | null;
  stage: TaxAuditStage;
  form_type: '3CA' | '3CB' | null;
  signing_partner_id: string | null;
  signing_partner_name: string | null;
  membership_no: string | null;
  cop_valid_until: string | null;
  udin: string | null;
  signed_at: Date | null;
  signed_by_name: string | null;
  signed_report_document_id: string | null;
  signed_report_title: string | null;
  uploaded_on: string | null;
  client_accepted_on: string | null;
  client_rejected_on: string | null;
  client_rejection_reason: string | null;
  filed_on: string | null;
  acknowledgement_no: string | null;
  acknowledgement_document_id: string | null;
  acknowledgement_title: string | null;
  compliance_instance_id: string | null;
  /** The year's IT_TAX_AUDIT filing (a revision files its papers there too). */
  year_instance_id: string | null;
  revised: boolean;
  version: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACK = /^[A-Z0-9/-]{3,40}$/;

/** A date the desk records: a real date, not in the future, not before `after`. */
export function recordedDateProblem(
  value: string,
  today: string,
  after: { date: string | null; what: string },
  what: string,
): string | null {
  if (!DATE.test(value) || Number.isNaN(Date.parse(value))) {
    return `The ${what} date must be a date (YYYY-MM-DD).`;
  }
  if (value > today) return `The ${what} date cannot be in the future.`;
  if (after.date && value < after.date) {
    return `The ${what} date cannot be before ${after.what} (${after.date}).`;
  }
  return null;
}

/**
 * Tax Audit sign and file (Phase 5, F-8). The signing Partner signs once the
 * review is signed off and nothing blocks it (F-7): the UDIN and the signed
 * report. The engagement's partner or manager, or the signing Partner,
 * records the upload, the client's acceptance or rejection (back to review)
 * and the filing. Filing lodges the year's IT_TAX_AUDIT filing through the
 * filing workspace — its checks, task and notification — and the audit takes
 * the acknowledgement from that lodge. A filed report can be revised: the
 * revision starts from the filed one's clauses and goes through review again.
 */
@Injectable()
export class TaxAuditFilingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly review: TaxAuditReviewService,
    private readonly filing: FilingWorkspaceService,
  ) {}

  get(ctx: RlsContext, engagementId: string, auditId: string): Promise<TaxAuditFiling> {
    return this.db.withRlsContext(ctx, (client) => this.view(client, ctx, engagementId, auditId));
  }

  /** The signing Partner signs: the UDIN and the signed report (PDF). */
  async sign(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: SignTaxAuditReportInput,
  ): Promise<TaxAuditFiling> {
    const checkSign = async (client: PoolClient): Promise<{ a: AuditRow; udin: string }> => {
      const a = await this.row(client, engagementId, auditId, true);
      this.checkVersion(a.version, input.version);
      if (a.stage !== 'review') {
        throw new BadRequestException(
          a.stage === 'clause_work'
            ? 'Send the 3CD for review first.'
            : 'The report is not in review; it cannot be signed now.',
        );
      }
      if (!ctx.employeeId || ctx.employeeId !== a.signing_partner_id) {
        throw new ForbiddenException(
          `Only the signing Partner${a.signing_partner_name ? ` (${a.signing_partner_name})` : ''} signs the report.`,
        );
      }
      const today = istToday(new Date());
      if (!a.cop_valid_until || a.cop_valid_until < today) {
        throw new BadRequestException(
          `${a.signing_partner_name ?? 'The signing Partner'} has no certificate of practice valid today.`,
        );
      }
      const blockers = await this.review.signingBlockersFor(client, auditId);
      if (blockers.length) throw new BadRequestException(blockers.join(' '));
      const udin = checkUdin(input.udin, a.membership_no);
      if ('error' in udin) throw new BadRequestException(udin.error);
      return { a, udin: udin.value };
    };
    const { a } = await this.db.withRlsContext(ctx, checkSign);
    const doc = await this.documents.create(ctx, engagementId, {
      title: `Signed tax audit report — Form ${a.form_type ?? '3CA/3CB'} and 3CD, FY ${a.financial_year}${
        a.revision ? ` (revision ${a.revision})` : ''
      }`,
      filename: input.filename,
      ...(input.contentType ? { contentType: input.contentType } : {}),
      contentBase64: input.contentBase64,
      documentType: 'report',
      classification: 'confidential',
      // The team files a filing's papers; the tax audit's filing carries its report.
      ...(a.year_instance_id ? { complianceInstanceId: a.year_instance_id } : {}),
    });
    return this.write(ctx, engagementId, auditId, async (client) => {
      const { udin } = await checkSign(client);
      await client.query(
        `UPDATE hsdg.tax_audits
            SET stage = 'signed', udin = $2, signed_at = now(), signed_by_employee_id = $3,
                signed_report_document_id = $4, version = version + 1
          WHERE id = $1`,
        [auditId, udin, ctx.employeeId, doc.id],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.report_signed',
        objectType: 'tax_audit',
        objectId: auditId,
        before: { stage: 'review' },
        after: { stage: 'signed', udin, documentId: doc.id },
      });
    });
  }

  /** The signing Partner takes the signature back before upload; the report goes back to review. */
  async withdraw(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: WithdrawTaxAuditSignatureInput,
  ): Promise<TaxAuditFiling> {
    return this.write(ctx, engagementId, auditId, async (client) => {
      const a = await this.row(client, engagementId, auditId, true);
      this.checkVersion(a.version, input.version);
      if (a.stage !== 'signed') {
        throw new BadRequestException(
          a.stage === 'uploaded'
            ? 'The report is uploaded: record the client’s rejection instead.'
            : 'The report is not signed.',
        );
      }
      if (ctx.employeeId !== a.signing_partner_id) {
        throw new ForbiddenException('Only the signing Partner withdraws the signature.');
      }
      const reason = this.reason(input.reason, 'withdrawing the signature');
      await this.backToReview(client, a, `The signature was withdrawn: ${reason}`);
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.signature_withdrawn',
        objectType: 'tax_audit',
        objectId: auditId,
        before: { stage: 'signed', udin: a.udin },
        after: { stage: 'review', reason },
      });
    });
  }

  /** The signed report is uploaded on the e-filing portal. */
  async uploaded(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: RecordTaxAuditUploadInput,
  ): Promise<TaxAuditFiling> {
    return this.write(ctx, engagementId, auditId, async (client) => {
      const a = await this.recorder(client, ctx, engagementId, auditId, input.version);
      if (a.stage !== 'signed') throw new BadRequestException('Sign the report first.');
      const signedOn = a.signed_at ? istToday(a.signed_at) : null;
      const bad = recordedDateProblem(
        input.uploadedOn,
        istToday(new Date()),
        { date: signedOn, what: 'the signing' },
        'upload',
      );
      if (bad) throw new BadRequestException(bad);
      await client.query(
        `UPDATE hsdg.tax_audits SET stage = 'uploaded', uploaded_on = $2, version = version + 1
          WHERE id = $1`,
        [auditId, input.uploadedOn],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.report_uploaded',
        objectType: 'tax_audit',
        objectId: auditId,
        after: { uploadedOn: input.uploadedOn },
      });
    });
  }

  /** The client accepts the uploaded report on the portal. */
  async clientAccepted(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: RecordTaxAuditAcceptanceInput,
  ): Promise<TaxAuditFiling> {
    return this.write(ctx, engagementId, auditId, async (client) => {
      const a = await this.recorder(client, ctx, engagementId, auditId, input.version);
      if (a.stage !== 'uploaded') throw new BadRequestException('Record the upload first.');
      const bad = recordedDateProblem(
        input.acceptedOn,
        istToday(new Date()),
        { date: a.uploaded_on, what: 'the upload' },
        'acceptance',
      );
      if (bad) throw new BadRequestException(bad);
      await client.query(
        `UPDATE hsdg.tax_audits
            SET stage = 'client_accepted', client_accepted_on = $2, version = version + 1
          WHERE id = $1`,
        [auditId, input.acceptedOn],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.client_accepted',
        objectType: 'tax_audit',
        objectId: auditId,
        after: { acceptedOn: input.acceptedOn },
      });
    });
  }

  /** The client rejects it: the report goes back to review for the signing Partner to look again. */
  async clientRejected(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: RecordTaxAuditRejectionInput,
  ): Promise<TaxAuditFiling> {
    return this.write(ctx, engagementId, auditId, async (client) => {
      const a = await this.recorder(client, ctx, engagementId, auditId, input.version);
      if (a.stage !== 'uploaded') throw new BadRequestException('Record the upload first.');
      const reason = this.reason(input.reason, 'the client’s rejection');
      const bad = recordedDateProblem(
        input.rejectedOn,
        istToday(new Date()),
        { date: a.uploaded_on, what: 'the upload' },
        'rejection',
      );
      if (bad) throw new BadRequestException(bad);
      await this.backToReview(client, a, `The client rejected the report: ${reason}`);
      await client.query(
        `UPDATE hsdg.tax_audits SET client_rejected_on = $2, client_rejection_reason = $3
          WHERE id = $1`,
        [auditId, input.rejectedOn, reason],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.client_rejected',
        objectType: 'tax_audit',
        objectId: auditId,
        before: { stage: 'uploaded', udin: a.udin, uploadedOn: a.uploaded_on },
        after: { stage: 'review', rejectedOn: input.rejectedOn, reason },
      });
    });
  }

  /**
   * Filed, with the acknowledgement. The original report lodges the year's
   * IT_TAX_AUDIT filing (the filing workspace's checks and task apply); a
   * revised report, which has no filing of its own, is recorded here.
   */
  async file(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: FileTaxAuditReportInput,
  ): Promise<TaxAuditFiling> {
    const ack = input.acknowledgementNo.trim().toUpperCase().replace(/\s+/g, '');
    const a = await this.db.withRlsContext(ctx, async (client) => {
      const r = await this.recorder(client, ctx, engagementId, auditId, input.version);
      if (r.stage !== 'client_accepted') {
        throw new BadRequestException('Record the client’s acceptance first.');
      }
      if (!ACK.test(ack)) {
        throw new BadRequestException(
          'The acknowledgement number is 3–40 letters, digits, "/" or "-".',
        );
      }
      const bad = recordedDateProblem(
        input.filedOn,
        istToday(new Date()),
        { date: r.client_accepted_on, what: 'the client’s acceptance' },
        'filing',
      );
      if (bad) throw new BadRequestException(bad);
      return r;
    });
    const doc = input.contentBase64
      ? await this.documents.create(ctx, engagementId, {
          title: `Acknowledgement — tax audit report FY ${a.financial_year}${
            a.revision ? ` (revision ${a.revision})` : ''
          }`,
          filename: input.filename?.trim() || 'acknowledgement.pdf',
          ...(input.contentType ? { contentType: input.contentType } : {}),
          contentBase64: input.contentBase64,
          documentType: 'acknowledgement',
          classification: 'client_shared',
          ...(a.year_instance_id ? { complianceInstanceId: a.year_instance_id } : {}),
        })
      : null;
    if (a.compliance_instance_id) {
      const lodge: LodgeDto = {
        referenceKind: 'ack',
        referenceNo: ack,
        filedOn: input.filedOn,
        ...(doc ? { ackDocumentId: doc.id } : {}),
      };
      await this.filing.lodge(ctx, a.compliance_instance_id, lodge);
    }
    return this.write(ctx, engagementId, auditId, async (client) => {
      if (!a.compliance_instance_id) {
        const r = await this.row(client, engagementId, auditId, true);
        this.checkVersion(r.version, input.version);
        await client.query(
          `UPDATE hsdg.tax_audits
              SET stage = 'filed', filed_on = $2, acknowledgement_no = $3,
                  acknowledgement_document_id = $4, version = version + 1
            WHERE id = $1`,
          [auditId, input.filedOn, ack, doc?.id ?? null],
        );
      }
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.report_filed',
        objectType: 'tax_audit',
        objectId: auditId,
        after: {
          acknowledgementNo: ack,
          filedOn: input.filedOn,
          lodgedFilingId: a.compliance_instance_id,
        },
      });
    });
  }

  /**
   * Revise a filed report: the next revision of the year's audit, from the
   * filed report's clauses, flagged matters and acceptance; it goes through
   * review, signing and filing again.
   */
  async revise(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: ReviseTaxAuditReportInput,
  ): Promise<TaxAuditFiling> {
    let revisedId = '';
    await this.write(ctx, engagementId, auditId, async (client) => {
      const a = await this.recorder(client, ctx, engagementId, auditId, input.version);
      if (a.stage !== 'filed') throw new BadRequestException('Only a filed report is revised.');
      if (a.revised) {
        throw new ConflictException('This report is already revised; work on the revision.');
      }
      const reason = this.reason(input.reason, 'the revision');
      const { rows } = await client.query<{ id: string; revision: number }>(
        `INSERT INTO hsdg.tax_audits
           (engagement_id, financial_year, revision, revised_from_id, revision_reason, stage,
            form_type, signing_partner_id, applicability_reason, independence_confirmed_at,
            independence_confirmed_by_employee_id, previous_auditor_changed, previous_auditor_name,
            previous_auditor_letter_document_id, appointment_letter_document_id, accepted_at,
            accepted_by_employee_id, clause_library_version_id, facts, clause_work_opened_at)
         SELECT engagement_id, financial_year,
                (SELECT max(x.revision) + 1 FROM hsdg.tax_audits x
                  WHERE x.engagement_id = a.engagement_id AND x.financial_year = a.financial_year),
                id, $2, 'clause_work', form_type, signing_partner_id, applicability_reason,
                independence_confirmed_at, independence_confirmed_by_employee_id,
                previous_auditor_changed, previous_auditor_name, previous_auditor_letter_document_id,
                appointment_letter_document_id, accepted_at, accepted_by_employee_id,
                clause_library_version_id, facts, now()
           FROM hsdg.tax_audits a WHERE a.id = $1
         RETURNING id, revision`,
        [auditId, reason],
      );
      const rev = rows[0]!;
      revisedId = rev.id;
      // The clauses carry over as filed; the team reopens what the revision changes.
      await client.query(
        `INSERT INTO hsdg.tax_audit_clause_packages (tax_audit_id, engagement_id, package, grade)
         SELECT $2, engagement_id, package, grade FROM hsdg.tax_audit_clause_packages
          WHERE tax_audit_id = $1`,
        [auditId, rev.id],
      );
      await client.query(
        `INSERT INTO hsdg.tax_audit_working_papers
           (tax_audit_id, engagement_id, package_id, library_clause_id, clause_no, status,
            not_applicable_source, not_applicable_reason, answer, preparer_employee_id,
            reviewer_employee_id, draft_source, draft_answer, draft_note, draft_confirmed_at,
            draft_confirmed_by_employee_id, sent_for_review_at, done_at, done_by_employee_id)
         SELECT $2, w.engagement_id, np.id, w.library_clause_id, w.clause_no, w.status,
                w.not_applicable_source, w.not_applicable_reason, w.answer, w.preparer_employee_id,
                w.reviewer_employee_id, w.draft_source, w.draft_answer, w.draft_note,
                w.draft_confirmed_at, w.draft_confirmed_by_employee_id, w.sent_for_review_at,
                w.done_at, w.done_by_employee_id
           FROM hsdg.tax_audit_working_papers w
           JOIN hsdg.tax_audit_clause_packages op ON op.id = w.package_id
           JOIN hsdg.tax_audit_clause_packages np ON np.tax_audit_id = $2 AND np.package = op.package
          WHERE w.tax_audit_id = $1`,
        [auditId, rev.id],
      );
      await client.query(
        `INSERT INTO hsdg.tax_audit_working_paper_documents
           (working_paper_id, document_id, engagement_id, added_by_employee_id, added_at)
         SELECT nw.id, d.document_id, d.engagement_id, d.added_by_employee_id, d.added_at
           FROM hsdg.tax_audit_working_paper_documents d
           JOIN hsdg.tax_audit_working_papers ow ON ow.id = d.working_paper_id
           JOIN hsdg.tax_audit_working_papers nw
             ON nw.tax_audit_id = $2 AND nw.library_clause_id = ow.library_clause_id
          WHERE ow.tax_audit_id = $1`,
        [auditId, rev.id],
      );
      await client.query(
        `INSERT INTO hsdg.tax_audit_observations
           (tax_audit_id, engagement_id, working_paper_id, clause_no, wording, status, kind,
            decision_note, decided_by_employee_id, decided_at, raised_by_employee_id)
         SELECT $2, o.engagement_id, nw.id, o.clause_no, o.wording, o.status, o.kind,
                o.decision_note, o.decided_by_employee_id, o.decided_at, o.raised_by_employee_id
           FROM hsdg.tax_audit_observations o
           LEFT JOIN hsdg.tax_audit_working_papers ow ON ow.id = o.working_paper_id
           LEFT JOIN hsdg.tax_audit_working_papers nw
             ON nw.tax_audit_id = $2 AND nw.library_clause_id = ow.library_clause_id
          WHERE o.tax_audit_id = $1`,
        [auditId, rev.id],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.report_revised',
        objectType: 'tax_audit',
        objectId: rev.id,
        before: { revisedFromId: auditId, acknowledgementNo: a.acknowledgement_no },
        after: { revision: rev.revision, reason },
      });
    });
    return this.get(ctx, engagementId, revisedId);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async write(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    work: (client: PoolClient) => Promise<void>,
  ): Promise<TaxAuditFiling> {
    try {
      return await this.db.withRlsContext(ctx, async (client) => {
        await work(client);
        return this.view(client, ctx, engagementId, auditId);
      });
    } catch (err) {
      throw this.mapPgError(err);
    }
  }

  private mapPgError(err: unknown): unknown {
    if (err instanceof HttpException) return err;
    const e = err as { code?: string; constraint?: string };
    if (e.code === '23505' && e.constraint === 'tax_audits_udin_key') {
      return new ConflictException('This UDIN is already on another report.');
    }
    if (e.code === '42501') return new ForbiddenException('You do not have access to this audit.');
    return err;
  }

  /** Back to review: the signature and upload go, and the signing Partner looks again. */
  private async backToReview(client: PoolClient, a: AuditRow, reason: string): Promise<void> {
    await client.query(
      `UPDATE hsdg.tax_audits
          SET stage = 'review', udin = NULL, signed_at = NULL, signed_by_employee_id = NULL,
              signed_report_document_id = NULL, uploaded_on = NULL, version = version + 1
        WHERE id = $1`,
      [a.id],
    );
    await supersedeSignoffs(client, a.id, 'partner', reason.slice(0, 300));
  }

  /** The upload, the client's answer and the filing: the engagement's leads or the signing Partner. */
  private async recorder(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    version: number,
  ): Promise<AuditRow> {
    const a = await this.row(client, engagementId, auditId, true);
    this.checkVersion(a.version, version);
    if (!(await this.mayRecord(client, ctx, engagementId, a))) {
      throw new ForbiddenException(
        'Only the engagement partner or manager, or the signing Partner, records this.',
      );
    }
    return a;
  }

  private async mayRecord(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    a: AuditRow,
  ): Promise<boolean> {
    if (ctx.employeeId && ctx.employeeId === a.signing_partner_id) return true;
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT hsdg.is_engagement_lead($1) AS ok`,
      [engagementId],
    );
    return rows[0]?.ok === true;
  }

  private reason(raw: string, what: string): string {
    const r = raw?.trim() ?? '';
    if (!r) throw new BadRequestException(`Give a reason for ${what}.`);
    if (r.length > 1000) throw new BadRequestException('Keep the reason to 1,000 characters.');
    return r;
  }

  private checkVersion(actual: number, sent: number): void {
    if (actual !== sent) {
      throw new ConflictException('Someone else changed this meanwhile. Reload and try again.');
    }
  }

  private async row(
    client: PoolClient,
    engagementId: string,
    auditId: string,
    lock = false,
  ): Promise<AuditRow> {
    const { rows } = await client.query<AuditRow>(
      `SELECT a.id, a.engagement_id, a.financial_year, a.revision, a.revised_from_id,
              a.revision_reason, a.stage, a.form_type, a.signing_partner_id,
              sp.full_name AS signing_partner_name, pp.membership_no,
              pp.cop_valid_until::text AS cop_valid_until, a.udin, a.signed_at,
              sb.full_name AS signed_by_name, a.signed_report_document_id,
              sd.title AS signed_report_title, a.uploaded_on::text AS uploaded_on,
              a.client_accepted_on::text AS client_accepted_on,
              a.client_rejected_on::text AS client_rejected_on, a.client_rejection_reason,
              a.filed_on::text AS filed_on, a.acknowledgement_no, a.acknowledgement_document_id,
              ad.title AS acknowledgement_title, a.compliance_instance_id,
              coalesce(a.compliance_instance_id,
                       (SELECT o.compliance_instance_id FROM hsdg.tax_audits o
                         WHERE o.engagement_id = a.engagement_id
                           AND o.financial_year = a.financial_year AND o.revision = 0))
                AS year_instance_id,
              EXISTS (SELECT 1 FROM hsdg.tax_audits r WHERE r.revised_from_id = a.id) AS revised,
              a.version
         FROM hsdg.tax_audits a
         LEFT JOIN hsdg.employees sp ON sp.id = a.signing_partner_id
         LEFT JOIN hsdg.partner_profiles pp ON pp.employee_id = a.signing_partner_id
         LEFT JOIN hsdg.employees sb ON sb.id = a.signed_by_employee_id
         LEFT JOIN hsdg.documents sd ON sd.id = a.signed_report_document_id
         LEFT JOIN hsdg.documents ad ON ad.id = a.acknowledgement_document_id
        WHERE a.id = $1 AND a.engagement_id = $2${lock ? ' FOR UPDATE OF a' : ''}`,
      [auditId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Tax audit not found.');
    return rows[0];
  }

  private async view(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
  ): Promise<TaxAuditFiling> {
    const a = await this.row(client, engagementId, auditId);
    const recorder = await this.mayRecord(client, ctx, engagementId, a);
    const signer = !!ctx.employeeId && ctx.employeeId === a.signing_partner_id;
    const blockers = a.stage === 'review' ? await this.review.signingBlockersFor(client, a.id) : [];
    const { rows: revisions } = await client.query<{
      id: string;
      revision: number;
      stage: TaxAuditStage;
      filed_on: string | null;
    }>(
      `SELECT id, revision, stage, filed_on::text AS filed_on FROM hsdg.tax_audits
        WHERE engagement_id = $1 AND financial_year = $2 ORDER BY revision`,
      [engagementId, a.financial_year],
    );
    return {
      auditId: a.id,
      engagementId: a.engagement_id,
      financialYear: a.financial_year,
      revision: a.revision,
      revisedFromId: a.revised_from_id,
      revisionReason: a.revision_reason,
      stage: a.stage,
      formType: a.form_type,
      signingPartnerId: a.signing_partner_id,
      signingPartnerName: a.signing_partner_name,
      udin: a.udin,
      signedAt: a.signed_at ? a.signed_at.toISOString() : null,
      signedByName: a.signed_by_name,
      signedReport: a.signed_report_document_id
        ? { id: a.signed_report_document_id, title: a.signed_report_title ?? 'Signed report' }
        : null,
      uploadedOn: a.uploaded_on,
      clientAcceptedOn: a.client_accepted_on,
      clientRejectedOn: a.client_rejected_on,
      clientRejectionReason: a.client_rejection_reason,
      filedOn: a.filed_on,
      acknowledgementNo: a.acknowledgement_no,
      acknowledgement: a.acknowledgement_document_id
        ? { id: a.acknowledgement_document_id, title: a.acknowledgement_title ?? 'Acknowledgement' }
        : null,
      complianceInstanceId: a.compliance_instance_id,
      signingBlockers: blockers,
      revisions: revisions.map((r) => ({
        id: r.id,
        revision: r.revision,
        stage: r.stage,
        filedOn: r.filed_on,
      })),
      can: {
        sign: a.stage === 'review' && signer && blockers.length === 0,
        withdraw: a.stage === 'signed' && signer,
        upload: a.stage === 'signed' && recorder,
        clientDecision: a.stage === 'uploaded' && recorder,
        file: a.stage === 'client_accepted' && recorder,
        revise: a.stage === 'filed' && recorder && !a.revised,
      },
      version: a.version,
    };
  }
}
