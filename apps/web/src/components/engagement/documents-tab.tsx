'use client';

import { useQuery } from '@tanstack/react-query';
import { STREAMS, STREAM_LABEL, type StreamTree } from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { useUrlState } from '@/lib/url-state';
import { Select } from '@/components/form';
import { Input } from '@/components/form';
import { DocumentsPanel, type DocumentListFilters } from '@/components/documents/documents-panel';

const SECTIONS = [
  { key: 'outward', label: 'Outward' },
  { key: 'inward', label: 'Inward' },
  { key: 'summary', label: 'Summary' },
  { key: 'annual', label: 'Annual' },
];

/** The filters held in the URL (?dstream=&dfy=&dperiod=&dsection=&dgstin=) → API filters. */
export function documentFilters(get: (k: string) => string | null, registrationId: string | null): DocumentListFilters {
  const f: DocumentListFilters = {};
  const stream = get('dstream');
  const fy = get('dfy');
  const period = get('dperiod');
  const section = get('dsection');
  if (stream) f.stream = stream;
  if (fy) f.financialYear = fy;
  if (period) f.periodKey = period;
  if (section) f.section = section;
  if (registrationId) f.registrationId = registrationId;
  return f;
}

/**
 * Change 3 / 6 — Documents with filters by stream, year, period, section and
 * GSTIN (only when the client has more than one). Filters live in the URL so
 * "the September 3B papers" can be linked.
 */
export function DocumentsTab({
  engagementId,
  financialYears,
}: {
  engagementId: string;
  financialYears: string[];
}): JSX.Element {
  const url = useUrlState();
  const gst = useQuery({
    queryKey: ['filing', 'tree', engagementId, 'gst', 'registrations'],
    queryFn: () => apiFetch<StreamTree>(`/engagements/${engagementId}/streams/gst/tree`),
    staleTime: 60_000,
  });
  const regs = gst.data?.registrations ?? [];
  const gstin = url.get('dgstin');
  const registrationId = regs.find((r) => r.number === gstin)?.id ?? null;
  const filters = documentFilters(url.get, registrationId);

  return (
    <section className="mt-2 space-y-3">
      <div className="flex flex-wrap items-center gap-2" aria-label="Filter documents">
        <Select
          className="w-auto"
          aria-label="Stream"
          value={url.get('dstream') ?? ''}
          onChange={(e) => url.set({ dstream: e.target.value })}
        >
          <option value="">All streams</option>
          {STREAMS.map((s) => (
            <option key={s} value={s}>
              {STREAM_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto"
          aria-label="Financial year"
          value={url.get('dfy') ?? ''}
          onChange={(e) => url.set({ dfy: e.target.value })}
        >
          <option value="">All years</option>
          {financialYears.map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </Select>
        <Input
          className="w-auto"
          type="month"
          aria-label="Period"
          value={url.get('dperiod') ?? ''}
          onChange={(e) => url.set({ dperiod: e.target.value })}
        />
        <Select
          className="w-auto"
          aria-label="Section"
          value={url.get('dsection') ?? ''}
          onChange={(e) => url.set({ dsection: e.target.value })}
        >
          <option value="">All sections</option>
          {SECTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
        {regs.length > 1 && (
          <Select
            className="w-auto"
            aria-label="GSTIN"
            value={gstin ?? ''}
            onChange={(e) => url.set({ dgstin: e.target.value })}
          >
            <option value="">All GSTINs</option>
            {regs.map((r) => (
              <option key={r.id} value={r.number}>
                {r.number}
              </option>
            ))}
          </Select>
        )}
        {Object.keys(filters).length > 0 && (
          <button
            type="button"
            className="text-xs text-primary-700 hover:underline"
            onClick={() => url.set({ dstream: null, dfy: null, dperiod: null, dsection: null, dgstin: null })}
          >
            Clear filters
          </button>
        )}
      </div>
      <DocumentsPanel engagementId={engagementId} filters={filters} />
    </section>
  );
}
