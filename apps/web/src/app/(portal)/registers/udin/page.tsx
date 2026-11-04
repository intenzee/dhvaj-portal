'use client';

import { Fragment, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Search } from 'lucide-react';
import {
  FEATURE_FLAG,
  PERMISSION,
  UDIN_DOCUMENT_KINDS,
  UDIN_DOCUMENT_KIND_LABEL,
  workItemHref,
  type UdinDocumentKind,
  type UdinEntry,
  type UdinPendingItem,
  type UdinStatus,
} from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useUrlState } from '@/lib/url-state';
import { downloadFile } from '@/lib/api';
import {
  fetchUdinPending,
  fetchUdins,
  revokeUdin,
  udinKey,
  udinListPath,
  type UdinFilters,
} from '@/lib/registers-api';
import { Badge, Button, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Input, Select } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { UdinForm, type UdinPrefill } from '@/components/registers/udin-form';

type View = 'register' | 'pending' | 'overdue';

/** "in 3 days" / "today" / "5 days ago" for a window. */
function windowText(daysLeft: number): string {
  if (daysLeft === 0) return 'closes today';
  if (daysLeft > 0) return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
  const n = -daysLeft;
  return `closed ${n} day${n === 1 ? '' : 's'} ago`;
}

/** PS-304 — every UDIN the firm generated, and the reports signed without one. */
function UdinRegisterScreen(): JSX.Element {
  const { principal } = useAuth();
  const flags = useFeatureFlags();
  const on = flags.isOn(FEATURE_FLAG.registers);
  const url = useUrlState();
  const qc = useQueryClient();
  const view: View =
    url.get('view') === 'overdue'
      ? 'overdue'
      : url.get('view') === 'pending'
        ? 'pending'
        : 'register';
  const filters: UdinFilters = {
    search: url.get('q') ?? '',
    documentKind: (url.get('kind') as UdinDocumentKind | null) ?? '',
    status: (url.get('status') as UdinStatus | null) ?? '',
    financialYear: url.get('fy') ?? '',
    id: url.get('u') ?? '',
  };
  const [term, setTerm] = useState(filters.search);
  useEffect(() => {
    if (term === filters.search) return;
    const t = setTimeout(() => url.set({ q: term }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
  const [open, setOpen] = useState<string | null>(filters.id || null);
  const [adding, setAdding] = useState<{ key: string; prefill: UdinPrefill | null } | null>(null);

  const list = useQuery({
    queryKey: [...udinKey, 'list', udinListPath(filters)],
    queryFn: () => fetchUdins(filters),
    enabled: on && view === 'register',
  });
  const pending = useQuery({
    queryKey: [...udinKey, 'pending', view],
    queryFn: () => fetchUdinPending(view === 'overdue' ? 'overdue' : 'all'),
    enabled: on && view !== 'register',
  });
  const canManage = can(principal, PERMISSION.registerManage);
  const windowDays = (list.data ?? pending.data)?.windowDays;

  if (!flags.isLoading && !on) {
    return (
      <div>
        <PageHeader title="UDIN register" />
        <EmptyState>The registers aren&rsquo;t switched on for your office yet.</EmptyState>
      </div>
    );
  }

  const chip = (active: boolean): string =>
    `rounded-full border px-3 py-1 text-xs font-medium transition ${
      active
        ? 'border-primary-600 bg-primary-600 text-white'
        : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-raised'
    }`;
  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: udinKey });

  return (
    <div>
      <PageHeader
        title="UDIN register"
        subtitle={`Every UDIN the firm generated, for peer review — and the reports signed without one${
          windowDays ? `, against the firm's ${windowDays}-day window` : ''
        }.`}
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                void downloadFile(
                  udinListPath({ ...filters, id: '' }, '/registers/udin/csv'),
                  'udin-register.csv',
                )
              }
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            {canManage && (
              <Button onClick={() => setAdding({ key: 'top', prefill: null })}>
                <Plus className="h-4 w-4" /> Add UDIN
              </Button>
            )}
          </div>
        }
      />

      {adding?.key === 'top' && (
        <div className="mb-4">
          <UdinForm
            prefill={null}
            onClose={() => setAdding(null)}
            onSaved={(e) => {
              setAdding(null);
              void refresh();
              url.set({ view: null, u: e.id });
              setOpen(e.id);
            }}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="View">
          {(
            [
              ['register', 'Register'],
              ['pending', 'Still to generate'],
              ['overdue', 'Window closed'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={view === k}
              className={chip(view === k)}
              onClick={() => url.set({ view: k === 'register' ? null : k, u: null })}
            >
              {label}
            </button>
          ))}
        </div>
        {view === 'register' && (
          <>
            <div className="flex min-w-56 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5">
              <Search className="h-4 w-4 text-ink-faint" aria-hidden />
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="UDIN, client, partner…"
                aria-label="Search UDINs"
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
              />
            </div>
            <Select
              className="w-auto"
              aria-label="Document"
              value={filters.documentKind}
              onChange={(e) => url.set({ kind: e.target.value })}
            >
              <option value="">Every document</option>
              {UDIN_DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {UDIN_DOCUMENT_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
            <Select
              className="w-auto"
              aria-label="Status"
              value={filters.status}
              onChange={(e) => url.set({ status: e.target.value })}
            >
              <option value="">Active and revoked</option>
              <option value="active">Active</option>
              <option value="revoked">Revoked</option>
            </Select>
            <Input
              className="w-28"
              aria-label="Financial year"
              placeholder="FY 2025-26"
              defaultValue={filters.financialYear}
              onBlur={(e) => {
                const fy = e.target.value.trim();
                if (fy === '' || /^\d{4}-\d{2}$/.test(fy)) url.set({ fy });
              }}
            />
          </>
        )}
      </div>

      {filters.id && view === 'register' && (
        <p className="mb-3 text-sm text-ink-muted">
          Showing one UDIN.{' '}
          <button
            type="button"
            className="text-primary-600 hover:underline"
            onClick={() => url.set({ u: null })}
          >
            Show the whole register
          </button>
        </p>
      )}

      {view === 'register' ? (
        <>
          {list.isLoading && <Spinner />}
          {list.isError && (
            <EmptyState>Could not load the register. Check that the API is reachable.</EmptyState>
          )}
          {list.data &&
            (list.data.items.length === 0 ? (
              <EmptyState>No UDINs match these filters.</EmptyState>
            ) : (
              <RegisterTable
                items={list.data.items}
                open={open}
                setOpen={setOpen}
                canManage={canManage}
                onChanged={refresh}
              />
            ))}
          {list.data && list.data.total > list.data.items.length && (
            <p className="mt-2 text-xs text-ink-faint">
              Showing {list.data.items.length} of {list.data.total}. Narrow the filters, or export
              the CSV for all.
            </p>
          )}
        </>
      ) : (
        <>
          {pending.isLoading && <Spinner />}
          {pending.isError && (
            <EmptyState>Could not load the reports. Check that the API is reachable.</EmptyState>
          )}
          {pending.data &&
            (pending.data.items.length === 0 ? (
              <EmptyState>
                {view === 'overdue'
                  ? 'No signed report has passed its window without a UDIN.'
                  : 'Every signed report you can see has its UDIN in the register.'}
              </EmptyState>
            ) : (
              <PendingTable
                items={pending.data.items}
                canManage={canManage}
                adding={adding}
                setAdding={setAdding}
                onSaved={(e) => {
                  setAdding(null);
                  void refresh();
                  url.set({ view: null, u: e.id });
                  setOpen(e.id);
                }}
              />
            ))}
        </>
      )}
    </div>
  );
}

function RegisterTable({
  items,
  open,
  setOpen,
  canManage,
  onChanged,
}: {
  items: UdinEntry[];
  open: string | null;
  setOpen: (id: string | null) => void;
  canManage: boolean;
  onChanged: () => Promise<void>;
}): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-surface-sunken/60 text-left text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="w-8 px-3 py-2" />
            <th className="px-3 py-2">UDIN</th>
            <th className="px-3 py-2">Document</th>
            <th className="px-3 py-2">Client</th>
            <th className="px-3 py-2">Signing partner</th>
            <th className="px-3 py-2">Signed</th>
            <th className="px-3 py-2">Generated</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => {
            const isOpen = open === e.id;
            return (
              <Fragment key={e.id}>
                <tr
                  className="group cursor-pointer border-b border-line last:border-0 hover:bg-surface-raised"
                  onClick={() => setOpen(isOpen ? null : e.id)}
                >
                  <td className="px-3 py-2">
                    <ExpandToggle open={isOpen} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{e.udin}</td>
                  <td className="px-3 py-2">
                    {UDIN_DOCUMENT_KIND_LABEL[e.documentKind]}
                    {e.financialYear ? ` · FY ${e.financialYear}` : ''}
                  </td>
                  <td className="px-3 py-2">{e.entityName}</td>
                  <td className="px-3 py-2">{e.signingPartnerName ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{e.signedOn}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {e.generatedOn}
                    {e.late && (
                      <Badge tone="warn" className="ml-2">
                        Late
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {e.status === 'revoked' ? (
                      <Badge tone="danger">Revoked</Badge>
                    ) : (
                      <Badge tone="success">Active</Badge>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-line">
                    <td colSpan={8} className="px-3 pb-3">
                      <UdinDetail entry={e} canManage={canManage} onChanged={onChanged} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const SOURCE_LABEL: Record<UdinEntry['source'], string> = {
  manual: 'Added by hand',
  archive: 'From the audit file archive',
  tax_audit: 'From the tax audit',
};

function UdinDetail({
  entry: e,
  canManage,
  onChanged,
}: {
  entry: UdinEntry;
  canManage: boolean;
  onChanged: () => Promise<void>;
}): JSX.Element {
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState('');
  const revoke = useMutation({
    mutationFn: () => revokeUdin(e.id, { reason: reason.trim(), version: e.version }),
    onSuccess: async () => {
      setRevoking(false);
      setReason('');
      await onChanged();
    },
  });
  return (
    <div className="mt-2 rounded-lg border border-primary-600/30 border-l-4 border-l-primary-600 bg-surface-sunken/40 p-4 text-sm">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-ink-muted">Membership no.</dt>
          <dd>{e.membershipNo ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Engagement</dt>
          <dd>
            {e.engagementId ? (
              <Link
                className="text-primary-600 hover:underline"
                href={workItemHref({ ...e.link, udinId: undefined })}
              >
                {e.engagementCode}
              </Link>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Entered</dt>
          <dd>{SOURCE_LABEL[e.source]}</dd>
        </div>
        {e.description && (
          <div className="sm:col-span-3">
            <dt className="text-xs text-ink-muted">Description</dt>
            <dd>{e.description}</dd>
          </div>
        )}
        {e.late && (
          <div className="sm:col-span-3 text-warning-700">
            Generated after the firm&rsquo;s window had closed.
          </div>
        )}
        {e.status === 'revoked' && (
          <div className="sm:col-span-3">
            <dt className="text-xs text-ink-muted">
              Revoked{e.revokedAt ? ` on ${e.revokedAt.slice(0, 10)}` : ''}
            </dt>
            <dd>{e.revokedReason}</dd>
          </div>
        )}
      </dl>
      {canManage && e.status === 'active' && (
        <div className="mt-3 border-t border-line pt-3">
          {revoking ? (
            <div className="flex flex-wrap items-start gap-2">
              <Input
                className="min-w-72 flex-1"
                value={reason}
                maxLength={500}
                onChange={(ev) => setReason(ev.target.value)}
                placeholder="Why is this UDIN revoked? (as recorded on the ICAI portal)"
                aria-label="Reason for revoking"
              />
              <Button
                variant="secondary"
                disabled={!reason.trim() || revoke.isPending}
                onClick={() => revoke.mutate()}
              >
                {revoke.isPending ? 'Revoking…' : 'Revoke UDIN'}
              </Button>
              <Button variant="ghost" onClick={() => setRevoking(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setRevoking(true)}>
              Revoke…
            </Button>
          )}
          {revoke.isError && (
            <p role="alert" className="mt-2 text-sm text-danger-700">
              {(revoke.error as Error).message}
            </p>
          )}
        </div>
      )}
      {!canManage && e.status === 'active' && (
        <p className="mt-3 text-xs text-ink-faint">
          A partner, manager, administrator or the accountant revokes a UDIN here.
        </p>
      )}
    </div>
  );
}

function PendingTable({
  items,
  canManage,
  adding,
  setAdding,
  onSaved,
}: {
  items: UdinPendingItem[];
  canManage: boolean;
  adding: { key: string; prefill: UdinPrefill | null } | null;
  setAdding: (v: { key: string; prefill: UdinPrefill | null } | null) => void;
  onSaved: (e: UdinEntry) => void;
}): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-surface-sunken/60 text-left text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-2">Client</th>
            <th className="px-3 py-2">Report</th>
            <th className="px-3 py-2">Signing partner</th>
            <th className="px-3 py-2">Signed</th>
            <th className="px-3 py-2">Window</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((p) => {
            const key = `${p.sourceKind}:${p.sourceId}`;
            return (
              <Fragment key={key}>
                <tr className="border-b border-line last:border-0">
                  <td className="px-3 py-2">{p.entityName}</td>
                  <td className="px-3 py-2">
                    <Link className="text-primary-600 hover:underline" href={workItemHref(p.link)}>
                      {UDIN_DOCUMENT_KIND_LABEL[p.documentKind]}
                      {p.financialYear ? ` · FY ${p.financialYear}` : ''}
                    </Link>
                    <span className="ml-1 text-xs text-ink-faint">{p.engagementCode}</span>
                  </td>
                  <td className="px-3 py-2">{p.signingPartnerName ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{p.signedOn}</td>
                  <td className="px-3 py-2">
                    <Badge tone={p.overdue ? 'danger' : p.daysLeft <= 7 ? 'warn' : 'neutral'}>
                      {windowText(p.daysLeft)}
                    </Badge>
                    <span className="ml-2 text-xs text-ink-faint tabular-nums">
                      {p.windowEndsOn}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage && adding?.key !== key && (
                      <Button
                        size="sm"
                        variant="subtle"
                        onClick={() =>
                          setAdding({
                            key,
                            prefill: {
                              documentKind: p.documentKind,
                              entity: { id: p.entityId, label: p.entityName },
                              engagementId: p.engagementId,
                              signingPartnerId: p.signingPartnerId,
                              signedOn: p.signedOn,
                              financialYear: p.financialYear,
                            },
                          })
                        }
                      >
                        <Plus className="h-3.5 w-3.5" /> Add its UDIN
                      </Button>
                    )}
                  </td>
                </tr>
                {adding?.key === key && (
                  <tr className="border-b border-line">
                    <td colSpan={6} className="px-3 pb-3">
                      <UdinForm
                        prefill={adding.prefill}
                        onClose={() => setAdding(null)}
                        onSaved={onSaved}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function UdinRegisterPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <UdinRegisterScreen />
    </Suspense>
  );
}
