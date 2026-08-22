'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui';

/**
 * Offset/limit page navigation over the API's paginated envelope. Purely
 * presentational — the parent owns `offset` and refetches on change.
 */
export function Pagination({
  total,
  limit,
  offset,
  onOffsetChange,
  unit = 'items',
}: {
  total: number;
  limit: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  unit?: string;
}): JSX.Element | null {
  if (total <= limit && offset === 0) {
    // Single page — show a lightweight count only.
    return total > 0 ? (
      <p className="mt-3 text-xs text-ink-faint">
        {total} {unit}
      </p>
    ) : null;
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <div className="mt-3 flex items-center justify-between">
      <p className="text-xs text-ink-faint">
        {from}–{to} of {total} {unit}
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          disabled={!canPrev}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!canNext}
          onClick={() => onOffsetChange(offset + limit)}
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
