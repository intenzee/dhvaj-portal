'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AREA_ATTENTION_LABEL,
  AREA_ATTENTIONS,
  AREA_CATEGORIES,
  AREA_CATEGORY_LABEL,
  AREA_CONDITION_KEYS,
  AREA_CONDITION_LABEL,
  AREA_TYPE_LABEL,
  AREA_TYPES,
  GENERAL_CORPORATE_INDUSTRY,
  type AreaAttention,
  type AreaCategory,
  type AreaConditionKey,
  type AreaType,
  type AssertionId,
  type AuditAreaLibraryAdminRow,
  type AuditAreaLibraryAdminView,
  type UpsertLibraryAreaInput,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { CheckList } from './analytics-methodology-section';

const API = '/audit-area-library';
const FRAMEWORK_LABEL = { both: 'AS and Ind AS', as: 'AS only', ind_as: 'Ind AS only' } as const;
/** Aliases and references may contain spaces ("Trade receivables"), so split on commas / lines only. */
const splitCsv = (s: string): string[] => [
  ...new Set(
    s
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean),
  ),
];

/**
 * Audit Area Library (DHVAJ 03.5 §4, §6, §7): the master list of Audit Areas
 * 03.5 populates on an engagement. A released version is immutable — changes
 * go into one draft (a copy of the current release) and publish as the next
 * version. Engagements keep the version they were populated from; a newer
 * release shows them a "methodology update available" notice only.
 */
export function AuditAreaLibrarySection(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [version, setVersion] = useState<string | null>(null);
  const key = ['audit-area-library', version ?? 'default'];
  const lib = useQuery({
    queryKey: key,
    queryFn: () =>
      apiFetch<AuditAreaLibraryAdminView>(
        version ? `${API}?version=${encodeURIComponent(version)}` : API,
      ),
  });
  const mutation = useMutation({
    mutationFn: (v: { path: string; body?: unknown; done: string; after?: () => void }) =>
      apiFetch<AuditAreaLibraryAdminView>(`${API}${v.path}`, {
        method: 'POST',
        body: v.body ?? {},
      }),
    onSuccess: (data, v) => {
      void qc.invalidateQueries({ queryKey: ['audit-area-library'] });
      const shown = data.selected?.libraryVersion ?? null;
      qc.setQueryData(['audit-area-library', shown ?? 'default'], data);
      setVersion(shown);
      toast(v.done);
      v.after?.();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save the library.'),
  });
  const send = (path: string, body: unknown, done: string, after?: () => void) =>
    mutation.mutate({ path, body, done, after });

  const v = lib.data;
  const draft = v?.releases.find((r) => r.status === 'draft') ?? null;
  const sel = v?.selected ?? null;
  const editable = sel?.status === 'draft';

  return (
    <div className="space-y-4">
      <div className="max-w-3xl space-y-2">
        <h3 className="text-sm font-semibold text-ink">Audit Area Library (03.5)</h3>
        <p className="text-xs text-ink-muted">
          The DHVAJ Audit Areas, their default SA 315 assertions, default attention, conditions
          (CFS, initial audit, CARO, IFC, Ind AS transition), industry and framework profile,
          signal-mapping tags and professional references. 03.5 populates every applicable area on
          first entry. Methodology only — no client data, no risk ratings. A release is never
          edited; start a draft, change it and publish it as the next version.
        </p>
      </div>
      {lib.isLoading ? (
        <Spinner label="Loading the library…" />
      ) : lib.isError || !v ? (
        <p className="text-sm text-danger-600">Could not load the Audit Area Library.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-muted">
              <tr>
                <th className="py-1">Version</th>
                <th>Status</th>
                <th>Areas (active)</th>
                <th>Engagements using</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {v.releases.map((r) => (
                <tr
                  key={r.libraryVersion}
                  className={r.libraryVersion === sel?.libraryVersion ? 'bg-primary-50/40' : ''}
                >
                  <td className="py-1.5 font-mono text-xs">{r.libraryVersion}</td>
                  <td className="space-x-1">
                    <Badge tone={r.status === 'draft' ? 'warn' : 'success'}>
                      {r.status === 'draft'
                        ? 'Draft'
                        : `Released ${r.releasedAt ? formatDate(r.releasedAt) : ''}`}
                    </Badge>
                    {r.current && <Badge tone="info">Current</Badge>}
                  </td>
                  <td>
                    {r.areaCount} ({r.activeCount})
                  </td>
                  <td>{r.engagementsUsing}</td>
                  <td className="max-w-xs text-xs text-ink-muted">
                    {r.basedOn ? `From ${r.basedOn}. ` : ''}
                    {r.note ?? ''}
                  </td>
                  <td className="text-right">
                    {r.libraryVersion !== sel?.libraryVersion && (
                      <button
                        type="button"
                        className="text-xs text-primary-700 hover:underline"
                        onClick={() => setVersion(r.libraryVersion)}
                      >
                        View
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!draft && <NewDraftForm pending={mutation.isPending} send={send} />}

          {sel && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">
                  {sel.libraryVersion} — {v.rows.length} area{v.rows.length === 1 ? '' : 's'}
                </span>
                {editable && (
                  <PublishButton
                    version={sel.libraryVersion}
                    pending={mutation.isPending}
                    send={send}
                  />
                )}
              </div>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {editable && (
                  <AreaEditor
                    key="new"
                    view={v}
                    row={null}
                    version={sel.libraryVersion}
                    pending={mutation.isPending}
                    send={send}
                  />
                )}
                {v.rows.map((row) => (
                  <AreaEditor
                    key={row.id}
                    view={v}
                    row={row}
                    version={sel.libraryVersion}
                    editable={editable}
                    pending={mutation.isPending}
                    send={send}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type Send = (path: string, body: unknown, done: string, after?: () => void) => void;

function NewDraftForm({ pending, send }: { pending: boolean; send: Send }): JSX.Element {
  const [libraryVersion, setLibraryVersion] = useState('');
  const [note, setNote] = useState('');
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line p-3">
      <Field label="Next library version" hint="e.g. dhvaj-gc-2026.3">
        <Input value={libraryVersion} onChange={(e) => setLibraryVersion(e.target.value)} />
      </Field>
      <div className="min-w-[16rem] flex-1">
        <Field label="What this version changes" required>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Button
        variant="secondary"
        disabled={pending || !libraryVersion.trim() || !note.trim()}
        onClick={() =>
          send(
            '/drafts',
            { libraryVersion: libraryVersion.trim(), note: note.trim() },
            'Draft started from the current release.',
            () => {
              setLibraryVersion('');
              setNote('');
            },
          )
        }
      >
        Start draft
      </Button>
    </div>
  );
}

function PublishButton({
  version,
  pending,
  send,
}: {
  version: string;
  pending: boolean;
  send: Send;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <span className="flex items-center gap-2 text-xs">
      <span className="text-warning-800">
        Publish {version}? It becomes the release new engagements use and can no longer be edited.
      </span>
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          send(`/${encodeURIComponent(version)}/publish`, {}, `${version} published.`, () =>
            setConfirming(false),
          )
        }
      >
        Publish
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  ) : (
    <Button size="sm" onClick={() => setConfirming(true)}>
      Publish draft
    </Button>
  );
}

const EMPTY: UpsertLibraryAreaInput = {
  areaCode: '',
  areaName: '',
  areaType: 'balance_sheet',
  category: 'assets',
  frameworkProfile: 'both',
  industryProfile: GENERAL_CORPORATE_INDUSTRY,
  conditionKey: null,
  defaultAssertions: [],
  nonAssertionWorkstream: false,
  defaultAttention: 'standard',
  relatedAuthorities: [],
  signalMappingTags: [],
  metricKeys: [],
  indicatorTags: [],
  aliases: [],
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: null,
  active: true,
  sortOrder: 0,
};

const LIST_FIELDS = [
  ['aliases', 'Aliases (search)'],
  ['relatedAuthorities', 'Professional references (codes)'],
  ['signalMappingTags', 'Signal-mapping tags'],
  ['metricKeys', '03.2 metric keys'],
  ['indicatorTags', 'Indicator tags'],
] as const;

/** One library area, opened under itself (+/−); a draft's areas are editable in place. */
function AreaEditor({
  view,
  row,
  version,
  editable = true,
  pending,
  send,
}: {
  view: AuditAreaLibraryAdminView;
  row: AuditAreaLibraryAdminRow | null;
  version: string;
  editable?: boolean;
  pending: boolean;
  send: Send;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const initial: UpsertLibraryAreaInput = row
    ? (({ id: _id, libraryVersion: _v, ...rest }) => rest)(row)
    : { ...EMPTY, sortOrder: (view.rows.at(-1)?.sortOrder ?? 0) + 10 };
  const [f, setF] = useState<UpsertLibraryAreaInput>(initial);
  const [lists, setLists] = useState<Record<(typeof LIST_FIELDS)[number][0], string>>(
    () =>
      Object.fromEntries(LIST_FIELDS.map(([k]) => [k, initial[k].join(', ')])) as Record<
        (typeof LIST_FIELDS)[number][0],
        string
      >,
  );
  const set = <K extends keyof UpsertLibraryAreaInput>(k: K, value: UpsertLibraryAreaInput[K]) =>
    setF((x) => ({ ...x, [k]: value }));
  const ro = !editable;
  const save = () =>
    send(
      row
        ? `/${encodeURIComponent(version)}/areas/${row.id}`
        : `/${encodeURIComponent(version)}/areas`,
      {
        ...f,
        ...Object.fromEntries(LIST_FIELDS.map(([k]) => [k, splitCsv(lists[k])])),
      },
      row ? `${f.areaName} saved.` : `${f.areaName} added to ${version}.`,
      () => {
        if (!row) {
          setF({ ...EMPTY, sortOrder: f.sortOrder + 10 });
          setLists(Object.fromEntries(LIST_FIELDS.map(([k]) => [k, ''])) as typeof lists);
        }
        setOpen(false);
      },
    );

  return (
    <li className="px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full flex-wrap items-center gap-2.5 text-left"
      >
        <ExpandToggle open={open} />
        {row ? (
          <>
            <span className="font-mono text-xs text-ink">{row.areaCode}</span>
            <span className="text-sm text-ink">{row.areaName}</span>
            <Badge tone="neutral">{AREA_TYPE_LABEL[row.areaType]}</Badge>
            {row.conditionKey && <Badge tone="info">Conditional</Badge>}
            {row.industryProfile !== GENERAL_CORPORATE_INDUSTRY && (
              <Badge tone="info">{row.industryProfile}</Badge>
            )}
            {row.defaultAttention === 'enhanced' && <Badge tone="warn">Enhanced by default</Badge>}
            {!row.active && <Badge tone="warn">Inactive</Badge>}
            <span className="ml-auto text-xs text-ink-faint">
              {row.nonAssertionWorkstream ? 'Workstream' : row.defaultAssertions.join(', ')}
            </span>
          </>
        ) : (
          <span className="text-sm font-medium text-primary-700">
            Add an Audit Area to {version}
          </span>
        )}
      </button>
      {open && (
        <fieldset disabled={ro} className="mt-3 space-y-3 pl-7">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Area code" hint="Capitals, digits, _">
              <Input
                value={f.areaCode}
                onChange={(e) => set('areaCode', e.target.value.toUpperCase())}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Area name">
                <Input value={f.areaName} onChange={(e) => set('areaName', e.target.value)} />
              </Field>
            </div>
            <Field label="Area type">
              <Select
                value={f.areaType}
                onChange={(e) => set('areaType', e.target.value as AreaType)}
              >
                {AREA_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {AREA_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category">
              <Select
                value={f.category}
                onChange={(e) => set('category', e.target.value as AreaCategory)}
              >
                {AREA_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {AREA_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Framework">
              <Select
                value={f.frameworkProfile}
                onChange={(e) =>
                  set(
                    'frameworkProfile',
                    e.target.value as UpsertLibraryAreaInput['frameworkProfile'],
                  )
                }
              >
                {(['both', 'as', 'ind_as'] as const).map((k) => (
                  <option key={k} value={k}>
                    {FRAMEWORK_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Industry profile">
              <Select
                value={f.industryProfile}
                onChange={(e) => set('industryProfile', e.target.value)}
              >
                {view.industryProfiles.map((i) => (
                  <option key={i.key} value={i.key}>
                    {i.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Selection condition">
              <Select
                value={f.conditionKey ?? ''}
                onChange={(e) =>
                  set('conditionKey', (e.target.value || null) as AreaConditionKey | null)
                }
              >
                <option value="">Always (no condition)</option>
                {AREA_CONDITION_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {AREA_CONDITION_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Default attention">
              <Select
                value={f.defaultAttention}
                onChange={(e) => set('defaultAttention', e.target.value as AreaAttention)}
              >
                {AREA_ATTENTIONS.map((a) => (
                  <option key={a} value={a}>
                    {AREA_ATTENTION_LABEL[a]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <CheckList<AssertionId>
            legend="Default SA 315 assertions"
            options={view.assertionMaster.map((m) => m.id)}
            value={f.defaultAssertions}
            onChange={(x) => set('defaultAssertions', x)}
            labelOf={(id) => view.assertionMaster.find((m) => m.id === id)?.label ?? id}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.nonAssertionWorkstream}
              onChange={(e) => set('nonAssertionWorkstream', e.target.checked)}
            />
            Non-assertion workstream (e.g. going concern, related parties) — no default assertions
            required
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {LIST_FIELDS.map(([k, label]) => (
              <Field key={k} label={label} hint="Comma or line separated">
                <Input
                  value={lists[k]}
                  onChange={(e) => setLists({ ...lists, [k]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Effective from">
              <Input
                type="date"
                value={f.effectiveFrom}
                onChange={(e) => set('effectiveFrom', e.target.value)}
              />
            </Field>
            <Field label="Effective to (optional)">
              <Input
                type="date"
                value={f.effectiveTo ?? ''}
                onChange={(e) => set('effectiveTo', e.target.value || null)}
              />
            </Field>
            <Field label="Sort order">
              <Input
                type="number"
                value={String(f.sortOrder)}
                onChange={(e) =>
                  set('sortOrder', Math.max(0, Math.trunc(Number(e.target.value) || 0)))
                }
              />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                checked={f.active}
                onChange={(e) => set('active', e.target.checked)}
              />
              Active
            </label>
          </div>
          {editable && (
            <Button
              variant="secondary"
              disabled={pending || !f.areaCode.trim() || !f.areaName.trim()}
              onClick={save}
            >
              {row ? 'Save area' : 'Add area'}
            </Button>
          )}
        </fieldset>
      )}
    </li>
  );
}
