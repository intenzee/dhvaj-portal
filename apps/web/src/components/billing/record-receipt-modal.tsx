'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RECEIPT_MODES,
  TDS_SECTIONS,
  type ClientStatement,
  type Paginated,
  type ReceiptMode,
  type ReceiptRecord,
  type TdsSection,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { EntityRow } from '@/lib/types';
import { Modal } from '@/components/modal';
import { Button, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { autoAllocate, checkAllocations, receiptGross, type AllocationDraft } from './receipts';

const today = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/**
 * PS-202 · Record receipt: pick the client, enter what reached the bank and
 * any TDS, and the gross fills their open invoices oldest due first. Adjust the
 * split; what is not allocated stays as an advance.
 */
export function RecordReceiptModal({
  open,
  onClose,
  entity,
}: {
  open: boolean;
  onClose: () => void;
  /** Fixed client (statement page); omit to pick one. */
  entity?: { id: string; name: string };
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(entity ?? null);
  const [receivedOn, setReceivedOn] = useState(today());
  const [mode, setMode] = useState<ReceiptMode>('bank');
  const [reference, setReference] = useState('');
  const [net, setNet] = useState('');
  const [tds, setTds] = useState('');
  const [section, setSection] = useState<TdsSection>('194J');
  const [rows, setRows] = useState<AllocationDraft[]>([]);
  const [edited, setEdited] = useState(false);

  const clients = useQuery({
    queryKey: ['billing', 'receipt-clients', search],
    queryFn: () =>
      apiFetch<Paginated<EntityRow>>(`/entities?search=${encodeURIComponent(search)}&limit=8`),
    enabled: open && !picked && search.trim().length >= 2,
  });
  const statement = useQuery({
    queryKey: ['billing', 'statement', picked?.id],
    queryFn: () => apiFetch<ClientStatement>(`/billing/clients/${picked!.id}/statement`),
    enabled: open && !!picked,
  });
  const openInvoices = (statement.data?.invoices ?? []).filter((i) => Number(i.balance) > 0);
  const gross = receiptGross(net, tds);

  // Until the split is edited by hand, follow the amount.
  useEffect(() => {
    if (!edited) setRows(autoAllocate(gross, openInvoices));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gross, statement.data, edited]);

  const check = checkAllocations(gross, rows, openInvoices);
  const hasTds = Number(tds || 0) > 0;

  const save = useMutation({
    mutationFn: () => {
      if (!check.ok || !picked) throw new Error(check.ok ? 'Pick the client.' : check.error);
      return apiFetch<ReceiptRecord>('/billing/receipts', {
        method: 'POST',
        body: {
          clientEntityId: picked.id,
          receivedOn,
          mode,
          reference: reference.trim() || null,
          netAmount: net.trim(),
          ...(hasTds ? { tdsAmount: tds.trim(), tdsSection: section } : {}),
          allocations: check.allocations,
        },
      });
    },
    onSuccess: (r) => {
      toast(
        Number(r.unallocated) > 0
          ? `Receipt recorded; ${formatMoney(r.unallocated, 'INR')} held as an advance.`
          : 'Receipt recorded.',
      );
      void qc.invalidateQueries({ queryKey: ['billing'] });
      void qc.invalidateQueries({ queryKey: ['engagement'] });
      onClose();
    },
    onError: (e) =>
      toast(
        e instanceof ApiError || e instanceof Error ? e.message : 'Could not record it.',
        'error',
      ),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Record receipt"
      description="Net is what reached the bank; add the TDS the client deducted. Together they settle invoices."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!picked || !check.ok || save.isPending}>
            Record receipt
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {picked ? (
          <div className="flex items-center justify-between rounded-md bg-surface-sunken px-3 py-2 text-sm">
            <span className="font-medium text-ink">{picked.name}</span>
            {!entity && (
              <button
                type="button"
                className="text-xs text-primary-700 hover:underline"
                onClick={() => {
                  setPicked(null);
                  setEdited(false);
                }}
              >
                Change client
              </button>
            )}
          </div>
        ) : (
          <Field label="Client">
            <Input
              autoFocus
              placeholder="Search by name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="mt-1 space-y-0.5">
              {(clients.data?.items ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setPicked({ id: c.id, name: c.legalName })}
                  className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-surface-raised"
                >
                  {c.legalName} <span className="text-xs text-ink-faint">{c.entityCode}</span>
                </button>
              ))}
            </div>
          </Field>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Field label="Received on">
            <Input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          </Field>
          <Field label="Mode">
            <Select value={mode} onChange={(e) => setMode(e.target.value as ReceiptMode)}>
              {RECEIPT_MODES.map((m) => (
                <option key={m} value={m}>
                  {m === 'upi' ? 'UPI' : humanize(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference" hint="UTR, cheque or UPI reference.">
            <Input
              value={reference}
              maxLength={200}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
          <Field label="Net received">
            <Input inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} />
          </Field>
          <Field label="TDS deducted">
            <Input inputMode="decimal" value={tds} onChange={(e) => setTds(e.target.value)} />
          </Field>
          {hasTds && (
            <Field label="TDS section">
              <Select value={section} onChange={(e) => setSection(e.target.value as TdsSection)}>
                {TDS_SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s === 'other' ? 'Other' : `s.${s}`}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        {picked && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-ink">Allocate to open invoices</span>
              {edited && (
                <button
                  type="button"
                  className="text-xs text-primary-700 hover:underline"
                  onClick={() => setEdited(false)}
                >
                  Oldest first again
                </button>
              )}
            </div>
            {statement.isLoading && <Spinner />}
            {statement.data && openInvoices.length === 0 && (
              <p className="text-sm text-ink-faint">
                No open invoices — it will be held as an advance.
              </p>
            )}
            {openInvoices.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-faint">
                    <th className="py-1">Invoice</th>
                    <th className="py-1">Due</th>
                    <th className="py-1 text-right">Balance</th>
                    <th className="py-1 text-right">Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  {openInvoices.map((inv) => {
                    const row = rows.find((r) => r.invoiceId === inv.id);
                    return (
                      <tr key={inv.id} className="border-t border-line">
                        <td className="py-1.5 font-medium tabular-nums text-ink">
                          {inv.invoiceNumber}
                        </td>
                        <td className="py-1.5 text-ink-muted">{formatDate(inv.dueDate)}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {formatMoney(inv.balance, 'INR')}
                        </td>
                        <td className="py-1.5 text-right">
                          <Input
                            className="ml-auto w-32 text-right"
                            inputMode="decimal"
                            aria-label={`Allocate to ${inv.invoiceNumber ?? 'invoice'}`}
                            value={row?.amount ?? ''}
                            onChange={(e) => {
                              setEdited(true);
                              setRows((rs) =>
                                rs.map((r) =>
                                  r.invoiceId === inv.id ? { ...r, amount: e.target.value } : r,
                                ),
                              );
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="mt-2 flex justify-end gap-6 text-sm">
              <span className="text-ink-muted">
                Gross{' '}
                <span className="ml-1 font-medium text-ink">
                  {gross ? formatMoney(gross, 'INR') : '—'}
                </span>
              </span>
              {check.ok ? (
                <span className="text-ink-muted">
                  Advance{' '}
                  <span className="ml-1 font-medium text-ink">
                    {formatMoney(check.advance, 'INR')}
                  </span>
                </span>
              ) : (
                gross && <span className="text-danger-600">{check.error}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
