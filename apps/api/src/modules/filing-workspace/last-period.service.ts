import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ChecklistItemStatus,
  FilingReferenceKind,
  FilingStatus,
  LastPeriodView,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { PREVIOUS_INSTANCE_SQL } from '../compliance/compliance-checklist';
import { periodLabel } from './filing-rules';

/**
 * Staff Workflow WF-303 — last period beside this one. The client's previous
 * period of the same return (same rule, registration and section), read-only:
 * its uploads by slot, checklist answers, filed reference and the review points
 * given when its task was returned. Everything runs under the caller's RLS — a
 * filing they cannot see is a 404, a previous period they cannot see is none.
 */
@Injectable()
export class LastPeriodService {
  constructor(private readonly db: DatabaseService) {}

  async get(ctx: RlsContext, id: string): Promise<LastPeriodView> {
    return this.db.withRlsContext(ctx, async (client) => {
      const seen = await client.query(`SELECT 1 FROM hsdg.compliance_instances WHERE id = $1`, [
        id,
      ]);
      if (seen.rowCount === 0) throw new NotFoundException('Filing not found.');
      const prev = (await client.query<{ id: string }>(PREVIOUS_INSTANCE_SQL, [id])).rows[0];
      if (!prev) return { previous: null };
      const p = prev.id;

      // One client runs one query at a time; keep these sequential.
      const inst = (
        await client.query<{
          engagement_id: string;
          form_label: string | null;
          rule_name: string;
          financial_year: string | null;
          period_key: string | null;
          due: string;
          workflow_status: FilingStatus;
        }>(
          `SELECT ci.engagement_id, COALESCE(ci.form_label, rv.form_label) AS form_label,
                  cr.name AS rule_name, ci.financial_year, ci.period_key,
                  COALESCE(ci.statutory_deadline_override, ci.statutory_deadline)::text AS due,
                  ci.workflow_status
             FROM hsdg.compliance_instances ci
             JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
             LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
            WHERE ci.id = $1`,
          [p],
        )
      ).rows[0]!;
      const filing = (
        await client.query<{
          reference_kind: FilingReferenceKind;
          reference_no: string;
          filed_on: string;
          filed_by_name: string | null;
          is_nil: boolean;
          ack_document_id: string;
        }>(
          `SELECT fr.reference_kind, fr.reference_no, fr.filed_on::text, fe.full_name AS filed_by_name,
                  fr.is_nil, fr.ack_document_id
             FROM hsdg.filing_records fr
             LEFT JOIN hsdg.employees fe ON fe.id = fr.filed_by_employee_id
            WHERE fr.compliance_instance_id = $1 AND fr.undone_at IS NULL
            ORDER BY fr.created_at DESC
            LIMIT 1`,
          [p],
        )
      ).rows[0];
      const items = await client.query<{
        item_code: string;
        label: string;
        slot_code: string | null;
        status: ChecklistItemStatus;
        done_note: string | null;
        na_reason: string | null;
        done_by_name: string | null;
        done_at: Date | null;
      }>(
        `SELECT it.item_code, it.label, it.slot_code, it.status, it.done_note, it.na_reason,
                e.full_name AS done_by_name, it.done_at
           FROM hsdg.instance_checklist_items it
           LEFT JOIN hsdg.employees e ON e.id = it.done_by_employee_id
          WHERE it.compliance_instance_id = $1
          ORDER BY it.sequence, it.item_code`,
        [p],
      );
      const docs = await client.query<{
        id: string;
        title: string;
        slot_code: string | null;
        filename: string | null;
        created_at: Date;
        uploaded_by_name: string | null;
        from_client: boolean;
      }>(
        `SELECT d.id, d.title, d.slot_code, cv.filename, d.created_at,
                ce.full_name AS uploaded_by_name,
                (d.client_dependency_id IS NOT NULL AND d.created_by_employee_id IS NULL) AS from_client
           FROM hsdg.documents d
           LEFT JOIN hsdg.document_versions cv ON cv.id = d.current_version_id
           LEFT JOIN hsdg.employees ce ON ce.id = d.created_by_employee_id
          WHERE d.compliance_instance_id = $1 AND d.status = 'active' AND d.deleted_at IS NULL
          ORDER BY d.created_at`,
        [p],
      );
      const points = await client.query<{ at: Date; by_name: string | null; note: string }>(
        `SELECT ev.created_at AS at, e.full_name AS by_name, ev.reason AS note
           FROM hsdg.task_events ev
           JOIN hsdg.tasks t ON t.id = ev.task_id
           LEFT JOIN hsdg.employees e ON e.id = ev.actor_employee_id
          WHERE t.source_compliance_instance_id = $1
            AND ev.from_status = 'in_review' AND ev.to_status = 'todo'
            AND ev.reason IS NOT NULL
          ORDER BY ev.created_at`,
        [p],
      );

      // Slots in checklist order, then any a document was filed under that the checklist lacks.
      const order: { code: string; label: string }[] = [];
      for (const it of items.rows) {
        if (it.slot_code && !order.some((o) => o.code === it.slot_code)) {
          order.push({ code: it.slot_code, label: it.label });
        }
      }
      for (const d of docs.rows) {
        if (d.slot_code && !order.some((o) => o.code === d.slot_code)) {
          order.push({ code: d.slot_code, label: d.slot_code });
        }
      }
      const slots = order
        .map((o) => ({
          slotCode: o.code,
          label: o.label,
          documents: docs.rows
            .filter((d) => d.slot_code === o.code)
            .map((d) => ({
              id: d.id,
              title: d.title,
              filename: d.filename,
              uploadedAt: d.created_at.toISOString(),
              uploadedByName: d.uploaded_by_name,
              fromClient: d.from_client,
            })),
        }))
        .filter((s) => s.documents.length > 0);

      return {
        previous: {
          instanceId: p,
          engagementId: inst.engagement_id,
          formLabel: inst.form_label,
          ruleName: inst.rule_name,
          financialYear: inst.financial_year,
          periodKey: inst.period_key,
          periodLabel: periodLabel(inst.period_key),
          statutoryDueDate: inst.due,
          workflowStatus: inst.workflow_status,
          filing: filing
            ? {
                referenceKind: filing.reference_kind,
                referenceNo: filing.reference_no,
                filedOn: filing.filed_on,
                filedByName: filing.filed_by_name,
                isNil: filing.is_nil,
                ackDocumentId: filing.ack_document_id,
              }
            : null,
          checklist: items.rows.map((it) => ({
            itemCode: it.item_code,
            label: it.label,
            status: it.status,
            doneNote: it.done_note,
            naReason: it.na_reason,
            doneByName: it.done_by_name,
            doneAt: it.done_at ? it.done_at.toISOString() : null,
          })),
          slots,
          reviewPoints: points.rows.map((r) => ({
            at: r.at.toISOString(),
            byName: r.by_name,
            note: r.note,
          })),
        },
      };
    });
  }
}
