'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  CHANGE_LOG_AREAS,
  PERMISSION,
  type ChangeLogEntry,
  type ChangeLogOp,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { humanize } from '@/lib/format';
import { Badge, Button, Card, CardBody, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Input, Select } from '@/components/form';

const PAGE = 50;

const OP_VERB: Record<ChangeLogOp, string> = {
  insert: 'added',
  update: 'changed',
  delete: 'removed',
};
const OP_TONE: Record<ChangeLogOp, string> = {
  insert: 'success',
  update: 'info',
  delete: 'danger',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Entry({ e }: { e: ChangeLogEntry }): JSX.Element {
  return (
    <li className="border-b border-line px-4 py-3 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold text-ink">{e.actorName ?? 'The system'}</span>
        {e.actorRole && <span className="text-xs text-ink-faint">{humanize(e.actorRole)}</span>}
        <Badge tone={OP_TONE[e.op]}>{OP_VERB[e.op]}</Badge>
        <span className="text-ink">
          {e.area}
          {e.label && <span className="font-medium"> · {e.label}</span>}
        </span>
        {e.entityId && (
          <Link href={`/entities/${e.entityId}`} className="text-primary-700 hover:underline">
            {e.entityCode ?? 'Client'}
            {e.entityName ? ` ${e.entityName}` : ''}
          </Link>
        )}
        {e.engagementId && e.engagementCode && (
          <Link
            href={`/engagements/${e.engagementId}`}
            className="text-primary-700 hover:underline"
          >
            {e.engagementCode}
          </Link>
        )}
        <span className="ml-auto text-xs tabular-nums text-ink-faint">{when(e.occurredAt)}</span>
      </div>
      {e.fields.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="w-48 py-1 pr-3 font-semibold">Field</th>
                {e.op !== 'insert' && <th className="py-1 pr-3 font-semibold">Before</th>}
                {e.op !== 'delete' && (
                  <th className="py-1 font-semibold">{e.op === 'update' ? 'After' : 'Value'}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {e.fields.map((f) => (
                <tr key={f.field} className="align-top">
                  <td className="py-0.5 pr-3 text-ink-muted">{f.label}</td>
                  {e.op !== 'insert' && (
                    <td className="break-all py-0.5 pr-3 text-ink-muted line-through decoration-ink-faint/60">
                      {f.before ?? '—'}
                    </td>
                  )}
                  {e.op !== 'delete' && (
                    <td className="break-all py-0.5 text-ink">{f.after ?? '—'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

function ChangeLog(): JSX.Element {
  const { principal } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const entityId = params.get('entityId') ?? '';
  const engagementId = params.get('engagementId') ?? '';
  const [q, setQ] = useState('');
  const [table, setTable] = useState('');
  const [op, setOp] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);

  const query = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  for (const [k, v] of Object.entries({ entityId, engagementId, q: q.trim(), table, op, from, to }))
    if (v) query.set(k, v);
  const log = useQuery({
    queryKey: ['change-log', query.toString()],
    queryFn: () => apiFetch<Paginated<ChangeLogEntry>>(`/change-log?${query.toString()}`),
    enabled: can(principal, PERMISSION.auditRead),
    placeholderData: keepPreviousData,
  });
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setOffset(0);
    };

  if (!can(principal, PERMISSION.auditRead)) {
    return <EmptyState>The change log is for the Managing Partner and administrators.</EmptyState>;
  }
  const scoped = log.data?.items[0];
  const total = log.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Change log"
        subtitle="Every add, edit and removal on clients and engagements — who made it, when, and each field’s old and new value. Kept by the database; nobody can edit or delete it."
      />
      <Card>
        <CardBody className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Input
              placeholder="Search client, engagement, person, record…"
              value={q}
              onChange={(e) => reset(setQ)(e.target.value)}
              className="lg:col-span-2"
            />
            <Select value={table} onChange={(e) => reset(setTable)(e.target.value)}>
              <option value="">Every record</option>
              {Object.entries(CHANGE_LOG_AREAS).map(([t, label]) => (
                <option key={t} value={t}>
                  {label}
                </option>
              ))}
            </Select>
            <Select value={op} onChange={(e) => reset(setOp)(e.target.value)}>
              <option value="">Added, changed or removed</option>
              <option value="insert">Added</option>
              <option value="update">Changed</option>
              <option value="delete">Removed</option>
            </Select>
            <div className="flex gap-2">
              <Input
                type="date"
                aria-label="From"
                value={from}
                onChange={(e) => reset(setFrom)(e.target.value)}
              />
              <Input
                type="date"
                aria-label="To"
                value={to}
                onChange={(e) => reset(setTo)(e.target.value)}
              />
            </div>
          </div>
          {(entityId || engagementId) && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-ink-muted">Showing</span>
              <Badge tone="info">
                {engagementId
                  ? (scoped?.engagementCode ?? 'one engagement')
                  : scoped
                    ? `${scoped.entityCode ?? ''} ${scoped.entityName ?? ''}`.trim()
                    : 'one client'}
              </Badge>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-ink-faint hover:text-ink"
                onClick={() => router.push('/change-log')}
              >
                <X className="h-3.5 w-3.5" /> Everything
              </button>
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="mt-4">
        {log.isLoading ? (
          <CardBody>
            <Spinner />
          </CardBody>
        ) : total === 0 ? (
          <CardBody>
            <EmptyState>No changes match.</EmptyState>
          </CardBody>
        ) : (
          <>
            <ul>
              {log.data!.items.map((e) => (
                <Entry key={e.id} e={e} />
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-line px-4 py-2 text-sm text-ink-muted">
              <span>
                {offset + 1}–{Math.min(offset + PAGE, total)} of {total.toLocaleString('en-IN')}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                >
                  Newer
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={offset + PAGE >= total}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  Older
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

export default function ChangeLogPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <ChangeLog />
    </Suspense>
  );
}
