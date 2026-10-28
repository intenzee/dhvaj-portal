'use client';

import { useState } from 'react';
import { GSTIN_REGEX, TAN_REGEX } from '@hsdg/contracts';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input } from '@/components/form';
import { gstStateLabel } from '@/components/entities/gst-state-select';

/** "27AAACA1234A1Z5" → the state code, when it looks like a GSTIN at all. */
export function stateCodeOfGstin(gstin: string): string | null {
  return /^[0-9]{2}/.test(gstin) ? gstin.slice(0, 2) : null;
}

/** A registration a stream can wait on: the GSTIN for GST, the TAN for TDS. */
export type PendingRegistrationKind = 'gstin' | 'tan';

const KINDS: Record<
  PendingRegistrationKind,
  { label: string; length: number; regex: RegExp; example: string; periods: string }
> = {
  gstin: {
    label: 'GSTIN',
    length: 15,
    regex: GSTIN_REGEX,
    example: '27AAACA1234A1Z5',
    periods: 'GST months',
  },
  tan: {
    label: 'TAN',
    length: 10,
    regex: TAN_REGEX,
    example: 'DELA12345B',
    periods: 'TDS quarters',
  },
};

/**
 * The client's GSTIN or TAN, entered in place (a GST / TDS engagement opened
 * before it was on file). `onSave` does the write; its error is shown here.
 */
export function AddGstinDialog({
  clientName,
  kind = 'gstin',
  onClose,
  onSave,
}: {
  clientName?: string | null;
  kind?: PendingRegistrationKind;
  onClose: () => void;
  onSave: (number: string) => Promise<void>;
}): JSX.Element {
  const k = KINDS[kind];
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = number.trim().toUpperCase();
  const valid = k.regex.test(value);
  const state = kind === 'gstin' ? stateCodeOfGstin(value) : null;
  const left = k.length - value.length;

  const submit = async (): Promise<void> => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(value);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not add the ${k.label}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Add the client’s ${k.label}`}
      description={
        clientName
          ? `${clientName} — saved on the client’s registrations.`
          : 'Saved on the client’s registrations.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : `Save ${k.label}`}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field
          label={k.label}
          required
          hint={
            value.length === 0
              ? `${k.length} characters, e.g. ${k.example}.`
              : valid
                ? kind === 'gstin'
                  ? `State ${gstStateLabel(state)}.`
                  : 'Looks right.'
                : left > 0
                  ? `${left} more character${left === 1 ? '' : 's'}.`
                  : `That is not a valid ${k.label}.`
          }
        >
          <Input
            autoFocus
            aria-label={k.label}
            className="font-mono uppercase"
            maxLength={k.length}
            value={number}
            onChange={(e) => setNumber(e.target.value.toUpperCase())}
            placeholder={k.example}
          />
        </Field>
        <p className="text-xs text-ink-muted">
          The {k.periods} already built move onto this {k.label} — anything marked filed or worked
          on stays as it is.
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger-700">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
