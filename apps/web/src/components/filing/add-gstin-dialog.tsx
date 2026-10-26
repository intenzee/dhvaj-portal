'use client';

import { useState } from 'react';
import { GSTIN_REGEX } from '@hsdg/contracts';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input } from '@/components/form';
import { gstStateLabel } from '@/components/entities/gst-state-select';

/** "27AAACA1234A1Z5" → the state code, when it looks like a GSTIN at all. */
export function stateCodeOfGstin(gstin: string): string | null {
  return /^[0-9]{2}/.test(gstin) ? gstin.slice(0, 2) : null;
}

/**
 * The client's GSTIN, entered in place (a GST engagement opened before it was
 * on file). `onSave` does the write; its error is shown here.
 */
export function AddGstinDialog({
  clientName,
  onClose,
  onSave,
}: {
  clientName?: string | null;
  onClose: () => void;
  onSave: (gstin: string) => Promise<void>;
}): JSX.Element {
  const [gstin, setGstin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = gstin.trim().toUpperCase();
  const valid = GSTIN_REGEX.test(value);
  const state = stateCodeOfGstin(value);

  const submit = async (): Promise<void> => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(value);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the GSTIN.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add the client’s GSTIN"
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
            {busy ? 'Saving…' : 'Save GSTIN'}
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
          label="GSTIN"
          required
          hint={
            value.length === 0
              ? '15 characters, e.g. 27AAACA1234A1Z5.'
              : valid
                ? `State ${gstStateLabel(state)}.`
                : value.length < 15
                  ? `${15 - value.length} more character${15 - value.length === 1 ? '' : 's'}.`
                  : 'That is not a valid GSTIN.'
          }
        >
          <Input
            autoFocus
            aria-label="GSTIN"
            className="font-mono uppercase"
            maxLength={15}
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
            placeholder="27AAACA1234A1Z5"
          />
        </Field>
        <p className="text-xs text-ink-muted">
          The GST months already built move onto this GSTIN — anything marked filed or worked on
          stays as it is.
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
