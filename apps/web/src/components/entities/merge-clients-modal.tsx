'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeftRight, CheckCircle2, GitMerge, Search } from 'lucide-react';
import {
  PERMISSION,
  type ClientVerdict,
  type DismissDuplicateRequest,
  type DuplicateClientConflict,
  type DuplicatePair,
  type MergeClientSide,
  type MergeClientsRequest,
  type MergeClientsResult,
  type MergeEngagementPlan,
  type MergePreview,
  type MergeTakeField,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { entityListPath } from '@/lib/list-paths';
import type { EntityRow } from '@/lib/types';
import { Badge, Button, Spinner } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Input } from '@/components/form';

// ── Shared pieces ────────────────────────────────────────────────────────────

export const VERDICT_LABEL: Record<ClientVerdict, string> = {
  same: 'Same client',
  probable: 'Probably the same',
  possible: 'Possibly the same',
  different: 'Different clients',
};
const VERDICT_TONE: Record<ClientVerdict, string> = {
  same: 'danger',
  probable: 'warn',
  possible: 'info',
  different: 'neutral',
};

export function VerdictBadge({ verdict }: { verdict: ClientVerdict }): JSX.Element {
  return <Badge tone={VERDICT_TONE[verdict]}>{VERDICT_LABEL[verdict]}</Badge>;
}

/** The 409 the API sends when a PAN / GSTIN / TAN / CIN is already on another client. */
export function duplicateConflictOf(err: unknown): DuplicateClientConflict | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const body = err.body as Partial<DuplicateClientConflict> | undefined;
  return body?.code === 'duplicate_client' && body.holder
    ? (body as DuplicateClientConflict)
    : null;
}

const DUPLICATES_KEY = ['entities', 'duplicates'] as const;

/** Pairs the API thinks may be one client (merged and dismissed pairs left out). */
export function useDuplicates() {
  const { principal } = useAuth();
  return useQuery({
    queryKey: DUPLICATES_KEY,
    queryFn: () => apiFetch<DuplicatePair[]>('/entities/duplicates'),
    enabled: can(principal, PERMISSION.entityManage),
  });
}

/** "These two are not the same client" — the pair leaves the duplicates list. */
export function useDismissDuplicate() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: DismissDuplicateRequest) =>
      apiFetch<void>('/entities/duplicates/dismiss', { method: 'POST', body }),
    onSuccess: () => {
      toast('Marked as different clients.');
      void qc.invalidateQueries({ queryKey: DUPLICATES_KEY });
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not dismiss the pair.', 'error'),
  });
}

/**
 * Shown in a form whose save was refused because the identifier is already on
 * another client: name that client and offer the merge popup on the two.
 */
export function DuplicateConflictNotice({
  conflict,
  entityId,
}: {
  conflict: DuplicateClientConflict;
  /** The client being edited; null when creating one. */
  entityId: string | null;
}): JSX.Element {
  const [merging, setMerging] = useState(false);
  const { holder, identifier } = conflict;
  const canMerge = holder.visible && entityId !== null && entityId !== holder.id;
  return (
    <div role="alert" className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm">
      <div className="flex items-center gap-1.5 font-semibold text-warning-700">
        <AlertTriangle className="h-4 w-4" /> {humanize(identifier.type).toUpperCase()}{' '}
        {identifier.value} is already on another client
      </div>
      <p className="mt-1 text-ink">
        {holder.visible ? (
          <>
            <Link href={`/entities/${holder.id}`} className="text-primary-700 hover:underline">
              {holder.legalName} ({holder.entityCode})
            </Link>{' '}
            holds it.{' '}
            {entityId === null
              ? 'It is likely the client you are adding: open it instead of creating a second one.'
              : 'If they are one business, merge the two clients instead of adding it twice.'}
          </>
        ) : (
          <>
            {holder.legalName} ({holder.entityCode}) holds it, in an office you cannot open. Ask
            that office, or a partner who sees both, to merge the two clients.
          </>
        )}
      </p>
      {canMerge && (
        <Button size="sm" className="mt-2" onClick={() => setMerging(true)}>
          <GitMerge className="h-4 w-4" /> Merge these clients
        </Button>
      )}
      {merging && entityId && (
        <MergeClientsModal clientIds={[entityId, holder.id]} onClose={() => setMerging(false)} />
      )}
    </div>
  );
}

// ── Picking the other client ─────────────────────────────────────────────────

/** "Merge with another client…": pick the other client, then the merge popup. */
export function MergeWithClientButton({ entityId }: { entityId: string }): JSX.Element {
  const [step, setStep] = useState<'closed' | 'pick' | { otherId: string }>('closed');
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setStep('pick')}>
        <GitMerge className="h-4 w-4" /> Merge with another client…
      </Button>
      {step === 'pick' && (
        <ClientPickerModal
          excludeId={entityId}
          onClose={() => setStep('closed')}
          onPick={(otherId) => setStep({ otherId })}
        />
      )}
      {typeof step === 'object' && (
        <MergeClientsModal clientIds={[entityId, step.otherId]} onClose={() => setStep('closed')} />
      )}
    </>
  );
}

function ClientPickerModal({
  excludeId,
  onPick,
  onClose,
}: {
  excludeId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const found = useQuery({
    queryKey: ['entities', 'merge-pick', debounced],
    queryFn: () =>
      apiFetch<Paginated<EntityRow>>(entityListPath({ limit: 10, offset: 0, search: debounced })),
    enabled: debounced.length >= 2,
  });
  const rows = (found.data?.items ?? []).filter((r) => r.id !== excludeId);

  return (
    <Modal
      open
      onClose={onClose}
      title="Merge with another client"
      description="Find the client that is the same business as this one."
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-faint" />
          <Input
            autoFocus
            aria-label="Find a client"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, code or PAN…"
            className="pl-8"
          />
        </div>
        {found.isFetching && <Spinner label="Searching…" />}
        {debounced.length >= 2 && found.data && rows.length === 0 && (
          <p className="text-sm text-ink-faint">No other client matches.</p>
        )}
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r.id)}
                className="flex w-full items-center justify-between gap-2 px-1 py-2 text-left text-sm hover:bg-surface-sunken"
              >
                <span>
                  <span className="font-medium text-ink">{r.legalName}</span>{' '}
                  <span className="text-ink-faint">({r.entityCode})</span>
                </span>
                <span className="text-xs text-ink-muted">{r.pan ?? 'No PAN'}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

// ── The merge popup ──────────────────────────────────────────────────────────

type Step = 'same' | 'values' | 'plan';

/** "1 engagement", "3 registrations" from the API's plural count keys. */
const countLabel = (kind: string, n: number): string => {
  const word = humanize(kind).toLowerCase();
  return `${n} ${n === 1 ? word.replace(/s$/, '') : word}`;
};

const ACTION_TONE: Record<MergeEngagementPlan['action'], string> = {
  move: 'success',
  fold: 'info',
  stay: 'warn',
};
const ACTION_LABEL: Record<MergeEngagementPlan['action'], string> = {
  move: 'Moves',
  fold: 'Folds in',
  stay: 'Stays',
};

/**
 * Merge two clients that are one business, in three steps: are they the same
 * (and which to keep), which differing values to carry over, and what happens
 * to the archived client's engagements. The API decides the verdict and the
 * plan; this only shows it and sends the choices.
 */
export function MergeClientsModal({
  clientIds,
  onClose,
  onMerged,
}: {
  /** The two clients, in any order; the API's recommendation picks the keeper. */
  clientIds: [string, string];
  onClose: () => void;
  onMerged?: (result: MergeClientsResult) => void;
}): JSX.Element {
  const qc = useQueryClient();
  const router = useRouter();
  const [order, setOrder] = useState<[string, string]>(clientIds);
  const [step, setStep] = useState<Step>('same');
  const [take, setTake] = useState<Set<MergeTakeField>>(new Set());
  const [result, setResult] = useState<MergeClientsResult | null>(null);
  const [keepId, dropId] = order;

  const preview = useQuery({
    queryKey: ['entity-merge', keepId, dropId],
    queryFn: () =>
      apiFetch<MergePreview>(
        `/entities/${keepId}/merge-preview?with=${encodeURIComponent(dropId)}`,
      ),
  });

  // Keep the API's recommendation until the person swaps.
  const [swapped, setSwapped] = useState(false);
  const p = preview.data;
  const flipToRecommended = !swapped && !!p && p.recommendedKeepId === p.drop.id;
  useEffect(() => {
    if (flipToRecommended && p) setOrder([p.drop.id, p.keep.id]);
  }, [flipToRecommended, p]);

  const swap = (): void => {
    setSwapped(true);
    setTake(new Set());
    setOrder([dropId, keepId]);
  };

  const merge = useMutation({
    mutationFn: () => {
      const body: MergeClientsRequest = { dropId, ...(take.size ? { take: [...take] } : {}) };
      return apiFetch<MergeClientsResult>(`/entities/${keepId}/merge`, { method: 'POST', body });
    },
    onSuccess: setResult,
  });

  // The refresh waits for the summary to close: the archived client's page,
  // the duplicates list and the import row all drop what hosts this popup.
  const finish = (): void => {
    if (result) {
      void qc.invalidateQueries({ queryKey: ['entities'] });
      void qc.invalidateQueries({ queryKey: ['entity', result.keptId] });
      void qc.invalidateQueries({ queryKey: ['entity', result.archivedId] });
      void qc.invalidateQueries({ queryKey: ['entity-merge'], refetchType: 'none' });
      onMerged?.(result);
    }
    onClose();
  };

  // Nothing shows until the preview is the order to show (no flash of the other keeper).
  const current = p && p.keep.id === keepId && !flipToRecommended ? p : undefined;
  const blocked = (current?.blockers.length ?? 0) > 0;
  const hasValues = (current?.fields.length ?? 0) > 0;

  if (result) {
    return (
      <Modal
        open
        onClose={finish}
        size="lg"
        title="Clients merged"
        footer={
          <>
            <Button variant="secondary" onClick={finish}>
              Close
            </Button>
            <Button
              onClick={() => {
                finish();
                router.push(`/entities/${result.keptId}`);
              }}
            >
              Open {result.keptCode}
            </Button>
          </>
        }
      >
        <MergeResultSummary result={result} />
      </Modal>
    );
  }

  const footer = current && (
    <>
      {step !== 'same' && (
        <Button
          variant="secondary"
          onClick={() => setStep(step === 'plan' && hasValues ? 'values' : 'same')}
        >
          Back
        </Button>
      )}
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      {!blocked && step !== 'plan' && (
        <Button onClick={() => setStep(step === 'same' && hasValues ? 'values' : 'plan')}>
          Next
        </Button>
      )}
      {!blocked && step === 'plan' && (
        <Button disabled={merge.isPending} onClick={() => merge.mutate()}>
          <GitMerge className="h-4 w-4" />
          {merge.isPending ? 'Merging…' : `Merge into ${current.keep.entityCode}`}
        </Button>
      )}
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Merge clients"
      description={
        step === 'same'
          ? 'Step 1 of 3 · Are these the same client?'
          : step === 'values'
            ? 'Step 2 of 3 · Where the two differ, which value to keep'
            : 'Step 3 of 3 · What the merge will do'
      }
      footer={footer || undefined}
    >
      {preview.isError && (
        <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {preview.error instanceof ApiError
            ? preview.error.message
            : 'Could not load the two clients.'}
        </p>
      )}
      {!current && !preview.isError && <Spinner label="Comparing the two clients…" />}
      {current && step === 'same' && <SameClientStep preview={current} onSwap={swap} />}
      {current && step === 'values' && (
        <ValuesStep preview={current} take={take} onChange={setTake} />
      )}
      {current && step === 'plan' && (
        <PlanStep
          preview={current}
          error={
            merge.isError
              ? merge.error instanceof ApiError
                ? merge.error.message
                : 'Could not merge the clients.'
              : null
          }
        />
      )}
    </Modal>
  );
}

function SameClientStep({
  preview,
  onSwap,
}: {
  preview: MergePreview;
  onSwap: () => void;
}): JSX.Element {
  const { keep, drop, verdict, reasons, blockers, recommendedKeepId } = preview;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="flex items-center gap-2">
          <VerdictBadge verdict={verdict} />
          {verdict === 'different' && blockers.length === 0 && (
            <span className="text-ink-muted">Merge only if you know they are one business.</span>
          )}
        </div>
        {reasons.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-ink-muted">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
        <SideCard side={keep} role="keep" recommended={keep.id === recommendedKeepId} />
        <div className="flex items-center justify-center">
          <Button
            size="sm"
            variant="ghost"
            onClick={onSwap}
            aria-label="Swap which client to keep"
            title="Keep the other one instead"
          >
            <ArrowLeftRight className="h-4 w-4" /> Swap
          </Button>
        </div>
        <SideCard side={drop} role="drop" recommended={drop.id === recommendedKeepId} />
      </div>

      {blockers.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger-200 bg-danger-50 p-3">
          <div className="font-semibold text-danger-700">These two cannot be merged</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-danger-700">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SideCard({
  side,
  role,
  recommended,
}: {
  side: MergeClientSide;
  role: 'keep' | 'drop';
  recommended: boolean;
}): JSX.Element {
  const counts = Object.entries(side.counts).filter(([, n]) => n > 0);
  return (
    <section
      aria-label={role === 'keep' ? 'Client to keep' : 'Client to archive'}
      className={`rounded-lg border p-3 ${
        role === 'keep' ? 'border-primary-300 bg-primary-50/40' : 'border-line'
      }`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <Badge tone={role === 'keep' ? 'success' : 'neutral'}>
          {role === 'keep' ? 'Keep' : 'Archive'}
        </Badge>
        {recommended && <Badge tone="info">Recommended</Badge>}
      </div>
      <div className="font-medium text-ink">{side.legalName}</div>
      <dl className="mt-1.5 space-y-0.5 text-xs">
        <Pair label="Code" value={side.entityCode} />
        <Pair label="Type" value={side.typeName} />
        <Pair label="PAN" value={side.pan ?? '—'} />
        <Pair label="GSTIN" value={side.gstins.length ? side.gstins.join(', ') : '—'} />
        <Pair label="Office" value={side.officeCode} />
        <Pair label="Status" value={humanize(side.status)} />
      </dl>
      {counts.length > 0 && (
        <p className="mt-1.5 text-xs text-ink-muted">
          {counts.map(([k, n]) => countLabel(k, n)).join(' · ')}
        </p>
      )}
    </section>
  );
}

function Pair({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="w-14 shrink-0 text-ink-faint">{label}</dt>
      <dd className="break-all text-ink">{value}</dd>
    </div>
  );
}

function ValuesStep({
  preview,
  take,
  onChange,
}: {
  preview: MergePreview;
  take: Set<MergeTakeField>;
  onChange: (next: Set<MergeTakeField>) => void;
}): JSX.Element {
  const pick = (field: MergeTakeField, fromDrop: boolean): void => {
    const next = new Set(take);
    if (fromDrop) next.add(field);
    else next.delete(field);
    onChange(next);
  };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-ink-muted">
        {preview.keep.entityCode} keeps its own values unless you pick {preview.drop.entityCode}
        &rsquo;s.
      </p>
      {preview.fields.map((f) => (
        <fieldset key={f.field} className="rounded-lg border border-line p-3">
          <legend className="px-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
            {f.label}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <ValueOption
              name={f.field}
              checked={!take.has(f.field)}
              onSelect={() => pick(f.field, false)}
              code={preview.keep.entityCode}
              value={f.keep}
            />
            <ValueOption
              name={f.field}
              checked={take.has(f.field)}
              onSelect={() => pick(f.field, true)}
              code={preview.drop.entityCode}
              value={f.drop}
            />
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function ValueOption({
  name,
  checked,
  onSelect,
  code,
  value,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  code: string;
  value: string | null;
}): JSX.Element {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 ${
        checked ? 'border-primary-400 bg-primary-50/50' : 'border-line'
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="mt-0.5" />
      <span>
        <span className="block text-ink">{value ?? <span className="text-ink-faint">—</span>}</span>
        <span className="text-xs text-ink-faint">from {code}</span>
      </span>
    </label>
  );
}

function PlanStep({
  preview,
  error,
}: {
  preview: MergePreview;
  error: string | null;
}): JSX.Element {
  const { keep, drop, engagements, warnings } = preview;
  return (
    <div className="space-y-4 text-sm">
      <p className="text-ink">
        {drop.legalName} ({drop.entityCode}) is archived. Its registrations, contacts, logins and
        billing move to {keep.legalName} ({keep.entityCode}), and its page will point there.
      </p>
      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Engagements of {drop.entityCode}
        </h3>
        {engagements.length === 0 ? (
          <p className="text-ink-faint">None.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {engagements.map((g) => (
              <li key={g.id} className="flex items-start justify-between gap-3 px-3 py-2">
                <div>
                  <span className="font-medium text-ink">{g.code}</span>{' '}
                  <span className="text-ink-muted">{g.label}</span>
                  {g.reason && <div className="text-xs text-ink-faint">{g.reason}</div>}
                </div>
                <Badge tone={ACTION_TONE[g.action]}>{ACTION_LABEL[g.action]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
      {warnings.length > 0 && (
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-3">
          <div className="flex items-center gap-1.5 font-semibold text-warning-700">
            <AlertTriangle className="h-4 w-4" /> Before you merge
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-ink-faint">
        This cannot be undone from the portal. The audit trail keeps what moved.
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}

function MergeResultSummary({ result }: { result: MergeClientsResult }): JSX.Element {
  // "invoicesLeft" and the like count what did not move.
  const [counts, left] = useMemo(() => {
    const all = Object.entries(result.counts).filter(([, n]) => n > 0);
    return [
      all.filter(([k]) => !k.endsWith('Left')),
      all.filter(([k]) => k.endsWith('Left')).map(([k, n]) => [k.slice(0, -4), n] as const),
    ];
  }, [result.counts]);
  return (
    <div className="space-y-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-success-700">
        <CheckCircle2 className="h-4 w-4" /> {result.archivedCode} is merged into {result.keptCode}{' '}
        and archived.
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-ink">
        <li>
          {result.movedEngagements} engagement{result.movedEngagements === 1 ? '' : 's'} moved.
        </li>
        {counts.map(([k, n]) => (
          <li key={k}>{countLabel(k, n)} moved.</li>
        ))}
        {result.folded && (
          <li>
            Compliance engagement {result.folded.from} folded into {result.folded.into}:{' '}
            {result.folded.filings} filing{result.folded.filings === 1 ? '' : 's'} and{' '}
            {result.folded.tasks} task{result.folded.tasks === 1 ? '' : 's'}
            {result.folded.filingsLeft > 0 &&
              `; ${result.folded.filingsLeft} filing${result.folded.filingsLeft === 1 ? '' : 's'} already on ${result.folded.into} left on ${result.folded.from}`}
            .
          </li>
        )}
      </ul>
      {(result.stayed.length > 0 || left.length > 0) && (
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-3">
          <div className="font-semibold text-warning-700">Stayed on {result.archivedCode}</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink">
            {left.map(([k, n]) => (
              <li key={`left-${k}`}>{countLabel(k, n)}</li>
            ))}
            {result.stayed.map((s, i) => (
              <li key={`${s.kind}-${s.code ?? i}`}>
                {s.code ?? (s.count !== undefined ? countLabel(s.kind, s.count) : humanize(s.kind))}
                : {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
