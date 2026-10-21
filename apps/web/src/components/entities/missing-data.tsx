import {
  MISSING_INFO_CODES,
  MISSING_INFO_SHORT,
  type MissingFilter,
  type MissingInfoCode,
} from '@hsdg/contracts';
import type { MissingInfoItem } from '@/lib/types';
import { Badge } from '@/components/ui';

const short = (m: MissingInfoItem): string =>
  MISSING_INFO_SHORT[m.code as MissingInfoCode] ?? m.label;

/**
 * The Clients list's marker for a client whose master is incomplete: the first
 * two missing items by name and a count of the rest, the full list on hover.
 * Nothing at all for a complete client, so the gaps stand out.
 */
export function MissingDataMarker({ items }: { items: MissingInfoItem[] }): JSX.Element | null {
  if (items.length === 0) return null;
  const names = items.slice(0, 2).map(short).join(', ');
  const more = items.length > 2 ? ` +${items.length - 2}` : '';
  const all = items.map((m) => m.label).join('; ');
  return (
    <span title={all} aria-label={`Missing: ${all}`}>
      <Badge tone="warn" className="whitespace-nowrap">
        {names}
        {more}
      </Badge>
    </span>
  );
}

/** The list's "Missing data" choices: everyone, any gap, no gap, or one item. */
export const MISSING_FILTER_OPTIONS: { value: MissingFilter | ''; label: string }[] = [
  { value: '', label: 'All clients' },
  { value: 'any', label: 'Missing anything' },
  { value: 'none', label: 'Nothing missing' },
  ...MISSING_INFO_CODES.map((c) => ({ value: c, label: `Missing ${MISSING_INFO_SHORT[c]}` })),
];
