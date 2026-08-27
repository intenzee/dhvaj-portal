'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated } from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { ComplianceRow, GovernmentExtension } from '@/lib/types';
import { Button, Spinner } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Textarea } from '@/components/form';

function useExtensionsInvalidate(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['compliance', 'extensions'] });
  };
}

/** Import a government extension (§19) — a firm-wide, append-only overlay record. */
export function CreateExtensionModal({ onClose }: { onClose: () => void }): JSX.Element {
  const toast = useToast();
  const invalidate = useExtensionsInvalidate();

  const [complianceRuleCode, setRuleCode] = useState('');
  const [originalDueDate, setOriginal] = useState('');
  const [revisedDueDate, setRevised] = useState('');
  const [notificationReference, setNotif] = useState('');
  const [applicablePopulation, setPopulation] = useState('');
  const [effectiveDate, setEffective] = useState('');
  const [notes, setNotes] = useState('');

  const codeValid = /^[A-Z0-9_]{2,50}$/.test(complianceRuleCode);
  const datesValid = !originalDueDate || !revisedDueDate || revisedDueDate >= originalDueDate;
  const ready =
    codeValid &&
    !!originalDueDate &&
    !!revisedDueDate &&
    datesValid &&
    notificationReference.trim().length > 0 &&
    applicablePopulation.trim().length > 0 &&
    !!effectiveDate;

  const create = useMutation({
    mutationFn: () =>
      apiFetch<GovernmentExtension>('/compliance-extensions', {
        method: 'POST',
        body: {
          complianceRuleCode: complianceRuleCode.trim().toUpperCase(),
          originalDueDate,
          revisedDueDate,
          notificationReference: notificationReference.trim(),
          applicablePopulation: applicablePopulation.trim(),
          effectiveDate,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast('Government extension imported. Apply it to obligations from the engagement.');
      invalidate();
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not import the extension.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Import government extension"
      description="A revised statutory deadline, stored as an overlay — the original date is retained."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Importing…' : 'Import extension'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="Compliance rule code"
          required
          hint={
            complianceRuleCode && !codeValid ? 'UPPER_SNAKE, 2–50 chars.' : 'The rule this revises.'
          }
        >
          <Input
            value={complianceRuleCode}
            onChange={(e) => setRuleCode(e.target.value.toUpperCase())}
            placeholder="GST_GSTR3B"
            className={complianceRuleCode && !codeValid ? 'border-danger-400' : undefined}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Original due date" required hint="Retained historically.">
            <Input type="date" value={originalDueDate} onChange={(e) => setOriginal(e.target.value)} />
          </Field>
          <Field
            label="Revised due date"
            required
            hint={!datesValid ? 'Must be on/after the original.' : 'The new operative date.'}
          >
            <Input
              type="date"
              value={revisedDueDate}
              onChange={(e) => setRevised(e.target.value)}
              className={!datesValid ? 'border-danger-400' : undefined}
            />
          </Field>
        </div>
        <Field label="Notification reference" required hint="Authority / source.">
          <Input
            value={notificationReference}
            onChange={(e) => setNotif(e.target.value)}
            placeholder="CBIC Notification 01/2026"
          />
        </Field>
        <Field label="Applicable population" required hint="Who the extension applies to.">
          <Input
            value={applicablePopulation}
            onChange={(e) => setPopulation(e.target.value)}
            placeholder="All GSTR-3B filers, turnover ≤ ₹5cr"
          />
        </Field>
        <Field label="Effective date" required hint="When the extension becomes operative.">
          <Input type="date" value={effectiveDate} onChange={(e) => setEffective(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Per-obligation extension controls (§19/§24) for the engagement compliance tab.
 * Open obligations can apply an extension; an already-extended one can clear it.
 * Access is enforced by the API (engagement lead) — errors surface as a toast.
 */
export function ObligationExtensionActions({
  engagementId,
  obligation,
}: {
  engagementId: string;
  obligation: ComplianceRow;
}): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const [applying, setApplying] = useState(false);

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'compliance'] });
    void qc.invalidateQueries({ queryKey: ['compliance'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const clear = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/compliance/${obligation.id}/clear-extension`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      toast('Extension cleared. The obligation reverted to its original date.');
      invalidate();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not clear the extension.', 'error'),
  });

  // Only open obligations are actionable (the API rejects the rest).
  if (obligation.status !== 'open') return null;

  return (
    <div className="flex justify-end gap-1">
      {obligation.isExtended ? (
        <Button size="sm" variant="ghost" disabled={clear.isPending} onClick={() => clear.mutate()}>
          {clear.isPending ? 'Clearing…' : 'Clear extension'}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setApplying(true)}>
          Apply extension
        </Button>
      )}
      {applying && (
        <ApplyExtensionModal
          engagementId={engagementId}
          instanceId={obligation.id}
          ruleCode={obligation.complianceRuleCode}
          ruleName={obligation.complianceRuleName}
          onClose={() => setApplying(false)}
        />
      )}
    </div>
  );
}

/** Pick a matching government extension and apply it to one obligation (§19/§24). */
export function ApplyExtensionModal({
  engagementId,
  instanceId,
  ruleCode,
  ruleName,
  onClose,
}: {
  engagementId: string;
  instanceId: string;
  ruleCode: string;
  ruleName: string;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['compliance', 'extensions', ruleCode],
    queryFn: () =>
      apiFetch<Paginated<GovernmentExtension>>(
        `/compliance-extensions?complianceRuleCode=${encodeURIComponent(ruleCode)}&limit=100`,
      ),
  });

  const apply = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/compliance/${instanceId}/apply-extension`, {
        method: 'POST',
        body: { governmentExtensionId: selected },
      }),
    onSuccess: () => {
      toast('Extension applied. The obligation now uses the revised operative date.');
      qc.invalidateQueries({ queryKey: ['engagement', engagementId, 'compliance'] });
      qc.invalidateQueries({ queryKey: ['compliance'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not apply the extension.', 'error'),
  });

  const items = list.data?.items ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title="Apply government extension"
      description={`Choose a notification that revises “${ruleName}”.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!selected || apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending ? 'Applying…' : 'Apply extension'}
          </Button>
        </>
      }
    >
      {list.isLoading && (
        <div className="p-4">
          <Spinner />
        </div>
      )}
      {list.data && items.length === 0 && (
        <p className="text-sm text-ink-muted">
          No government extensions exist for <span className="font-medium">{ruleCode}</span> yet.
          Import one under Compliance → Configure rules → Extensions.
        </p>
      )}
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => setSelected(x.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                  selected === x.id
                    ? 'border-primary-600 bg-primary-50'
                    : 'border-line-strong bg-surface hover:bg-surface-raised'
                }`}
              >
                <div className="font-medium text-ink">{x.notificationReference}</div>
                <div className="text-xs text-ink-muted">
                  {formatDate(x.originalDueDate)} → {formatDate(x.revisedDueDate)} · effective{' '}
                  {formatDate(x.effectiveDate)}
                </div>
                <div className="text-xs text-ink-faint">{x.applicablePopulation}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
