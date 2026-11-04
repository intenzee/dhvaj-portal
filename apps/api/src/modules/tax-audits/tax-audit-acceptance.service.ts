import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  DOCUMENT_TEMPLATE_KEY,
  INDEPENDENCE_RULE,
  acceptanceMissing,
  assessmentYearOf,
  signingPartnerOffer,
  templateDefinition,
  type IndependenceFinding,
  type SaveTaxAuditAcceptanceInput,
  type TaxAuditAcceptance,
  type TaxAuditAcceptanceStepInput,
  type TaxAuditForm,
  type TaxAuditSigningPartner,
  type TaxAuditStage,
  type UploadPreviousAuditorLetterInput,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from '../documents/documents.service';
import {
  DocumentTemplatesService,
  KNOWN_MERGE_FIELDS,
} from '../document-templates/document-templates.service';
import { mergeDocx } from '../document-templates/docx-merge';
import {
  evaluateIndependence,
  type IndependenceFact,
  type IndependenceFactKind,
} from '../engagements/independence';
import { istToday } from '../engagements/time/auto-time';
import { formatLongDate } from '../statutory-audit/acceptance-merge-values';

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TEMPLATE_KEY = DOCUMENT_TEMPLATE_KEY.taxAuditAppointmentLetter;
const NO_TEMPLATE =
  'No approved template for the tax audit appointment letter yet — an administrator must upload and approve one under Settings → Document templates.';
const LEAD_ONLY = 'Only the engagement’s partner or manager accepts a tax audit.';
/** The stages in which acceptance is still open. */
const OPEN_STAGES: readonly TaxAuditStage[] = ['not_started', 'acceptance'];

interface AuditRow {
  id: string;
  engagement_id: string;
  entity_id: string;
  financial_year: string;
  revision: number;
  stage: TaxAuditStage;
  form_type: TaxAuditForm | null;
  signing_partner_id: string | null;
  signing_partner_name: string | null;
  independence_confirmed_at: Date | null;
  independence_confirmed_by_name: string | null;
  previous_auditor_changed: boolean | null;
  previous_auditor_name: string | null;
  previous_auditor_letter_document_id: string | null;
  previous_auditor_letter_title: string | null;
  appointment_letter_document_id: string | null;
  appointment_letter_title: string | null;
  accepted_at: Date | null;
  accepted_by_name: string | null;
  version: number;
}

interface PartnerRow {
  employee_id: string;
  full_name: string;
  cop_no: string | null;
  cop_valid_until: string | null;
  reports: number;
}

/** A pg error raised by the signing-partner trigger, as the refusal to show. */
export function signingRefusal(err: unknown): string | null {
  const e = err as { code?: string; message?: string };
  if (e?.code !== '23514' || !e.message) return null;
  const m = /^tax_audit_(?:limit|cop): (.*)$/s.exec(e.message);
  return m ? m[1]! : null;
}

/** Only the s.44AB rule speaks to a tax audit's acceptance. */
export function taxAuditIndependence(
  isCompany: boolean,
  financialYear: string,
  facts: readonly IndependenceFact[],
): { ok: boolean; findings: IndependenceFinding[] } {
  const findings = evaluateIndependence(
    { isCompany, kind: 'compliance', financialYears: [financialYear], streams: ['tax_audit'] },
    facts,
  ).filter((f) => f.rule === INDEPENDENCE_RULE.taxAuditBookkeeper);
  return { ok: !findings.some((f) => f.outcome === 'block'), findings };
}

/**
 * Tax Audit acceptance desk (Phase 4, F-3): independence, the previous
 * auditor's communication, the form, the signing partner (a valid COP and room
 * under the firm's yearly limit, counted across every client) and the
 * appointment letter. Then the audit moves on to Information from client.
 * The engagement's partner or manager decides; the database refuses a partner
 * over the limit or without a valid COP whoever writes the row.
 */
@Injectable()
export class TaxAuditAcceptanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly templates: DocumentTemplatesService,
  ) {}

  async get(ctx: RlsContext, engagementId: string, auditId: string): Promise<TaxAuditAcceptance> {
    return this.db.withRlsContext(ctx, (client) => this.view(client, engagementId, auditId));
  }

  async save(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: SaveTaxAuditAcceptanceInput,
  ): Promise<TaxAuditAcceptance> {
    return this.db.withRlsContext(ctx, async (client) => {
      const before = await this.open(client, engagementId, auditId, input.version);
      const sets: string[] = [];
      const values: unknown[] = [auditId];
      const set = (column: string, value: unknown): void => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };

      if (input.formType !== undefined) set('form_type', input.formType);
      if (input.previousAuditorChanged !== undefined) {
        set('previous_auditor_changed', input.previousAuditorChanged);
        if (input.previousAuditorChanged !== true) {
          set('previous_auditor_name', null);
          set('previous_auditor_letter_document_id', null);
        }
      }
      // A name only goes with a changed auditor (a "no" or "not answered" clears it above).
      if (
        input.previousAuditorName !== undefined &&
        (input.previousAuditorChanged === undefined || input.previousAuditorChanged === true)
      ) {
        set('previous_auditor_name', input.previousAuditorName?.trim() || null);
      }
      if (
        input.signingPartnerId !== undefined &&
        input.signingPartnerId !== before.signing_partner_id
      ) {
        if (input.signingPartnerId) {
          await this.assertOffered(client, before, input.signingPartnerId);
        }
        set('signing_partner_id', input.signingPartnerId);
      }
      if (sets.length === 0) return this.view(client, engagementId, auditId);
      // The appointment letter names the form and the partner: a change means a new one.
      if (
        before.appointment_letter_document_id &&
        ((input.formType !== undefined && input.formType !== before.form_type) ||
          (input.signingPartnerId !== undefined &&
            input.signingPartnerId !== before.signing_partner_id))
      ) {
        set('appointment_letter_document_id', null);
      }
      if (before.stage === 'not_started') sets.push(`stage = 'acceptance'`);

      await this.write(
        client,
        `UPDATE hsdg.tax_audits SET ${sets.join(', ')}, version = version + 1
                                 WHERE id = $1`,
        values,
      );
      const after = await this.view(client, engagementId, auditId);
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.acceptance_updated',
        objectType: 'tax_audit',
        objectId: auditId,
        before: {
          formType: before.form_type,
          signingPartnerId: before.signing_partner_id,
          previousAuditorChanged: before.previous_auditor_changed,
          previousAuditorName: before.previous_auditor_name,
        },
        after: {
          formType: after.formType,
          signingPartnerId: after.signingPartnerId,
          previousAuditorChanged: after.previousAuditor.changed,
          previousAuditorName: after.previousAuditor.name,
        },
      });
      return after;
    });
  }

  /** The written communication to the previous auditor, filed in the engagement's documents. */
  async uploadPreviousAuditorLetter(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: UploadPreviousAuditorLetterInput,
  ): Promise<TaxAuditAcceptance> {
    const before = await this.db.withRlsContext(ctx, async (client) => {
      const a = await this.open(client, engagementId, auditId, input.version);
      if (a.previous_auditor_changed !== true) {
        throw new BadRequestException(
          'Say first that another auditor signed last year’s report; the letter is to them.',
        );
      }
      return a;
    });
    const doc = await this.documents.create(ctx, engagementId, {
      title: `Communication to previous auditor — tax audit FY ${before.financial_year}`,
      filename: input.filename,
      contentType: input.contentType,
      contentBase64: input.contentBase64,
      documentType: 'correspondence',
      classification: 'confidential',
    });
    return this.db.withRlsContext(ctx, async (client) => {
      await this.open(client, engagementId, auditId, input.version);
      await this.write(
        client,
        `UPDATE hsdg.tax_audits
            SET previous_auditor_letter_document_id = $2, version = version + 1,
                stage = CASE WHEN stage = 'not_started' THEN 'acceptance' ELSE stage END
          WHERE id = $1`,
        [auditId, doc.id],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.previous_auditor_letter_uploaded',
        objectType: 'tax_audit',
        objectId: auditId,
        after: { documentId: doc.id },
      });
      return this.view(client, engagementId, auditId);
    });
  }

  /** The appointment letter, merged from the firm's approved template. */
  async createAppointmentLetter(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: TaxAuditAcceptanceStepInput,
  ): Promise<TaxAuditAcceptance> {
    const prepared = await this.db.withRlsContext(ctx, async (client) => {
      const a = await this.open(client, engagementId, auditId, input.version);
      if (!a.form_type || !a.signing_partner_id) {
        throw new BadRequestException(
          'Choose the form and the signing partner first: the letter names both.',
        );
      }
      const { rows } = await client.query<{
        client_name: string;
        pan: string | null;
        engagement_code: string;
        entity_type_slug: string | null;
        listed: boolean;
        membership_no: string | null;
        cop_no: string | null;
      }>(
        `SELECT ent.legal_name AS client_name, ent.pan, e.engagement_code,
                et.slug AS entity_type_slug, ent.listing_status <> 'unlisted' AS listed,
                pp.membership_no, pp.cop_no
           FROM hsdg.engagements e
           JOIN hsdg.entities ent ON ent.id = e.entity_id
           LEFT JOIN hsdg.entity_types et ON et.id = ent.entity_type_id
           LEFT JOIN hsdg.partner_profiles pp ON pp.employee_id = $2
          WHERE e.id = $1`,
        [engagementId, a.signing_partner_id],
      );
      const f = rows[0];
      if (!f) throw new NotFoundException('Engagement not found.');
      const firm = await this.templates.readFirm(client);
      const resolved = await this.templates.resolveOn(
        client,
        TEMPLATE_KEY,
        { listed: f.listed, entityTypeSlug: f.entity_type_slug, hasGroup: false },
        input.variantKey,
      );
      if (!resolved) throw new BadRequestException(NO_TEMPLATE);
      const today = istToday(new Date());
      return {
        audit: a,
        resolved,
        clientName: f.client_name,
        values: {
          'firm.name': firm.firmName,
          'firm.frn': firm.frn,
          'firm.address': firm.address,
          'client.name': f.client_name,
          'client.pan': f.pan,
          'engagement.code': f.engagement_code,
          'engagement.financialYear': a.financial_year,
          'partner.name': a.signing_partner_name,
          'partner.membershipNo': f.membership_no,
          'partner.copNo': f.cop_no,
          'taxAudit.form': `Form ${a.form_type}`,
          'taxAudit.assessmentYear': assessmentYearOf(a.financial_year),
          'taxAudit.letterDate': formatLongDate(today),
          today: formatLongDate(today),
        } satisfies Record<string, string | null>,
      };
    });
    const bytes = await this.templates.readBytes(prepared.resolved.reference);
    const merged = await mergeDocx(bytes, prepared.values, KNOWN_MERGE_FIELDS);
    const filename = templateDefinition(TEMPLATE_KEY)!
      .filenamePattern.replace('{fy}', prepared.audit.financial_year)
      .replace('{client}', prepared.clientName)
      .replace(/[\\/:*?"<>|]/g, '-');
    const doc = await this.documents.create(ctx, engagementId, {
      title: filename.replace(/\.docx$/i, ''),
      filename,
      contentType: DOCX_CONTENT_TYPE,
      contentBase64: merged.buffer.toString('base64'),
      documentType: 'engagement_letter',
      classification: 'confidential',
    });
    return this.db.withRlsContext(ctx, async (client) => {
      await this.open(client, engagementId, auditId, input.version);
      await this.write(
        client,
        `UPDATE hsdg.tax_audits
            SET appointment_letter_document_id = $2, version = version + 1,
                stage = CASE WHEN stage = 'not_started' THEN 'acceptance' ELSE stage END
          WHERE id = $1`,
        [auditId, doc.id],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.appointment_letter_created',
        objectType: 'tax_audit',
        objectId: auditId,
        after: {
          documentId: doc.id,
          templateVersionId: prepared.resolved.versionId,
          templateVersionNo: prepared.resolved.versionNo,
          missingFields: merged.missing,
        },
      });
      return this.view(client, engagementId, auditId);
    });
  }

  /** Accept the audit: everything in place, then on to Information from client. */
  async accept(
    ctx: RlsContext,
    engagementId: string,
    auditId: string,
    input: TaxAuditAcceptanceStepInput,
  ): Promise<TaxAuditAcceptance> {
    return this.db.withRlsContext(ctx, async (client) => {
      await this.open(client, engagementId, auditId, input.version);
      const view = await this.view(client, engagementId, auditId);
      if (view.missing.length) {
        throw new BadRequestException(`Not yet: ${view.missing.join(' ')}`);
      }
      // The partner was offered when chosen; the COP must still be valid today.
      const partner = view.partners.find((p) => p.employeeId === view.signingPartnerId);
      if (!partner?.offered) {
        throw new ConflictException(
          `${partner?.summary ?? 'The signing partner'}. ${partner?.reason ?? ''} Choose another partner.`.trim(),
        );
      }
      await this.write(
        client,
        `UPDATE hsdg.tax_audits
            SET stage = 'information', accepted_at = now(), accepted_by_employee_id = $2,
                independence_confirmed_at = now(), independence_confirmed_by_employee_id = $2,
                version = version + 1
          WHERE id = $1`,
        [auditId, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'tax_audit.accepted',
        objectType: 'tax_audit',
        objectId: auditId,
        after: {
          formType: view.formType,
          signingPartnerId: view.signingPartnerId,
          previousAuditorChanged: view.previousAuditor.changed,
          independence: view.independence.findings,
        },
      });
      return this.view(client, engagementId, auditId);
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async row(client: PoolClient, engagementId: string, auditId: string, lock = false) {
    const { rows } = await client.query<AuditRow>(
      `SELECT a.id, a.engagement_id, e.entity_id, a.financial_year, a.revision, a.stage,
              a.form_type, a.signing_partner_id, sp.full_name AS signing_partner_name,
              a.independence_confirmed_at, ic.full_name AS independence_confirmed_by_name,
              a.previous_auditor_changed, a.previous_auditor_name,
              a.previous_auditor_letter_document_id, pd.title AS previous_auditor_letter_title,
              a.appointment_letter_document_id, ad.title AS appointment_letter_title,
              a.accepted_at, ab.full_name AS accepted_by_name, a.version
         FROM hsdg.tax_audits a
         JOIN hsdg.engagements e ON e.id = a.engagement_id
         LEFT JOIN hsdg.employees sp ON sp.id = a.signing_partner_id
         LEFT JOIN hsdg.employees ic ON ic.id = a.independence_confirmed_by_employee_id
         LEFT JOIN hsdg.employees ab ON ab.id = a.accepted_by_employee_id
         LEFT JOIN hsdg.documents pd ON pd.id = a.previous_auditor_letter_document_id
         LEFT JOIN hsdg.documents ad ON ad.id = a.appointment_letter_document_id
        WHERE a.id = $1 AND a.engagement_id = $2
        ${lock ? 'FOR UPDATE OF a' : ''}`,
      [auditId, engagementId],
    );
    if (!rows[0]) throw new NotFoundException('Tax audit not found on this engagement.');
    return rows[0];
  }

  /** The audit, locked, for a change: the lead, an open stage and the version read. */
  private async open(
    client: PoolClient,
    engagementId: string,
    auditId: string,
    version: number,
  ): Promise<AuditRow> {
    const a = await this.row(client, engagementId, auditId, true);
    if (!(await this.isLead(client, engagementId))) throw new ForbiddenException(LEAD_ONLY);
    if (a.stage === 'not_applicable') {
      throw new BadRequestException('A tax audit marked not applicable is not accepted.');
    }
    if (!OPEN_STAGES.includes(a.stage)) {
      throw new ConflictException('This tax audit is already accepted.');
    }
    if (a.version !== version) {
      throw new ConflictException(
        'Someone changed this tax audit since you opened it. Reload and try again.',
      );
    }
    return a;
  }

  private async isLead(client: PoolClient, engagementId: string): Promise<boolean> {
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT hsdg.is_engagement_lead($1) AS ok`,
      [engagementId],
    );
    return rows[0]?.ok === true;
  }

  private async limit(client: PoolClient): Promise<number> {
    const { rows } = await client.query<{ tax_audit_limit: number }>(
      `SELECT tax_audit_limit FROM hsdg.firm_settings LIMIT 1`,
    );
    return rows[0]?.tax_audit_limit ?? 60;
  }

  private async partners(
    client: PoolClient,
    a: Pick<AuditRow, 'financial_year' | 'signing_partner_id' | 'revision'>,
    limit: number,
  ): Promise<TaxAuditSigningPartner[]> {
    const today = istToday(new Date());
    const { rows } = await client.query<PartnerRow>(
      `SELECT employee_id, full_name, cop_no, cop_valid_until::text, reports
         FROM hsdg.tax_audit_signing_partners($1)`,
      [a.financial_year],
    );
    return rows.map((p) => {
      const current = p.employee_id === a.signing_partner_id;
      // A revised report is the same report: it does not take a new place.
      const offer = signingPartnerOffer(
        { name: p.full_name, copValidUntil: p.cop_valid_until, reports: p.reports },
        limit,
        a.financial_year,
        today,
        current || a.revision > 0,
      );
      return {
        employeeId: p.employee_id,
        name: p.full_name,
        copNo: p.cop_no,
        copValidUntil: p.cop_valid_until,
        reports: p.reports,
        ...offer,
      };
    });
  }

  private async assertOffered(client: PoolClient, a: AuditRow, partnerId: string): Promise<void> {
    const limit = await this.limit(client);
    const p = (await this.partners(client, a, limit)).find((x) => x.employeeId === partnerId);
    if (!p) {
      throw new BadRequestException(
        'Only a partner of the firm signs a tax audit report; choose one from the list.',
      );
    }
    if (!p.offered) {
      throw new ConflictException(`${p.summary}. ${p.reason ?? ''}`.trim());
    }
  }

  private async write(client: PoolClient, sql: string, values: unknown[]): Promise<void> {
    try {
      await client.query(sql, values);
    } catch (err) {
      const refusal = signingRefusal(err);
      if (refusal) throw new ConflictException(refusal);
      throw err;
    }
  }

  private async view(
    client: PoolClient,
    engagementId: string,
    auditId: string,
  ): Promise<TaxAuditAcceptance> {
    const a = await this.row(client, engagementId, auditId);
    const kind = await client.query<{ category: string | null }>(
      `SELECT et.category FROM hsdg.entities e
         LEFT JOIN hsdg.entity_types et ON et.id = e.entity_type_id
        WHERE e.id = $1`,
      [a.entity_id],
    );
    const facts = await client.query<{
      engagement_id: string;
      engagement_code: string;
      financial_year: string;
      fact: IndependenceFactKind;
    }>(
      `SELECT engagement_id, engagement_code, financial_year, fact
         FROM hsdg.entity_independence_facts($1)`,
      [a.entity_id],
    );
    const independence = taxAuditIndependence(
      kind.rows[0]?.category === 'company',
      a.financial_year,
      facts.rows.map((f) => ({
        engagementId: f.engagement_id,
        engagementCode: f.engagement_code,
        financialYear: f.financial_year,
        fact: f.fact,
      })),
    );
    const limit = await this.limit(client);
    const partners = await this.partners(client, a, limit);
    const lead = await this.isLead(client, engagementId);
    return {
      auditId: a.id,
      engagementId: a.engagement_id,
      financialYear: a.financial_year,
      stage: a.stage,
      formType: a.form_type,
      signingPartnerId: a.signing_partner_id,
      signingPartnerName: a.signing_partner_name,
      independence: {
        ...independence,
        confirmedAt: a.independence_confirmed_at?.toISOString() ?? null,
        confirmedByName: a.independence_confirmed_by_name,
      },
      previousAuditor: {
        changed: a.previous_auditor_changed,
        name: a.previous_auditor_name,
        letterDocumentId: a.previous_auditor_letter_document_id,
        letterTitle: a.previous_auditor_letter_title,
      },
      appointmentLetter: a.appointment_letter_document_id
        ? {
            documentId: a.appointment_letter_document_id,
            title: a.appointment_letter_title ?? 'Appointment letter',
          }
        : null,
      acceptedAt: a.accepted_at?.toISOString() ?? null,
      acceptedByName: a.accepted_by_name,
      limit,
      partners,
      missing: acceptanceMissing({
        independenceOk: independence.ok,
        formType: a.form_type,
        signingPartnerId: a.signing_partner_id,
        previousAuditorChanged: a.previous_auditor_changed,
        previousAuditorName: a.previous_auditor_name,
        previousAuditorLetterDocumentId: a.previous_auditor_letter_document_id,
        appointmentLetterDocumentId: a.appointment_letter_document_id,
      }),
      canEdit: lead && OPEN_STAGES.includes(a.stage),
      version: a.version,
    };
  }
}
