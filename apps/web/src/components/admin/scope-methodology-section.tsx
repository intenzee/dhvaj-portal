'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  DECISION_STATUS_LABEL,
  SCOPE_METHODOLOGY_KIND_LABEL,
  SCOPE_METHODOLOGY_KINDS,
  SCOPE_METHODOLOGY_STATUSES,
  type CreateScopeMethodologyItemVersionInput,
  type ScopeDecisionKind,
  type ScopeMethodologyItemRecord,
  type ScopeMethodologyLibrary,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { CheckList, LibraryRow, VersionHistory, groupBy, useVersionFields } from './analytics-methodology-section';

const LIBRARY_KEY = ['scope-methodology-library'];
const API = '/scope-methodology-library';
const statusLabel = (s: string) => (DECISION_STATUS_LABEL as Record<string, string>)[s] ?? s;

/**
 * 03.4 Scope & Approach Methodology Library (DHVAJ 03.4 §31): the controls
 * cycles, timing areas, evidence channels and technology uses 03.4 asks about —
 * their labels, answer vocabularies, hints and guidance. Configuration, not
 * code: every change is a new version from a date; a retired item stays
 * visible on files that already answered it. The Methodology Admin never reads
 * client data here and cannot conclude an engagement's scope.
 */
export function ScopeMethodologySection(): JSX.Element {
  const lib = useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: () => apiFetch<ScopeMethodologyLibrary>(API),
  });
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<ScopeDecisionKind | 'all'>('all');
  const groups = useMemo(
    () =>
      groupBy(lib.data?.items, (r) => r.itemCode).filter(
        (v) => kind === 'all' || v[0]!.kind === kind,
      ),
    [lib.data, kind],
  );
  const nextCode = useMemo(() => {
    const used = new Set((lib.data?.items ?? []).map((r) => r.itemCode));
    for (let n = 1; n < 1000; n += 1) {
      const code = `SMI-${String(n).padStart(3, '0')}`;
      if (!used.has(code)) return code;
    }
    return '';
  }, [lib.data]);

  return (
    <div className="space-y-4">
      <div className="max-w-3xl space-y-2">
        <h3 className="text-sm font-semibold text-ink">Scope &amp; Approach Methodology Library</h3>
        <p className="text-xs text-ink-muted">
          The strategic decision lists 03.4 Audit Scope &amp; Approach asks the Engagement Manager
          about: major controls cycles (reliance strategy), interim / year-end timing areas,
          evidence channels and potential technology uses. Change a label, the answers offered,
          the hint or the guidance by adding a version from a date; retire an item to stop asking
          it on new work. Answers already recorded on a file are kept and shown as retired.
        </p>
      </div>
      {lib.isLoading ? (
        <Spinner label="Loading the library…" />
      ) : lib.isError || !lib.data ? (
        <p className="text-sm text-danger-600">
          Could not load the Scope &amp; Approach Methodology Library.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Select
              className="max-w-[14rem]"
              aria-label="Filter by kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ScopeDecisionKind | 'all')}
            >
              <option value="all">All kinds</option>
              {SCOPE_METHODOLOGY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SCOPE_METHODOLOGY_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)}>
              {adding ? 'Cancel new item' : 'New item'}
            </Button>
          </div>
          {adding && (
            <ItemForm base={null} defaultCode={nextCode} onDone={() => setAdding(false)} />
          )}
          <ul className="divide-y divide-line rounded-lg border border-line">
            {groups.map((versions) => {
              const r = versions[0]!;
              return (
                <LibraryRow
                  key={r.itemCode}
                  code={r.itemCode}
                  title={r.label}
                  latest={r}
                  count={versions.length}
                  badges={<Badge tone="neutral">{SCOPE_METHODOLOGY_KIND_LABEL[r.kind]}</Badge>}
                >
                  <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
                    <dt className="text-ink-muted">Item key</dt>
                    <dd className="font-mono text-xs">{r.itemKey}</dd>
                    <dt className="text-ink-muted">Answers offered</dt>
                    <dd className="text-xs">{r.options.map(statusLabel).join(' · ')}</dd>
                    <dt className="text-ink-muted">Hint</dt>
                    <dd className="text-xs">{r.hint ?? '—'}</dd>
                    <dt className="text-ink-muted">Guidance</dt>
                    <dd className="text-xs">{r.guidance ?? '—'}</dd>
                  </dl>
                  <VersionHistory versions={versions} periodLabel="Effective" />
                  <ItemForm base={r} defaultCode={r.itemCode} onDone={() => undefined} />
                </LibraryRow>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function ItemForm({
  base,
  defaultCode,
  onDone,
}: {
  base: ScopeMethodologyItemRecord | null;
  defaultCode: string;
  onDone: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [itemCode, setItemCode] = useState(defaultCode);
  const [kind, setKind] = useState<ScopeDecisionKind>(base?.kind ?? 'controls_cycle');
  const [itemKey, setItemKey] = useState(base?.itemKey ?? '');
  const [label, setLabel] = useState(base?.label ?? '');
  const [options, setOptions] = useState<string[]>(base?.options ?? []);
  const [hint, setHint] = useState(base?.hint ?? '');
  const [guidance, setGuidance] = useState(base?.guidance ?? '');
  const [sortOrder, setSortOrder] = useState(base?.sortOrder.toString() ?? '');
  const v = useVersionFields(base, 'Effective from', 'e.g. dhvaj-scope-2027.1');

  const errors = [
    ...v.errors,
    !/^SMI-[0-9]{3}$/.test(itemCode) && 'Item code must look like SMI-001.',
    !/^[a-z][a-z0-9_]{1,59}$/.test(itemKey) && 'Item key must be lower_snake_case.',
    !label.trim() && 'Label the item.',
    (options.length < 2 || options.length > 8) && 'Offer between 2 and 8 answers.',
  ].filter((e): e is string => typeof e === 'string');

  const save = useMutation({
    mutationFn: (body: CreateScopeMethodologyItemVersionInput) =>
      apiFetch<ScopeMethodologyItemRecord>(`${API}/items`, { method: 'POST', body }),
    onSuccess: (r) => {
      toast(`${r.itemCode} v${r.version} saved.`);
      void qc.invalidateQueries({ queryKey: LIBRARY_KEY });
      v.reset();
      onDone();
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not save the library version.'),
  });

  return (
    <form
      className="space-y-3 rounded-lg border border-line bg-surface-raised p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (errors.length) return;
        save.mutate({
          itemCode,
          kind,
          itemKey,
          label: label.trim(),
          options,
          hint: hint.trim() || null,
          guidance: guidance.trim() || null,
          ...(sortOrder.trim() ? { sortOrder: Number(sortOrder) } : {}),
          ...v.body,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Item code" required>
          <Input value={itemCode} disabled={!!base} onChange={(e) => setItemCode(e.target.value)} />
        </Field>
        <Field label="Kind" required>
          <Select
            value={kind}
            disabled={!!base}
            onChange={(e) => setKind(e.target.value as ScopeDecisionKind)}
          >
            {SCOPE_METHODOLOGY_KINDS.map((k) => (
              <option key={k} value={k}>
                {SCOPE_METHODOLOGY_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Item key" required hint="Stable key saved answers refer to.">
          <Input value={itemKey} disabled={!!base} onChange={(e) => setItemKey(e.target.value.trim())} />
        </Field>
        <Field label="Order">
          <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
      </div>
      <Field label="Label" required>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <CheckList
        legend="Answers offered (2–8)"
        options={SCOPE_METHODOLOGY_STATUSES}
        value={options}
        onChange={setOptions}
        labelOf={statusLabel}
      />
      <Field label="Hint" hint="Short prompt under the label in 03.4.">
        <Input value={hint} onChange={(e) => setHint(e.target.value)} />
      </Field>
      <Field label="Guidance" hint="DHVAJ methodology guidance shown with the item.">
        <Textarea rows={2} value={guidance} onChange={(e) => setGuidance(e.target.value)} />
      </Field>
      {v.fields('Retire this item from the effective date')}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={errors.length > 0 || save.isPending}
          title={errors.join(' ') || undefined}
        >
          {base ? 'Add version' : 'Add item'}
        </Button>
      </div>
    </form>
  );
}
