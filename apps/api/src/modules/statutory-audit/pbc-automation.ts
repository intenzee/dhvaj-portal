/**
 * Statutory Audit — the PBC tracker builds itself from the file (Audit Spec §16).
 *
 * Beyond the standard list from the client master, the requests the client
 * will be asked for are read from the rest of the audit file:
 *
 *   • 03.5 audit areas — requests specific to an area (cut-off records for
 *     revenue, actuarial reports for employee benefits …), and every request
 *     is linked to the 03.5 area it supports when the file has one.
 *   • Section 04 risks — the journal-entry listing for management override,
 *     cash-flow forecasts for going concern, workings for estimates.
 *   • the completion stage — representation letter, post-year-end minutes and
 *     the board-approved financial statements, due near the end of the audit.
 *   • last year's tracker — custom requests the team added last year roll
 *     forward.
 *
 * Each suggestion has a stable `sourceKey` (the service logs it, so a request
 * the team deletes is never suggested again), the client role that answers it
 * and a stage that sets its due date. A chase list drafts one reminder per
 * client contact for overdue and due-soon requests.
 *
 * Pure: no database, unit-tested on its own.
 */
import {
  PBC_DUE_SOON_DAYS,
  PBC_OUTSTANDING_STATUSES,
  type AuditPbcItem,
  type PbcChaseGroup,
} from '@hsdg/contracts';
import {
  planStandardPbcList,
  samePbcRequirement,
  type ClientContact,
  type PbcOwnerRole,
  type StandardPbcFacts,
} from './pbc-standard-list';

export type PbcStage = 'planning' | 'fieldwork' | 'completion';

export interface SuggestedPbc {
  sourceKey: string;
  requirement: string;
  ownerRole: PbcOwnerRole;
  /** Work area key to link, when the file has it. */
  workAreaKey: string | null;
  stage: PbcStage;
  sourceNote: string;
}

export interface PbcAreaInput {
  key: string;
  title: string;
}

export interface PbcRiskInput {
  id: string;
  ref: string;
  description: string;
  fsArea: string | null;
  status: string;
}

export interface PriorPbcInput {
  id: string;
  ref: string;
  requirement: string;
}

export interface PbcSuggestionFacts {
  standard: StandardPbcFacts;
  /** Active work areas (framework workstreams and 03.5 `fs_*` areas). */
  areas: readonly PbcAreaInput[];
  risks: readonly PbcRiskInput[];
  /** Last year's tracker, when there is a prior-year file. */
  prior: { financialYear: string; items: readonly PriorPbcInput[] } | null;
}

/** A request topic → the 03.5 area (by name) it belongs to. */
const TOPICS: ReadonlyArray<[RegExp, RegExp]> = [
  [/bank/, /cash|bank/],
  [/receivable/, /receivable|debtor/],
  [/payable/, /payable|creditor/],
  [/inventory|stock/, /^inventor|stock/],
  [/fixed asset/, /property|plant|equipment|fixed asset|ppe/],
  [/loan|borrow|lender/, /borrowing|debenture/],
  [/gst|tds|income-tax|tax/, /tax/],
  [/payroll|actuarial|gratuity/, /employee|payroll|salar|benefit/],
  [/related-party|related part/, /related part/],
  [/contingent|litigation|lawyer/, /provision|contingen|litigation/],
  [/investment|investee|group compan/, /investment/],
  [/sales|credit notes/, /revenue|sale|turnover/],
  [/journal entr/, /journal/],
  [/after the year end|subsequent/, /subsequent/],
  [/opening-balance|opening balance/, /opening/],
  [/estimate/, /estimate/],
];

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);

/**
 * The work area a request belongs to: the 03.5 area its topic names, else
 * the `preferred` workstream when it is on the file, else none.
 */
export function linkArea(
  requirement: string,
  areas: readonly PbcAreaInput[],
  preferred: string | null = null,
): string | null {
  const text = requirement.toLowerCase();
  const fsAreas = areas.filter((a) => a.key.startsWith('fs_'));
  for (const [topic, area] of TOPICS) {
    if (!topic.test(text)) continue;
    const hit = fsAreas.find((a) => area.test(a.title.toLowerCase()));
    if (hit) return hit.key;
  }
  return preferred && areas.some((a) => a.key === preferred) ? preferred : null;
}

/** Who at the client usually answers a request, read from its wording. */
export function roleFor(requirement: string): PbcOwnerRole {
  const t = requirement.toLowerCase();
  if (/\bgst/.test(t)) return 'gst';
  if (/tds|income-tax|26as|tax return|tax computation/.test(t)) return 'tax';
  if (/payroll|pf |esi|actuarial|gratuity/.test(t)) return 'hr';
  if (/minutes|register|mca|board|representation letter|related.part|litigation|legal/.test(t)) {
    return 'secretarial';
  }
  return 'finance';
}

/** Area-specific requests by keyword in the 03.5 area name. */
const AREA_REQUESTS: ReadonlyArray<{ match: RegExp; key: string; requirement: string }> = [
  {
    match: /revenue|sale|turnover/,
    key: 'cutoff',
    requirement:
      'Sales register, credit notes and dispatch / delivery records for 15 days either side of the year end (cut-off)',
  },
  {
    match: /investment/,
    key: 'holdings',
    requirement: 'Investment register with holding / demat statements and year-end valuation',
  },
  {
    match: /employee|payroll|salar|gratuity|benefit/,
    key: 'actuarial',
    requirement: 'Actuarial valuation reports for gratuity and leave encashment',
  },
  {
    match: /intangible/,
    key: 'intangibles',
    requirement: 'Intangible asset register with capitalisation and amortisation workings',
  },
  {
    match: /lease/,
    key: 'leases',
    requirement:
      'Lease agreements and the lease accounting working (right-of-use asset and liability)',
  },
  {
    match: /share capital|equity share/,
    key: 'capital',
    requirement:
      'Register of members, allotment filings and the shareholding pattern at the year end',
  },
  {
    match: /deferred tax/,
    key: 'deferred_tax',
    requirement: 'Deferred tax computation and the reconciliation of the tax expense',
  },
  {
    match: /purchase|expense|cost of material/,
    key: 'purchases',
    requirement: 'Purchase register and the contracts / agreements for major expenses',
  },
];

/** Requests a Section 04 risk calls for, matched on its wording. */
const RISK_REQUESTS: ReadonlyArray<{
  match: RegExp;
  key: string;
  requirement: string;
  preferred: string | null;
}> = [
  {
    match: /override|journal/,
    key: 'journal_entries',
    requirement:
      'Journal entry listing for the year — all manual, period-end and post-closing entries, with user IDs',
    preferred: 'overall_responses',
  },
  {
    match: /going concern/,
    key: 'going_concern',
    requirement:
      "Cash-flow forecast for the next 12 months and management's going-concern assessment",
    preferred: 'overall_responses',
  },
  {
    match: /estimate|impairment/,
    key: 'estimates',
    requirement:
      'Basis and workings for significant accounting estimates (provisions, impairment, useful lives, expected credit loss)',
    preferred: 'overall_responses',
  },
];

/** Asked for at every audit, near its end. */
const COMPLETION_REQUESTS: ReadonlyArray<{
  key: string;
  requirement: string;
  role: PbcOwnerRole;
  preferred: string | null;
}> = [
  {
    key: 'rep_letter',
    requirement:
      'Signed management representation letter (SA 580), dated on the date of the auditor’s report',
    role: 'secretarial',
    preferred: 'auditor_reporting',
  },
  {
    key: 'post_year_end',
    requirement:
      'Board minutes and management accounts after the year end, up to the report date (subsequent events)',
    role: 'secretarial',
    preferred: 'overall_responses',
  },
  {
    key: 'approved_fs',
    requirement: 'Financial statements approved and signed by the board',
    role: 'secretarial',
    preferred: 'schedule_iii_work',
  },
];

/** Plan every suggested request for the file, de-duplicated by wording. */
export function planPbcSuggestions(f: PbcSuggestionFacts): SuggestedPbc[] {
  const out: SuggestedPbc[] = [];
  const push = (s: SuggestedPbc): void => {
    if (
      out.some(
        (o) => o.sourceKey === s.sourceKey || samePbcRequirement(o.requirement, s.requirement),
      )
    ) {
      return;
    }
    out.push(s);
  };

  for (const r of planStandardPbcList(f.standard)) {
    push({
      sourceKey: `std:${slug(r.requirement)}`,
      requirement: r.requirement,
      ownerRole: r.ownerRole,
      workAreaKey: linkArea(r.requirement, f.areas, r.workAreaKey),
      stage: 'planning',
      sourceNote: 'Standard request list (client master)',
    });
  }

  for (const a of f.areas.filter((x) => x.key.startsWith('fs_'))) {
    const name = a.title.toLowerCase();
    for (const t of AREA_REQUESTS.filter((x) => x.match.test(name))) {
      push({
        sourceKey: `area:${a.key}:${t.key}`,
        requirement: t.requirement,
        ownerRole: roleFor(t.requirement),
        workAreaKey: a.key,
        stage: 'fieldwork',
        sourceNote: `03.5 audit area — ${a.title}`,
      });
    }
  }

  const open = f.risks.filter((r) => r.status !== 'concluded');
  for (const t of RISK_REQUESTS) {
    const hits = open.filter((r) =>
      t.match.test(`${r.description} ${r.fsArea ?? ''}`.toLowerCase()),
    );
    if (hits.length === 0) continue;
    push({
      sourceKey: `risk:${t.key}`,
      requirement: t.requirement,
      ownerRole: roleFor(t.requirement),
      workAreaKey: linkArea(t.requirement, f.areas, t.preferred),
      stage: 'fieldwork',
      sourceNote: `Section 04 risk ${hits.map((r) => r.ref).join(', ')}`,
    });
  }

  for (const t of COMPLETION_REQUESTS) {
    push({
      sourceKey: `stage:${t.key}`,
      requirement: t.requirement,
      ownerRole: t.role,
      workAreaKey: linkArea(t.requirement, f.areas, t.preferred),
      stage: 'completion',
      sourceNote: 'Completion stage (07)',
    });
  }

  if (f.prior) {
    for (const p of f.prior.items) {
      push({
        sourceKey: `py:${p.id}`,
        requirement: p.requirement.trim(),
        ownerRole: roleFor(p.requirement),
        workAreaKey: linkArea(p.requirement, f.areas),
        stage: 'planning',
        sourceNote: `Rolled forward from FY ${f.prior.financialYear} (${p.ref})`,
      });
    }
  }
  return out;
}

const DAY_MS = 86_400_000;
const plusDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Due date by stage: planning requests by the planned start (or a week from
 * today), fieldwork a week after that, completion a week before the planned
 * end (never before the fieldwork date).
 */
export function dueFor(
  stage: PbcStage,
  dates: { today: string; plannedStart: string | null; plannedEnd: string | null },
): string {
  const base =
    dates.plannedStart && dates.plannedStart > dates.today
      ? dates.plannedStart
      : plusDays(dates.today, 7);
  const fieldwork = plusDays(base, 7);
  if (stage === 'planning') return base;
  if (stage === 'fieldwork') return fieldwork;
  const nearEnd = dates.plannedEnd ? plusDays(dates.plannedEnd, -7) : plusDays(base, 30);
  return nearEnd > fieldwork ? nearEnd : plusDays(fieldwork, 7);
}

// ── Chase list ──────────────────────────────────────────────────────────────

export interface ChaseContact extends ClientContact {
  email: string | null;
}

export interface ChaseContext {
  entityName: string;
  financialYear: string | null;
  /** Who signs the reminder (the engagement manager). */
  senderName: string | null;
  today: string;
}

const NO_OWNER = 'Client (no owner set)';

function contactFor(owner: string, contacts: readonly ChaseContact[]): ChaseContact | null {
  const o = owner.toLowerCase();
  return (
    contacts.find((c) => {
      const name = c.fullName.toLowerCase();
      return o === name || o.startsWith(`${name} (`);
    }) ?? null
  );
}

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * One drafted reminder per client owner, covering their outstanding requests
 * that are overdue or due within {@link PBC_DUE_SOON_DAYS} days. Groups with
 * overdue requests come first.
 */
export function planChase(
  items: readonly AuditPbcItem[],
  contacts: readonly ChaseContact[],
  ctx: ChaseContext,
): PbcChaseGroup[] {
  const soon = plusDays(ctx.today, PBC_DUE_SOON_DAYS);
  const due = items.filter(
    (i) => PBC_OUTSTANDING_STATUSES.includes(i.status) && i.dueDate != null && i.dueDate <= soon,
  );
  const byOwner = new Map<string, AuditPbcItem[]>();
  for (const i of due) {
    const owner = i.clientOwner?.trim() || NO_OWNER;
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), i]);
  }
  const groups: PbcChaseGroup[] = [];
  for (const [owner, list] of byOwner) {
    list.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    const contact = owner === NO_OWNER ? null : contactFor(owner, contacts);
    const lines = list.map((i) => {
      const late = daysBetween(i.dueDate!, ctx.today);
      const when = late > 0 ? `due ${i.dueDate}, ${late} day(s) overdue` : `due ${i.dueDate}`;
      const again =
        i.status === 'rejected'
          ? ` — please send a revised copy${i.rejectionReason ? `: ${i.rejectionReason}` : ''}`
          : i.status === 'clarification_required'
            ? ' — clarification needed'
            : '';
      return `${i.pbcRef} — ${i.requirement} (${when})${again}`;
    });
    const overdue = list.filter((i) => i.dueDate! < ctx.today).length;
    const chased = list
      .map((i) => i.lastChasedOn)
      .filter((d): d is string => d != null)
      .sort()
      .pop();
    const firstName = contact?.fullName.split(/\s+/)[0] ?? null;
    const fy = ctx.financialYear ? ` for FY ${ctx.financialYear}` : '';
    const by = plusDays(ctx.today, 3);
    const body = [
      `Dear ${firstName ?? 'Sir / Madam'},`,
      '',
      `For the statutory audit of ${ctx.entityName}${fy}, we are still awaiting the following:`,
      '',
      ...lines.map((l) => `• ${l}`),
      '',
      `Could you please share ${list.length === 1 ? 'this' : 'these'} by ${by}? If anything is unclear or already sent, just reply to this email.`,
      '',
      'Thank you,',
      ctx.senderName ?? '',
    ]
      .join('\n')
      .trimEnd();
    groups.push({
      owner,
      email: contact?.email ?? null,
      pbcIds: list.map((i) => i.id),
      lines,
      overdue,
      lastChasedOn: chased ?? null,
      subject: `${ctx.entityName} — statutory audit${fy}: ${list.length} item(s) pending`,
      body,
    });
  }
  return groups.sort((a, b) => b.overdue - a.overdue || a.owner.localeCompare(b.owner));
}
