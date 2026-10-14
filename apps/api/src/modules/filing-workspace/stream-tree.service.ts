import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  FilingStatus,
  PeriodSection,
  Stream,
  StreamTree,
  TreeItem,
  TreePeriod,
  TreeRegistration,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { istToday } from '../engagements/time/auto-time';
import { seedChecklistForInstance } from '../compliance/compliance-checklist';
import {
  fyMonths,
  isAnnualKey,
  lastMonthOfQuarter,
  nextActionText,
  periodLabel,
  quarterOfMonth,
} from './filing-rules';

interface TreeRow {
  id: string;
  rule_code: string;
  label: string;
  section: PeriodSection | null;
  period_key: string | null;
  financial_year: string | null;
  due: string;
  workflow_status: FilingStatus;
  filed_on: string | null;
  is_provisional: boolean;
  verification: string | null;
  required_done: number;
  required_total: number;
  pending_label: string | null;
  has_items: boolean;
}

const STREAM_SQL = `COALESCE(rv.stream, sv.stream)`;
const CLOSED = new Set<FilingStatus>(['filed', 'not_applicable']);

/**
 * Change 5 — the year → period tree behind each stream tab (GSTIN bar, year
 * selector, annual strip, twelve months or the stream's periods, each with its
 * sections, due dates, status and next action). RLS scopes it to members.
 */
@Injectable()
export class StreamTreeService {
  constructor(private readonly db: DatabaseService) {}

  async tree(
    ctx: RlsContext,
    engagementId: string,
    stream: Stream,
    query: { registrationId?: string; fy?: string },
  ): Promise<StreamTree> {
    return this.db.withRlsContext(ctx, async (client) => {
      const eng = await client.query<{ is_member: boolean }>(
        `SELECT hsdg.is_engagement_member(e.id) AS is_member FROM hsdg.engagements e WHERE e.id = $1`,
        [engagementId],
      );
      if (!eng.rows[0]) throw new NotFoundException('Engagement not found.');

      const regs = await client.query<{
        id: string;
        number: string;
        type: string;
        state_code: string | null;
        gst_scheme: string | null;
        qrmp_category: string | null;
      }>(
        `SELECT DISTINCT ON (r.id) r.id, r.registration_number AS number, r.registration_type AS type,
                r.state_code, p.gst_scheme, p.qrmp_category
           FROM hsdg.compliance_instances ci
           JOIN hsdg.entity_registrations r ON r.id = ci.registration_id
           LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
           LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
           LEFT JOIN hsdg.services sv ON sv.id = es.service_id
           LEFT JOIN LATERAL (
             SELECT p.gst_scheme, p.qrmp_category FROM hsdg.registration_compliance_profiles p
              WHERE p.registration_id = r.id AND p.effective_from <= CURRENT_DATE
              ORDER BY p.effective_from DESC LIMIT 1) p ON true
          WHERE ci.engagement_id = $1 AND ${STREAM_SQL} = $2
          ORDER BY r.id, r.is_principal DESC NULLS LAST`,
        [engagementId, stream],
      );
      const registrations: TreeRegistration[] = regs.rows
        .map((r) => ({
          id: r.id,
          number: r.number,
          type: r.type,
          stateCode: r.state_code,
          label: [r.number, r.state_code, r.gst_scheme].filter(Boolean).join(' · '),
          gstScheme: r.gst_scheme,
          qrmpCategory: r.qrmp_category,
        }))
        .sort((a, b) => a.number.localeCompare(b.number));
      const registrationId =
        (query.registrationId && registrations.find((r) => r.id === query.registrationId)?.id) ||
        registrations[0]?.id ||
        null;

      // Years in scope, newest first; default = the FY of the earliest open item.
      const years = await client.query<{ fy: string; first_open: string | null }>(
        `SELECT ci.financial_year AS fy,
                min(COALESCE(ci.statutory_deadline_override, ci.statutory_deadline))
                  FILTER (WHERE ci.workflow_status NOT IN ('filed','not_applicable'))::text AS first_open
           FROM hsdg.compliance_instances ci
           LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
           LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
           LEFT JOIN hsdg.services sv ON sv.id = es.service_id
          WHERE ci.engagement_id = $1 AND ${STREAM_SQL} = $2 AND ci.financial_year IS NOT NULL
            AND ($3::uuid IS NULL OR ci.registration_id = $3 OR ci.registration_id IS NULL)
          GROUP BY ci.financial_year
          ORDER BY ci.financial_year DESC`,
        [engagementId, stream, registrationId],
      );
      const financialYears = years.rows.map((y) => y.fy);
      const earliestOpen = years.rows
        .filter((y) => y.first_open)
        .sort((a, b) => a.first_open!.localeCompare(b.first_open!))[0]?.fy;
      const financialYear =
        (query.fy && financialYears.includes(query.fy) ? query.fy : null) ??
        earliestOpen ??
        financialYears[0] ??
        query.fy ??
        null;

      const empty: StreamTree = {
        stream,
        registrations,
        registrationId,
        financialYears,
        financialYear,
        annual: [],
        periods: stream === 'gst' && financialYear ? this.gstMonths(financialYear, false) : [],
      };
      if (!financialYear) return empty;

      const select = (): Promise<{ rows: TreeRow[] }> =>
        client.query<TreeRow>(
          `SELECT ci.id, cr.code AS rule_code, COALESCE(ci.form_label, rv.form_label, cr.name) AS label, ci.section,
                  ci.period_key, ci.financial_year,
                  COALESCE(ci.statutory_deadline_override, ge.revised_due_date, ci.statutory_deadline)::text AS due,
                  ci.workflow_status, fr.filed_on::text, ci.is_provisional, rv.verification,
                  COALESCE(ck.required_done, 0) AS required_done, COALESCE(ck.required_total, 0) AS required_total,
                  ck.pending_label, ck.required_total IS NOT NULL AS has_items
             FROM hsdg.compliance_instances ci
             JOIN hsdg.compliance_rules cr ON cr.id = ci.compliance_rule_id
             LEFT JOIN hsdg.compliance_rule_versions rv ON rv.id = ci.compliance_rule_version_id
             LEFT JOIN hsdg.engagement_services es ON es.id = ci.engagement_service_id
             LEFT JOIN hsdg.services sv ON sv.id = es.service_id
             LEFT JOIN hsdg.government_extensions ge ON ge.id = ci.government_extension_id
             LEFT JOIN hsdg.filing_records fr ON fr.compliance_instance_id = ci.id AND fr.undone_at IS NULL
             LEFT JOIN LATERAL (
               SELECT count(*) FILTER (WHERE it.required AND it.status <> 'open')::int AS required_done,
                      count(*) FILTER (WHERE it.required)::int AS required_total,
                      (array_agg(it.label ORDER BY it.sequence)
                         FILTER (WHERE it.required AND it.status = 'open'
                                   AND COALESCE(it.auto_tick, '') NOT IN ('review','lodge')))[1] AS pending_label
                 FROM hsdg.instance_checklist_items it
                WHERE it.compliance_instance_id = ci.id
               HAVING count(*) > 0) ck ON true
            WHERE ci.engagement_id = $1 AND ${STREAM_SQL} = $2 AND ci.financial_year = $3
              AND ($4::uuid IS NULL OR ci.registration_id = $4 OR ci.registration_id IS NULL)
            ORDER BY due, cr.code`,
          [engagementId, stream, financialYear, registrationId],
        );
      let rows = (await select()).rows;
      // Checklists are created lazily; fill them for this year so progress shows.
      const unseeded = rows.filter((r) => !r.has_items && !CLOSED.has(r.workflow_status));
      if (eng.rows[0].is_member && unseeded.length > 0) {
        for (const r of unseeded) await seedChecklistForInstance(client, r.id);
        rows = (await select()).rows;
      }

      const today = istToday(new Date());
      const toItem = (r: TreeRow): TreeItem => ({
        instanceId: r.id,
        ruleCode: r.rule_code,
        label: r.label,
        section: r.section,
        dueDate: r.due,
        workflowStatus: r.workflow_status,
        filedOn: r.filed_on,
        isLate: !!r.filed_on && r.filed_on > r.due,
        isOverdue: !CLOSED.has(r.workflow_status) && r.due < today,
        isProvisional: r.is_provisional,
        verify: r.verification === 'verify',
        requiredDone: r.required_done,
        requiredTotal: r.required_total,
      });

      const annual: TreeItem[] = [];
      const reg = registrations.find((r) => r.id === registrationId);
      const qrmp =
        stream === 'gst' &&
        (!!reg?.qrmpCategory || rows.some((r) => /:Q[1-4]$/.test(r.period_key ?? '')));
      const periods: TreePeriod[] = stream === 'gst' ? this.gstMonths(financialYear, qrmp) : [];
      const byKey = new Map(periods.map((p) => [p.periodKey, p]));
      const pending = new Map<string, TreeRow[]>();

      for (const r of rows) {
        if (!r.period_key || isAnnualKey(r.period_key) || r.period_key.startsWith('EVT:')) {
          annual.push(toItem(r));
          continue;
        }
        let key = r.period_key;
        const q = /^(\d{4}-\d{2}):(Q[1-4])$/.exec(key);
        if (stream === 'gst' && q) key = lastMonthOfQuarter(q[1]!, q[2]!) ?? key;
        let period = byKey.get(key);
        if (!period) {
          period = {
            periodKey: key,
            label: periodLabel(key),
            quarter: q ? q[2]! : null,
            sections: {},
            items: [],
            nextAction: null,
          };
          byKey.set(key, period);
          periods.push(period);
        }
        const item = toItem(r);
        if (r.section) (period.sections[r.section] ??= []).push(item);
        else period.items.push(item);
        if (!CLOSED.has(r.workflow_status)) pending.set(key, [...(pending.get(key) ?? []), r]);
      }

      for (const p of periods) {
        const next = (pending.get(p.periodKey) ?? []).sort((a, b) => a.due.localeCompare(b.due))[0];
        p.nextAction = next
          ? nextActionText({
              label: next.label,
              dueDate: next.due,
              today,
              pendingLabel: next.pending_label,
              workflowStatus: next.workflow_status,
            })
          : null;
      }
      if (stream !== 'gst') {
        periods.sort((a, b) => firstDue(a).localeCompare(firstDue(b)));
      }
      return { ...empty, annual, periods };
    });
  }

  private gstMonths(fy: string, qrmp: boolean): TreePeriod[] {
    return fyMonths(fy).map((m) => ({
      periodKey: m,
      label: periodLabel(m),
      quarter: qrmp ? quarterOfMonth(m) : null,
      sections: {},
      items: [],
      nextAction: null,
    }));
  }
}

function firstDue(p: TreePeriod): string {
  const all = [...p.items, ...Object.values(p.sections).flat()];
  return all.map((i) => i.dueDate).sort()[0] ?? '9999-12-31';
}
