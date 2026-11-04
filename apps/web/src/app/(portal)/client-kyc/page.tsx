'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  FEATURE_FLAG,
  KYC_GATES,
  KYC_GATE_LABEL,
  KYC_RISK_LABEL,
  KYC_RISK_RATINGS,
  KYC_STATUSES,
  KYC_STATUS_LABEL,
  ROLE,
  type KycGate,
  type KycSettings,
} from '@hsdg/contracts';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatureFlags } from '@/lib/feature-flags';
import { formatDate } from '@/lib/format';
import { hasRole } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { useUrlState } from '@/lib/url-state';
import {
  KYC_REGISTER_KEY,
  fetchKycRegister,
  fetchKycSettings,
  updateKycSettings,
} from '@/lib/client-kyc-api';
import { KYC_TONE } from '@/components/client-kyc/kyc-card';
import { Badge, Button, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

/** PS-404 — every active client and its KYC, with the firm's KYC rules. */
function KycRegisterScreen(): JSX.Element {
  const flags = useFeatureFlags();
  const on = flags.isOn(FEATURE_FLAG.clientKyc);
  const url = useUrlState();
  const filters = {
    search: url.get('q') ?? '',
    status: url.get('status') ?? '',
    risk: url.get('risk') ?? '',
  };
  const [term, setTerm] = useState(filters.search);
  useEffect(() => {
    if (term === filters.search) return;
    const t = setTimeout(() => url.set({ q: term }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
  const list = useQuery({
    queryKey: [...KYC_REGISTER_KEY, filters],
    queryFn: () => fetchKycRegister(filters),
    enabled: on,
  });

  if (!flags.isLoading && !on) {
    return (
      <div>
        <PageHeader title="KYC register" />
        <EmptyState>Client KYC isn&rsquo;t switched on for your office yet.</EmptyState>
      </div>
    );
  }

  const counts = list.data?.counts;
  return (
    <div>
      <PageHeader
        title="KYC register"
        subtitle="Every active client and its KYC — collect it on the client's page; a manager or partner marks it complete."
      />
      <KycRules />
      {counts && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {KYC_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => url.set({ status: filters.status === s ? '' : s })}
              className={`rounded-lg border px-3 py-1.5 ${
                filters.status === s ? 'border-primary-500 bg-primary-50' : 'border-line bg-surface'
              }`}
            >
              <Badge tone={KYC_TONE[s]}>{KYC_STATUS_LABEL[s]}</Badge>
              <span className="ml-2 font-semibold">{counts[s]}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-56 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5">
          <Search className="h-4 w-4 text-ink-faint" aria-hidden />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Client name or code…"
            aria-label="Search clients"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </div>
        <Select
          className="w-auto"
          aria-label="Status"
          value={filters.status}
          onChange={(e) => url.set({ status: e.target.value })}
        >
          <option value="">Any status</option>
          <option value="open">Not complete</option>
          {KYC_STATUSES.map((s) => (
            <option key={s} value={s}>
              {KYC_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto"
          aria-label="Risk"
          value={filters.risk}
          onChange={(e) => url.set({ risk: e.target.value })}
        >
          <option value="">Any risk</option>
          {KYC_RISK_RATINGS.map((r) => (
            <option key={r} value={r}>
              {KYC_RISK_LABEL[r]}
            </option>
          ))}
        </Select>
      </div>
      {list.isLoading && <Spinner />}
      {list.isError && (
        <EmptyState>Could not load the register. Check that the API is reachable.</EmptyState>
      )}
      {list.data &&
        (list.data.items.length === 0 ? (
          <EmptyState>No clients match these filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-sunken/60 text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Office</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Risk</th>
                  <th className="px-3 py-2">Reviewed</th>
                  <th className="px-3 py-2">Next review</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((r) => (
                  <tr key={r.entityId} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <Link
                        href={`/entities/${r.entityId}`}
                        className="text-primary-600 hover:underline"
                      >
                        {r.entityName}
                      </Link>
                      <span className="block text-xs text-ink-faint">{r.entityCode}</span>
                    </td>
                    <td className="px-3 py-2">{r.officeName ?? '—'}</td>
                    <td className="px-3 py-2">
                      <Badge tone={KYC_TONE[r.status]}>{KYC_STATUS_LABEL[r.status]}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {r.riskRating ? KYC_RISK_LABEL[r.riskRating] : '—'}
                    </td>
                    <td className="px-3 py-2">{formatDate(r.reviewedOn)}</td>
                    <td className="px-3 py-2">{formatDate(r.nextReviewOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.data.total > list.data.items.length && (
              <p className="px-3 py-2 text-xs text-ink-faint">
                Showing {list.data.items.length} of {list.data.total}. Narrow the filters to see the
                rest.
              </p>
            )}
          </div>
        ))}
    </div>
  );
}

/** The firm's KYC rules: everyone reads them, the managing partner or admin sets them. */
function KycRules(): JSX.Element | null {
  const { principal } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const editable = hasRole(principal, ROLE.managingPartner, ROLE.admin);
  const settings = useQuery({
    queryKey: [...KYC_REGISTER_KEY, 'settings'],
    queryFn: fetchKycSettings,
  });
  const [draft, setDraft] = useState<KycSettings | null>(null);
  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () =>
      updateKycSettings({
        gate: draft!.gate,
        reviewYearsHigh: draft!.reviewYearsHigh,
        reviewYearsOther: draft!.reviewYearsOther,
        version: settings.data!.version,
      }),
    onSuccess: (s) => {
      qc.setQueryData([...KYC_REGISTER_KEY, 'settings'], s);
      toast('KYC rules saved.', 'success');
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not save the rules.', 'error'),
  });
  if (!settings.data || !draft) return null;
  const s = settings.data;
  if (!editable) {
    return (
      <p className="mb-4 text-sm text-ink-muted">
        New engagements: {KYC_GATE_LABEL[s.gate]}. Review every {s.reviewYearsHigh} year(s) for high
        risk, {s.reviewYearsOther} for others.
      </p>
    );
  }
  const dirty =
    draft.gate !== s.gate ||
    draft.reviewYearsHigh !== s.reviewYearsHigh ||
    draft.reviewYearsOther !== s.reviewYearsOther;
  const years = (v: string) => Math.min(10, Math.max(1, Math.round(Number(v) || 1)));
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3">
      <Field label="New non-audit engagements" className="min-w-72">
        <Select
          value={draft.gate}
          onChange={(e) => setDraft({ ...draft, gate: e.target.value as KycGate })}
        >
          {KYC_GATES.map((g) => (
            <option key={g} value={g}>
              {KYC_GATE_LABEL[g]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Review high risk every (years)">
        <Input
          type="number"
          min={1}
          max={10}
          className="w-24"
          value={draft.reviewYearsHigh}
          onChange={(e) => setDraft({ ...draft, reviewYearsHigh: years(e.target.value) })}
        />
      </Field>
      <Field label="Others every (years)">
        <Input
          type="number"
          min={1}
          max={10}
          className="w-24"
          value={draft.reviewYearsOther}
          onChange={(e) => setDraft({ ...draft, reviewYearsOther: years(e.target.value) })}
        />
      </Field>
      <Button
        variant="primary"
        size="sm"
        disabled={!dirty || save.isPending}
        onClick={() => save.mutate()}
      >
        Save rules
      </Button>
      <p className="w-full text-xs text-ink-faint">
        A new period applies from the next review a manager or partner marks complete.
      </p>
    </div>
  );
}

export default function KycRegisterPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <KycRegisterScreen />
    </Suspense>
  );
}
