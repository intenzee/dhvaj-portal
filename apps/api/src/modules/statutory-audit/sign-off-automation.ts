/**
 * Statutory Audit — Section 09 partner sign-off drafted from the file.
 *
 * Reads the whole audit file and lays out what the partner signs on:
 *
 *   • the §29 gates (completion approved, reporting resolved, every audit area
 *     concluded, no blocking review note open) — each with the facts behind it
 *     and a link to where it is put right. These are exactly the server's
 *     sign-off rule, so `ready` matches what the sign-off endpoint enforces.
 *   • what a partner should know before signing and never blocks it:
 *     misstatements carried forward against materiality, significant risks
 *     without a completed response, outstanding PBC and open reassessments.
 *   • a draft partner sign-off memo written from the same facts, used when
 *     the partner signs off without typing one.
 *
 * Pure: no database, unit-tested on its own.
 */
import type { CompletionGoTo, SignOffCheck, SignOffPack } from '@hsdg/contracts';
import { money, periodEndLabel, type CompletionFacts } from './completion-automation';

export interface SignOffItem {
  section: 'completion' | 'reporting';
  title: string;
  state: 'not_started' | 'in_progress' | 'complete' | 'not_applicable';
}

export interface SignOffNote {
  body: string;
  targetLabel: string | null;
}

export interface SignOffFacts extends CompletionFacts {
  items: readonly SignOffItem[];
  completionApprovedAt: Date | null;
  completionApprovedByName: string | null;
  /** Open / responded blocking review notes. */
  blockingNotes: readonly SignOffNote[];
  /** PBC requests still outstanding (requested / rejected / clarification). */
  pbcOutstanding: number;
  /** …of which past their due date. */
  pbcOverdue: number;
  openReassessments: readonly string[];
  engagementPartnerName: string | null;
}

const COMPLETION: CompletionGoTo = { phaseKey: 'completion', label: 'Open completion checklist' };
const REPORTING: CompletionGoTo = { phaseKey: 'reporting', label: 'Open reporting checklist' };
const WORK: CompletionGoTo = { phaseKey: 'audit_areas', label: 'Open audit work' };
const REVIEW: CompletionGoTo = { phaseKey: 'review', label: 'Open review notes' };
const RISK: CompletionGoTo = { phaseKey: 'risk', label: 'Open risk register' };
const PBC: CompletionGoTo = { phaseKey: 'pbc', label: 'Open PBC tracker' };
const REASSESS: CompletionGoTo = { phaseKey: 'reassessment', label: 'Open reassessment' };

const MAX_LISTED = 4;

function listed(names: readonly string[]): string[] {
  const out = names.slice(0, MAX_LISTED).map((n) => `• ${n}`);
  if (names.length > MAX_LISTED) out.push(`+${names.length - MAX_LISTED} more`);
  return out;
}

function check(
  key: string,
  label: string,
  ok: boolean,
  blocking: boolean,
  facts: string[],
  goTo: CompletionGoTo,
): SignOffCheck {
  return { key, label, ok, blocking, facts, goTo: ok ? null : goTo };
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const resolved = (i: SignOffItem): boolean =>
  i.state === 'complete' || i.state === 'not_applicable';

export function planSignOff(f: SignOffFacts): SignOffPack {
  const checks: SignOffCheck[] = [];

  // ── §29 gates ──────────────────────────────────────────────────────────────
  const completionItems = f.items.filter((i) => i.section === 'completion');
  const openCompletion = completionItems.filter((i) => !resolved(i));
  checks.push(
    check(
      'completion_approved',
      'Completion approved (07)',
      f.completionApprovedAt != null,
      true,
      f.completionApprovedAt
        ? [
            `Approved${f.completionApprovedByName ? ` by ${f.completionApprovedByName}` : ''} on ${day(f.completionApprovedAt)}.`,
          ]
        : openCompletion.length > 0
          ? [
              `Not yet approved — ${openCompletion.length} completion item(s) open:`,
              ...listed(openCompletion.map((i) => i.title)),
            ]
          : ['Not yet approved — every completion item is resolved, ready to approve.'],
      COMPLETION,
    ),
  );

  const reporting = f.items.filter((i) => i.section === 'reporting');
  const openReporting = reporting.filter((i) => !resolved(i));
  const reportedOn = reporting.filter((i) => i.state === 'complete').map((i) => i.title);
  checks.push(
    check(
      'reporting_resolved',
      'Reporting resolved (08)',
      openReporting.length === 0,
      true,
      openReporting.length === 0
        ? [
            `All ${reporting.length} reporting item(s) resolved.`,
            ...(reportedOn.length > 0 ? [`Reports: ${reportedOn.join(', ')}.`] : []),
          ]
        : [
            `${openReporting.length} reporting item(s) open:`,
            ...listed(openReporting.map((i) => i.title)),
          ],
      REPORTING,
    ),
  );

  const openAreas = f.areas.filter((a) => !a.concluded);
  checks.push(
    check(
      'areas_concluded',
      'Audit areas concluded (05/06)',
      openAreas.length === 0,
      true,
      openAreas.length === 0
        ? [
            f.areas.length === 0
              ? 'No audit areas in the file yet — nothing to conclude.'
              : `All ${f.areas.length} audit area(s) concluded.`,
          ]
        : [
            `${f.areas.length - openAreas.length} of ${f.areas.length} audit area(s) concluded; not yet:`,
            ...listed(openAreas.map((a) => a.title)),
          ],
      WORK,
    ),
  );

  checks.push(
    check(
      'blocking_notes',
      'No blocking review notes',
      f.blockingNotes.length === 0,
      true,
      f.blockingNotes.length === 0
        ? ['No blocking review note is open.']
        : [
            `${f.blockingNotes.length} blocking review note(s) open:`,
            ...listed(
              f.blockingNotes.map((n) => (n.targetLabel ? `${n.targetLabel}: ${n.body}` : n.body)),
            ),
          ],
      REVIEW,
    ),
  );

  // ── What the partner should know (never blocks) ───────────────────────────
  const carried = f.exceptions.filter((e) => e.status === 'carried_forward');
  const open = f.exceptions.filter((e) => e.status === 'open');
  const ctt = f.materiality?.ctt ?? null;
  const om = f.materiality?.om ?? null;
  checks.push(
    check(
      'misstatements',
      'Misstatements',
      open.length === 0 && carried.every((e) => e.severity !== 'high'),
      false,
      [
        open.length === 0 && carried.length === 0
          ? 'No exceptions open or carried forward.'
          : `${open.length} exception(s) open, ${carried.length} carried forward as uncorrected.`,
        ...listed(
          [...open, ...carried].map(
            (e) =>
              `${e.procedureRef}: ${e.description} (${e.severity}, ${e.status.replace(/_/g, ' ')})`,
          ),
        ),
        ...(om != null
          ? [
              `Measure against overall materiality ${money(om)}${ctt != null ? ` (clearly trivial ${money(ctt)})` : ''}.`,
            ]
          : []),
      ],
      WORK,
    ),
  );

  const significant = f.risks.filter((r) => r.isSignificant);
  const unanswered = significant.filter((r) => {
    const linked = f.procedures.filter((p) => p.riskId === r.id);
    return linked.length === 0 || linked.some((p) => p.state !== 'complete');
  });
  checks.push(
    check(
      'significant_risks',
      'Significant risks addressed',
      unanswered.length === 0,
      false,
      significant.length === 0
        ? ['No significant risks in Section 04.']
        : unanswered.length === 0
          ? [`All ${significant.length} significant risk(s) have a completed response.`]
          : [
              `${unanswered.length} of ${significant.length} significant risk(s) without a completed response:`,
              ...listed(unanswered.map((r) => `${r.ref} ${r.description}`)),
            ],
      RISK,
    ),
  );

  checks.push(
    check(
      'pbc',
      'Client information (PBC)',
      f.pbcOutstanding === 0,
      false,
      f.pbcOutstanding === 0
        ? ['Nothing outstanding from the client.']
        : [
            `${f.pbcOutstanding} PBC request(s) outstanding${f.pbcOverdue > 0 ? `, ${f.pbcOverdue} overdue` : ''}.`,
          ],
      PBC,
    ),
  );

  checks.push(
    check(
      'reassessments',
      'Changes reassessed',
      f.openReassessments.length === 0,
      false,
      f.openReassessments.length === 0
        ? ['No reassessment is open.']
        : [
            `${f.openReassessments.length} reassessment(s) still open:`,
            ...listed(f.openReassessments),
          ],
      REASSESS,
    ),
  );

  const ready = checks.filter((c) => c.blocking).every((c) => c.ok);
  const attention = checks.filter((c) => !c.blocking && !c.ok).length;

  // ── Draft partner sign-off memo ───────────────────────────────────────────
  const procsDone = f.procedures.filter((p) => p.state === 'complete').length;
  const memo = [
    `Partner sign-off — financial year ${f.financialYear ?? ''} (period ended ${periodEndLabel(f.financialYear)}).`,
    f.completionApprovedAt
      ? `Completion approved${f.completionApprovedByName ? ` by ${f.completionApprovedByName}` : ''} on ${day(f.completionApprovedAt)}.`
      : 'Completion not yet approved.',
    `Work: ${f.areas.length - openAreas.length} of ${f.areas.length} audit areas concluded; ${procsDone} of ${f.procedures.length} procedures complete.`,
    significant.length > 0
      ? `Significant risks: ${significant.length - unanswered.length} of ${significant.length} with a completed response.`
      : 'Significant risks: none identified.',
    carried.length > 0
      ? `Uncorrected misstatements: ${carried.length} carried forward${om != null ? `, assessed against overall materiality ${money(om)}` : ''}.`
      : 'Uncorrected misstatements: none carried forward.',
    reportedOn.length > 0
      ? `Reporting: ${reportedOn.join(', ')}.`
      : 'Reporting: no reports marked complete.',
    'I have reviewed the file and am satisfied that sufficient appropriate audit evidence has been obtained to support the opinion.',
  ].join('\n');

  return {
    checks,
    ready,
    attention,
    engagementPartnerName: f.engagementPartnerName,
    draftMemo: memo,
  };
}
