'use client';

import { useQuery } from '@tanstack/react-query';
import { PERMISSION, type AuthorityReference } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { ReferenceLink } from './provision-viewer';

/**
 * The configured references of a workflow context (e.g. `02.2`, spec §20) plus
 * any provision versions a conclusion cited (the triggered rule's provision),
 * each resolved through the library for the engagement period.
 *
 * `anchors` narrows the list to the links one field shows (FRF-01 shows
 * "View Rule 4"); `effectiveOn` is the audit-period start (today if omitted).
 */
export function FrameworkReferences({
  contextKey,
  provisionIds,
  anchors,
  effectiveOn,
}: {
  contextKey: string;
  provisionIds?: string[];
  anchors?: string[];
  effectiveOn?: string;
}): JSX.Element | null {
  const { principal } = useAuth();
  const canAdmin = can(principal, PERMISSION.serviceManage);
  const cited = [...new Set((provisionIds ?? []).filter(Boolean))].sort();
  const q = useQuery({
    queryKey: ['authority-references', contextKey, effectiveOn ?? null, cited],
    queryFn: () => {
      const params = new URLSearchParams();
      if (effectiveOn) params.set('on', effectiveOn);
      if (cited.length) params.set('cited', cited.join(','));
      const qs = params.toString();
      return apiFetch<AuthorityReference[]>(
        `/authority-provisions/references/${encodeURIComponent(contextKey)}${qs ? `?${qs}` : ''}`,
      );
    },
    staleTime: 5 * 60_000,
  });
  if (q.isLoading) return <p className="text-xs text-ink-faint">Loading references…</p>;
  if (q.isError) return <p className="text-xs text-danger-700">Could not load the references.</p>;
  const refs = (q.data ?? []).filter(
    (r) => !anchors || anchors.includes(r.anchor) || r.anchor.startsWith('cited_'),
  );
  if (refs.length === 0) return null;
  return (
    <div className="space-y-1" aria-label="References">
      {refs.map((r) => (
        <ReferenceLink key={r.anchor} reference={r} canAdmin={canAdmin} />
      ))}
    </div>
  );
}
