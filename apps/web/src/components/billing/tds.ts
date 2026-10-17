import {
  financialYearOf,
  type TdsClientMismatch,
  type TdsImportResult,
  type TdsMatchKind,
} from '@hsdg/contracts';
import { formatDate, formatMoney } from '@/lib/format';

/** The year `today` falls in, then the `back` before it. Pure — tested. */
export function financialYearsFor(today: string, back = 3): string[] {
  const start = Number(financialYearOf(today).slice(0, 4));
  return Array.from({ length: back + 1 }, (_, i) => {
    const y = start - i;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  });
}

export const MATCH_KIND_LABEL: Record<TdsMatchKind, string> = {
  exact: 'Exact',
  tolerance: 'Within tolerance',
  split: 'Split deposit',
  combined: 'Several receipts, one credit',
  quarter_total: 'Quarter in total',
  other_quarter: 'Next or previous quarter',
};

/** 26AS "Status of Booking" in words; null for final (or not stated). Pure — tested. */
export function bookingNote(status: string | null): string | null {
  if (status === 'U') return 'Unmatched in TRACES: the challan does not match yet';
  if (status === 'P') return 'Provisional: the deductor’s challan is not yet verified';
  if (status === 'O') return 'Overbooked in TRACES';
  return null;
}

const SENT_BY: Record<NonNullable<TdsClientMismatch['lastReminder']>['channel'], string> = {
  email: 'e-mailed',
  whatsapp: 'WhatsApp',
  copy: 'text copied',
};

/** "Asked 16 Oct 2026 · WhatsApp · Partner A", or null. Pure — tested. */
export function tdsReminderLine(r: TdsClientMismatch['lastReminder']): string | null {
  if (!r) return null;
  return [`Asked ${formatDate(r.at)}`, SENT_BY[r.channel], r.byName].filter(Boolean).join(' · ');
}

/** What an import did, in one line. Pure — tested. */
export function importSummary(r: TdsImportResult): string {
  const what =
    r.source === '26as_text' ? `26AS for ${r.financialYear}` : `Form 16A (${r.financialYear})`;
  const replaced = r.superseded
    ? ` It replaced ${r.superseded} row${r.superseded === 1 ? '' : 's'} of earlier imports.`
    : '';
  return `${what}: ${r.credits} credit${r.credits === 1 ? '' : 's'} from ${r.deductors} deductor${
    r.deductors === 1 ? '' : 's'
  }, ${formatMoney(r.tdsTotal, 'INR')} of TDS.${replaced}`;
}
