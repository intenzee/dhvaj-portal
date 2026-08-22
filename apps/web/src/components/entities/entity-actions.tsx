'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import {
  ENTITY_STATUSES,
  PAN_REGEX,
  REGISTRATION_STATUSES,
  REGISTRATION_TYPES,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { PERMISSION } from '@hsdg/contracts';
import type { EntityDetail, EntityType, OfficeRow } from '@/lib/types';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Select } from '@/components/form';

/** Manage buttons shown on Client 360 for users who can manage entities. */
export function EntityDetailActions({ entity }: { entity: EntityDetail }): JSX.Element | null {
  const { principal } = useAuth();
  const [open, setOpen] = useState<null | 'edit' | 'registration' | 'contact'>(null);

  if (!can(principal, PERMISSION.entityManage)) return null;

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onClick={() => setOpen('edit')}>
        <Pencil className="h-4 w-4" /> Edit
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setOpen('registration')}>
        <Plus className="h-4 w-4" /> Registration
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setOpen('contact')}>
        <Plus className="h-4 w-4" /> Contact
      </Button>

      {open === 'edit' && <EditEntityModal entity={entity} onClose={() => setOpen(null)} />}
      {open === 'registration' && (
        <AddRegistrationModal entityId={entity.id} onClose={() => setOpen(null)} />
      )}
      {open === 'contact' && <AddContactModal entityId={entity.id} onClose={() => setOpen(null)} />}
    </div>
  );
}

function useEntityInvalidate(entityId: string): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['entity', entityId] });
    void qc.invalidateQueries({ queryKey: ['entities'] });
  };
}

function EditEntityModal({
  entity,
  onClose,
}: {
  entity: EntityDetail;
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const invalidate = useEntityInvalidate(entity.id);

  const [legalName, setLegalName] = useState(entity.legalName);
  const [displayName, setDisplayName] = useState(entity.displayName ?? '');
  const [typeSlug, setTypeSlug] = useState(entity.typeSlug);
  const [officeCode, setOfficeCode] = useState(entity.officeCode);
  const [pan, setPan] = useState(entity.pan ?? '');
  const [status, setStatus] = useState<string>(entity.status);
  const [incorporationDate, setIncorporationDate] = useState(entity.incorporationDate ?? '');

  const types = useQuery({ queryKey: ['entity-types'], queryFn: () => apiFetch<EntityType[]>('/entity-types') });
  const offices = useQuery({ queryKey: ['admin', 'offices'], queryFn: () => apiFetch<OfficeRow[]>('/offices') });

  const panValid = pan === '' || PAN_REGEX.test(pan.trim().toUpperCase());

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { version: entity.version };
      if (legalName.trim() !== entity.legalName) body.legalName = legalName.trim();
      if ((displayName.trim() || null) !== (entity.displayName ?? null))
        body.displayName = displayName.trim() || null;
      if (typeSlug !== entity.typeSlug) body.typeSlug = typeSlug;
      if (officeCode !== entity.officeCode) body.officeCode = officeCode;
      if ((pan.trim().toUpperCase() || null) !== (entity.pan ?? null))
        body.pan = pan.trim().toUpperCase() || null;
      if (status !== entity.status) body.status = status;
      if ((incorporationDate || null) !== (entity.incorporationDate ?? null))
        body.incorporationDate = incorporationDate || null;
      return apiFetch(`/entities/${entity.id}`, { method: 'PATCH', body });
    },
    onSuccess: () => {
      toast('Entity updated.');
      invalidate();
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not update the entity.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit entity"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={legalName.trim().length === 0 || !panValid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Legal name" required>
          <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Display name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label="Entity type">
            <Select value={typeSlug} onChange={(e) => setTypeSlug(e.target.value)}>
              {(types.data ?? []).map((t) => (
                <option key={t.id} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Home office">
            <Select value={officeCode} onChange={(e) => setOfficeCode(e.target.value)}>
              {(offices.data ?? []).map((o) => (
                <option key={o.id} value={o.code}>
                  {o.name} ({o.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {ENTITY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="PAN" hint={pan && !panValid ? 'Invalid PAN.' : undefined}>
            <Input
              value={pan}
              onChange={(e) => setPan(e.target.value.toUpperCase())}
              className={pan && !panValid ? 'border-danger-400' : undefined}
            />
          </Field>
          <Field label="Incorporation date">
            <Input type="date" value={incorporationDate} onChange={(e) => setIncorporationDate(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function AddRegistrationModal({
  entityId,
  onClose,
}: {
  entityId: string;
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const invalidate = useEntityInvalidate(entityId);

  const [registrationType, setRegistrationType] = useState<string>(REGISTRATION_TYPES[0] ?? 'gstin');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [status, setStatus] = useState<string>('active');
  const [validFrom, setValidFrom] = useState('');

  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/entities/${entityId}/registrations`, {
        method: 'POST',
        body: {
          registrationType,
          registrationNumber: registrationNumber.trim().toUpperCase(),
          status,
          ...(validFrom ? { validFrom } : {}),
        },
      }),
    onSuccess: () => {
      toast('Registration added.');
      invalidate();
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not add the registration.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Add registration"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={registrationNumber.trim().length === 0 || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? 'Adding…' : 'Add registration'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" required>
            <Select value={registrationType} onChange={(e) => setRegistrationType(e.target.value)}>
              {REGISTRATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {REGISTRATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Registration number" required>
          <Input
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value.toUpperCase())}
            placeholder="27AAACA1234A1Z5"
          />
        </Field>
        <Field label="Valid from">
          <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function AddContactModal({
  entityId,
  onClose,
}: {
  entityId: string;
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const invalidate = useEntityInvalidate(entityId);

  const [fullName, setFullName] = useState('');
  const [designation, setDesignation] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [isSignatory, setIsSignatory] = useState(false);

  const emailValid = email === '' || /.+@.+\..+/.test(email);

  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/entities/${entityId}/contacts`, {
        method: 'POST',
        body: {
          fullName: fullName.trim(),
          ...(designation.trim() ? { designation: designation.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          isPrimary,
          isSignatory,
        },
      }),
    onSuccess: () => {
      toast('Contact added.');
      invalidate();
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not add the contact.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Add contact"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={fullName.trim().length === 0 || !emailValid || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? 'Adding…' : 'Add contact'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name" required>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Designation">
            <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Director" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email" hint={email && !emailValid ? 'Invalid email.' : undefined}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={email && !emailValid ? 'border-danger-400' : undefined}
            />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98xxxxxxx0" />
          </Field>
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            Primary contact
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={isSignatory} onChange={(e) => setIsSignatory(e.target.checked)} />
            Signatory
          </label>
        </div>
      </div>
    </Modal>
  );
}
