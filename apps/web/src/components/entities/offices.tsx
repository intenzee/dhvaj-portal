'use client';

/**
 * One client, several offices (CM-6) on Client 360: a tab per office
 * (`?office=<id>`), and the Offices dialog to add, rename, make head office,
 * close or reopen one and to put a GSTIN under it.
 */
import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GST_STATES, officeLabel, readGstin, type ClientBranch } from '@hsdg/contracts';
import { Building2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { EntityDetail } from '@/lib/types';
import { Badge, Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';
import { cn } from '@/lib/cn';

export const liveBranches = (e: EntityDetail): ClientBranch[] =>
  (e.branches ?? []).filter((b) => !b.archivedAt);

/** The office picked by `?office=`, or null for the whole client. */
export function useOfficeTab(e: EntityDetail | undefined): {
  office: ClientBranch | null;
  setOffice: (id: string | null) => void;
} {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const id = params.get('office');
  const office = (e ? liveBranches(e) : []).find((b) => b.id === id) ?? null;
  const setOffice = (next: string | null): void => {
    const q = new URLSearchParams(params.toString());
    if (next) q.set('office', next);
    else q.delete('office');
    const s = q.toString();
    router.replace(s ? `${path}?${s}` : path, { scroll: false });
  };
  return { office, setOffice };
}

/** Whether a registration, contact or address belongs on the office tab. */
export function inOffice(item: { branchId?: string | null }, office: ClientBranch | null): boolean {
  return !office || item.branchId === office.id;
}

export function OfficeTabs({
  entity,
  office,
  onChange,
  canManage,
}: {
  entity: EntityDetail;
  office: ClientBranch | null;
  onChange: (id: string | null) => void;
  canManage: boolean;
}): JSX.Element | null {
  const [managing, setManaging] = useState(false);
  const branches = liveBranches(entity);
  const gstins = entity.registrations.filter(
    (r) => r.registrationType === 'gstin' && r.status === 'active',
  );
  if (branches.length === 0 && !(canManage && gstins.length >= 2)) return null;

  const tab = (id: string | null, label: string, head = false): JSX.Element => (
    <button
      key={id ?? 'all'}
      role="tab"
      type="button"
      aria-selected={(office?.id ?? null) === id}
      onClick={() => onChange(id)}
      className={cn(
        '-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 text-sm',
        (office?.id ?? null) === id
          ? 'border-primary-600 font-medium text-primary-700'
          : 'border-transparent text-ink-muted hover:text-ink',
      )}
    >
      {label}
      {head && <span className="ml-1 text-xs text-ink-faint">(head)</span>}
    </button>
  );

  return (
    <div className="flex items-end justify-between gap-2 border-b border-line">
      <div role="tablist" aria-label="Offices" className="flex gap-1 overflow-x-auto">
        {branches.length > 0 ? (
          <>
            {tab(null, 'Whole client')}
            {branches.map((b) => tab(b.id, b.label, b.isHeadOffice))}
          </>
        ) : (
          <p className="px-1 pb-1.5 text-sm text-ink-muted">
            {gstins.length} GSTINs and no offices set up — each GSTIN can be an office.
          </p>
        )}
      </div>
      {canManage && (
        <Button size="sm" variant="secondary" className="mb-1" onClick={() => setManaging(true)}>
          <Building2 className="h-4 w-4" /> {branches.length > 0 ? 'Offices' : 'Set up offices'}
        </Button>
      )}
      {managing && <OfficesModal entity={entity} onClose={() => setManaging(false)} />}
    </div>
  );
}

/** "Delhi office" next to a registration on the whole-client tab. */
export function OfficeBadge({
  entity,
  branchId,
}: {
  entity: EntityDetail;
  branchId?: string | null;
}): JSX.Element | null {
  const b = branchId ? entity.branches?.find((x) => x.id === branchId) : null;
  return b ? <Badge tone="neutral">{b.label}</Badge> : null;
}

function OfficesModal({
  entity,
  onClose,
}: {
  entity: EntityDetail;
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const done = (msg: string) => (): void => {
    toast(msg);
    void qc.invalidateQueries({ queryKey: ['entity', entity.id] });
    void qc.invalidateQueries({ queryKey: ['entities'] });
    void qc.invalidateQueries({ queryKey: ['branch-candidates'] });
  };
  const fail = (err: unknown): void =>
    toast(err instanceof ApiError ? err.message : 'Could not save the office.', 'error');

  const unplaced = entity.registrations.filter(
    (r) => r.registrationType === 'gstin' && r.status === 'active' && !r.branchId,
  );
  const [regId, setRegId] = useState(unplaced[0]?.id ?? '');
  const suggested = (id: string): string => {
    const r = entity.registrations.find((x) => x.id === id);
    const state = r ? readGstin(r.registrationNumber).stateCode : null;
    return officeLabel(null, state ? (GST_STATES[state] ?? null) : null);
  };
  const [label, setLabel] = useState(regId ? suggested(regId) : '');
  const [head, setHead] = useState(liveBranches(entity).length === 0);

  const add = useMutation({
    mutationFn: () =>
      apiFetch<EntityDetail>(`/entities/${entity.id}/branches`, {
        method: 'POST',
        body: { label: label.trim(), registrationId: regId || null, isHeadOffice: head },
      }),
    onSuccess: () => {
      done(`Office "${label.trim()}" added.`)();
      const rest = unplaced.filter((r) => r.id !== regId);
      setRegId(rest[0]?.id ?? '');
      setLabel(rest[0] ? suggested(rest[0].id) : '');
      setHead(false);
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: (v: { b: ClientBranch; body: Record<string, unknown> }) =>
      apiFetch<EntityDetail>(`/entities/${entity.id}/branches/${v.b.id}`, {
        method: 'PATCH',
        body: { ...v.body, version: v.b.version },
      }),
    onSuccess: done('Office saved.'),
    onError: fail,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Offices"
      description="One client, one PAN; each place it is registered for GST is an office with its own tab."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <ul className="divide-y divide-line rounded-md border border-line">
          {(entity.branches ?? []).length === 0 && (
            <li className="px-3 py-2 text-sm text-ink-faint">No offices yet.</li>
          )}
          {(entity.branches ?? []).map((b) => (
            <OfficeRow
              key={b.id}
              entity={entity}
              branch={b}
              busy={update.isPending}
              onSave={(body) => update.mutate({ b, body })}
            />
          ))}
        </ul>

        <div className="space-y-2 rounded-md border border-line p-3">
          <p className="text-sm font-medium text-ink">Add an office</p>
          <Field label="GSTIN" hint="The GST registration this office is for (optional).">
            <Select
              value={regId}
              onChange={(ev) => {
                setRegId(ev.target.value);
                if (ev.target.value) setLabel(suggested(ev.target.value));
              }}
            >
              <option value="">No GSTIN</option>
              {unplaced.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.registrationNumber}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name">
            <Input value={label} maxLength={80} onChange={(ev) => setLabel(ev.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={head} onChange={(ev) => setHead(ev.target.checked)} />
            Head office
          </label>
          <Button size="sm" disabled={!label.trim() || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? 'Adding…' : 'Add office'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function OfficeRow({
  entity,
  branch,
  busy,
  onSave,
}: {
  entity: EntityDetail;
  branch: ClientBranch;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
}): JSX.Element {
  const [label, setLabel] = useState(branch.label);
  const gstins = entity.registrations
    .filter((r) => r.branchId === branch.id)
    .map((r) => r.registrationNumber);
  const closed = Boolean(branch.archivedAt);
  return (
    <li className={cn('space-y-1.5 px-3 py-2 text-sm', closed && 'opacity-60')}>
      <div className="flex items-center gap-2">
        <Input
          aria-label="Office name"
          value={label}
          maxLength={80}
          disabled={closed}
          onChange={(ev) => setLabel(ev.target.value)}
          className="flex-1"
        />
        {branch.isHeadOffice && <Badge tone="info">Head office</Badge>}
        {closed && <Badge tone="neutral">Closed</Badge>}
      </div>
      <p className="text-xs text-ink-muted">{gstins.length ? gstins.join(' · ') : 'No GSTIN'}</p>
      <div className="flex flex-wrap gap-2">
        {!closed && label.trim() && label.trim() !== branch.label && (
          <Button size="sm" disabled={busy} onClick={() => onSave({ label: label.trim() })}>
            Rename
          </Button>
        )}
        {!closed && !branch.isHeadOffice && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onSave({ isHeadOffice: true })}
          >
            Make head office
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onSave({ archived: !closed })}
        >
          {closed ? 'Reopen' : 'Close office'}
        </Button>
      </div>
    </li>
  );
}
