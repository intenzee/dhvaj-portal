import type { PoolClient } from 'pg';
import { seedChecklistForInstance } from '../compliance/compliance-checklist';
import { formatLongDate } from '../statutory-audit/acceptance-merge-values';
import { periodLabel } from './filing-rules';

/**
 * Staff Workflow WF-302 — the shared rules for chasing a client on a filing:
 * which upload slots the client fills, when a request is reminded and
 * escalated, and the reminder wording. Used by the monthly scheduler, the
 * filing's "Waiting on client" panel and filing-run bulk reminders.
 */

/**
 * The client's phone for a reminder: the primary contact's, else the oldest
 * with one. `entityId` is the SQL expression for the client (entity) id.
 */
export function clientPhoneSql(entityId: string): string {
  return `(SELECT c.phone FROM hsdg.entity_contacts c
            WHERE c.entity_id = ${entityId} AND NULLIF(trim(c.phone), '') IS NOT NULL
            ORDER BY c.is_primary DESC, c.created_at LIMIT 1)`;
}

/**
 * Upload slots the CLIENT fills (registers, statements, certificates from a
 * CS). Everything else on a checklist is the firm's own working. Client
 * approval of tax payable is client-side too but follows the working, so it is
 * never part of the opening request.
 */
export const CLIENT_DATA_SLOTS: readonly string[] = [
  'SALES_REGISTER',
  'PURCHASE_REGISTER',
  'IRN_REPORT',
  'EWB_REPORT',
  'CNDN_REGISTER',
  'EXPORT_DOCS',
  'BILLS_OF_ENTRY',
  'REGISTERS',
  'CLIENT_DATA',
  'BANK_STATEMENT',
  'IT_DATA',
  'DEDUCTEE_DATA',
  'MSME_DATA',
  'DPT_DATA',
  'PAS6_DATA',
  'KYC_DOCS',
  'OFFICE_PROOF',
  'UTILITY_BILL',
  'OWNER_NOC',
  'SANCTION_LETTER',
  'CHARGE_INSTRUMENT',
  'RESIGNATION',
  'ALLOTTEE_LIST',
  'SH_LIST',
  'LLP_PARTNERS',
  'LLP_ACCOUNTS',
  'FS_SIGNED',
  'AUDITOR_CONSENT',
  'MGT8',
  'MR3',
];

/** Firm policy (firm_settings): remind T-7, escalate T-3 against the internal date. */
export interface ChasingPolicy {
  reminderDays: number;
  escalationDays: number;
}
export const DEFAULT_CHASING_POLICY: ChasingPolicy = { reminderDays: 7, escalationDays: 3 };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A request's reminder and escalation dates from the filing's internal due
 * date — never in the past (a late request is reminded today, escalated no
 * earlier than its reminder). Null without an internal date. Pure — tested.
 */
export function chasingDates(
  internalDate: string | null,
  today: string,
  policy: ChasingPolicy = DEFAULT_CHASING_POLICY,
): { reminderDate: string | null; escalationDate: string | null } {
  if (!internalDate) return { reminderDate: null, escalationDate: null };
  const max = (a: string, b: string): string => (a > b ? a : b);
  const reminderDate = max(addDays(internalDate, -policy.reminderDays), today);
  const escalationDate = max(addDays(internalDate, -policy.escalationDays), reminderDate);
  return { reminderDate, escalationDate };
}

/** "Sales register received" → "Sales register" (the checklist says what's done). */
export function slotItemLabel(label: string): string {
  return label.replace(/\s+(received|downloaded|listed|matched)$/i, '').trim();
}

/**
 * The reminder to the client, as e-mail body or text to paste into WhatsApp.
 * One line per item, with its upload link when one was minted. Pure — tested.
 */
export function reminderText(r: {
  entityName: string;
  formLabel: string;
  periodKey: string | null;
  items: { label: string; uploadUrl?: string | null }[];
  dueBy: string | null;
  firmName?: string | null;
}): string {
  const period = periodLabel(r.periodKey);
  const what = [r.formLabel, period].filter(Boolean).join(' for ');
  const lines = r.items.map((i) => `• ${i.label}${i.uploadUrl ? `: ${i.uploadUrl}` : ''}`);
  // The client reads "by 15 October 2026", not the ISO date.
  const by = r.dueBy ? ` by ${formatLongDate(r.dueBy)}` : '';
  const hasLinks = r.items.some((i) => i.uploadUrl);
  return [
    `Dear ${r.entityName},`,
    '',
    `To prepare your ${what}, we still need${by}:`,
    ...lines,
    '',
    hasLinks
      ? 'Please upload each using its secure link above (no login needed).'
      : 'Please share them at the earliest.',
    '',
    `Thank you${r.firmName ? `,\n${r.firmName}` : '.'}`,
  ].join('\n');
}

export async function chasingPolicy(client: PoolClient): Promise<ChasingPolicy> {
  const { rows } = await client.query<{ r: number; e: number }>(
    `SELECT client_reminder_days AS r, client_escalation_days AS e FROM hsdg.firm_settings LIMIT 1`,
  );
  const row = rows[0];
  return row ? { reminderDays: row.r, escalationDays: row.e } : DEFAULT_CHASING_POLICY;
}

export interface RaisedRequest {
  dependencyId: string;
  slotCode: string;
  label: string;
}

/**
 * Raise one client request per required client-data slot on the filing that
 * is still empty and has never been asked for (an open or received request on
 * the slot means it was) — so a re-run is a no-op. Each request is owned by
 * the filing's preparer (else its manager), dated from the internal due date
 * and linked to its checklist step. Seeds the checklist first. Runs in the
 * caller's transaction.
 */
export async function raiseSlotRequests(
  client: PoolClient,
  instanceId: string,
  opts: { today: string; createdBy: string | null; policy: ChasingPolicy },
): Promise<RaisedRequest[]> {
  await seedChecklistForInstance(client, instanceId);
  const meta = await client.query<{
    engagement_id: string;
    form: string;
    period_key: string | null;
    internal_date: string | null;
    task_id: string | null;
    owner: string | null;
  }>(
    `SELECT ci.engagement_id, COALESCE(ci.form_label, rv.form_label, cr.name) AS form,
            ci.period_key,
            COALESCE(ci.internal_sla_override, ci.internal_sla_date)::text AS internal_date,
            t.id AS task_id,
            COALESCE(t.assigned_to_employee_id, e.engagement_manager_id,
                     e.engagement_partner_id) AS owner
       FROM hsdg.compliance_instances ci
       JOIN hsdg.engagements e ON e.id = ci.engagement_id
       JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
       LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
       LEFT JOIN LATERAL (
         SELECT t.id, t.assigned_to_employee_id FROM hsdg.tasks t
          WHERE t.source_compliance_instance_id = ci.id AND t.status <> 'cancelled'
          ORDER BY t.created_at DESC LIMIT 1) t ON true
      WHERE ci.id = $1`,
    [instanceId],
  );
  const inst = meta.rows[0];
  if (!inst) return [];
  const { rows } = await client.query<{ slot_code: string; label: string }>(
    `SELECT DISTINCT ON (it.slot_code) it.slot_code, it.label
       FROM hsdg.instance_checklist_items it
      WHERE it.compliance_instance_id = $1 AND it.required AND it.status = 'open'
        AND it.auto_tick = 'document' AND it.document_id IS NULL
        AND it.slot_code = ANY($2::text[])
        AND NOT EXISTS (SELECT 1 FROM hsdg.client_dependencies d
                         WHERE d.compliance_instance_id = it.compliance_instance_id
                           AND d.slot_code = it.slot_code
                           AND d.status NOT IN ('cancelled', 'waived'))
      ORDER BY it.slot_code, it.sequence`,
    [instanceId, CLIENT_DATA_SLOTS],
  );
  const dates = chasingDates(inst.internal_date, opts.today, opts.policy);
  const what = [inst.form, periodLabel(inst.period_key)].filter(Boolean).join(' ');
  const raised: RaisedRequest[] = [];
  for (const r of rows) {
    const label = slotItemLabel(r.label);
    const ins = await client.query<{ id: string }>(
      `INSERT INTO hsdg.client_dependencies
         (engagement_id, requested_info, responsible_employee_id, created_by_employee_id,
          reminder_date, escalation_date, engagement_service_id, compliance_instance_id,
          task_id, period_section, slot_code)
       SELECT ci.engagement_id, $2, $3, $4, $5::date, $6::date, ci.engagement_service_id,
              ci.id, $7, ci.section, $8
         FROM hsdg.compliance_instances ci WHERE ci.id = $1
       RETURNING id`,
      [
        instanceId,
        `${label} — ${what}`,
        inst.owner,
        opts.createdBy,
        dates.reminderDate,
        dates.escalationDate,
        inst.task_id,
        r.slot_code,
      ],
    );
    const dependencyId = ins.rows[0]!.id;
    await client.query(
      `UPDATE hsdg.instance_checklist_items
          SET client_dependency_id = $1, version = version + 1
        WHERE compliance_instance_id = $2 AND slot_code = $3 AND status = 'open'`,
      [dependencyId, instanceId, r.slot_code],
    );
    raised.push({ dependencyId, slotCode: r.slot_code, label });
  }
  return raised;
}
