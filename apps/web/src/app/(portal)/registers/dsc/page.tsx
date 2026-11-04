'use client';

import { Fragment, Suspense, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, KeyRound, Plus, Search } from 'lucide-react';
import {
  DSC_CLASS_LABEL,
  DSC_MOVEMENT_LABEL,
  DSC_STATUS_LABEL,
  DSC_USAGE_LABEL,
  FEATURE_FLAG,
  PERMISSION,
  type DscToken,
  type DscTokenDetail,
  type DscView,
  type Paginated,
  type RevealedDscPin,
} from '@hsdg/contracts';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useUrlState } from '@/lib/url-state';
import { apiFetch } from '@/lib/api';
import type { EmployeeRow } from '@/lib/types';
import {
  checkInDsc,
  checkOutDsc,
  dscKey,
  dscListPath,
  fetchDscToken,
  fetchDscTokens,
  releaseDsc,
  revealDscPin,
  setDscPin,
  type DscFilters,
} from '@/lib/registers-api';
import { Badge, Button, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';
import { CopyButton, hidesIn } from '@/components/entities/portal-login';
import { todayIst } from '@/components/work/my-task-columns';
import { DscForm, dscExpiryText } from '@/components/registers/dsc-form';

const VIEWS: ReadonlyArray<readonly [DscView, string]> = [
  ['all', 'All tokens'],
  ['at_risk', 'At risk'],
  ['out', 'Out of the office'],
  ['expiring', 'Expiring'],
  ['gone', 'Returned or lost'],
];

function expiryTone(t: DscToken): 'danger' | 'warn' | 'neutral' {
  if (t.daysToExpiry < 0) return 'danger';
  if (t.daysToExpiry <= 30) return 'warn';
  return 'neutral';
}

const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—');

/** PS-305 — every DSC token the office holds: validity, custody and the PIN (in the vault). */
function DscRegisterScreen(): JSX.Element {
  const { principal } = useAuth();
  const flags = useFeatureFlags();
  const on = flags.isOn(FEATURE_FLAG.registers);
  const url = useUrlState();
  const qc = useQueryClient();
  const viewParam = url.get('view') as DscView | null;
  const filters: DscFilters = {
    view: VIEWS.some(([k]) => k === viewParam) ? viewParam! : 'all',
    search: url.get('q') ?? '',
    id: url.get('d') ?? '',
  };
  const [term, setTerm] = useState(filters.search);
  useEffect(() => {
    if (term === filters.search) return;
    const t = setTimeout(() => url.set({ q: term }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
  const [open, setOpen] = useState<string | null>(filters.id || null);
  const [adding, setAdding] = useState(false);

  const list = useQuery({
    queryKey: [...dscKey, 'list', dscListPath(filters)],
    queryFn: () => fetchDscTokens(filters),
    enabled: on,
  });
  const canManage = can(principal, PERMISSION.registerManage);
  const canKeepPin = can(principal, PERMISSION.credentialManage);

  if (!flags.isLoading && !on) {
    return (
      <div>
        <PageHeader title="DSC register" />
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
  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: dscKey });

  return (
    <div>
      <PageHeader
        title="DSC register"
        subtitle="Every digital signature token the office holds: when it expires, where it is, and who has it."
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add token
            </Button>
          )
        }
      />

      {adding && (
        <div className="mb-4">
          <DscForm
            existing={null}
            canKeepPin={canKeepPin}
            onClose={() => setAdding(false)}
            onSaved={(t) => {
              setAdding(false);
              void refresh();
              url.set({ view: null, d: t.id });
              setOpen(t.id);
            }}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="View">
          {VIEWS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filters.view === k && !filters.id}
              className={chip(filters.view === k && !filters.id)}
              onClick={() => url.set({ view: k === 'all' ? null : k, d: null })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex min-w-56 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5">
          <Search className="h-4 w-4 text-ink-faint" aria-hidden />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Holder, PAN, DIN, client…"
            aria-label="Search tokens"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </div>
      </div>

      {filters.id && (
        <p className="mb-3 text-sm text-ink-muted">
          Showing one token.{' '}
          <button
            type="button"
            className="text-primary-600 hover:underline"
            onClick={() => url.set({ d: null })}
          >
            Show the whole register
          </button>
        </p>
      )}

      {list.isLoading && <Spinner />}
      {list.isError && (
        <EmptyState>Could not load the register. Check that the API is reachable.</EmptyState>
      )}
      {list.data &&
        (list.data.items.length === 0 ? (
          <EmptyState>
            {filters.view === 'at_risk'
              ? 'No token is close to expiry or overdue back in the office.'
              : 'No tokens match.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-sunken/60 text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2">Holder</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Valid to</th>
                  <th className="px-3 py-2">Where</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((t) => {
                  const isOpen = open === t.id;
                  return (
                    <Fragment key={t.id}>
                      <tr
                        className="group cursor-pointer border-b border-line last:border-0 hover:bg-surface-raised"
                        onClick={() => setOpen(isOpen ? null : t.id)}
                      >
                        <td className="px-3 py-2">
                          <ExpandToggle open={isOpen} />
                        </td>
                        <td className="px-3 py-2">
                          {t.holderName}
                          {t.din && (
                            <span className="ml-1 font-mono text-xs text-ink-faint">
                              DIN {t.din}
                            </span>
                          )}
                          {t.hasPin && (
                            <KeyRound
                              className="ml-1 inline h-3.5 w-3.5 text-ink-faint"
                              aria-label="PIN kept in the vault"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2">{t.entityName ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {t.validTo}
                          {(t.status === 'active' || t.status === 'expired') && (
                            <Badge tone={expiryTone(t)} className="ml-2">
                              {dscExpiryText(t.daysToExpiry)}
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {t.status === 'returned_to_holder' || t.status === 'lost' ? (
                            '—'
                          ) : t.inOffice ? (
                            <span className="text-ink-muted">
                              In the office{t.location ? ` · ${t.location}` : ''}
                            </span>
                          ) : (
                            <>
                              Out with {t.outWithName ?? 'someone'}
                              {t.overdueReturn ? (
                                <Badge tone="danger" className="ml-2">
                                  Overdue back
                                </Badge>
                              ) : (
                                <span className="ml-1 text-xs text-ink-faint">
                                  back by {day(t.expectedBackAt)}
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge
                            tone={
                              t.status === 'active'
                                ? 'success'
                                : t.status === 'lost' || t.status === 'expired'
                                  ? 'danger'
                                  : 'neutral'
                            }
                          >
                            {DSC_STATUS_LABEL[t.status]}
                          </Badge>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-line">
                          <td colSpan={6} className="px-3 pb-3">
                            <DscDetail
                              id={t.id}
                              canManage={canManage}
                              canKeepPin={canKeepPin}
                              canReveal={can(principal, PERMISSION.credentialReveal)}
                              canPickStaff={can(principal, PERMISSION.employeeRead)}
                              onChanged={refresh}
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
        ))}
      {list.data && list.data.total > list.data.items.length && (
        <p className="mt-2 text-xs text-ink-faint">
          Showing {list.data.items.length} of {list.data.total}. Search to narrow it.
        </p>
      )}
    </div>
  );
}

type Action = 'out' | 'in' | 'edit' | 'release' | 'pin' | null;

function DscDetail({
  id,
  canManage,
  canKeepPin,
  canReveal,
  canPickStaff,
  onChanged,
}: {
  id: string;
  canManage: boolean;
  canKeepPin: boolean;
  canReveal: boolean;
  canPickStaff: boolean;
  onChanged: () => Promise<void>;
}): JSX.Element {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: [...dscKey, 'one', id], queryFn: () => fetchDscToken(id) });
  const [action, setAction] = useState<Action>(null);
  const [shown, setShown] = useState<RevealedDscPin | null>(null);
  const done = async (): Promise<void> => {
    setAction(null);
    await qc.invalidateQueries({ queryKey: dscKey });
    await onChanged();
  };
  const reveal = useMutation({ mutationFn: () => revealDscPin(id), onSuccess: setShown });

  if (detail.isLoading) return <Spinner />;
  if (!detail.data)
    return <p className="mt-2 text-sm text-danger-700">Could not load the token.</p>;
  const t = detail.data;
  const holding = t.status === 'active' || t.status === 'expired';

  return (
    <div className="mt-2 rounded-lg border border-primary-600/30 border-l-4 border-l-primary-600 bg-surface-sunken/40 p-4 text-sm">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-4">
        <Item label="PAN" value={t.holderPan} mono />
        <Item label="Class" value={`${DSC_CLASS_LABEL[t.class]} · ${DSC_USAGE_LABEL[t.usage]}`} />
        <Item label="Valid" value={`${t.validFrom ?? '…'} to ${t.validTo}`} />
        <Item label="Issuer" value={t.issuer} />
        <Item label="Token serial" value={t.tokenSerial} mono />
        <Item label="Office" value={t.officeName} />
        {t.outSince && !t.inOffice && holding && <Item label="Out since" value={day(t.outSince)} />}
        {t.statusReason && <Item label="Reason" value={t.statusReason} />}
        {t.notes && (
          <div className="sm:col-span-4">
            <dt className="text-xs text-ink-muted">Notes</dt>
            <dd className="whitespace-pre-wrap">{t.notes}</dd>
          </div>
        )}
      </dl>

      {t.entityId && (t.hasPin || t.canPin) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
          <KeyRound className="h-3.5 w-3.5 text-ink-faint" />
          <span className="text-ink-muted">PIN</span>
          {t.hasPin ? <span className="text-ink-faint">••••••</span> : <span>not kept</span>}
          {t.hasPin && canReveal && !shown && (
            <Button
              size="sm"
              variant="subtle"
              className="px-2 py-0.5"
              disabled={reveal.isPending}
              onClick={() => reveal.mutate()}
            >
              <Eye className="h-3.5 w-3.5" /> Show
            </Button>
          )}
          {t.canPin && holding && action !== 'pin' && (
            <Button size="sm" variant="ghost" onClick={() => setAction('pin')}>
              {t.hasPin ? 'Change PIN' : 'Keep the PIN'}
            </Button>
          )}
          {reveal.isError && (
            <span role="alert" className="text-danger-700">
              {(reveal.error as Error).message}
            </span>
          )}
        </div>
      )}
      {shown && <ShownPin pin={shown} onHide={() => setShown(null)} />}
      {action === 'pin' && <PinForm id={id} onDone={done} onCancel={() => setAction(null)} />}

      {holding && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          {t.status === 'active' && t.inOffice && action !== 'out' && (
            <Button size="sm" variant="secondary" onClick={() => setAction('out')}>
              Check out…
            </Button>
          )}
          {!t.inOffice && action !== 'in' && (
            <Button size="sm" variant="secondary" onClick={() => setAction('in')}>
              Check in…
            </Button>
          )}
          {canManage && action !== 'edit' && (
            <Button size="sm" variant="ghost" onClick={() => setAction('edit')}>
              Edit
            </Button>
          )}
          {canManage && action !== 'release' && (
            <Button size="sm" variant="ghost" onClick={() => setAction('release')}>
              Returned or lost…
            </Button>
          )}
        </div>
      )}
      {!canManage && holding && (
        <p className="mt-2 text-xs text-ink-faint">
          A partner, manager, administrator or the accountant edits a token or marks it returned.
        </p>
      )}

      {action === 'out' && (
        <CheckOutForm
          token={t}
          canPickStaff={canPickStaff}
          onDone={done}
          onCancel={() => setAction(null)}
        />
      )}
      {action === 'in' && <CheckInForm token={t} onDone={done} onCancel={() => setAction(null)} />}
      {action === 'release' && (
        <ReleaseForm token={t} onDone={done} onCancel={() => setAction(null)} />
      )}
      {action === 'edit' && (
        <div className="mt-3">
          <DscForm
            existing={t}
            canKeepPin={canKeepPin}
            onClose={() => setAction(null)}
            onSaved={() => void done()}
          />
        </div>
      )}

      {t.movements.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
            Movements
          </h4>
          <ul className="space-y-1 text-xs">
            {t.movements.map((m) => (
              <li key={m.id} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums text-ink-faint">
                  {m.at.slice(0, 16).replace('T', ' ')}
                </span>
                <span className="font-medium">{DSC_MOVEMENT_LABEL[m.kind]}</span>
                {m.withName && <span>with {m.withName}</span>}
                {m.purpose && <span className="text-ink-muted">— {m.purpose}</span>}
                {m.expectedBackAt && (
                  <span className="text-ink-faint">(due back {day(m.expectedBackAt)})</span>
                )}
                {m.byName && <span className="text-ink-faint">· by {m.byName}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Item({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : undefined}>{value ?? '—'}</dd>
    </div>
  );
}

function ActionRow({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mt-3 rounded-md border border-line bg-surface p-3">{children}</div>;
}

function MutationError({ error }: { error: unknown }): JSX.Element | null {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 text-sm text-danger-700">
      {(error as Error).message}
    </p>
  );
}

function CheckOutForm({
  token,
  canPickStaff,
  onDone,
  onCancel,
}: {
  token: DscTokenDetail;
  canPickStaff: boolean;
  onDone: () => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const today = todayIst();
  const [withEmployeeId, setWithEmployeeId] = useState('');
  const [withName, setWithName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [backOn, setBackOn] = useState(today);
  const staff = useQuery({
    queryKey: ['employees', 'active', 100],
    queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100&status=active'),
    enabled: canPickStaff,
    retry: false,
  });
  const go = useMutation({
    mutationFn: () =>
      checkOutDsc(token.id, {
        version: token.version,
        withEmployeeId: withEmployeeId || null,
        withName: withEmployeeId ? null : withName.trim() || null,
        purpose: purpose.trim(),
        expectedBackOn: backOn,
      }),
    onSuccess: onDone,
  });
  const ready = (!!withEmployeeId || !!withName.trim()) && !!purpose.trim() && backOn >= today;
  return (
    <ActionRow>
      <div className="grid gap-3 sm:grid-cols-4">
        {canPickStaff && (
          <Field label="Colleague">
            <Select
              value={withEmployeeId}
              onChange={(e) => setWithEmployeeId(e.target.value)}
              aria-label="Colleague"
            >
              <option value="">Someone else…</option>
              {staff.data?.items.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {!withEmployeeId && (
          <Field label="With" hint="The director, the client’s accountant…">
            <Input
              value={withName}
              onChange={(e) => setWithName(e.target.value)}
              maxLength={120}
              aria-label="Taken by"
            />
          </Field>
        )}
        <Field label="For">
          <Input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            maxLength={300}
            placeholder="e.g. Sign the AOC-4"
            aria-label="Purpose"
          />
        </Field>
        <Field label="Back by">
          <Input
            type="date"
            min={today}
            value={backOn}
            onChange={(e) => setBackOn(e.target.value)}
            aria-label="Back by"
          />
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!ready || go.isPending} onClick={() => go.mutate()}>
          {go.isPending ? 'Saving…' : 'Check out'}
        </Button>
      </div>
      <MutationError error={go.error} />
    </ActionRow>
  );
}

function CheckInForm({
  token,
  onDone,
  onCancel,
}: {
  token: DscTokenDetail;
  onDone: () => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [location, setLocation] = useState(token.location ?? '');
  const go = useMutation({
    mutationFn: () =>
      checkInDsc(token.id, { version: token.version, location: location.trim() || null }),
    onSuccess: onDone,
  });
  return (
    <ActionRow>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Kept at" className="min-w-64 flex-1">
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={120}
            aria-label="Kept at"
          />
        </Field>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={go.isPending} onClick={() => go.mutate()}>
          {go.isPending ? 'Saving…' : 'It’s back'}
        </Button>
      </div>
      <MutationError error={go.error} />
    </ActionRow>
  );
}

function ReleaseForm({
  token,
  onDone,
  onCancel,
}: {
  token: DscTokenDetail;
  onDone: () => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [status, setStatus] = useState<'returned_to_holder' | 'lost'>('returned_to_holder');
  const [reason, setReason] = useState('');
  const go = useMutation({
    mutationFn: () =>
      releaseDsc(token.id, { version: token.version, status, reason: reason.trim() }),
    onSuccess: onDone,
  });
  return (
    <ActionRow>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="What happened">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            aria-label="What happened"
          >
            <option value="returned_to_holder">Returned to the holder</option>
            <option value="lost">Lost</option>
          </Select>
        </Field>
        <Field label="Reason" className="min-w-64 flex-1">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="e.g. Director resigned; token handed back"
            aria-label="Reason"
          />
        </Field>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          disabled={!reason.trim() || go.isPending}
          onClick={() => go.mutate()}
        >
          {go.isPending ? 'Saving…' : 'Take off the register'}
        </Button>
      </div>
      {token.hasPin && (
        <p className="mt-2 text-xs text-ink-faint">Its PIN is removed from the vault too.</p>
      )}
      <MutationError error={go.error} />
    </ActionRow>
  );
}

function PinForm({
  id,
  onDone,
  onCancel,
}: {
  id: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [pin, setPin] = useState('');
  const go = useMutation({ mutationFn: () => setDscPin(id, pin), onSuccess: onDone });
  return (
    <ActionRow>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="PIN" hint="Kept encrypted in the client’s logins vault.">
          <Input
            type="password"
            autoComplete="new-password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            maxLength={64}
            aria-label="PIN"
          />
        </Field>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!pin || go.isPending} onClick={() => go.mutate()}>
          {go.isPending ? 'Saving…' : 'Keep the PIN'}
        </Button>
      </div>
      <MutationError error={go.error} />
    </ActionRow>
  );
}

function ShownPin({ pin, onHide }: { pin: RevealedDscPin; onHide: () => void }): JSX.Element {
  const [shownAt] = useState(() => Date.now());
  const [now, setNow] = useState(shownAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = hidesIn(shownAt, now);
  useEffect(() => {
    if (left === 0) onHide();
  }, [left, onHide]);
  return (
    <div className="mt-1.5 rounded-md border border-line-strong bg-surface-sunken px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="w-10 text-ink-muted">PIN</span>
        <span className="font-mono text-ink">{pin.pin}</span>
        <CopyButton text={pin.pin} what="PIN" />
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-ink-faint">
        <span>Hides in {left}s · this view is logged</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-ink"
          onClick={onHide}
        >
          <EyeOff className="h-3.5 w-3.5" /> Hide
        </button>
      </div>
    </div>
  );
}

export default function DscRegisterPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <DscRegisterScreen />
    </Suspense>
  );
}
