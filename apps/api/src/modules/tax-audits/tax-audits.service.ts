import { Injectable, NotFoundException } from '@nestjs/common';
import type { FilingStatus, TaxAuditForm, TaxAuditRow, TaxAuditStage } from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { istToday } from '../engagements/time/auto-time';

interface Row {
  id: string;
  engagement_id: string;
  financial_year: string;
  revision: number;
  stage: TaxAuditStage;
  form_type: TaxAuditForm | null;
  signing_partner_id: string | null;
  signing_partner_name: string | null;
  applicability_reason: string | null;
  udin: string | null;
  signed_at: Date | null;
  uploaded_on: string | null;
  client_accepted_on: string | null;
  client_rejected_on: string | null;
  filed_on: string | null;
  acknowledgement_no: string | null;
  instance_id: string | null;
  filing_status: FilingStatus | null;
  due_date: string | null;
  days_left: number | null;
}

export function toTaxAuditRow(r: Row): TaxAuditRow {
  return {
    id: r.id,
    engagementId: r.engagement_id,
    financialYear: r.financial_year,
    revision: r.revision,
    stage: r.stage,
    formType: r.form_type,
    signingPartnerId: r.signing_partner_id,
    signingPartnerName: r.signing_partner_name,
    applicabilityReason: r.applicability_reason,
    udin: r.udin,
    signedAt: r.signed_at ? r.signed_at.toISOString() : null,
    uploadedOn: r.uploaded_on,
    clientAcceptedOn: r.client_accepted_on,
    clientRejectedOn: r.client_rejected_on,
    filedOn: r.filed_on,
    acknowledgementNo: r.acknowledgement_no,
    instanceId: r.instance_id,
    filingStatus: r.filing_status,
    dueDate: r.due_date,
    daysLeft: r.days_left,
  };
}

/**
 * Tax Audit (Phase 3, F-1): the engagement's audits, one a year, newest first,
 * each with its report filing's due date. Everything is read under RLS — whoever
 * sees the engagement's filings sees its audits.
 */
@Injectable()
export class TaxAuditsService {
  constructor(private readonly db: DatabaseService) {}

  async forEngagement(ctx: RlsContext, engagementId: string): Promise<TaxAuditRow[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await client.query(`SELECT 1 FROM hsdg.engagements WHERE id = $1`, [
        engagementId,
      ]);
      if (!eng.rowCount) throw new NotFoundException('Engagement not found.');
      const { rows } = await client.query<Row>(
        `SELECT a.id, a.engagement_id, a.financial_year, a.revision, a.stage, a.form_type,
                a.signing_partner_id, sp.full_name AS signing_partner_name,
                COALESCE(a.applicability_reason,
                         CASE WHEN d.override_applicable IS NOT NULL
                              THEN 'Decided: ' || d.override_reason
                              ELSE d.computed_reason END) AS applicability_reason,
                a.udin, a.signed_at,
                a.uploaded_on::text, a.client_accepted_on::text, a.client_rejected_on::text,
                a.filed_on::text, a.acknowledgement_no,
                ci.id AS instance_id, ci.workflow_status AS filing_status,
                x.due::text AS due_date,
                CASE WHEN ci.workflow_status IN ('filed', 'not_applicable') THEN NULL
                     ELSE x.due - $2::date END AS days_left
           FROM hsdg.tax_audits a
           LEFT JOIN hsdg.employees sp ON sp.id = a.signing_partner_id
           LEFT JOIN hsdg.tax_audit_applicability d
                  ON d.engagement_id = a.engagement_id AND d.financial_year = a.financial_year
           LEFT JOIN hsdg.compliance_instances ci ON ci.id = a.compliance_instance_id
           LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
           LEFT JOIN LATERAL (SELECT COALESCE(ci.statutory_deadline_override, ge.revised_due_date,
                                              ci.statutory_deadline) AS due) x ON true
          WHERE a.engagement_id = $1
          ORDER BY a.financial_year DESC, a.revision DESC`,
        [engagementId, istToday(new Date())],
      );
      return rows.map(toTaxAuditRow);
    });
  }
}
