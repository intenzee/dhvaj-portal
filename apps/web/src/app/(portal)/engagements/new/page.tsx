'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { ENGAGEMENT_STATUS, type Paginated } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { EntityRow } from '@/lib/types';
import { PageHeader, Card, CardBody, Button, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

interface ServiceOption {
  id: string;
  code: string;
  name: string;
}
interface CreatedEngagement {
  id: string;
}

/** Sensible default Indian FY, e.g. "2026-27" (year rolls over in April). */
function currentFinancialYear(): string {
  const d = new Date();
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export default function NewEngagementPage(): JSX.Element {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();

  const [entity, setEntity] = useState<{ id: string; label: string } | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [financialYear, setFinancialYear] = useState(currentFinancialYear());
  const [periodLabel, setPeriodLabel] = useState('FY');
  const [status, setStatus] = useState<string>(ENGAGEMENT_STATUS.accepted);

  const services = useQuery({
    queryKey: ['services', 'all'],
    queryFn: () => apiFetch<Paginated<ServiceOption>>('/services?limit=100'),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<CreatedEngagement>('/engagements', {
        method: 'POST',
        body: {
          entityId: entity!.id,
          serviceId,
          financialYear,
          periodLabel: periodLabel || 'FY',
          status,
        },
      }),
    onSuccess: (data) => {
      toast('Engagement created.');
      qc.invalidateQueries({ queryKey: ['engagements'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      router.push(`/engagements/${data.id}`);
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not create the engagement.', 'error'),
  });

  const canSubmit = !!entity && !!serviceId && /^[0-9]{4}-[0-9]{2}$/.test(financialYear);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Create Engagement" subtitle="Start a new engagement for a client." />
      <Card>
        <CardBody className="space-y-4">
          <Field label="Client entity" required>
            <EntityPicker value={entity} onChange={setEntity} />
          </Field>

          <Field label="Service" required>
            {services.isLoading ? (
              <Spinner label="Loading services…" />
            ) : (
              <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                <option value="">Select a service…</option>
                {(services.data?.items ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Financial year" required hint="Format 2026-27">
              <Input value={financialYear} onChange={(e) => setFinancialYear(e.target.value)} placeholder="2026-27" />
            </Field>
            <Field label="Period" hint="FY, Q1, Apr-2026…">
              <Input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder="FY" />
            </Field>
          </div>

          <Field label="Initial status" hint="Choosing “Accepted” makes you the accountable Engagement Partner.">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value={ENGAGEMENT_STATUS.prospect}>Prospect</option>
              <option value={ENGAGEMENT_STATUS.pendingAcceptance}>Pending Acceptance</option>
              <option value={ENGAGEMENT_STATUS.accepted}>Accepted (you become EP)</option>
            </Select>
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Creating…' : 'Create engagement'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/** Search-and-select a client entity. */
function EntityPicker({
  value,
  onChange,
}: {
  value: { id: string; label: string } | null;
  onChange: (v: { id: string; label: string } | null) => void;
}): JSX.Element {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const q = useQuery({
    queryKey: ['entities', 'pick', debounced],
    queryFn: () =>
      apiFetch<Paginated<EntityRow>>(`/entities?search=${encodeURIComponent(debounced)}&limit=6`),
    enabled: debounced.length >= 2,
  });

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-300 px-3 py-2 text-sm">
        <span className="font-medium text-ink">{value.label}</span>
        <button className="text-xs text-primary-600 hover:underline" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2">
        <Search className="h-4 w-4 text-ink-faint" />
        <input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search clients by name or PAN…"
          className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-pop">
          {q.isFetching && <div className="px-3 py-2 text-sm text-ink-faint">Searching…</div>}
          {q.data && q.data.items.length === 0 && (
            <div className="px-3 py-2 text-sm text-ink-faint">No clients found.</div>
          )}
          {(q.data?.items ?? []).map((e) => (
            <button
              key={e.id}
              onClick={() => {
                onChange({ id: e.id, label: e.legalName });
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left hover:bg-slate-50"
            >
              <span className="block text-sm font-medium text-ink">{e.legalName}</span>
              <span className="block text-xs text-ink-faint">
                {e.entityCode} · {e.typeName}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
