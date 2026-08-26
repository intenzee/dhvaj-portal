'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COMPONENT_APPLICABILITY_DEFAULTS,
  RECURRENCES,
  PERMISSION,
  type ComponentApplicabilityDefault,
  type Recurrence,
  type ServiceComponentRecord,
  type Paginated,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import type { ServiceRow } from '@/lib/types';
import { PageHeader, Spinner, Card, EmptyState, Badge, Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Select, Textarea } from '@/components/form';

/** Firm-wide component catalogue management (spec §11/§13; gated service.manage). */
export default function ComponentCataloguePage(): JSX.Element {
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.serviceManage);
  const [serviceCode, setServiceCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServiceComponentRecord | null>(null);

  const services = useQuery({
    queryKey: ['services', 'all'],
    queryFn: () => apiFetch<Paginated<ServiceRow>>('/services?limit=100'),
  });
  const components = useQuery({
    queryKey: ['service-components', serviceCode],
    queryFn: () =>
      apiFetch<Paginated<ServiceComponentRecord>>(
        `/service-components?limit=100${serviceCode ? `&serviceCode=${serviceCode}` : ''}`,
      ),
  });

  const items = components.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Component catalogue"
        subtitle="The scopes/obligations available under each service — discovery and configuration draw from here."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/services"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-slate-50"
            >
              ← Services
            </Link>
            {canManage && <Button onClick={() => setCreating(true)}>New component</Button>}
          </div>
        }
      />

      <div className="mb-4 max-w-xs">
        <Select value={serviceCode} onChange={(e) => setServiceCode(e.target.value)}>
          <option value="">All services</option>
          {(services.data?.items ?? []).map((s) => (
            <option key={s.id} value={s.code}>
              {s.code} — {s.name}
            </option>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden p-0">
        {components.isLoading && (
          <div className="p-5">
            <Spinner />
          </div>
        )}
        {components.isSuccess && items.length === 0 && (
          <div className="p-5">
            <EmptyState>No components defined for this filter.</EmptyState>
          </div>
        )}
        {items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-semibold">Code</th>
                <th className="px-4 py-2.5 font-semibold">Component</th>
                <th className="px-4 py-2.5 font-semibold">Service</th>
                <th className="px-4 py-2.5 font-semibold">Applicability</th>
                <th className="px-4 py-2.5 font-semibold">Frequency</th>
                <th className="px-4 py-2.5 font-semibold">Rule</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                {canManage && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-primary-700">{c.code}</td>
                  <td className="px-4 py-2.5 text-ink">{c.name}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{c.serviceCode}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={c.defaultApplicability === 'mandatory' ? 'info' : 'neutral'}>
                      {humanize(c.defaultApplicability)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{humanize(c.defaultFrequency)}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{c.complianceRuleCode ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {c.isActive ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Inactive</Badge>
                    )}
                  </td>
                  {canManage && (
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                        Edit
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {creating && (
        <ComponentFormModal
          services={services.data?.items ?? []}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && <ComponentFormModal component={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Create (no `component`) or edit a catalogue component. */
function ComponentFormModal({
  component,
  services,
  onClose,
}: {
  component?: ServiceComponentRecord;
  services?: ServiceRow[];
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const isEdit = Boolean(component);

  const [serviceCode, setServiceCode] = useState(services?.[0]?.code ?? '');
  const [code, setCode] = useState('');
  const [name, setName] = useState(component?.name ?? '');
  const [description, setDescription] = useState(component?.description ?? '');
  const [defaultApplicability, setApplicability] = useState<ComponentApplicabilityDefault>(
    component?.defaultApplicability ?? 'optional',
  );
  const [defaultFrequency, setFrequency] = useState<Recurrence>(
    component?.defaultFrequency ?? 'as_required',
  );
  const [complianceRuleCode, setRuleCode] = useState(component?.complianceRuleCode ?? '');
  const [displayOrder, setDisplayOrder] = useState(String(component?.displayOrder ?? 0));
  const [isActive, setIsActive] = useState(component?.isActive ?? true);

  const save = useMutation({
    mutationFn: () => {
      if (isEdit && component) {
        return apiFetch(`/service-components/${component.id}`, {
          method: 'PATCH',
          body: {
            name,
            description: description.trim() === '' ? null : description,
            defaultApplicability,
            defaultFrequency,
            complianceRuleCode: complianceRuleCode.trim() === '' ? null : complianceRuleCode,
            displayOrder: Number(displayOrder) || 0,
            isActive,
          },
        });
      }
      return apiFetch('/service-components', {
        method: 'POST',
        body: {
          serviceCode,
          code,
          name,
          description: description.trim() === '' ? undefined : description,
          defaultApplicability,
          defaultFrequency,
          complianceRuleCode: complianceRuleCode.trim() === '' ? undefined : complianceRuleCode,
          displayOrder: Number(displayOrder) || 0,
        },
      });
    },
    onSuccess: () => {
      toast(isEdit ? 'Component updated.' : 'Component created.');
      void qc.invalidateQueries({ queryKey: ['service-components'] });
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not save.', 'error'),
  });

  const canSubmit = isEdit ? name.trim() !== '' : serviceCode !== '' && code.trim() !== '' && name.trim() !== '';

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit ${component!.code}` : 'New component'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!isEdit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Service" required>
              <Select value={serviceCode} onChange={(e) => setServiceCode(e.target.value)}>
                <option value="">Select…</option>
                {(services ?? []).map((s) => (
                  <option key={s.id} value={s.code}>
                    {s.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Code" required>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="GSTR1"
              />
            </Field>
          </div>
        )}
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default applicability">
            <Select
              value={defaultApplicability}
              onChange={(e) => setApplicability(e.target.value as ComponentApplicabilityDefault)}
            >
              {COMPONENT_APPLICABILITY_DEFAULTS.map((a) => (
                <option key={a} value={a}>
                  {humanize(a)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default frequency">
            <Select
              value={defaultFrequency}
              onChange={(e) => setFrequency(e.target.value as Recurrence)}
            >
              {RECURRENCES.map((r) => (
                <option key={r} value={r}>
                  {humanize(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Compliance rule code">
            <Input
              value={complianceRuleCode}
              onChange={(e) => setRuleCode(e.target.value)}
              placeholder="(optional)"
            />
          </Field>
          <Field label="Display order">
            <Input
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
            />
          </Field>
        </div>
        {isEdit && (
          <Field label="Status">
            <Select value={isActive ? 'active' : 'inactive'} onChange={(e) => setIsActive(e.target.value === 'active')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
