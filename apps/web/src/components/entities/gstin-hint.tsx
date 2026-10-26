'use client';

/**
 * The line under a GSTIN field (CM-1): once 15 characters are in, the PAN and
 * state inside it in grey when they fit the client, in red when the GSTIN is
 * another PAN's. A red line blocks saving — `gstinBlocks` says so.
 */
import Link from 'next/link';
import { cleanPan, readGstin } from '@hsdg/contracts';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

export interface GstinVerdict {
  tone: 'ok' | 'warn' | 'block';
  text: string;
}

/** What a typed GSTIN says against the client's PAN; null until 15 characters are in. */
export function gstinVerdict(
  value: string | null | undefined,
  clientPan: string | null | undefined,
): GstinVerdict | null {
  const read = readGstin(value);
  if (read.gstin.length < 15) return null;
  const pan = cleanPan(clientPan);
  if (read.pan && pan && read.pan !== pan)
    return {
      tone: 'block',
      text: `This GSTIN is for PAN ${read.pan}, but the client's PAN is ${pan}.`,
    };
  if (!read.valid)
    return {
      tone: 'warn',
      text: 'This GSTIN does not pass its check — a character is wrong (the last digit does not fit).',
    };
  const state = read.stateName ? `${read.stateCode} ${read.stateName}` : `state ${read.stateCode}?`;
  return { tone: 'ok', text: `PAN ${read.pan} · ${state}` };
}

/** Whether a GSTIN must not be saved for this client. */
export function gstinBlocks(value: string | null | undefined, clientPan: string | null | undefined): boolean {
  return gstinVerdict(value, clientPan)?.tone === 'block';
}

export function GstinHint({
  value,
  pan,
  className,
}: {
  value: string | null | undefined;
  pan: string | null | undefined;
  className?: string;
}): JSX.Element | null {
  const v = gstinVerdict(value, pan);
  if (!v) return null;
  return (
    <p
      role={v.tone === 'block' ? 'alert' : undefined}
      className={cn(
        'mt-1 text-xs',
        v.tone === 'ok' && 'text-ink-muted',
        v.tone === 'warn' && 'text-warn-700',
        v.tone === 'block' && 'text-danger-600',
        className,
      )}
    >
      {v.text}
    </p>
  );
}

/** The API's 422 for a GSTIN of another PAN (CM-1). */
export interface TaxIdConflict {
  code: 'PAN_GSTIN_MISMATCH' | 'GSTINS_DIFFERENT_PAN';
  message: string;
  expected?: string;
  actual?: string;
  holder?: { id: string; entityCode: string; legalName: string };
}

export function taxIdConflictOf(err: unknown): TaxIdConflict | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  const body = err.body as Partial<TaxIdConflict> | undefined;
  return body?.code === 'PAN_GSTIN_MISMATCH' || body?.code === 'GSTINS_DIFFERENT_PAN'
    ? ({ ...body, message: err.message } as TaxIdConflict)
    : null;
}

export function TaxIdConflictNotice({ conflict }: { conflict: TaxIdConflict }): JSX.Element {
  return (
    <div role="alert" className="rounded-md border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">
      <p>{conflict.message}</p>
      {conflict.holder && (
        <Link href={`/entities/${conflict.holder.id}`} className="mt-1 inline-block font-medium underline">
          Open {conflict.holder.legalName} ({conflict.holder.entityCode})
        </Link>
      )}
    </div>
  );
}
