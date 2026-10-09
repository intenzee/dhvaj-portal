import type { PoolClient } from 'pg';
import {
  CASH_FLOW_STATUS_LABEL,
  COMPARATIVES_STATUS_LABEL,
  DISCLOSURE_CATEGORY_LABEL,
  FRAMEWORK_AREA_KEY,
  SCH01_RESULT_LABEL,
  SCHEDULE_III_OUTCOME_LABEL,
  SPECIALISED_EFFECT_LABEL,
  SPECIALISED_EFFECT,
  SUB_SECTION_KEY,
  type ScheduleIiiCapturedFacts,
  type ScheduleIiiDetail,
  type ScheduleIiiOutcome,
} from '@hsdg/contracts';
import { formatLongDate } from './acceptance-merge-values';

/** The 02.3 assessment as stored — what the memo and the FS workbook merge from. */
export interface ScheduleIiiMemoInput {
  systemOutcome: string | null;
  systemBasis: string | null;
  conclusion: string | null;
  basis: string | null;
  isOverridden: boolean;
  decidedByName: string | null;
  decidedAt: string | null;
  professionalAction: string | null;
  pendingReason: string | null;
  partnerApprovedByName: string | null;
  partnerApprovedAt: string | null;
  detail: ScheduleIiiDetail | null;
  facts: ScheduleIiiCapturedFacts;
}

/** Read the 02.3 sub-assessment of a workflow (null when 02.3 is not open). */
export async function readScheduleIiiMemoInput(
  client: PoolClient,
  workflowInstanceId: string,
): Promise<ScheduleIiiMemoInput | null> {
  const { rows } = await client.query<{
    system_outcome: string | null;
    system_basis: string | null;
    conclusion: string | null;
    basis: string | null;
    is_overridden: boolean;
    decided_by_name: string | null;
    decided_at: Date | null;
    professional_action: string | null;
    pending_reason: string | null;
    partner_name: string | null;
    partner_approved_at: Date | null;
    system_detail: ScheduleIiiDetail | null;
    facts: ScheduleIiiCapturedFacts | null;
  }>(
    `SELECT s.system_outcome, s.system_basis, s.conclusion, s.basis, s.is_overridden,
            d.full_name AS decided_by_name, s.decided_at, s.professional_action, s.pending_reason,
            p.full_name AS partner_name, s.partner_approved_at, s.system_detail, s.facts
       FROM hsdg.audit_framework_subassessment s
       LEFT JOIN hsdg.employees d ON d.id = s.decided_by_employee_id
       LEFT JOIN hsdg.employees p ON p.id = s.partner_approved_by_employee_id
      WHERE s.workflow_instance_id = $1 AND s.sub_section_key = $2 AND s.area_key = $3`,
    [workflowInstanceId, SUB_SECTION_KEY.scheduleIii, FRAMEWORK_AREA_KEY.scheduleIii],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    systemOutcome: r.system_outcome,
    systemBasis: r.system_basis,
    conclusion: r.conclusion,
    basis: r.basis,
    isOverridden: r.is_overridden,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    professionalAction: r.professional_action,
    pendingReason: r.pending_reason,
    partnerApprovedByName: r.partner_name,
    partnerApprovedAt: r.partner_approved_at ? r.partner_approved_at.toISOString() : null,
    detail: r.system_detail,
    facts: r.facts ?? {},
  };
}

const outcomeLabel = (o: string | null): string | null =>
  o ? (SCHEDULE_III_OUTCOME_LABEL[o as ScheduleIiiOutcome] ?? o.replace(/_/g, ' ')) : null;
const rupees = (n: number): string => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * The `sch.*` merge values of the 02.3 technical memo and the FS workbook
 * (02.3 spec §16, §17): the stored assessment as display text. Pure; an absent
 * assessment or fact leaves the field blank so the file shows its `[label]`
 * gap rather than a guess.
 */
export function scheduleIiiMergeValues(
  m: ScheduleIiiMemoInput | null,
): Record<string, string | null> {
  if (!m) return {};
  const t = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);
  const d = m.detail;
  const decided = m.conclusion !== null;
  const fv = d?.frameworkVersion ?? null;
  const required = (d?.componentLines ?? []).filter((c) => c.required);
  const sp = d?.specialised;
  const r = d?.rounding;
  const pm = d?.presentationMateriality;
  const library = (d?.disclosureLibrary ?? []).filter((x) => x.applicability !== 'not_triggered');
  const categories = [...new Set(library.map((x) => DISCLOSURE_CATEGORY_LABEL[x.category]))];
  const unit = r?.selectedUnit ?? r?.systemUnit ?? null;
  const partnerRequired =
    m.isOverridden || (sp?.answer === 'yes' && sp.effect === SPECIALISED_EFFECT.replaces);

  return {
    'sch.presentationFramework': outcomeLabel(decided ? m.conclusion : m.systemOutcome),
    'sch.systemConclusion': outcomeLabel(m.systemOutcome),
    'sch.systemBasis': t(m.systemBasis),
    'sch.frameworkVersion': fv
      ? `${fv.title} — ${fv.versionLabel} (in force from ${fv.effectiveFrom}${fv.effectiveTo ? ` to ${fv.effectiveTo}` : ''})` +
        (fv.notificationReference ? `; ${fv.notificationReference}` : '')
      : null,
    'sch.guidanceVersion': t(fv?.guidanceVersion),
    'sch.components': required.length
      ? required.map((c) => (c.includesOci ? `${c.label} (with OCI)` : c.label)).join('; ')
      : null,
    'sch.cashFlow': d?.cashFlow
      ? `${CASH_FLOW_STATUS_LABEL[d.cashFlow.status]} — ${d.cashFlow.basis}`
      : d
        ? d.cashFlowRequired
          ? 'Required'
          : `Exempt — ${d.cashFlowExemptionReason ?? 'section 2(40) proviso'}`
        : null,
    'sch.rounding': r
      ? unit
        ? `${unit}${r.permittedUnits.length ? ` (permitted: ${r.permittedUnits.join(', ')})` : ''}` +
          (r.overridden && r.reason
            ? ` — changed from ${r.systemUnit ?? '—'}: ${r.reason.trim().replace(/\.+$/, '')}`
            : '') +
          (t(r.basis) ? `. ${r.basis.trim()}` : '')
        : t(r.basis)
      : null,
    'sch.presentationMateriality': pm
      ? `${pm.label}: ${pm.amount !== null ? rupees(pm.amount) : 'not determinable'}` +
        (t(pm.basis) ? ` — ${pm.basis.trim()}` : '')
      : null,
    'sch.specialisedFormat': sp
      ? sp.answer === 'yes'
        ? [
            'Yes',
            t(sp.governingAuthority),
            t(sp.frameworkName),
            sp.effect ? SPECIALISED_EFFECT_LABEL[sp.effect] : null,
            t(sp.effectiveVersion),
          ]
            .filter(Boolean)
            .join(' — ')
        : sp.answer === 'no'
          ? 'No'
          : SCH01_RESULT_LABEL[sp.sch01]
      : null,
    'sch.comparatives': d?.comparatives
      ? `${COMPARATIVES_STATUS_LABEL[d.comparatives.status]}` +
        (d.comparatives.priorPeriod ? ` — prior period ${d.comparatives.priorPeriod}` : '') +
        (t(d.comparatives.basis) ? `. ${d.comparatives.basis.trim()}` : '')
      : null,
    'sch.disclosureLibrary': library.length
      ? `${library.length} requirement${library.length === 1 ? '' : 's'}` +
        (fv ? ` of ${fv.title}` : '') +
        (categories.length ? `: ${categories.join('; ')}` : '')
      : null,
    'sch.factsUsed': d?.factsUsed?.length
      ? d.factsUsed.map((f) => `${f.label}: ${f.value} (${f.source})`).join('; ')
      : null,
    'sch.rulesApplied': d?.rulesApplied?.length
      ? d.rulesApplied.map((x) => `${x.ruleCode} — ${x.label} (${x.condition})`).join('; ')
      : null,
    'sch.professionalConclusion': decided
      ? outcomeLabel(m.conclusion)
      : m.professionalAction === 'information_pending'
        ? 'Information Pending'
        : 'Not yet concluded',
    'sch.overridden': m.isOverridden ? 'Yes' : 'No',
    'sch.overrideReason': m.isOverridden ? t(m.basis) : 'Not applicable',
    'sch.technicalBasis': m.isOverridden ? t(m.facts.technicalBasis) : 'Not applicable',
    'sch.partnerApproval': m.partnerApprovedAt
      ? `Approved by ${m.partnerApprovedByName ?? 'the Engagement Partner'} on ${formatLongDate(m.partnerApprovedAt.slice(0, 10))}`
      : partnerRequired
        ? 'Pending — Engagement Partner approval required'
        : 'Not required',
    'sch.pendingReason':
      m.professionalAction === 'information_pending' ? t(m.pendingReason) : 'None',
    'sch.decidedBy': decided ? t(m.decidedByName) : null,
    'sch.decidedAt': decided && m.decidedAt ? formatLongDate(m.decidedAt.slice(0, 10)) : null,
  };
}
