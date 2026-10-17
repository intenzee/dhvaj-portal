'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FEATURE_FLAG,
  PERMISSION,
  type FeeWaiver,
  type InvoiceDetail,
  type SetAsideFeesResult,
  type SetAsideKind,
  type UnbilledEngagement,
  type UnbilledReport,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useToast } from '@/lib/toast';
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { InlinePanel } from '@/components/inline-panel';
import {
  SOURCE_LABEL,
  ageLine,
  partnersOf,
  selectedTotal,
  setAsideLine,
  setAsideProblem,
  waiverLine,
} from '@/components/billing/unbilled';

const KEY = ['billing', 'unbilled'] as const;
const WAIVERS_KEY = ['billing', 'fee-waivers', 'pending'] as const;
const today = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/**
 * PS-206 · fixed fees that are due and on no invoice — each engagement's
 * retainer periods, or its compliance year's fee shared by the billing
 * frequency, and fee milestones and events that have come due — and a draft
 * invoice from the ticked ones in one click. Periods billed outside the app
 * are set aside naming that invoice; not billing a period is a waiver another
 * partner approves. Set-aside periods can be restored.
 */
export default function UnbilledPage(): JSX.Element {
  const { principal } = useAuth();
  const { isOn } = useFeatureFlags();
  const on = isOn(FEATURE_FLAG.billing);
  const allowed = can(principal, PERMISSION.billingManage) || can(principal, PERMISSION.reportRead);
  const [partner, setPartner] = useState('');
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch<UnbilledReport>('/billing/unbilled'),
    enabled: on && allowed,
  });
  const partners = useMemo(() => partnersOf(q.data?.engagements ?? []), [q.data]);

  if (!on) return <EmptyState>Unbilled fees arrive with the new billing.</EmptyState>;
  if (!allowed) {
    return (
      <div>
        <PageHeader title="Unbilled fees" />
        <EmptyState>You don’t have permission to view unbilled fees.</EmptyState>
      </div>
    );
  }

  const rows = (q.data?.engagements ?? []).filter((e) => !partner || e.partnerId === partner);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Unbilled fees"
        subtitle={
          q.data
            ? `Fixed fees due and on no invoice, as at ${formatDate(q.data.asOf)}: ${formatMoney(q.data.total, 'INR')}. Oldest first${q.data.billingFrom ? `, from the billing go-live on ${formatDate(q.data.billingFrom)}` : ''}.`
            : 'Fixed fees due and on no invoice.'
        }
      />
      <div className="flex items-center gap-2 text-sm">
        <Link href="/billing" className="text-primary-700 hover:underline">
          ← Billing
        </Link>
        {partners.length > 1 && (
          <div className="ml-auto w-56">
            <Select
              aria-label="Engagement partner"
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
            >
              <option value="">All engagement partners</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      {can(principal, PERMISSION.billingApprove) && <WaiversToDecide />}
      {q.isLoading && <Spinner label="Finding unbilled fees…" />}
      {q.isError && (
        <EmptyState>
          {q.error instanceof ApiError ? q.error.message : 'Could not load the unbilled fees.'}
        </EmptyState>
      )}
      {q.data && rows.length === 0 && (
        <EmptyState>Every fixed fee that is due is on an invoice.</EmptyState>
      )}
      {rows.map((e) => (
        <EngagementFees key={e.engagementId} e={e} />
      ))}
      {q.data && q.data.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-ink-faint">
          {q.data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EngagementFees({ e }: { e: UnbilledEngagement }): JSX.Element {
  const { principal } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(e.items.filter((i) => !i.waiverId).map((i) => i.key)),
  );
  const [asideOpen, setAsideOpen] = useState(false);
  const [asideForm, setAsideForm] = useState<{
    kind: SetAsideKind;
    reason: string;
    number: string;
    date: string;
  }>({ kind: 'billed_outside', reason: '', number: '', date: '' });
  const mayDraft = can(principal, PERMISSION.billingManage);
  const chosen = e.items.filter((i) => picked.has(i.key)).map((i) => i.key);
  // A period with a waiver waiting for a partner cannot be set aside again.
  const asideKeys = e.items.filter((i) => picked.has(i.key) && !i.waiverId).map((i) => i.key);
  const asideTotal = selectedTotal(e.items, new Set(asideKeys));
  const problem = setAsideProblem(asideForm, today());
  const fail = (what: string) => (err: unknown) =>
    toast(err instanceof ApiError ? err.message : what, 'error');

  const draft = useMutation({
    mutationFn: () =>
      apiFetch<InvoiceDetail>('/billing/unbilled/draft', {
        method: 'POST',
        body: { engagementId: e.engagementId, keys: chosen },
      }),
    onSuccess: (inv) => {
      void qc.invalidateQueries({ queryKey: ['billing'] });
      toast(`Draft invoice of ${formatMoney(inv.total, 'INR')} made — review and issue it.`);
      router.push(`/engagements/${e.engagementId}?tab=invoices`);
    },
    onError: fail('Could not make the draft invoice.'),
  });

  const aside = useMutation({
    mutationFn: () =>
      apiFetch<SetAsideFeesResult>('/billing/unbilled/set-aside', {
        method: 'POST',
        body: {
          engagementId: e.engagementId,
          keys: asideKeys,
          kind: asideForm.kind,
          reason: asideForm.reason.trim() || undefined,
          ...(asideForm.kind === 'billed_outside'
            ? {
                externalInvoiceNumber: asideForm.number.trim(),
                externalInvoiceDate: asideForm.date,
              }
            : {}),
        },
      }),
    onSuccess: (r) => {
      setAsideOpen(false);
      setAsideForm((f) => ({ ...f, reason: '', number: '', date: '' }));
      void qc.invalidateQueries({ queryKey: ['billing'] });
      toast(
        r.waiver
          ? `Not billing ${formatMoney(r.waiver.amount, 'INR')}: sent to a partner to approve.`
          : `${r.setAside} period${r.setAside === 1 ? '' : 's'} set aside.`,
      );
    },
    onError: fail('Could not set the periods aside.'),
  });

  const restore = useMutation({
    mutationFn: (key: string) =>
      apiFetch<{ restored: string }>('/billing/unbilled/restore', {
        method: 'POST',
        body: { engagementId: e.engagementId, key },
      }),
    onSuccess: (r) => {
      setPicked((s) => new Set(s).add(r.restored));
      void qc.invalidateQueries({ queryKey: ['billing'] });
      toast('Listed as unbilled again.');
    },
    onError: fail('Could not restore the period.'),
  });

  const toggle = (key: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/engagements/${e.engagementId}`}
            className="font-medium text-ink hover:underline"
          >
            {e.clientName}
          </Link>
          <span className="block text-xs text-ink-faint">
            {e.serviceName} · {e.engagementCode}
            {e.partnerName ? ` · ${e.partnerName}` : ''}
          </span>
        </div>
        {mayDraft && e.items.length > 0 && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={asideKeys.length === 0 || aside.isPending}
              onClick={() => setAsideOpen((o) => !o)}
            >
              Set aside…
            </Button>
            <Button
              size="sm"
              disabled={chosen.length === 0 || draft.isPending}
              onClick={() => draft.mutate()}
            >
              {draft.isPending
                ? 'Drafting…'
                : `Draft invoice · ${formatMoney(selectedTotal(e.items, picked), 'INR')}`}
            </Button>
          </div>
        )}
      </div>
      <InlinePanel
        open={asideOpen && asideKeys.length > 0}
        onClose={() => setAsideOpen(false)}
        title="Set these periods aside"
        description={`${asideKeys.length} period${asideKeys.length === 1 ? '' : 's'}, ${formatMoney(asideTotal, 'INR')}. They leave the unbilled list; restore them any time.`}
        className="mx-4 mb-3"
        footer={
          <div className="flex items-center justify-end gap-3">
            {problem && <span className="mr-auto text-xs text-ink-faint">{problem}</span>}
            <Button variant="secondary" size="sm" onClick={() => setAsideOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!!problem || aside.isPending} onClick={() => aside.mutate()}>
              {asideForm.kind === 'not_billing' ? 'Ask a partner' : 'Set aside'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <fieldset className="flex flex-wrap gap-4">
            <legend className="sr-only">Why they are not billed here</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`aside-${e.engagementId}`}
                checked={asideForm.kind === 'billed_outside'}
                onChange={() => setAsideForm((f) => ({ ...f, kind: 'billed_outside' }))}
              />
              Billed outside the app
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`aside-${e.engagementId}`}
                checked={asideForm.kind === 'not_billing'}
                onChange={() => setAsideForm((f) => ({ ...f, kind: 'not_billing' }))}
              />
              Not billing it — another partner approves
            </label>
          </fieldset>
          {asideForm.kind === 'billed_outside' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Outside invoice number" hint="e.g. the Tally voucher number">
                <Input
                  value={asideForm.number}
                  maxLength={40}
                  onChange={(ev) => setAsideForm((f) => ({ ...f, number: ev.target.value }))}
                />
              </Field>
              <Field label="Its date">
                <Input
                  type="date"
                  value={asideForm.date}
                  max={today()}
                  onChange={(ev) => setAsideForm((f) => ({ ...f, date: ev.target.value }))}
                />
              </Field>
            </div>
          )}
          <Field
            label={
              asideForm.kind === 'not_billing' ? 'Why the firm is not billing it' : 'Note (optional)'
            }
            hint={
              asideForm.kind === 'not_billing'
                ? 'e.g. First month free, agreed at onboarding. It stays unbilled until a partner approves.'
                : undefined
            }
          >
            <Textarea
              rows={2}
              maxLength={500}
              value={asideForm.reason}
              onChange={(ev) => setAsideForm((f) => ({ ...f, reason: ev.target.value }))}
            />
          </Field>
        </div>
      </InlinePanel>
      <ul className="divide-y divide-line text-sm">
        {e.items.map((i) => (
          <li key={i.key} className="flex items-center gap-3 px-4 py-2">
            {mayDraft && (
              <input
                type="checkbox"
                aria-label={`Bill ${i.label}`}
                checked={picked.has(i.key)}
                onChange={() => toggle(i.key)}
              />
            )}
            <span className="flex-1">
              {i.label}
              <span className="block text-xs text-ink-faint">
                {SOURCE_LABEL[i.source]} · {ageLine(i)}
                {i.waiverId && (
                  <span className="text-warning-700"> · Not billing it: waiting for a partner</span>
                )}
              </span>
            </span>
            <span className="tabular-nums">{formatMoney(i.amount, 'INR')}</span>
          </li>
        ))}
      </ul>
      {e.setAside.length > 0 && (
        <details className="border-t border-line px-4 py-2 text-sm">
          <summary className="cursor-pointer text-xs text-ink-muted">
            {e.setAside.length} set aside — billed outside the app or not billed
          </summary>
          <ul className="mt-2 space-y-2">
            {e.setAside.map((a) => (
              <li key={a.key} className="flex items-center gap-3">
                <span className="flex-1 text-ink-muted">
                  {a.label} · {formatMoney(a.amount, 'INR')}
                  <span className="block text-xs text-ink-faint">{setAsideLine(a)}</span>
                </span>
                {mayDraft && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(a.key)}
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

/** Waivers waiting on the caller: a partner who bills the client decides another's request. */
function WaiversToDecide(): JSX.Element | null {
  const { principal } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: WAIVERS_KEY,
    queryFn: () => apiFetch<FeeWaiver[]>('/billing/fee-waivers?status=pending'),
  });
  const decide = useMutation({
    mutationFn: ({ w, decision }: { w: FeeWaiver; decision: 'approve' | 'reject' }) =>
      apiFetch<FeeWaiver>(`/billing/fee-waivers/${w.id}/decision`, {
        method: 'POST',
        body: { decision, version: w.version },
      }),
    onSuccess: (w) => {
      void qc.invalidateQueries({ queryKey: ['billing'] });
      toast(
        w.status === 'approved'
          ? `Approved: ${formatMoney(w.amount, 'INR')} not billed.`
          : 'Rejected: the periods stay unbilled.',
      );
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not decide the waiver.', 'error'),
  });
  const toDecide = (q.data ?? []).filter((w) => w.requestedById !== principal?.employeeId);
  if (toDecide.length === 0) return null;
  return (
    <Card className="p-0">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Not billing — to approve</h2>
        <p className="text-xs text-ink-faint">
          Fees a colleague asked not to bill. Approve to set them aside; reject to keep them
          unbilled.
        </p>
      </div>
      <ul className="divide-y divide-line text-sm">
        {toDecide.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1">
              {w.clientName}
              {w.serviceName ? ` · ${w.serviceName}` : ''}
              <span className="block text-xs text-ink-faint">{waiverLine(w)}</span>
            </span>
            <span className="tabular-nums">{formatMoney(w.amount, 'INR')}</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ w, decision: 'reject' })}
            >
              Reject
            </Button>
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ w, decision: 'approve' })}
            >
              Approve
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
