/**
 * Statutory Audit — Review reads the file (Audit Spec §25, §344).
 *
 * Before a reviewer opens a procedure or an area waiting for review, the file
 * already says most of what a first review would find:
 *
 *   • procedure — is there an objective and a real conclusion, is evidence
 *     attached, are exceptions still open, is a sample size recorded for the
 *     sampling method chosen; and which significant risk it answers.
 *   • area — are all its procedures complete, is the conclusion recorded, is
 *     client information (PBC) still outstanding for it; and its significant
 *     risks and carried-forward misstatements.
 *
 * Each failed check suggests a pre-written review note (blocking when it would
 * stop completion), so the reviewer raises it in one click instead of typing
 * it. A suggestion has a stable `sourceKey`: a raised note keeps it, so the
 * screen can say when the issue has been fixed in the file. `ready` means
 * every check passes — the item can be approved as it stands.
 *
 * Pure: no database, unit-tested on its own.
 */
import type { ReviewCheck, SuggestedReviewNote } from '@hsdg/contracts';

/** A conclusion shorter than this is a placeholder, not a conclusion. */
export const MIN_CONCLUSION_CHARS = 15;

export interface ProcedureReviewFacts {
  id: string;
  ref: string;
  objective: string | null;
  conclusion: string | null;
  samplingMethod: string | null;
  sampleSize: number | null;
  evidenceCount: number;
  openExceptions: number;
  carriedExceptions: number;
  /** Refs of the significant risks this procedure responds to. */
  significantRisks: readonly string[];
}

export interface AreaReviewFacts {
  id: string;
  title: string;
  conclusion: string | null;
  procedures: ReadonlyArray<{ ref: string; state: string }>;
  /** Refs of PBC requests linked to the area that the client still owes. */
  outstandingPbc: readonly string[];
  significantRisks: readonly string[];
  carriedExceptions: number;
}

export interface ItemReview {
  checks: ReviewCheck[];
  context: string[];
  ready: boolean;
  /** Every suggestion the failed checks make, before raised / dismissed are removed. */
  suggestions: SuggestedReviewNote[];
}

const real = (s: string | null): boolean => (s?.trim().length ?? 0) >= MIN_CONCLUSION_CHARS;

const list = (refs: readonly string[], max = 4): string =>
  refs.length > max
    ? `${refs.slice(0, max).join(', ')} +${refs.length - max} more`
    : refs.join(', ');

function finish(
  checks: Array<ReviewCheck & { note?: SuggestedReviewNote }>,
  context: string[],
): ItemReview {
  return {
    checks: checks.map(({ key, label, ok }) => ({ key, label, ok })),
    context,
    ready: checks.every((c) => c.ok),
    suggestions: checks.filter((c) => !c.ok && c.note).map((c) => c.note!),
  };
}

export const procedureKey = (id: string, check: string): string => `proc:${id}:${check}`;
export const areaKey = (id: string, check: string): string => `area:${id}:${check}`;

export function reviewProcedure(p: ProcedureReviewFacts): ItemReview {
  const key = (k: string) => procedureKey(p.id, k);
  const significant = p.significantRisks.length > 0;
  const checks: Array<ReviewCheck & { note?: SuggestedReviewNote }> = [
    {
      key: 'objective',
      label: 'Objective recorded',
      ok: real(p.objective),
      note: {
        sourceKey: key('objective'),
        body: `${p.ref}: state the objective — what this procedure is meant to show and for which assertion.`,
        isBlocking: true,
      },
    },
    {
      key: 'conclusion',
      label: 'Conclusion recorded',
      ok: real(p.conclusion),
      note: {
        sourceKey: key('conclusion'),
        body: `${p.ref}: record the conclusion — what was done, what was found, and whether the objective is met.`,
        isBlocking: true,
      },
    },
    {
      key: 'evidence',
      label: 'Evidence attached',
      ok: p.evidenceCount > 0,
      note: {
        sourceKey: key('evidence'),
        body: `${p.ref}: no evidence is attached — attach the working papers or documents the conclusion rests on.`,
        isBlocking: significant,
      },
    },
    {
      key: 'exceptions',
      label: 'No open exceptions',
      ok: p.openExceptions === 0,
      note: {
        sourceKey: key('exceptions'),
        body: `${p.ref}: ${p.openExceptions} exception(s) still open — resolve them or carry them forward as misstatements.`,
        isBlocking: true,
      },
    },
  ];
  if (p.samplingMethod) {
    checks.push({
      key: 'sample',
      label: 'Sample size recorded',
      ok: p.sampleSize != null && p.sampleSize > 0,
      note: {
        sourceKey: key('sample'),
        body: `${p.ref}: a ${p.samplingMethod.replace(/_/g, ' ')} sample is planned but no sample size is recorded — record the size and how it was chosen.`,
        isBlocking: false,
      },
    });
  }
  const context: string[] = [];
  if (significant) {
    context.push(
      `Responds to significant risk ${list(p.significantRisks)} — check the response is specific to it (SA 330.21).`,
    );
  }
  if (p.carriedExceptions > 0) {
    context.push(
      `${p.carriedExceptions} exception(s) carried forward as uncorrected misstatements.`,
    );
  }
  return finish(checks, context);
}

export function reviewArea(a: AreaReviewFacts): ItemReview {
  const key = (k: string) => areaKey(a.id, k);
  const open = a.procedures.filter((p) => p.state !== 'complete');
  const checks: Array<ReviewCheck & { note?: SuggestedReviewNote }> = [
    {
      key: 'procedures',
      label:
        a.procedures.length === 0
          ? 'Procedures performed'
          : `Procedures complete (${a.procedures.length - open.length} of ${a.procedures.length})`,
      ok: a.procedures.length > 0 && open.length === 0,
      note: {
        sourceKey: key('procedures'),
        body:
          a.procedures.length === 0
            ? `${a.title}: no procedures are recorded for this area — add the work performed before concluding.`
            : `${a.title}: ${open.length} procedure(s) not complete (${list(open.map((p) => p.ref))}) — complete or return them before concluding the area.`,
        isBlocking: true,
      },
    },
    {
      key: 'conclusion',
      label: 'Area conclusion recorded',
      ok: real(a.conclusion),
      note: {
        sourceKey: key('conclusion'),
        body: `${a.title}: record the area conclusion — whether the balances / transactions are fairly stated, with the work it rests on.`,
        isBlocking: true,
      },
    },
    {
      key: 'pbc',
      label: 'Client information received',
      ok: a.outstandingPbc.length === 0,
      note: {
        sourceKey: key('pbc'),
        body: `${a.title}: client information still outstanding (${list(a.outstandingPbc)}) — confirm the conclusion does not depend on it, or follow it up.`,
        isBlocking: false,
      },
    },
  ];
  const context: string[] = [];
  if (a.significantRisks.length > 0)
    context.push(`Significant risks: ${list(a.significantRisks)}.`);
  if (a.carriedExceptions > 0) {
    context.push(
      `${a.carriedExceptions} misstatement(s) carried forward — check they are in the summary of misstatements.`,
    );
  }
  return finish(checks, context);
}

/**
 * Whether the issue behind a note raised from a suggestion is fixed: its check
 * now passes. Unknown keys (or targets no longer reviewed) are not resolved.
 */
export function resolvedInFile(sourceKey: string | null, passing: ReadonlySet<string>): boolean {
  return sourceKey != null && passing.has(sourceKey);
}

/** The suggestions still to offer: not dismissed, and no live note already raised from it. */
export function openSuggestions(
  suggestions: readonly SuggestedReviewNote[],
  liveKeys: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
): SuggestedReviewNote[] {
  return suggestions.filter((s) => !liveKeys.has(s.sourceKey) && !dismissed.has(s.sourceKey));
}
