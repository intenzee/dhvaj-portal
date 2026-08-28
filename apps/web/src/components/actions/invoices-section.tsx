'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, FileText, Send, CheckCircle2, Ban } from 'lucide-react';
import {
  BILLING_FREQUENCIES,
  INVOICE_STATUS,
  type EngagementCommercial,
  type InvoiceDetail,
  type InvoiceRecord,
  type InvoiceStatus,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Card, EmptyState, Button, Spinner } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { Modal } from '@/components/modal';
import { Field, Input, Select, Textarea } from '@/components/form';

/** Format a decimal-string amount as money in the invoice's currency. */
function money(amount: string | null | undefined, currency = 'INR'): string {
  const n = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

interface DraftLine {
  description: string;
  quantity: string;
  unitAmount: string;
}

export function InvoicesSection({ engagementId }: { engagementId: string }): JSX.Element {
  const qc = useQueryClient();
  const [commercialOpen, setCommercialOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);

  const commercial = useQuery({
    queryKey: ['engagement', engagementId, 'commercial'],
    queryFn: () => apiFetch<EngagementCommercial>(`/engagements/${engagementId}/commercial`),
  });
  const invoices = useQuery({
    queryKey: ['engagement', engagementId, 'invoices'],
    queryFn: () =>
      apiFetch<Paginated<InvoiceRecord>>(`/engagements/${engagementId}/invoices?limit=100`),
  });

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'invoices'] });
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'commercial'] });
  };

  const items = invoices.data?.items ?? [];

  return (
    <div className="space-y-6">
      {/* ── Commercial configuration (§31) ─────────────────────────────── */}
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Commercial scope</h2>
          <Button variant="secondary" size="sm" onClick={() => setCommercialOpen(true)}>
            Configure
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Fact label="Billing frequency" value={humanize(commercial.data?.billingFrequency)} />
          <Fact label="Effective" value={formatDate(commercial.data?.effectiveDate)} />
          <Fact label="End" value={formatDate(commercial.data?.endDate)} />
          <Fact
            label="Retainer"
            value={commercial.data?.retainerAmount ? money(commercial.data.retainerAmount) : '—'}
          />
        </div>
        {commercial.data?.scopeNotes && (
          <div className="border-t border-line px-4 py-3 text-sm text-ink-muted">
            {commercial.data.scopeNotes}
          </div>
        )}
      </Card>

      {/* ── Invoices (§31) ─────────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Invoices</h2>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New invoice
          </Button>
        </div>
        <Card className="overflow-hidden p-0">
          {invoices.isLoading && <div className="p-5"><Spinner /></div>}
          {invoices.data && items.length === 0 && (
            <div className="p-5">
              <EmptyState>No invoices yet. Create a draft to start billing this engagement.</EmptyState>
            </div>
          )}
          {items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-2">Number</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Issued</th>
                  <th className="px-4 py-2">Due</th>
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((inv) => (
                  <tr
                    key={inv.id}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-sunken"
                    onClick={() => setOpenInvoiceId(inv.id)}
                  >
                    <td className="px-4 py-2 font-medium text-ink">
                      <FileText className="mr-1.5 inline h-3.5 w-3.5 text-ink-faint" />
                      {inv.invoiceNumber}
                    </td>
                    <td className="px-4 py-2"><StatusBadge status={inv.status} /></td>
                    <td className="px-4 py-2 text-ink-muted">{formatDate(inv.issueDate)}</td>
                    <td className="px-4 py-2 text-ink-muted">{formatDate(inv.dueDate)}</td>
                    <td className="px-4 py-2 text-right font-medium text-ink">
                      {money(inv.total, inv.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      {commercialOpen && commercial.data && (
        <CommercialModal
          engagementId={engagementId}
          current={commercial.data}
          onClose={() => setCommercialOpen(false)}
          onSaved={() => {
            invalidate();
            setCommercialOpen(false);
          }}
        />
      )}
      {createOpen && (
        <CreateInvoiceModal
          engagementId={engagementId}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            invalidate();
            setCreateOpen(false);
            setOpenInvoiceId(id);
          }}
        />
      )}
      {openInvoiceId && (
        <InvoiceDetailModal
          engagementId={engagementId}
          invoiceId={openInvoiceId}
          onClose={() => setOpenInvoiceId(null)}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="text-ink">{value ?? '—'}</div>
    </div>
  );
}

function CommercialModal({
  engagementId,
  current,
  onClose,
  onSaved,
}: {
  engagementId: string;
  current: EngagementCommercial;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const toast = useToast();
  const [billingFrequency, setBillingFrequency] = useState(current.billingFrequency);
  const [effectiveDate, setEffectiveDate] = useState(current.effectiveDate ?? '');
  const [endDate, setEndDate] = useState(current.endDate ?? '');
  const [retainerAmount, setRetainerAmount] = useState(current.retainerAmount ?? '');
  const [scopeNotes, setScopeNotes] = useState(current.scopeNotes ?? '');

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/commercial`, {
        method: 'PATCH',
        body: {
          billingFrequency,
          effectiveDate: effectiveDate || null,
          endDate: endDate || null,
          retainerAmount: retainerAmount.trim() || null,
          scopeNotes: scopeNotes.trim() || null,
        },
      }),
    onSuccess: () => {
      toast('Commercial scope updated.');
      onSaved();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Commercial scope"
      description="Billing frequency and the commercial window for this engagement (§31)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Billing frequency">
          <Select value={billingFrequency} onChange={(e) => setBillingFrequency(e.target.value as typeof billingFrequency)}>
            {BILLING_FREQUENCIES.map((f) => (
              <option key={f} value={f}>{humanize(f)}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Effective date">
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </Field>
          <Field label="End date">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Retainer amount">
          <Input inputMode="decimal" placeholder="e.g. 50000.00" value={retainerAmount} onChange={(e) => setRetainerAmount(e.target.value)} />
        </Field>
        <Field label="Scope notes">
          <Textarea rows={3} value={scopeNotes} onChange={(e) => setScopeNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function CreateInvoiceModal({
  engagementId,
  onClose,
  onCreated,
}: {
  engagementId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}): JSX.Element {
  const toast = useToast();
  const [currency, setCurrency] = useState('INR');
  const [dueDate, setDueDate] = useState('');
  const [taxAmount, setTaxAmount] = useState('0');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ description: '', quantity: '1', unitAmount: '0' }]);

  const setLine = (i: number, patch: Partial<DraftLine>): void =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const create = useMutation({
    mutationFn: () =>
      apiFetch<InvoiceDetail>(`/engagements/${engagementId}/invoices`, {
        method: 'POST',
        body: {
          currency,
          dueDate: dueDate || null,
          taxAmount: taxAmount.trim() || '0',
          notes: notes.trim() || null,
          lines: lines
            .filter((l) => l.description.trim())
            .map((l) => ({
              description: l.description.trim(),
              quantity: l.quantity.trim() || '1',
              unitAmount: l.unitAmount.trim() || '0',
            })),
        },
      }),
    onSuccess: (inv) => {
      toast(`Draft ${inv.invoiceNumber} created.`);
      onCreated(inv.id);
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not create the invoice.', 'error'),
  });

  const subtotal = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitAmount || 0), 0);
  const total = subtotal + Number(taxAmount || 0);

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="New invoice"
      description="Create a draft invoice. It stays editable until you issue it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>Create draft</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Currency">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Tax amount">
            <Input inputMode="decimal" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-faint">Lines</div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                />
                <Input
                  className="w-16"
                  inputMode="decimal"
                  aria-label="Quantity"
                  value={l.quantity}
                  onChange={(e) => setLine(i, { quantity: e.target.value })}
                />
                <Input
                  className="w-28"
                  inputMode="decimal"
                  aria-label="Unit amount"
                  value={l.unitAmount}
                  onChange={(e) => setLine(i, { unitAmount: e.target.value })}
                />
                <button
                  type="button"
                  className="rounded p-1.5 text-ink-faint hover:bg-surface-sunken hover:text-danger-600"
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
            onClick={() => setLines((ls) => [...ls, { description: '', quantity: '1', unitAmount: '0' }])}
          >
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
        </div>

        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-6 border-t border-line pt-3 text-sm">
          <span className="text-ink-muted">Subtotal <span className="ml-2 font-medium text-ink">{money(String(subtotal), currency)}</span></span>
          <span className="text-ink-muted">Total <span className="ml-2 font-semibold text-ink">{money(String(total), currency)}</span></span>
        </div>
      </div>
    </Modal>
  );
}

function InvoiceDetailModal({
  engagementId,
  invoiceId,
  onClose,
  onChanged,
}: {
  engagementId: string;
  invoiceId: string;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('0');

  const key = ['engagement', engagementId, 'invoice', invoiceId] as const;
  const invoice = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<InvoiceDetail>(`/engagements/${engagementId}/invoices/${invoiceId}`),
  });
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: key });
    onChanged();
  };

  const addLine = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/invoices/${invoiceId}/lines`, {
        method: 'POST',
        body: { description: desc.trim(), quantity: qty.trim() || '1', unitAmount: unit.trim() || '0' },
      }),
    onSuccess: () => {
      setDesc('');
      setQty('1');
      setUnit('0');
      refresh();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not add the line.', 'error'),
  });
  const removeLine = useMutation({
    mutationFn: (lineId: string) =>
      apiFetch(`/engagements/${engagementId}/invoices/${invoiceId}/lines/${lineId}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not remove the line.', 'error'),
  });
  const setStatus = useMutation({
    mutationFn: (status: InvoiceStatus) =>
      apiFetch(`/engagements/${engagementId}/invoices/${invoiceId}/status`, {
        method: 'POST',
        body: { status },
      }),
    onSuccess: (_d, status) => {
      toast(`Invoice ${humanize(status)}.`);
      refresh();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not update the invoice.', 'error'),
  });

  const inv = invoice.data;
  const isDraft = inv?.status === INVOICE_STATUS.draft;

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={inv ? inv.invoiceNumber : 'Invoice'}
      description={inv ? `${humanize(inv.status)} · ${money(inv.total, inv.currency)}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {isDraft && (
            <>
              <Button variant="secondary" onClick={() => setStatus.mutate(INVOICE_STATUS.void)} disabled={setStatus.isPending}>
                <Ban className="h-4 w-4" /> Void
              </Button>
              <Button onClick={() => setStatus.mutate(INVOICE_STATUS.issued)} disabled={setStatus.isPending}>
                <Send className="h-4 w-4" /> Issue
              </Button>
            </>
          )}
          {inv?.status === INVOICE_STATUS.issued && (
            <>
              <Button variant="secondary" onClick={() => setStatus.mutate(INVOICE_STATUS.void)} disabled={setStatus.isPending}>
                <Ban className="h-4 w-4" /> Void
              </Button>
              <Button onClick={() => setStatus.mutate(INVOICE_STATUS.paid)} disabled={setStatus.isPending}>
                <CheckCircle2 className="h-4 w-4" /> Mark paid
              </Button>
            </>
          )}
        </>
      }
    >
      {invoice.isLoading && <Spinner />}
      {inv && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Fact label="Status" value={humanize(inv.status)} />
            <Fact label="Issued" value={formatDate(inv.issueDate)} />
            <Fact label="Due" value={formatDate(inv.dueDate)} />
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-2 py-1.5">Description</th>
                <th className="px-2 py-1.5 text-right">Qty</th>
                <th className="px-2 py-1.5 text-right">Unit</th>
                <th className="px-2 py-1.5 text-right">Amount</th>
                {isDraft && <th className="px-2 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {inv.lines.length === 0 && (
                <tr><td colSpan={5} className="px-2 py-3 text-ink-faint">No lines yet.</td></tr>
              )}
              {inv.lines.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-2 py-1.5 text-ink">
                    {l.description}
                    {l.componentName && <span className="ml-2 text-xs text-ink-faint">· {l.componentName}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right text-ink-muted">{l.quantity}</td>
                  <td className="px-2 py-1.5 text-right text-ink-muted">{money(l.unitAmount, inv.currency)}</td>
                  <td className="px-2 py-1.5 text-right font-medium text-ink">{money(l.amount, inv.currency)}</td>
                  {isDraft && (
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        className="rounded p-1 text-ink-faint hover:text-danger-600"
                        onClick={() => removeLine.mutate(l.id)}
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-sm">
                <td className="px-2 pt-2 text-right text-ink-muted" colSpan={isDraft ? 4 : 3}>Subtotal</td>
                <td className="px-2 pt-2 text-right text-ink">{money(inv.subtotal, inv.currency)}</td>
              </tr>
              <tr className="text-sm">
                <td className="px-2 text-right text-ink-muted" colSpan={isDraft ? 4 : 3}>Tax</td>
                <td className="px-2 text-right text-ink">{money(inv.taxAmount, inv.currency)}</td>
              </tr>
              <tr className="text-sm font-semibold">
                <td className="px-2 pb-1 text-right text-ink" colSpan={isDraft ? 4 : 3}>Total</td>
                <td className="px-2 pb-1 text-right text-ink">{money(inv.total, inv.currency)}</td>
              </tr>
            </tfoot>
          </table>

          {isDraft && (
            <div className="flex items-end gap-2 border-t border-line pt-3">
              <div className="flex-1">
                <Field label="Add line">
                  <Input placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
                </Field>
              </div>
              <Input className="w-16" aria-label="Quantity" value={qty} onChange={(e) => setQty(e.target.value)} />
              <Input className="w-28" aria-label="Unit amount" value={unit} onChange={(e) => setUnit(e.target.value)} />
              <Button size="sm" onClick={() => addLine.mutate()} disabled={!desc.trim() || addLine.isPending}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          )}
          {inv.notes && <p className="text-sm text-ink-muted">{inv.notes}</p>}
        </div>
      )}
    </Modal>
  );
}
