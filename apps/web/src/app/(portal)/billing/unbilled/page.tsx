'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FEATURE_FLAG,
  PERMISSION,
  type InvoiceDetail,
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
import { Field, Select, Textarea } from '@/components/form';
import { Modal } from '@/components/modal';
import {
  SOURCE_LABEL,
  ageLine,
  partnersOf,
  selectedTotal,
  setAsideLine,
} from '@/components/billing/unbilled';

const KEY = ['billing', 'unbilled'] as const;

/**
 * PS-206 · fixed fees that are due and on no invoice — each engagement's
 * retainer periods, or its compliance year's fee shared by the billing
 * frequency, and fee milestones and events that have come due — and a draft
 * invoice from the ticked ones in one click. Periods billed outside the app
 * (or not billed) are set aside with a reason and can be restored.
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
            ? `Fixed fees due and on no invoice, as at ${formatDate(q.data.asOf)}: ${formatMoney(q.data.total, 'INR')}. Oldest first.`
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
  const [picked, setPicked] = useState<Set<string>>(() => new Set(e.items.map((i) => i.key)));
  const [asideOpen, setAsideOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mayDraft = can(principal, PERMISSION.billingManage);
  const chosen = e.items.filter((i) => picked.has(i.key)).map((i) => i.key);
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
      apiFetch<{ setAside: number }>('/billing/unbilled/set-aside', {
        method: 'POST',
        body: { engagementId: e.engagementId, keys: chosen, reason: reason.trim() },
      }),
    onSuccess: (r) => {
      setAsideOpen(false);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['billing'] });
      toast(`${r.setAside} period${r.setAside === 1 ? '' : 's'} set aside.`);
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
              disabled={chosen.length === 0 || aside.isPending}
              onClick={() => setAsideOpen(true)}
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
      <Modal
        open={asideOpen}
        onClose={() => setAsideOpen(false)}
        title="Set these periods aside"
        description={`${chosen.length} period${chosen.length === 1 ? '' : 's'}, ${formatMoney(selectedTotal(e.items, picked), 'INR')}. They leave the unbilled list; restore them any time.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAsideOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={reason.trim().length < 3 || aside.isPending}
              onClick={() => aside.mutate()}
            >
              Set aside
            </Button>
          </>
        }
      >
        <Field label="Why" hint="e.g. Billed in Tally before the switch, or waived by the partner.">
          <Textarea rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
      </Modal>
    </Card>
  );
}
