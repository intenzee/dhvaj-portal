'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  NOTIFICATION_DELIVERIES,
  type NotificationDelivery,
  type NotificationPreference,
  type NotificationType,
} from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Card, Spinner } from '@/components/ui';
import { Select } from '@/components/form';
import { DELIVERY_LABEL } from './notifications-model';

export const preferencesKey = ['notifications', 'preferences'] as const;

/**
 * WF-305 — where each notification type reaches me. Informational types can go
 * to the bell, the daily digest (the default) or nowhere; a type that needs
 * action always reaches the bell, so it is listed but fixed.
 */
export function NotificationSettings(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const prefs = useQuery({
    queryKey: preferencesKey,
    queryFn: () => apiFetch<NotificationPreference[]>('/notifications/preferences'),
  });
  const save = useMutation({
    mutationFn: (item: { type: NotificationType; delivery: NotificationDelivery }) =>
      apiFetch<NotificationPreference[]>('/notifications/preferences', {
        method: 'PUT',
        body: { items: [item] },
      }),
    onSuccess: (next) => {
      qc.setQueryData(preferencesKey, next);
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      toast('Saved.');
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not save.', 'error'),
  });

  if (prefs.isLoading) return <Spinner label="Loading settings…" />;
  const items = prefs.data ?? [];
  const informational = items.filter((p) => p.editable);
  const actionable = items.filter((p) => !p.editable);

  return (
    <div className="space-y-5">
      <section aria-label="Updates">
        <h2 className="mb-1 text-sm font-semibold text-ink">Updates</h2>
        <p className="mb-2 text-sm text-ink-muted">
          Worth knowing, nothing to do. They go to the daily digest unless you choose otherwise.
        </p>
        <Card className="divide-y divide-line">
          {informational.map((p) => (
            <label key={p.type} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-sm text-ink">{p.label}</span>
              <Select
                aria-label={p.label}
                value={p.delivery}
                disabled={save.isPending}
                className="w-40"
                onChange={(e) =>
                  save.mutate({ type: p.type, delivery: e.target.value as NotificationDelivery })
                }
              >
                {NOTIFICATION_DELIVERIES.map((d) => (
                  <option key={d} value={d}>
                    {DELIVERY_LABEL[d]}
                  </option>
                ))}
              </Select>
            </label>
          ))}
        </Card>
      </section>
      <section aria-label="Needs action">
        <h2 className="mb-1 text-sm font-semibold text-ink">Needs action</h2>
        <p className="mb-2 text-sm text-ink-muted">
          Always in the bell. Each clears itself when the work is done.
        </p>
        <Card className="divide-y divide-line">
          {actionable.map((p) => (
            <div key={p.type} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-sm text-ink">{p.label}</span>
              <span className="text-xs text-ink-faint">Bell</span>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
