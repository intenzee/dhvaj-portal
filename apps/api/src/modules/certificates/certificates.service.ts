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
  REGISTER_UDIN_PATTERN,
  checkCertificateFigures,
  udinMembershipNo,
  type Certificate,
  type CertificateCheck,
  type CertificateRegisterRow,
  type CertificateStatus,
  type CertificateTemplate,
  type CertificateVariable,
  type CreateCertificateInput,
  type RecordForm15caInput,
  type ReviewCertificateInput,
  type RevokeCertificateInput,
  type SignCertificateInput,
  type UpdateCertificateInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { istToday } from '../engagements/time/auto-time';
import { recordedDateProblem } from '../tax-audits/tax-audit-filing.service';
import { renderCertificatePdf } from './certificate-pdf';
import type { CertificateRegisterQueryDto } from './dto/certificates.dto';

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  version: number;
  effective_from: string;
  form_label: string | null;
  legal_ref: string | null;
  verification: 'verified' | 'verify';
  variables: CertificateVariable[];
  checks: CertificateCheck[];
  body: string;
  records_form_15ca: boolean;
}

interface CertRow {
  id: string;
  engagement_id: string;
  engagement_code: string;
  engagement_kind: string;
  entity_id: string;
  entity_name: string;
  office_name: string | null;
  template_id: string;
  certificate_no: string | null;
  purpose: string;
  addressee: string;
  figures: Record<string, string>;
  status: CertificateStatus;
  prepared_by_employee_id: string | null;
  prepared_by_name: string | null;
  reviewed_by_employee_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  signing_partner_employee_id: string | null;
  signing_partner_name: string | null;
  membership_no: string | null;
  signed_on: string | null;
  udin: string | null;
  issued_on: string | null;
  document_id: string | null;
  form_15ca_ack_no: string | null;
  form_15ca_filed_on: string | null;
  revoked_reason: string | null;
  revoked_at: Date | null;
  created_at: Date;
  version: number;
}

const ACK = /^[A-Z0-9/-]{3,40}$/;
const SIGNING_ROLES = ['partner', 'managing_partner'];

const TEMPLATE_COLUMNS = `t.id, t.code, t.name, t.version, t.effective_from::text AS effective_from,
  t.form_label, t.legal_ref, t.verification, t.variables, t.checks, t.body, t.records_form_15ca`;

/** The certificate's financial year, from the date it is numbered on (CERT/2026-27/0001). */
export function certificateFy(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The UDIN as the register takes it, on the signing partner's own membership number. */
export function certificateUdin(
  raw: string,
  membershipNo: string | null,
): { value: string } | { error: string } {
  const value = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!REGISTER_UDIN_PATTERN.test(value)) {
    return {
      error:
        'A UDIN is 18 characters: the 2-digit year, the 6-digit membership no. and 10 letters or digits.',
    };
  }
  const m = membershipNo?.trim() ?? '';
  if (!/^[0-9]{1,6}$/.test(m)) {
    return { error: 'Your membership number is not on your profile (Admin → People).' };
  }
  if (udinMembershipNo(value) !== m.padStart(6, '0')) {
    return {
      error: `This UDIN is not on your membership number (${m.padStart(6, '0')}).`,
    };
  }
  return { value };
}

/**
 * Practice Services PS-402 — the certificates desk. A certificate lives on an
 * Assignment engagement; its team prepares it (RLS: engagement members
 * write), someone other than the preparer reviews it (the engagement's
 * partner or manager, or a partner), a partner with a certificate of
 * practice valid today signs it with a UDIN on their own membership number,
 * and it is then numbered and issued as a PDF filed with the engagement's
 * documents. The UDIN goes to the UDIN register (trigger). A signed or
 * issued certificate is revoked with a reason, never edited; its UDIN is
 * revoked in the register with it.
 */
@Injectable()
export class CertificatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
  ) {}

  templates(ctx: RlsContext, asOn?: string): Promise<CertificateTemplate[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<TemplateRow>(
        `SELECT DISTINCT ON (t.code) ${TEMPLATE_COLUMNS}
           FROM hsdg.certificate_templates t
          WHERE t.is_active AND t.effective_from <= $1::date
          ORDER BY t.code, t.effective_from DESC`,
        [asOn ?? istToday()],
      );
      const order = await client.query<{ code: string }>(
        `SELECT code FROM hsdg.certificate_templates GROUP BY code ORDER BY min(sequence), code`,
      );
      const rank = new Map(order.rows.map((r, i) => [r.code, i]));
      return rows.sort((a, b) => (rank.get(a.code) ?? 0) - (rank.get(b.code) ?? 0)).map(toTemplate);
    });
  }

  list(ctx: RlsContext, engagementId: string): Promise<Certificate[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM hsdg.certificates WHERE engagement_id = $1 ORDER BY created_at DESC`,
        [engagementId],
      );
      const out: Certificate[] = [];
      for (const r of rows) out.push(await this.view(client, ctx, engagementId, r.id));
      return out;
    });
  }

  get(ctx: RlsContext, engagementId: string, id: string): Promise<Certificate> {
    return this.db.withRlsContext(ctx, (client) => this.view(client, ctx, engagementId, id));
  }

  /** The firm-wide register: every certificate on an engagement the caller can see. */
  register(ctx: RlsContext, q: CertificateRegisterQueryDto): Promise<CertificateRegisterRow[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.status) {
        params.push(q.status);
        where.push(`c.status = $${params.length}`);
      }
      if (q.template) {
        params.push(q.template);
        where.push(`t.code = $${params.length}`);
      }
      if (q.search?.trim()) {
        params.push(`%${q.search.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
        where.push(
          `(ent.legal_name ILIKE $${params.length} OR c.certificate_no ILIKE $${params.length}
            OR c.udin ILIKE $${params.length})`,
        );
      }
      const { rows } = await client.query<CertificateRegisterRow>(
        `SELECT c.id, c.certificate_no AS "certificateNo", t.code AS "templateCode",
                t.name AS "templateName", t.form_label AS "formLabel", e.entity_id AS "entityId",
                ent.legal_name AS "entityName", e.id AS "engagementId",
                e.engagement_code AS "engagementCode", c.purpose, c.addressee, c.status,
                sp.full_name AS "signingPartnerName", c.signed_on::text AS "signedOn", c.udin,
                c.issued_on::text AS "issuedOn", c.form_15ca_ack_no AS "form15caAckNo"
           FROM hsdg.certificates c
           JOIN hsdg.certificate_templates t ON t.id = c.template_id
           JOIN hsdg.engagements e ON e.id = c.engagement_id
           JOIN hsdg.entities ent ON ent.id = e.entity_id
           LEFT JOIN hsdg.employees sp ON sp.id = c.signing_partner_employee_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY coalesce(c.issued_on, c.signed_on, c.created_at::date) DESC, c.created_at DESC
          LIMIT 500`,
        params,
      );
      return rows;
    });
  }

  async create(
    ctx: RlsContext,
    engagementId: string,
    input: CreateCertificateInput,
  ): Promise<Certificate> {
    return this.write(ctx, async (client) => {
      const eng = await client.query<{ kind: string }>(
        `SELECT kind FROM hsdg.engagements WHERE id = $1`,
        [engagementId],
      );
      if (!eng.rows[0]) throw new NotFoundException('Engagement not found.');
      if (eng.rows[0].kind !== 'assignment') {
        throw new BadRequestException('Certificates are issued on an Assignment engagement.');
      }
      const t = await this.templateOn(client, input.templateCode, input.asOnDate ?? istToday());
      const figures = this.checkFigures(t, input.figures);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO hsdg.certificates
           (engagement_id, template_id, purpose, addressee, figures, prepared_by_employee_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          engagementId,
          t.id,
          input.purpose.trim(),
          input.addressee.trim(),
          JSON.stringify(figures),
          ctx.employeeId ?? null,
        ],
      );
      const id = rows[0]!.id;
      await this.audit.recordWith(client, ctx, {
        action: 'certificate.created',
        objectType: 'certificate',
        objectId: id,
        after: { template: t.code, version: t.version, purpose: input.purpose },
      });
      return this.view(client, ctx, engagementId, id);
    });
  }

  async update(
    ctx: RlsContext,
    engagementId: string,
    id: string,
    input: UpdateCertificateInput,
  ): Promise<Certificate> {
    return this.write(ctx, async (client) => {
      const c = await this.row(client, engagementId, id, true);
      this.checkVersion(c.version, input.version);
      if (c.status !== 'draft') {
        throw new BadRequestException(
          c.status === 'in_review'
            ? 'The certificate is in review; return it to draft to change it.'
            : 'A signed certificate is not changed; revoke it and make a new one.',
        );
      }
      const t = await this.templateById(client, c.template_id);
      const figures = input.figures ? this.checkFigures(t, input.figures) : c.figures;
      await client.query(
        `UPDATE hsdg.certificates
            SET purpose = $2, addressee = $3, figures = $4, version = version + 1
          WHERE id = $1`,
        [
          id,
          input.purpose?.trim() ?? c.purpose,
          input.addressee?.trim() ?? c.addressee,
          JSON.stringify(figures),
        ],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'certificate.updated',
        objectType: 'certificate',
        objectId: id,
        before: { purpose: c.purpose, addressee: c.addressee, figures: c.figures },
        after: { purpose: input.purpose, addressee: input.addressee, figures },
      });
      return this.view(client, ctx, engagementId, id);
    });
  }

  /** Draft → in review: every required figure filled and the cross-checks holding. */
  async submit(ctx: RlsContext, engagementId: string, id: string, version: number) {
    return this.write(ctx, async (client) => {
      const c = await this.row(client, engagementId, id, true);
      this.checkVersion(c.version, version);
      if (c.status !== 'draft') throw new BadRequestException('Only a draft is sent for review.');
      this.checkFigures(await this.templateById(client, c.template_id), c.figures);
      await client.query(
        `UPDATE hsdg.certificates
            SET status = 'in_review', reviewed_by_employee_id = NULL, reviewed_at = NULL,
                review_note = NULL, version = version + 1
          WHERE id = $1`,
        [id],
      );
      await this.transition(client, ctx, id, 'draft', 'in_review');
      return this.view(client, ctx, engagementId, id);
    });
  }

  /** The reviewer approves (ready to sign) or returns it to draft with a note. */
  async review(
    ctx: RlsContext,
    engagementId: string,
    id: string,
    input: ReviewCertificateInput,
  ): Promise<Certificate> {
    return this.write(ctx, async (client) => {
      const c = await this.row(client, engagementId, id, true);
      this.checkVersion(c.version, input.version);
      if (c.status !== 'in_review')
        throw new BadRequestException('The certificate is not in review.');
      if (!(await this.mayReview(client, ctx, c))) {
        throw new ForbiddenException(
          c.prepared_by_employee_id === ctx.employeeId
            ? 'The preparer does not review their own certificate.'
            : 'Only the engagement partner or manager, or a partner, reviews a certificate.',
        );
      }
      const note = input.note?.trim() || null;
      if (input.decision === 'return') {
        if (!note) throw new BadRequestException('Say what to change when returning it.');
        await client.query(
          `UPDATE hsdg.certificates
              SET status = 'draft', review_note = $2, reviewed_by_employee_id = NULL,
                  reviewed_at = NULL, version = version + 1
            WHERE id = $1`,
          [id, note],
        );
        await this.transition(client, ctx, id, 'in_review', 'draft', note);
      } else {
        await client.query(
          `UPDATE hsdg.certificates
              SET reviewed_by_employee_id = $2, reviewed_at = now(), review_note = $3,
                  version = version + 1
            WHERE id = $1`,
          [id, ctx.employeeId, note],
        );
        await this.audit.recordWith(client, ctx, {
          action: 'certificate.reviewed',
          objectType: 'certificate',
          objectId: id,
          after: { reviewedBy: ctx.employeeId, note },
        });
      }
      return this.view(client, ctx, engagementId, id);
    });
  }

  /**
   * A partner signs a reviewed certificate: a certificate of practice valid
   * today, and a UDIN on their own membership number that no other document
   * in the register carries.
   */
  async sign(
    ctx: RlsContext,
    engagementId: string,
    id: string,
    input: SignCertificateInput,
  ): Promise<Certificate> {
    return this.write(ctx, async (client) => {
      const c = await this.row(client, engagementId, id, true);
      this.checkVersion(c.version, input.version);
      if (c.status !== 'in_review' || !c.reviewed_by_employee_id) {
        throw new BadRequestException(
          c.status === 'draft' || c.status === 'in_review'
            ? 'The certificate needs its review before it is signed.'
            : 'The certificate is already signed.',
        );
      }
      if (!ctx.employeeId || !SIGNING_ROLES.includes(ctx.role)) {
        throw new ForbiddenException('Only a partner signs a certificate.');
      }
      const partner = await client.query<{
        full_name: string;
        membership_no: string | null;
        cop_valid_until: string | null;
      }>(
        `SELECT e.full_name, pp.membership_no, pp.cop_valid_until::text AS cop_valid_until
           FROM hsdg.employees e
           LEFT JOIN hsdg.partner_profiles pp ON pp.employee_id = e.id
          WHERE e.id = $1`,
        [ctx.employeeId],
      );
      const pr = partner.rows[0];
      const today = istToday();
      if (!pr?.cop_valid_until || pr.cop_valid_until < today) {
        throw new BadRequestException(
          `${pr?.full_name ?? 'You'} has no certificate of practice valid today (Admin → People).`,
        );
      }
      const udin = certificateUdin(input.udin, pr.membership_no);
      if ('error' in udin) throw new BadRequestException(udin.error);
      const signedOn = input.signedOn ?? today;
      const generatedOn = input.udinGeneratedOn ?? today;
      const bad =
        recordedDateProblem(signedOn, today, { date: null, what: '' }, 'signing') ??
        recordedDateProblem(generatedOn, today, { date: null, what: '' }, 'UDIN generation');
      if (bad) throw new BadRequestException(bad);
      const taken = await client.query<{ source: string; source_id: string | null }>(
        `SELECT source, source_id FROM hsdg.udin_register WHERE udin = $1`,
        [udin.value],
      );
      const other = taken.rows[0];
      if (other && !(other.source === 'certificate' && other.source_id === id)) {
        throw new ConflictException('This UDIN is already in the register for another document.');
      }
      await client.query(
        `UPDATE hsdg.certificates
            SET status = 'signed', signing_partner_employee_id = $2, signed_on = $3, udin = $4,
                udin_generated_on = $5, version = version + 1
          WHERE id = $1`,
        [id, ctx.employeeId, signedOn, udin.value, generatedOn],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'certificate.signed',
        objectType: 'certificate',
        objectId: id,
        before: { status: 'in_review' },
        after: { status: 'signed', udin: udin.value, signedOn },
      });
      return this.view(client, ctx, engagementId, id);
    });
  }

  /** Number it (CERT/<FY>/<n>, one series a year), print it and file the PDF. */
  async issue(ctx: RlsContext, engagementId: string, id: string, version: number) {
    const c = await this.db.withRlsContext(ctx, async (client) => {
      const r = await this.row(client, engagementId, id);
      this.checkVersion(r.version, version);
      if (r.status !== 'signed')
        throw new BadRequestException('Only a signed certificate is issued.');
      if (!(await this.mayIssue(client, ctx, r))) {
        throw new ForbiddenException(
          'Only the signing partner, or the engagement partner or manager, issues it.',
        );
      }
      return r;
    });
    const issuedOn = istToday();
    const number = await this.db.withRlsContext(ctx, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('hsdg.certificate_no'))`);
      const fy = certificateFy(issuedOn);
      const { rows } = await client.query<{ n: number }>(
        `SELECT coalesce(max(split_part(certificate_no, '/', 3)::int), 0) + 1 AS n
           FROM hsdg.certificates WHERE certificate_no LIKE $1`,
        [`CERT/${fy}/%`],
      );
      return `CERT/${fy}/${String(rows[0]!.n).padStart(4, '0')}`;
    });
    const pdf = await this.db.withRlsContext(ctx, async (client) =>
      this.pdfFor(client, { ...c, certificate_no: number, issued_on: issuedOn, status: 'issued' }),
    );
    const t = await this.db.withRlsContext(ctx, (client) =>
      this.templateById(client, c.template_id),
    );
    const doc = await this.documents.create(ctx, engagementId, {
      title: `${t.name} — ${number}`,
      filename: `${number.replace(/\//g, '-')}.pdf`,
      contentType: 'application/pdf',
      contentBase64: pdf.toString('base64'),
      documentType: 'report',
      classification: 'confidential',
    });
    return this.write(ctx, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('hsdg.certificate_no'))`);
      const r = await this.row(client, engagementId, id, true);
      this.checkVersion(r.version, version);
      if (r.status !== 'signed')
        throw new BadRequestException('Only a signed certificate is issued.');
      await client.query(
        `UPDATE hsdg.certificates
            SET status = 'issued', certificate_no = $2, issued_on = $3, document_id = $4,
                version = version + 1
          WHERE id = $1`,
        [id, number, issuedOn, doc.id],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'certificate.issued',
        objectType: 'certificate',
        objectId: id,
        before: { status: 'signed' },
        after: { status: 'issued', certificateNo: number, documentId: doc.id },
      });
      return this.view(client, ctx, engagementId, id);
    });
  }

  /** Revoke with a reason; a signed one's UDIN is revoked in the register with it. */
  async revoke(
    ctx: RlsContext,
    engagementId: string,
    id: string,
    input: RevokeCertificateInput,
  ): Promise<Certificate> {
    return this.write(ctx, async (client) => {
      const c = await this.row(client, engagementId, id, true);
      this.checkVersion(c.version, input.version);
      const reason = input.reason?.trim() ?? '';
      if (!reason) throw new BadRequestException('Give the reason for revoking the certificate.');
      if (c.status === 'revoked')
        throw new BadRequestException('The certificate is already revoked.');
      if (!(await this.mayRevoke(client, ctx, c))) {
        throw new ForbiddenException(
          'Only the signing partner or the Managing Partner revokes a signed certificate.',
        );
      }
      await client.query(
        `UPDATE hsdg.certificates
            SET status = 'revoked', revoked_reason = $2, revoked_at = now(),
                revoked_by_employee_id = $3, version = version + 1
          WHERE id = $1`,
        [id, reason, ctx.employeeId ?? null],
      );
      if (c.udin) {
        await client.query(
          `UPDATE hsdg.udin_register
              SET status = 'revoked', revoked_reason = $2, revoked_at = now(),
                  revoked_by_employee_id = $3, version = version + 1
            WHERE source = 'certificate' AND source_id = $1 AND status = 'active'`,
          [id, `Certificate revoked: ${reason}`.slice(0, 500), ctx.employeeId ?? null],
        );
      }
      await this.transition(client, ctx, id, c.status, 'revoked', reason);
      return this.view(client, ctx, engagementId, id);
    });
  }

  /** Form 146 / 15CB: the Form 145 / 15CA acknowledgement, once the remitter files it. */
  async recordForm15ca(
    ctx: RlsContext,
    engagementId: string,
    id: string,
    input: RecordForm15caInput,
  ): Promise<Certificate> {
    return this.write(ctx, async (client) => {
      const c = await this.row(client, engagementId, id, true);
      this.checkVersion(c.version, input.version);
      const t = await this.templateById(client, c.template_id);
      if (!t.records_form_15ca) {
        throw new BadRequestException('Only a remittance certificate records a Form 145 / 15CA.');
      }
      if (c.status !== 'signed' && c.status !== 'issued') {
        throw new BadRequestException('Record the Form 145 / 15CA once the certificate is signed.');
      }
      const ack = input.ackNo.trim().toUpperCase().replace(/\s+/g, '');
      if (!ACK.test(ack)) {
        throw new BadRequestException(
          'The acknowledgement number is 3–40 letters, digits, / or -.',
        );
      }
      const bad = recordedDateProblem(
        input.filedOn,
        istToday(),
        { date: c.signed_on, what: 'the certificate was signed' },
        'filing',
      );
      if (bad) throw new BadRequestException(bad);
      await client.query(
        `UPDATE hsdg.certificates
            SET form_15ca_ack_no = $2, form_15ca_filed_on = $3, version = version + 1
          WHERE id = $1`,
        [id, ack, input.filedOn],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'certificate.form_15ca_recorded',
        objectType: 'certificate',
        objectId: id,
        before: { ackNo: c.form_15ca_ack_no },
        after: { ackNo: ack, filedOn: input.filedOn },
      });
      return this.view(client, ctx, engagementId, id);
    });
  }

  pdf(ctx: RlsContext, engagementId: string, id: string): Promise<{ name: string; pdf: Buffer }> {
    return this.db.withRlsContext(ctx, async (client) => {
      const c = await this.row(client, engagementId, id);
      return {
        name: `${(c.certificate_no ?? `certificate-draft-${c.id.slice(0, 8)}`).replace(/\//g, '-')}.pdf`,
        pdf: await this.pdfFor(client, c),
      };
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private async pdfFor(client: PoolClient, c: CertRow): Promise<Buffer> {
    const t = await this.templateById(client, c.template_id);
    const firm = await client.query<{
      firm_name: string;
      frn: string | null;
      address: string | null;
    }>(`SELECT firm_name, frn, address FROM hsdg.firm_settings LIMIT 1`);
    return renderCertificatePdf({
      firm: {
        name: firm.rows[0]?.firm_name ?? '',
        frn: firm.rows[0]?.frn ?? null,
        address: firm.rows[0]?.address ?? null,
      },
      title: t.name,
      formLabel: t.form_label,
      legalRef: t.legal_ref,
      certificateNo: c.certificate_no,
      issuedOn: c.issued_on,
      addressee: c.addressee,
      purpose: c.purpose,
      clientName: c.entity_name,
      body: t.body,
      figures: c.figures,
      dateKeys: t.variables.filter((v) => v.type === 'date').map((v) => v.key),
      amountKeys: t.variables.filter((v) => v.type === 'amount').map((v) => v.key),
      partner: c.signing_partner_name
        ? { name: c.signing_partner_name, membershipNo: c.membership_no }
        : null,
      signedOn: c.signed_on,
      udin: c.udin,
      place: c.office_name,
      status: c.status,
      revokedReason: c.revoked_reason,
    });
  }

  private checkFigures(t: TemplateRow, raw: Record<string, string>): Record<string, string> {
    const { figures, errors } = checkCertificateFigures(t, raw ?? {});
    const problems = Object.values(errors);
    if (problems.length) throw new BadRequestException({ message: problems.join(' '), errors });
    return figures;
  }

  private async templateOn(client: PoolClient, code: string, asOn: string): Promise<TemplateRow> {
    const { rows } = await client.query<TemplateRow>(
      `SELECT ${TEMPLATE_COLUMNS} FROM hsdg.certificate_templates t
        WHERE t.code = $1 AND t.is_active AND t.effective_from <= $2::date
        ORDER BY t.effective_from DESC LIMIT 1`,
      [code, asOn],
    );
    if (!rows[0]) throw new BadRequestException(`No certificate template ${code} on ${asOn}.`);
    return rows[0];
  }

  private async templateById(client: PoolClient, id: string): Promise<TemplateRow> {
    const { rows } = await client.query<TemplateRow>(
      `SELECT ${TEMPLATE_COLUMNS} FROM hsdg.certificate_templates t WHERE t.id = $1`,
      [id],
    );
    return rows[0]!;
  }

  private async isLead(client: PoolClient, engagementId: string): Promise<boolean> {
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT hsdg.is_engagement_lead($1) AS ok`,
      [engagementId],
    );
    return rows[0]?.ok === true;
  }

  private async mayReview(client: PoolClient, ctx: RlsContext, c: CertRow): Promise<boolean> {
    if (!ctx.employeeId || c.prepared_by_employee_id === ctx.employeeId) return false;
    return SIGNING_ROLES.includes(ctx.role) || (await this.isLead(client, c.engagement_id));
  }

  private async mayIssue(client: PoolClient, ctx: RlsContext, c: CertRow): Promise<boolean> {
    if (ctx.employeeId && ctx.employeeId === c.signing_partner_employee_id) return true;
    return this.isLead(client, c.engagement_id);
  }

  private async mayRevoke(client: PoolClient, ctx: RlsContext, c: CertRow): Promise<boolean> {
    if (c.status === 'draft' || c.status === 'in_review') {
      return (
        ctx.employeeId === c.prepared_by_employee_id || (await this.isLead(client, c.engagement_id))
      );
    }
    return (
      ctx.role === 'managing_partner' ||
      (!!ctx.employeeId && ctx.employeeId === c.signing_partner_employee_id)
    );
  }

  private async transition(
    client: PoolClient,
    ctx: RlsContext,
    id: string,
    from: CertificateStatus,
    to: CertificateStatus,
    reason?: string,
  ): Promise<void> {
    await this.audit.recordWith(client, ctx, {
      action: `certificate.${to}`,
      objectType: 'certificate',
      objectId: id,
      before: { status: from },
      after: { status: to, ...(reason ? { reason } : {}) },
    });
  }

  private checkVersion(actual: number, sent: number): void {
    if (actual !== sent) {
      throw new ConflictException('Someone else changed this meanwhile. Reload and try again.');
    }
  }

  private async write<T>(ctx: RlsContext, work: (client: PoolClient) => Promise<T>): Promise<T> {
    try {
      return await this.db.withRlsContext(ctx, work);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const e = err as { code?: string; constraint?: string };
      if (e.code === '23505' && e.constraint === 'certificates_udin_key') {
        throw new ConflictException('This UDIN is already on another certificate.');
      }
      if (e.code === '42501') {
        throw new ForbiddenException('Only the engagement’s team works its certificates.');
      }
      throw err;
    }
  }

  private async row(
    client: PoolClient,
    engagementId: string,
    id: string,
    lock = false,
  ): Promise<CertRow> {
    const { rows } = await client.query<CertRow>(
      `SELECT c.id, c.engagement_id, e.engagement_code, e.kind AS engagement_kind, e.entity_id,
              ent.legal_name AS entity_name, o.name AS office_name, c.template_id,
              c.certificate_no, c.purpose, c.addressee, c.figures, c.status,
              c.prepared_by_employee_id, pb.full_name AS prepared_by_name,
              c.reviewed_by_employee_id, rb.full_name AS reviewed_by_name, c.reviewed_at,
              c.review_note, c.signing_partner_employee_id, sp.full_name AS signing_partner_name,
              pp.membership_no, c.signed_on::text AS signed_on, c.udin,
              c.issued_on::text AS issued_on, c.document_id, c.form_15ca_ack_no,
              c.form_15ca_filed_on::text AS form_15ca_filed_on, c.revoked_reason, c.revoked_at,
              c.created_at, c.version
         FROM hsdg.certificates c
         JOIN hsdg.engagements e ON e.id = c.engagement_id
         JOIN hsdg.entities ent ON ent.id = e.entity_id
         LEFT JOIN hsdg.offices o ON o.id = e.office_id
         LEFT JOIN hsdg.employees pb ON pb.id = c.prepared_by_employee_id
         LEFT JOIN hsdg.employees rb ON rb.id = c.reviewed_by_employee_id
         LEFT JOIN hsdg.employees sp ON sp.id = c.signing_partner_employee_id
         LEFT JOIN hsdg.partner_profiles pp ON pp.employee_id = c.signing_partner_employee_id
        WHERE c.id = $1 AND c.engagement_id = $2${lock ? ' FOR UPDATE OF c' : ''}`,
      [id, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Certificate not found.');
    return rows[0];
  }

  private async view(
    client: PoolClient,
    ctx: RlsContext,
    engagementId: string,
    id: string,
  ): Promise<Certificate> {
    const c = await this.row(client, engagementId, id);
    const t = await this.templateById(client, c.template_id);
    const member = await client.query<{ ok: boolean }>(
      `SELECT hsdg.is_engagement_member($1) AS ok`,
      [engagementId],
    );
    const isMember = member.rows[0]?.ok === true;
    const live = c.status !== 'revoked';
    return {
      id: c.id,
      engagementId: c.engagement_id,
      engagementCode: c.engagement_code,
      entityId: c.entity_id,
      entityName: c.entity_name,
      templateCode: t.code,
      templateName: t.name,
      templateVersion: t.version,
      formLabel: t.form_label,
      certificateNo: c.certificate_no,
      purpose: c.purpose,
      addressee: c.addressee,
      figures: c.figures,
      status: c.status,
      preparedBy: c.prepared_by_employee_id
        ? { id: c.prepared_by_employee_id, name: c.prepared_by_name ?? '' }
        : null,
      reviewedBy: c.reviewed_by_employee_id
        ? { id: c.reviewed_by_employee_id, name: c.reviewed_by_name ?? '' }
        : null,
      reviewedAt: c.reviewed_at?.toISOString() ?? null,
      reviewNote: c.review_note,
      signingPartner: c.signing_partner_employee_id
        ? {
            id: c.signing_partner_employee_id,
            name: c.signing_partner_name ?? '',
            membershipNo: c.membership_no,
          }
        : null,
      signedOn: c.signed_on,
      udin: c.udin,
      issuedOn: c.issued_on,
      documentId: c.document_id,
      form15caAckNo: c.form_15ca_ack_no,
      form15caFiledOn: c.form_15ca_filed_on,
      revokedReason: c.revoked_reason,
      revokedAt: c.revoked_at?.toISOString() ?? null,
      createdAt: c.created_at.toISOString(),
      version: c.version,
      can: {
        edit: isMember && c.status === 'draft',
        submit: isMember && c.status === 'draft',
        review:
          isMember &&
          c.status === 'in_review' &&
          !c.reviewed_by_employee_id &&
          (await this.mayReview(client, ctx, c)),
        sign:
          isMember &&
          c.status === 'in_review' &&
          !!c.reviewed_by_employee_id &&
          !!ctx.employeeId &&
          SIGNING_ROLES.includes(ctx.role),
        issue: isMember && c.status === 'signed' && (await this.mayIssue(client, ctx, c)),
        revoke: isMember && live && (await this.mayRevoke(client, ctx, c)),
        recordForm15ca:
          isMember && t.records_form_15ca && (c.status === 'signed' || c.status === 'issued'),
      },
    };
  }
}

function toTemplate(t: TemplateRow): CertificateTemplate {
  return {
    code: t.code,
    name: t.name,
    version: t.version,
    effectiveFrom: t.effective_from,
    formLabel: t.form_label,
    legalRef: t.legal_ref,
    verification: t.verification,
    variables: t.variables,
    checks: t.checks,
    body: t.body,
    recordsForm15ca: t.records_form_15ca,
  };
}
