'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  CERTIFICATE_STATUSES,
  CERTIFICATE_STATUS_LABEL,
  FEATURE_FLAG,
  type CertificateStatus,
} from '@hsdg/contracts';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useUrlState } from '@/lib/url-state';
import {
  certificatesKey,
  fetchCertificateRegister,
  fetchCertificateTemplates,
  type CertificateRegisterFilters,
} from '@/lib/certificates-api';
import { formatDate } from '@/lib/format';
import { Badge, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Select } from '@/components/form';
import { CERTIFICATE_TONE } from '@/components/certificates/certificates-tab';

/** PS-402 — every certificate the firm prepared or issued, with its UDIN. */
function CertificateRegisterScreen(): JSX.Element {
  const flags = useFeatureFlags();
  const on = flags.isOn(FEATURE_FLAG.certificates);
  const url = useUrlState();
  const filters: CertificateRegisterFilters = {
    search: url.get('q') ?? '',
    status: (url.get('status') as CertificateStatus | null) ?? '',
    template: url.get('template') ?? '',
  };
  const [term, setTerm] = useState(filters.search);
  useEffect(() => {
    if (term === filters.search) return;
    const t = setTimeout(() => url.set({ q: term }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
  const templates = useQuery({
    queryKey: [...certificatesKey, 'templates'],
    queryFn: fetchCertificateTemplates,
    enabled: on,
    staleTime: 5 * 60_000,
  });
  const list = useQuery({
    queryKey: [...certificatesKey, 'register', filters],
    queryFn: () => fetchCertificateRegister(filters),
    enabled: on,
  });

  if (!flags.isLoading && !on) {
    return (
      <div>
        <PageHeader title="Certificate register" />
        <EmptyState>The certificates desk isn&rsquo;t switched on for your office yet.</EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Certificate register"
        subtitle="Every certificate the firm prepared or issued, with its number, signing partner and UDIN."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-56 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5">
          <Search className="h-4 w-4 text-ink-faint" aria-hidden />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Client, certificate no., UDIN…"
            aria-label="Search certificates"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </div>
        <Select
          className="w-auto"
          aria-label="Template"
          value={filters.template}
          onChange={(e) => url.set({ template: e.target.value })}
        >
          <option value="">Every certificate</option>
          {templates.data?.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto"
          aria-label="Status"
          value={filters.status}
          onChange={(e) => url.set({ status: e.target.value })}
        >
          <option value="">Any status</option>
          {CERTIFICATE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CERTIFICATE_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>
      {list.isLoading && <Spinner />}
      {list.isError && (
        <EmptyState>Could not load the register. Check that the API is reachable.</EmptyState>
      )}
      {list.data &&
        (list.data.length === 0 ? (
          <EmptyState>No certificates match these filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-sunken/60 text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">No.</th>
                  <th className="px-3 py-2">Certificate</th>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Purpose</th>
                  <th className="px-3 py-2">Signing partner</th>
                  <th className="px-3 py-2">Signed</th>
                  <th className="px-3 py-2">UDIN</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{r.certificateNo ?? '—'}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/engagements/${r.engagementId}?tab=certificates`}
                        className="text-primary-600 hover:underline"
                      >
                        {r.templateName}
                      </Link>
                      {r.formLabel && (
                        <span className="ml-1 text-xs text-ink-faint">({r.formLabel})</span>
                      )}
                      {r.form15caAckNo && (
                        <span className="block text-xs text-ink-faint">
                          Form 145: {r.form15caAckNo}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/entities/${r.entityId}`} className="hover:underline">
                        {r.entityName}
                      </Link>
                      <span className="block text-xs text-ink-faint">{r.engagementCode}</span>
                    </td>
                    <td className="px-3 py-2">{r.purpose}</td>
                    <td className="px-3 py-2">{r.signingPartnerName ?? '—'}</td>
                    <td className="px-3 py-2">{formatDate(r.signedOn)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.udin ?? '—'}</td>
                    <td className="px-3 py-2">
                      <Badge tone={CERTIFICATE_TONE[r.status]}>
                        {CERTIFICATE_STATUS_LABEL[r.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

export default function CertificateRegisterPage(): JSX.Element {
  return (
    <Suspense fallback={<Spinner />}>
      <CertificateRegisterScreen />
    </Suspense>
  );
}
