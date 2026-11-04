'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  DSC_CLASSES,
  DSC_CLASS_LABEL,
  DSC_USAGES,
  DSC_USAGE_LABEL,
  type DscClass,
  type DscTokenDetail,
  type DscUsage,
} from '@hsdg/contracts';
import { createDscToken, updateDscToken } from '@/lib/registers-api';
import { Field, Input, Select, Textarea } from '@/components/form';
import { Button } from '@/components/ui';
import { InlinePanel } from '@/components/inline-panel';
import { EntityPicker, type Picked } from '@/components/entity-picker';

export interface DscFormValues {
  holderName: string;
  holderPan: string;
  din: string;
  validFrom: string;
  validTo: string;
  pin: string;
}

/** "12 days left" / "expires today" / "expired 3 days ago". Pure — tested. */
export function dscExpiryText(daysToExpiry: number): string {
  if (daysToExpiry === 0) return 'expires today';
  if (daysToExpiry > 0) return `${daysToExpiry} day${daysToExpiry === 1 ? '' : 's'} left`;
  const n = -daysToExpiry;
  return `expired ${n} day${n === 1 ? '' : 's'} ago`;
}

/** The checks the API makes, ahead of it. Pure — tested. */
export function dscFormProblem(v: DscFormValues, hasClient: boolean): string | null {
  const pan = v.holderPan.trim();
  if (pan && !/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/.test(pan))
    return 'A PAN is 10 characters, like ABCDE1234F.';
  const din = v.din.trim();
  if (din && !/^[0-9]{8}$/.test(din)) return 'A DIN is 8 digits.';
  if (v.validFrom && v.validTo && v.validFrom > v.validTo)
    return 'A token is valid from a day on or before its expiry.';
  if (v.pin && !hasClient)
    return 'Choose the client first: the PIN is kept with the client’s logins.';
  return null;
}

/**
 * PS-305 — add a token to the register, or edit one (inline, under the
 * header or under its row). The PIN field shows only to someone who can keep
 * PINs, and only when adding.
 */
export function DscForm({
  existing,
  canKeepPin,
  onClose,
  onSaved,
}: {
  existing: DscTokenDetail | null;
  canKeepPin: boolean;
  onClose: () => void;
  onSaved: (t: DscTokenDetail) => void;
}): JSX.Element {
  const [entity, setEntity] = useState<Picked | null>(
    existing?.entityId ? { id: existing.entityId, label: existing.entityName ?? '' } : null,
  );
  const [v, setV] = useState({
    holderName: existing?.holderName ?? '',
    holderPan: existing?.holderPan ?? '',
    din: existing?.din ?? '',
    class: existing?.class ?? ('class3' as DscClass),
    usage: existing?.usage ?? ('sign' as DscUsage),
    issuer: existing?.issuer ?? '',
    validFrom: existing?.validFrom ?? '',
    validTo: existing?.validTo ?? '',
    tokenSerial: existing?.tokenSerial ?? '',
    location: existing?.location ?? '',
    notes: existing?.notes ?? '',
    pin: '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]): void =>
    setV((cur) => ({ ...cur, [k]: val }));
  const problem = dscFormProblem(v, Boolean(entity));
  const orNull = (s: string): string | null => s.trim() || null;

  const save = useMutation({
    mutationFn: () => {
      const common = {
        holderName: v.holderName.trim(),
        holderPan: orNull(v.holderPan)?.toUpperCase() ?? null,
        din: orNull(v.din),
        entityId: entity?.id ?? null,
        class: v.class,
        usage: v.usage,
        issuer: orNull(v.issuer),
        validFrom: v.validFrom || null,
        validTo: v.validTo,
        tokenSerial: orNull(v.tokenSerial),
        location: orNull(v.location),
        notes: orNull(v.notes),
      };
      return existing
        ? updateDscToken(existing.id, { ...common, version: existing.version })
        : createDscToken({ ...common, pin: canKeepPin ? orNull(v.pin) : null });
    },
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });
  const ready = !!v.holderName.trim() && !!v.validTo && !problem;

  return (
    <InlinePanel
      open
      onClose={onClose}
      title={existing ? 'Edit the token' : 'Add a DSC token'}
      description="A token the office holds for a client’s director or signatory."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : existing ? 'Save' : 'Add to register'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Holder" required>
          <Input
            value={v.holderName}
            onChange={(e) => set('holderName', e.target.value)}
            maxLength={120}
            aria-label="Holder"
            placeholder="Name on the certificate"
          />
        </Field>
        <Field label="Client" hint="The company or person the holder signs for.">
          <EntityPicker value={entity} onChange={setEntity} exclude={new Set()} />
        </Field>
        <Field label="PAN">
          <Input
            value={v.holderPan}
            onChange={(e) => set('holderPan', e.target.value.toUpperCase())}
            maxLength={10}
            aria-label="PAN"
            className="font-mono"
          />
        </Field>
        <Field label="DIN" hint="For a director: links the ROC DSC warnings to this token.">
          <Input
            value={v.din}
            onChange={(e) => set('din', e.target.value)}
            maxLength={8}
            aria-label="DIN"
            className="font-mono"
          />
        </Field>
        <Field label="Class">
          <Select
            value={v.class}
            onChange={(e) => set('class', e.target.value as DscClass)}
            aria-label="Class"
          >
            {DSC_CLASSES.map((c) => (
              <option key={c} value={c}>
                {DSC_CLASS_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Use">
          <Select
            value={v.usage}
            onChange={(e) => set('usage', e.target.value as DscUsage)}
            aria-label="Use"
          >
            {DSC_USAGES.map((u) => (
              <option key={u} value={u}>
                {DSC_USAGE_LABEL[u]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Valid from">
          <Input
            type="date"
            value={v.validFrom}
            onChange={(e) => set('validFrom', e.target.value)}
            aria-label="Valid from"
          />
        </Field>
        <Field label="Valid to" required>
          <Input
            type="date"
            value={v.validTo}
            onChange={(e) => set('validTo', e.target.value)}
            aria-label="Valid to"
          />
        </Field>
        <Field label="Issuer">
          <Input
            value={v.issuer}
            onChange={(e) => set('issuer', e.target.value)}
            maxLength={120}
            aria-label="Issuer"
            placeholder="e.g. eMudhra"
          />
        </Field>
        <Field label="Token serial">
          <Input
            value={v.tokenSerial}
            onChange={(e) => set('tokenSerial', e.target.value)}
            maxLength={80}
            aria-label="Token serial"
          />
        </Field>
        <Field label="Kept at" hint="Where in the office: the cabinet, the drawer.">
          <Input
            value={v.location}
            onChange={(e) => set('location', e.target.value)}
            maxLength={120}
            aria-label="Kept at"
          />
        </Field>
        {!existing && canKeepPin && (
          <Field label="PIN" hint="Optional. Kept in the client’s logins vault, never here.">
            <Input
              type="password"
              autoComplete="new-password"
              value={v.pin}
              onChange={(e) => set('pin', e.target.value)}
              maxLength={64}
              aria-label="PIN"
            />
          </Field>
        )}
        <Field label="Notes" className="sm:col-span-2">
          <Textarea
            value={v.notes}
            onChange={(e) => set('notes', e.target.value)}
            maxLength={1000}
            aria-label="Notes"
          />
        </Field>
      </div>
      {(problem || error) && (
        <p role="alert" className="mt-3 text-sm text-danger-700">
          {problem ?? error}
        </p>
      )}
    </InlinePanel>
  );
}
