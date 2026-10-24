'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Archive } from 'lucide-react';
import type { DuplicatePair, MergedInto } from '@hsdg/contracts';
import { Button, Card, EmptyState, Spinner } from '@/components/ui';
import {
  MergeClientsModal,
  VerdictBadge,
  useDismissDuplicate,
  useDuplicates,
} from './merge-clients-modal';

const pairKey = (p: DuplicatePair): string => `${p.a.id}:${p.b.id}`;

/** On an archived client: where it went. */
export function MergedIntoBanner({ mergedInto }: { mergedInto: MergedInto }): JSX.Element {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-line-strong bg-surface-sunken px-3 py-2.5 text-sm"
    >
      <Archive className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
      <p className="text-ink">
        Merged into{' '}
        <Link
          href={`/entities/${mergedInto.id}`}
          className="font-medium text-primary-700 hover:underline"
        >
          {mergedInto.legalName} ({mergedInto.entityCode})
        </Link>{' '}
        on {new Date(mergedInto.mergedAt).toLocaleDateString('en-IN')}. This client is archived:
        work on it there.
      </p>
    </div>
  );
}

/** On a client's page: the pairs the API lists it in, each with Review / Not the same. */
export function PossibleDuplicateBanner({ entityId }: { entityId: string }): JSX.Element | null {
  const dupes = useDuplicates();
  const dismiss = useDismissDuplicate();
  const [reviewing, setReviewing] = useState<DuplicatePair | null>(null);
  const mine = (dupes.data ?? []).filter((p) => p.a.id === entityId || p.b.id === entityId);
  if (mine.length === 0) return null;

  return (
    <div className="space-y-2">
      {mine.map((p) => {
        const other = p.a.id === entityId ? p.b : p.a;
        return (
          <div
            key={pairKey(p)}
            className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2.5 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning-700" />
              <span className="font-semibold text-warning-700">Possible duplicate</span>
              <VerdictBadge verdict={p.verdict} />
            </div>
            <p className="mt-1 text-ink">
              <Link href={`/entities/${other.id}`} className="text-primary-700 hover:underline">
                {other.legalName} ({other.entityCode})
              </Link>
              {other.pan && <span className="text-ink-muted"> · PAN {other.pan}</span>}
              <span className="text-ink-muted"> · {other.officeCode}</span>
            </p>
            {p.reasons.length > 0 && (
              <p className="text-xs text-ink-muted">{p.reasons.join(' · ')}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setReviewing(p)}>
                Review
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate({ aId: p.a.id, bId: p.b.id })}
              >
                Not the same client
              </Button>
            </div>
          </div>
        );
      })}
      {reviewing && (
        <MergeClientsModal
          clientIds={[reviewing.a.id, reviewing.b.id]}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  );
}

/** The Clients page's "Possible duplicates" view. */
export function PossibleDuplicatesList(): JSX.Element {
  const dupes = useDuplicates();
  const dismiss = useDismissDuplicate();
  const [reviewing, setReviewing] = useState<DuplicatePair | null>(null);

  if (dupes.isLoading) return <Spinner label="Looking for duplicates…" />;
  const pairs = dupes.data ?? [];
  if (pairs.length === 0)
    return <EmptyState>No clients look like duplicates of each other.</EmptyState>;

  return (
    <Card className="p-0">
      <ul className="divide-y divide-line">
        {pairs.map((p) => (
          <li
            key={pairKey(p)}
            className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <ClientLink side={p.a} />
                <span className="text-ink-faint">and</span>
                <ClientLink side={p.b} />
                <VerdictBadge verdict={p.verdict} />
              </div>
              {p.reasons.length > 0 && (
                <p className="mt-0.5 text-xs text-ink-muted">{p.reasons.join(' · ')}</p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => setReviewing(p)}>
                Review
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate({ aId: p.a.id, bId: p.b.id })}
                aria-label={`Dismiss ${p.a.entityCode} and ${p.b.entityCode}`}
              >
                Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {reviewing && (
        <MergeClientsModal
          clientIds={[reviewing.a.id, reviewing.b.id]}
          onClose={() => setReviewing(null)}
        />
      )}
    </Card>
  );
}

function ClientLink({ side }: { side: DuplicatePair['a'] }): JSX.Element {
  return (
    <Link href={`/entities/${side.id}`} className="text-primary-700 hover:underline">
      <span className="font-medium">{side.legalName}</span>{' '}
      <span className="text-ink-faint">
        ({side.entityCode}
        {side.pan ? ` · ${side.pan}` : ''})
      </span>
    </Link>
  );
}
