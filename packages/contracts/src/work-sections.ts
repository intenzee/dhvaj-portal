/**
 * Sections — one vocabulary for "show me GST only / Income Tax only" across
 * the home calendar, tasks, clients and engagements. A section is one of the
 * six compliance STREAMS or one of the non-compliance engagement kinds
 * (Statutory Audit, Other assignments). APIs take `?section=gst,income_tax`
 * (comma list, any-of); an empty list means every section.
 */
import { STREAMS, STREAM_LABEL, type Stream } from './engagement-restructure';

export type WorkSection = Stream | 'statutory_audit' | 'assignment';

/** Filter-row order: the filings people ask for most come first. */
export const WORK_SECTIONS: WorkSection[] = [
  'gst',
  'tds',
  'income_tax',
  'roc',
  'bookkeeping',
  'mis',
  'statutory_audit',
  'assignment',
];

export const WORK_SECTION_LABEL: Record<WorkSection, string> = {
  ...STREAM_LABEL,
  statutory_audit: 'Statutory Audit',
  assignment: 'Assignments',
};

/** Sections that are filing streams (the compliance calendar's sections). */
export const STREAM_SECTIONS: Stream[] = WORK_SECTIONS.filter((s): s is Stream =>
  (STREAMS as string[]).includes(s),
);

export function isStreamSection(s: WorkSection): s is Stream {
  return (STREAMS as string[]).includes(s);
}

/**
 * `"gst,income_tax"` (or a repeated param) → known sections in WORK_SECTIONS
 * order, unknown keys and duplicates dropped. Lenient on purpose: it reads
 * URLs and saved preferences, where a stale key should not break the page.
 */
export function parseWorkSections(
  raw: string | readonly string[] | null | undefined,
): WorkSection[] {
  if (!raw) return [];
  const parts = (typeof raw === 'string' ? [raw] : raw).flatMap((p) => p.split(','));
  const set = new Set(parts.map((p) => p.trim()));
  return WORK_SECTIONS.filter((s) => set.has(s));
}

/** The `?section=` value for a selection ('' when every section is shown). */
export function workSectionsParam(sections: readonly WorkSection[]): string {
  return WORK_SECTIONS.filter((s) => sections.includes(s)).join(',');
}
