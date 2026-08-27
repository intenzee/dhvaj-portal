'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Star, X } from 'lucide-react';
import { PERMISSION, type EngagementServiceLine, type Paginated } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Card, Badge, Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Select } from '@/components/form';

interface ServiceOption {
  id: string;
  code: string;
  name: string;
  serviceLineName: string;
}

const STATUS_TONE: Record<string, string> = {
  prospect: 'neutral',
  active: 'success',
  on_hold: 'warn',
  completed: 'info',
  cancelled: 'danger',
};

/**
 * Service lines carried by an engagement (multi-service, §9–§10). Lists every
 * service (primary first), lets a lead add another service from the catalogue,
 * and remove a non-primary one (soft-cancel; the primary cannot be removed).
 */
export function ServicesSection({
  engagementId,
  services,
}: {
  engagementId: string;
  services: EngagementServiceLine[];
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState('');

  const catalogue = useQuery({
    queryKey: ['services', 'all'],
    queryFn: () => apiFetch<Paginated<ServiceOption>>('/services?limit=100'),
    enabled: open,
  });

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  };

  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/services`, {
        method: 'POST',
        body: { serviceId },
      }),
    onSuccess: () => {
      toast('Service added to the engagement.');
      setOpen(false);
      setServiceId('');
      invalidate();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not add the service.', 'error'),
  });

  const remove = useMutation({
    mutationFn: (serviceLineId: string) =>
      apiFetch(`/engagements/${engagementId}/services/${serviceLineId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Service removed from the engagement.');
      invalidate();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not remove the service.', 'error'),
  });

  // Services already on the engagement (live) — hide them from the add picker.
  const liveServiceIds = new Set(
    services.filter((s) => s.status !== 'cancelled').map((s) => s.serviceId),
  );
  const addable = (catalogue.data?.items ?? []).filter((s) => !liveServiceIds.has(s.id));
  const visible = services.filter((s) => s.status !== 'cancelled');

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Services</h2>
        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add service
          </Button>
        )}
      </div>
      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-semibold">Service</th>
              <th className="px-4 py-2.5 font-semibold">Office</th>
              <th className="px-4 py-2.5 font-semibold">Lead</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              {canManage && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.id} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2.5 text-ink">
                  <span className="inline-flex items-center gap-1.5">
                    {s.isPrimary && (
                      <Star className="h-3.5 w-3.5 text-amber-500" aria-label="Primary service" />
                    )}
                    {s.serviceName}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-muted">{s.officeCode}</td>
                <td className="px-4 py-2.5 text-ink-muted">{s.leadEmployeeName ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{humanize(s.status)}</Badge>
                </td>
                {canManage && (
                  <td className="px-4 py-2.5 text-right">
                    {!s.isPrimary && (
                      <button
                        onClick={() => remove.mutate(s.id)}
                        disabled={remove.isPending}
                        className="rounded p-0.5 text-ink-faint hover:bg-slate-100 hover:text-danger-600"
                        aria-label={`Remove ${s.serviceName}`}
                        title="Remove service"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Add a service">
        <div className="space-y-4">
          <Field label="Service">
            <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Select a service…</option>
              {addable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.serviceLineName}
                </option>
              ))}
            </Select>
          </Field>
          {catalogue.isSuccess && addable.length === 0 && (
            <p className="text-sm text-ink-muted">
              Every catalogue service is already on this engagement.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => add.mutate()} disabled={!serviceId || add.isPending}>
              Add service
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
