'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Pencil, Play, Plus, Repeat, X } from 'lucide-react';
import {
  PERMISSION,
  type ComponentDiscoveryResult,
  type ComponentDiscoveryCategory,
  type ComponentConfigStatus,
  type EngagementComponentRecord,
  type EngagementServiceLine,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize, formatDate } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Card, EmptyState, Badge, Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { EditComponentModal } from '@/components/actions/edit-component-modal';
import { ChangeFrequencyModal } from '@/components/actions/change-frequency-modal';
import { ComponentChecklistModal } from '@/components/actions/component-checklist-modal';

const CATEGORY_TONE: Record<ComponentDiscoveryCategory, string> = {
  mandatory: 'info',
  applicable: 'success',
  optional: 'neutral',
  pending_review: 'warn',
  not_applicable: 'neutral',
};

const STATUS_TONE: Record<ComponentConfigStatus, string> = {
  draft: 'neutral',
  active: 'success',
  on_hold: 'warn',
  completed: 'info',
  cancelled: 'danger',
  superseded: 'neutral',
};

/**
 * Scope & Components (spec §11–§13, §16, §24): the configured components on an
 * engagement, plus a discovery drawer that categorises the service catalogue
 * (mandatory / applicable / optional) and lets a lead select and remove scope.
 */
export function ComponentsSection({
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
  const [editing, setEditing] = useState<EngagementComponentRecord | null>(null);
  const [freqChanging, setFreqChanging] = useState<EngagementComponentRecord | null>(null);
  const [checklistFor, setChecklistFor] = useState<EngagementComponentRecord | null>(null);

  // The service lines a caller can scope components under (live only), primary first.
  const lines = services.filter((s) => s.status !== 'cancelled');
  const primaryLineId = lines.find((s) => s.isPrimary)?.id ?? lines[0]?.id ?? '';
  const [lineId, setLineId] = useState(primaryLineId);
  // Keep the selection valid if the set of lines changes.
  const activeLineId = lines.some((s) => s.id === lineId) ? lineId : primaryLineId;
  const multiService = lines.length > 1;

  const configured = useQuery({
    queryKey: ['engagement', engagementId, 'components'],
    queryFn: () =>
      apiFetch<Paginated<EngagementComponentRecord>>(`/engagements/${engagementId}/components?limit=100`),
  });

  const discovery = useQuery({
    queryKey: ['engagement', engagementId, 'components', 'discovery', activeLineId],
    queryFn: () =>
      apiFetch<ComponentDiscoveryResult>(
        `/engagements/${engagementId}/components/discovery?engagementServiceId=${activeLineId}`,
      ),
    enabled: open,
  });

  const invalidate = (): void => {
    // Broaden to the whole engagement: removing/adding scope also affects the
    // component-work list (a sibling query key), not just the component list.
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  };

  const configure = useMutation({
    mutationFn: (serviceComponentCode: string) =>
      apiFetch(`/engagements/${engagementId}/components`, {
        method: 'POST',
        body: { serviceComponentCode, engagementServiceId: activeLineId },
      }),
    onSuccess: () => {
      toast('Component added to scope.');
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not add component.', 'error'),
  });

  const remove = useMutation({
    mutationFn: (componentId: string) =>
      apiFetch(`/engagements/${engagementId}/components/${componentId}/remove`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      toast('Component removed from scope.');
      invalidate();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not remove component.', 'error'),
  });

  // §20/§37 — the gated, atomic activation ceremony.
  const activate = useMutation({
    mutationFn: () =>
      apiFetch<{ activatedComponents: number; generated: number; removed: number }>(
        `/engagements/${engagementId}/activate`,
        { method: 'POST', body: {} },
      ),
    onSuccess: (r) => {
      toast(
        `Activated: ${r.activatedComponents} component${r.activatedComponents === 1 ? '' : 's'}, ${r.generated} work item${r.generated === 1 ? '' : 's'} generated.`,
      );
      invalidate();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not activate the engagement.', 'error'),
  });

  const allItems = configured.data?.items ?? [];
  // In a multi-service engagement, scope the table to the selected service line.
  const items = multiService
    ? allItems.filter((c) => c.engagementServiceId === activeLineId)
    : allItems;
  const activeLine = lines.find((s) => s.id === activeLineId);

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">Scope &amp; components</h2>
        <div className="flex items-center gap-2">
          {multiService && (
            <select
              value={activeLineId}
              onChange={(e) => setLineId(e.target.value)}
              aria-label="Service line"
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs text-ink focus:border-primary-500 focus:outline-none"
            >
              {lines.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.serviceName}
                  {s.isPrimary ? ' (primary)' : ''}
                </option>
              ))}
            </select>
          )}
          {canManage && (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> Discover &amp; add
            </Button>
          )}
          {canManage && (
            <Button
              size="sm"
              onClick={() => activate.mutate()}
              disabled={activate.isPending || items.length === 0}
              title="Confirm scope, activate draft components and generate work"
            >
              <Play className="h-4 w-4" /> {activate.isPending ? 'Activating…' : 'Activate'}
            </Button>
          )}
        </div>
      </div>
      <Card className="overflow-hidden p-0">
        {configured.isSuccess && items.length === 0 && (
          <div className="p-5">
            <EmptyState>
              No components configured yet. {canManage && 'Use “Discover & add” to select scope.'}
            </EmptyState>
          </div>
        )}
        {items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-raised/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-semibold">Component</th>
                <th className="px-4 py-2.5 font-semibold">Applicability</th>
                <th className="px-4 py-2.5 font-semibold">Frequency</th>
                <th className="px-4 py-2.5 font-semibold">Owner</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const removed = c.status === 'cancelled' || c.status === 'superseded';
                return (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-ink">{c.componentName}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={CATEGORY_TONE[c.applicabilityStatus] ?? 'neutral'}>
                        {humanize(c.applicabilityStatus)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{humanize(c.frequency)}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{c.ownerName ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{humanize(c.status)}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                        {!removed && (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setChecklistFor(c)}
                              className="rounded p-0.5 text-ink-faint hover:bg-surface-sunken hover:text-ink"
                              aria-label={`Checklist for ${c.componentName}`}
                              title="Checklist"
                            >
                              <ListChecks className="h-3.5 w-3.5" />
                            </button>
                            {canManage && (
                            <button
                              onClick={() => setFreqChanging(c)}
                              className="rounded p-0.5 text-ink-faint hover:bg-surface-sunken hover:text-ink"
                              aria-label={`Change frequency of ${c.componentName}`}
                              title="Change frequency"
                            >
                              <Repeat className="h-3.5 w-3.5" />
                            </button>
                            )}
                            {canManage && (
                            <button
                              onClick={() => setEditing(c)}
                              className="rounded p-0.5 text-ink-faint hover:bg-surface-sunken hover:text-ink"
                              aria-label={`Configure ${c.componentName}`}
                              title="Configure"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            )}
                            {canManage && (
                            <button
                              onClick={() => remove.mutate(c.id)}
                              disabled={remove.isPending}
                              className="rounded p-0.5 text-ink-faint hover:bg-surface-sunken hover:text-danger-600"
                              aria-label={`Remove ${c.componentName}`}
                              title="Remove from scope"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                            )}
                          </div>
                        )}
                      </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Discover components"
        description={`Applicable components for ${
          activeLine ? `the “${activeLine.serviceName}” service` : 'this engagement’s service'
        }. The system recommends; you confirm the scope.`}
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Done
          </Button>
        }
      >
        {discovery.isLoading && <p className="text-sm text-ink-faint">Running discovery…</p>}
        {discovery.isError && (
          <p className="text-sm text-danger-600">Could not run discovery.</p>
        )}
        {discovery.data && (
          <div className="space-y-2">
            {discovery.data.rows.length === 0 && (
              <EmptyState>No components are defined for this service yet.</EmptyState>
            )}
            {discovery.data.rows.map((r) => (
              <div
                key={r.serviceComponentId}
                className="flex items-start justify-between gap-3 rounded-lg border border-line-strong p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{r.name}</span>
                    <Badge tone={CATEGORY_TONE[r.category] ?? 'neutral'}>{humanize(r.category)}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">{r.reason}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {humanize(r.frequency)}
                    {r.statutoryDeadlinePreview
                      ? ` · statutory ${formatDate(r.statutoryDeadlinePreview)}`
                      : ''}
                    {r.internalDeadlinePreview
                      ? ` · internal ${formatDate(r.internalDeadlinePreview)}`
                      : ''}
                  </p>
                </div>
                <div className="shrink-0">
                  {r.alreadyConfigured ? (
                    <Badge tone="success">Added</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={configure.isPending}
                      onClick={() => configure.mutate(r.code)}
                    >
                      Add
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {editing && (
        <EditComponentModal
          engagementId={engagementId}
          component={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {freqChanging && (
        <ChangeFrequencyModal
          engagementId={engagementId}
          component={freqChanging}
          onClose={() => setFreqChanging(null)}
        />
      )}

      {checklistFor && (
        <ComponentChecklistModal
          engagementId={engagementId}
          componentId={checklistFor.id}
          componentName={checklistFor.componentName}
          onClose={() => setChecklistFor(null)}
        />
      )}
    </section>
  );
}
