'use client';

/**
 * Client 360's "Firm type" fact (CM-3): the type, where it came from (the
 * PAN, an import, or a person), and a Change dialog. A type the PAN disagrees
 * with is asked about once; a type saved here is kept by later imports.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ENTITY_TYPE_SOURCE_LABEL, firmTypeFromIds, typeAgreesWithPan } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { EntityDetail, EntityType } from '@/lib/types';
import { Button, Card, CardBody } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Select } from '@/components/form';

function sourceLine(e: EntityDetail): string {
  if (e.entityTypeSource === 'manual') {
    const on = e.entityTypeSetAt
      ? new Date(e.entityTypeSetAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : null;
    return `Set by ${e.entityTypeSetBy ?? 'hand'}${on ? ` on ${on}` : ''}`;
  }
  return ENTITY_TYPE_SOURCE_LABEL[e.entityTypeSource] ?? '';
}

export function FirmTypeCard({ entity, canManage }: { entity: EntityDetail; canManage: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const disagrees = !typeAgreesWithPan(entity.typeSlug, entity.pan);
  return (
    <Card>
      <CardBody className="py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-faint">Firm type</div>
            <div className="mt-0.5 font-medium text-ink">{entity.typeName}</div>
            <div className="text-xs text-ink-muted">{sourceLine(entity)}</div>
            {disagrees && entity.entityTypeSource !== 'manual' && (
              <div className="mt-1 text-xs text-warning-700">The PAN&rsquo;s 4th letter says another type.</div>
            )}
          </div>
          {canManage && (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              Change
            </Button>
          )}
        </div>
      </CardBody>
      {open && <ChangeFirmTypeModal entity={entity} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function ChangeFirmTypeModal({ entity, onClose }: { entity: EntityDetail; onClose: () => void }): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const [typeSlug, setTypeSlug] = useState(entity.typeSlug);
  const [confirming, setConfirming] = useState(false);
  const types = useQuery({
    queryKey: ['entity-types'],
    queryFn: () => apiFetch<EntityType[]>('/entity-types'),
  });
  const says = firmTypeFromIds({
    pan: entity.pan,
    gstins: entity.registrations.filter((r) => r.registrationType === 'gstin').map((r) => r.registrationNumber),
    nameOrTypedType: entity.legalName,
    hasBusinessRegistration: entity.registrations.some((r) => r.status === 'active'),
  });
  const saysName = types.data?.find((t) => t.slug === says?.slug)?.name;
  const chosenName = types.data?.find((t) => t.slug === typeSlug)?.name ?? typeSlug;
  const mismatch = !typeAgreesWithPan(typeSlug, entity.pan);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/entities/${entity.id}`, {
        method: 'PATCH',
        body: {
          typeSlug,
          version: entity.version,
          ...(mismatch ? { typeMismatchAcknowledged: true } : {}),
        },
      }),
    onSuccess: () => {
      toast('Firm type saved.');
      qc.invalidateQueries({ queryKey: ['entity', entity.id] });
      qc.invalidateQueries({ queryKey: ['entities'] });
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not save the firm type.', 'error'),
  });

  const submit = (): void => {
    if (mismatch && !confirming) {
      setConfirming(true);
      return;
    }
    save.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Change firm type"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || typeSlug === entity.typeSlug} onClick={submit}>
            {save.isPending ? 'Saving…' : confirming ? `Save ${chosenName} anyway` : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="Firm type"
          hint={says ? `${says.reason}${saysName ? ` (${saysName})` : ''}` : 'The PAN does not say a type.'}
        >
          <Select
            value={typeSlug}
            onChange={(ev) => {
              setTypeSlug(ev.target.value);
              setConfirming(false);
            }}
          >
            {(types.data ?? []).map((t) => (
              <option key={t.id} value={t.slug}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        {confirming && (
          <p role="alert" className="rounded-md border border-warning-200 bg-warning-50 p-2 text-sm text-warning-700">
            PAN {entity.pan} says {saysName ?? 'another type'} (4th letter {entity.pan?.[3]}). Save {chosenName}{' '}
            anyway? It will be kept as set by hand, and later imports will not change it.
          </p>
        )}
        <p className="text-xs text-ink-faint">
          The type decides which compliances apply, so the regulatory profile is marked for reassessment.
        </p>
      </div>
    </Modal>
  );
}
