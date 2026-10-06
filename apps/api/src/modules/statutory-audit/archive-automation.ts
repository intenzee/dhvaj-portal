/**
 * Statutory Audit — Section 10 archiving drafted from the file.
 *
 * Reads the signed-off file and lays out what archiving means for it:
 *
 *   • the gate — the file is signed off and not yet archived. This is the
 *     server's archive rule, so `ready` matches what the endpoint enforces.
 *   • the deadlines — assemble the final file within 60 days of the auditor's
 *     report (SA 230, SQC 1) and keep it seven years from that date (SQC 1).
 *   • what archiving will freeze while still open — review notes, exceptions,
 *     unfinished procedures, PBC requests and reassessments — and completed
 *     procedures with no evidence attached. These never block archiving.
 *   • the report's ICAI UDIN, and what next year's planning (03.1.6) will
 *     bring forward from this file.
 *   • a draft archive note written from the same facts, recorded when the
 *     file is archived without one.
 *
 * Pure: no database, unit-tested on its own.
 */
import type { ArchivePack, CompletionGoTo, SignOffCheck } from '@hsdg/contracts';
import { periodEndLabel, type CompletionFacts } from './completion-automation';

/** SA 230 / SQC 1: assemble the final audit file within 60 days of the report. */
export const ASSEMBLY_DAYS = 60;
/** SQC 1: keep engagement documentation seven years from the report date. */
export const RETENTION_YEARS = 7;

export interface ArchiveFacts extends CompletionFacts {
  signedOffAt: Date | null;
  signedOffByName: string | null;
  archivedAt: Date | null;
  archivedByName: string | null;
  /** Recorded report date, when archived; otherwise the sign-off date is used. */
  reportDate: Date | null;
  udin: string | null;
  today: Date;
  /** Review notes not cleared (open / responded), blocking or not. */
  openReviewNotes: number;
  pbcOutstanding: number;
  openReassessments: number;
  /** Evidence items on the file. */
  evidenceCount: number;
  /** Complete procedures with no evidence linked (`ref title`). */
  completeWithoutEvidence: readonly string[];
  /** What next year's 03.1.6 import will bring forward from this file. */
  carryForward: readonly string[];
  /** Next year's statutory-audit engagement, when it already exists. */
  nextYear: { financialYear: string } | null;
}

const SIGN_OFF: CompletionGoTo = { phaseKey: 'sign_off', label: 'Open partner sign-off' };
const WORK: CompletionGoTo = { phaseKey: 'audit_areas', label: 'Open audit work' };
const REVIEW: CompletionGoTo = { phaseKey: 'review', label: 'Open review notes' };
const PBC: CompletionGoTo = { phaseKey: 'pbc', label: 'Open PBC tracker' };
const REASSESS: CompletionGoTo = { phaseKey: 'reassessment', label: 'Open reassessment' };

const MAX_LISTED = 4;
const DAY_MS = 86_400_000;

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
  goTo: CompletionGoTo | null,
): SignOffCheck {
  return { key, label, ok, blocking, facts, goTo: ok ? null : goTo };
}

/** Calendar date (UTC) as yyyy-mm-dd. */
export function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  return new Date(utcDate(d).getTime() + days * DAY_MS);
}

/** Same calendar day `years` later (29 Feb → 28 Feb). */
export function addYears(d: Date, years: number): Date {
  const u = utcDate(d);
  const y = u.getUTCFullYear() + years;
  const last = new Date(Date.UTC(y, u.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, u.getUTCMonth(), Math.min(u.getUTCDate(), last)));
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / DAY_MS);
}

export function planArchive(f: ArchiveFacts): ArchivePack {
  const checks: SignOffCheck[] = [];
  const archived = f.archivedAt != null;
  const reportDate = f.reportDate ?? f.signedOffAt;
  const dueBy = reportDate ? addDays(reportDate, ASSEMBLY_DAYS) : null;
  const retainUntil = reportDate ? addYears(reportDate, RETENTION_YEARS) : null;
  // Once archived the clock stops at the archive date.
  const daysToAssemble = dueBy ? daysBetween(f.archivedAt ?? f.today, dueBy) : null;

  // ── The gate ─────────────────────────────────────────────────────────────
  checks.push(
    check(
      'signed_off',
      'Partner signed off (09)',
      f.signedOffAt != null,
      true,
      f.signedOffAt
        ? [
            `Signed off${f.signedOffByName ? ` by ${f.signedOffByName}` : ''} on ${day(f.signedOffAt)}.`,
          ]
        : ['Not yet signed off — the file can be archived only after partner sign-off.'],
      SIGN_OFF,
    ),
  );

  // ── Deadlines ─────────────────────────────────────────────────────────────
  {
    const facts: string[] = [];
    if (!reportDate || !dueBy || daysToAssemble == null) {
      facts.push(
        `Assemble the final file within ${ASSEMBLY_DAYS} days of the auditor's report (SA 230); the clock starts at sign-off.`,
      );
    } else {
      facts.push(`Report dated ${day(reportDate)} — assemble by ${day(dueBy)} (SA 230, SQC 1).`);
      if (archived) {
        facts.push(
          daysToAssemble >= 0
            ? `Archived on ${day(f.archivedAt!)}, within the ${ASSEMBLY_DAYS}-day window.`
            : `Archived on ${day(f.archivedAt!)}, ${-daysToAssemble} day(s) after the deadline.`,
        );
      } else {
        facts.push(
          daysToAssemble >= 0
            ? `${daysToAssemble} day(s) left.`
            : `Overdue by ${-daysToAssemble} day(s) — archive now.`,
        );
      }
    }
    if (retainUntil)
      facts.push(`Keep the file until ${day(retainUntil)} (${RETENTION_YEARS} years, SQC 1).`);
    checks.push(
      check(
        'assembly',
        'Assembly deadline',
        daysToAssemble == null || daysToAssemble >= 0,
        false,
        facts,
        null,
      ),
    );
  }

  checks.push(
    check(
      'udin',
      "UDIN for the auditor's report",
      f.udin != null,
      false,
      f.udin
        ? [`UDIN ${f.udin}.`]
        : ['Generate the UDIN on the ICAI portal and record it when archiving.'],
      null,
    ),
  );

  // ── What archiving will freeze ───────────────────────────────────────────
  {
    const openExceptions = f.exceptions.filter((e) => e.status === 'open').length;
    const unfinished = f.procedures.filter((p) => p.state !== 'complete');
    const lines: Array<[number, string, CompletionGoTo]> = [
      [f.openReviewNotes, `${f.openReviewNotes} review note(s) not cleared.`, REVIEW],
      [openExceptions, `${openExceptions} exception(s) still open.`, WORK],
      [unfinished.length, `${unfinished.length} procedure(s) not complete.`, WORK],
      [f.pbcOutstanding, `${f.pbcOutstanding} PBC request(s) outstanding.`, PBC],
      [f.openReassessments, `${f.openReassessments} reassessment(s) open.`, REASSESS],
    ];
    const open = lines.filter(([n]) => n > 0);
    checks.push(
      check(
        'loose_ends',
        'Nothing left open',
        open.length === 0,
        false,
        open.length === 0
          ? ['Every note, exception, procedure, PBC request and reassessment is closed.']
          : [
              archived
                ? 'Archived with these still open:'
                : 'Archiving freezes these as they are — close them first:',
              ...open.map(([, text]) => `• ${text}`),
            ],
        open[0]?.[2] ?? null,
      ),
    );
  }

  checks.push(
    check(
      'evidence',
      'Evidence on file',
      f.completeWithoutEvidence.length === 0,
      false,
      [
        `${f.evidenceCount} evidence item(s) on the file.`,
        ...(f.completeWithoutEvidence.length
          ? [
              `${f.completeWithoutEvidence.length} completed procedure(s) with no evidence attached:`,
              ...listed(f.completeWithoutEvidence),
            ]
          : f.procedures.length
            ? ['Every completed procedure has evidence attached.']
            : []),
      ],
      WORK,
    ),
  );

  checks.push(
    check(
      'carry_forward',
      "Carried to next year's file",
      true,
      false,
      [
        f.carryForward.length
          ? `${f.carryForward.length} matter(s) will be brought forward to next year's planning (03.1.6):`
          : 'Nothing to bring forward — no significant risks, Areas of Focus, blocking notes or high-severity exceptions.',
        ...listed(f.carryForward),
        f.nextYear
          ? `FY ${f.nextYear.financialYear} engagement exists — its planning picks these up when opened.`
          : 'They are picked up when next year’s engagement is opened.',
      ],
      null,
    ),
  );

  const ready = f.signedOffAt != null && !archived;
  const attention = checks.filter(
    (c) => !c.blocking && !c.ok && c.key !== 'udin' && c.key !== 'carry_forward',
  ).length;

  // ── Draft archive note ────────────────────────────────────────────────────
  const procsDone = f.procedures.filter((p) => p.state === 'complete').length;
  const concluded = f.areas.filter((a) => a.concluded).length;
  const archiveDay = f.archivedAt ?? f.today;
  const note = [
    `Final audit file for financial year ${f.financialYear ?? ''} (period ended ${periodEndLabel(f.financialYear)}) assembled and archived on ${day(archiveDay)}` +
      (reportDate
        ? `, ${daysBetween(reportDate, archiveDay)} day(s) after the auditor's report dated ${day(reportDate)} (SA 230: within ${ASSEMBLY_DAYS} days).`
        : '.'),
    f.signedOffAt
      ? `Signed off${f.signedOffByName ? ` by ${f.signedOffByName}` : ''} on ${day(f.signedOffAt)}${f.udin ? `; UDIN ${f.udin}` : ''}.`
      : 'Not yet signed off.',
    `Contents: ${concluded} of ${f.areas.length} audit areas concluded, ${procsDone} of ${f.procedures.length} procedures complete, ${f.evidenceCount} evidence item(s).`,
    retainUntil
      ? `Retained until ${day(retainUntil)} (SQC 1). No deletion or change after archiving; any later addition is documented separately with the reason, who made it and when (SA 230).`
      : 'Retained seven years from the report date (SQC 1).',
    f.carryForward.length
      ? `${f.carryForward.length} matter(s) carried forward to next year's planning.`
      : 'No matters to carry forward to next year.',
  ].join('\n');

  return {
    checks,
    ready,
    attention,
    reportDate: reportDate ? day(reportDate) : null,
    assemblyDueBy: dueBy ? day(dueBy) : null,
    daysToAssemble,
    retainUntil: retainUntil ? day(retainUntil) : null,
    carryForward: [...f.carryForward],
    draftNote: note,
  };
}
