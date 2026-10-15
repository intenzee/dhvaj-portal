'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ARTICLE_CLIENT_SCOPES,
  ARTICLE_CLIENT_SCOPE_LABEL,
  BULK_ASSIGN_SCOPES,
  BULK_ASSIGN_SCOPE_LABEL,
  DEFAULT_REVIEWERS,
  DEFAULT_REVIEWER_LABEL,
  PERMISSION,
  REMINDER_CHANNEL_SETTINGS,
  REMINDER_CHANNEL_SETTING_LABEL,
  type FormInternalDue,
  type FormInternalDueList,
  type FormInternalDueUpdate,
  type UpdateWorkflowSettingsInput,
  type WorkflowSettings,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { Button, Spinner } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

type Draft = Omit<UpdateWorkflowSettingsInput, 'version'>;

const draftOf = (s: WorkflowSettings): Required<Draft> => ({
  defaultReviewer: s.defaultReviewer,
  articleClientScope: s.articleClientScope,
  clientReminderChannel: s.clientReminderChannel,
  bulkAssignScope: s.bulkAssignScope,
  clientReminderDays: s.clientReminderDays,
  clientEscalationDays: s.clientEscalationDays,
});

/**
 * Admin → Workflow: the plan's five questions for the partners, answered for
 * the firm. Partners (workflow.manage) change them; every change is audited.
 */
export function WorkflowSection(): JSX.Element {
  const { principal } = useAuth();
  const mayManage = can(principal, PERMISSION.workflowManage);
  return (
    <div className="space-y-8">
      <PolicyForm mayManage={mayManage} />
      <div className="border-t border-line pt-6">
        <InternalDueTable mayManage={mayManage} />
      </div>
    </div>
  );
}

function PolicyForm({ mayManage }: { mayManage: boolean }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({
    queryKey: ['workflow-settings'],
    queryFn: () => apiFetch<WorkflowSettings>('/workflow-settings'),
  });
  const [draft, setDraft] = useState<Required<Draft> | null>(null);
  useEffect(() => {
    if (settings.data) setDraft(draftOf(settings.data));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => {
      const current = draftOf(settings.data!);
      const body: Record<string, unknown> = { version: settings.data!.version };
      for (const k of Object.keys(current) as (keyof Draft)[]) {
        if (draft![k] !== current[k]) body[k] = draft![k];
      }
      return apiFetch<WorkflowSettings>('/workflow-settings', { method: 'PATCH', body });
    },
    onSuccess: (next) => {
      qc.setQueryData(['workflow-settings'], next);
      toast('Workflow policy saved.');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        void qc.invalidateQueries({ queryKey: ['workflow-settings'] });
        toast('Someone else changed the policy; it has been reloaded.', 'error');
        return;
      }
      toast(err instanceof ApiError ? err.message : 'Could not save the policy.', 'error');
    },
  });

  if (settings.isLoading || !draft) return <Spinner label="Loading the workflow policy…" />;
  const s = settings.data!;
  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== draftOf(s)[k]);
  const daysInvalid =
    !Number.isInteger(draft.clientReminderDays) ||
    !Number.isInteger(draft.clientEscalationDays) ||
    draft.clientReminderDays < 0 ||
    draft.clientEscalationDays < 0 ||
    draft.clientEscalationDays > draft.clientReminderDays;
  const set = <K extends keyof Draft>(k: K, v: Required<Draft>[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <form
      aria-label="Workflow policy"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <h2 className="text-base font-semibold text-ink">Workflow policy</h2>
        <p className="text-sm text-ink-muted">
          How the firm’s work moves. {s.updatedByName ? `Last changed by ${s.updatedByName}.` : ''}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Default reviewer"
          hint="Who reviews a task sent for review without a reviewer named. Never the preparer."
        >
          <Select
            value={draft.defaultReviewer}
            disabled={!mayManage}
            onChange={(e) =>
              set('defaultReviewer', e.target.value as Required<Draft>['defaultReviewer'])
            }
          >
            {DEFAULT_REVIEWERS.map((r) => (
              <option key={r} value={r}>
                {DEFAULT_REVIEWER_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Clients an article sees">
          <Select
            value={draft.articleClientScope}
            disabled={!mayManage}
            onChange={(e) =>
              set('articleClientScope', e.target.value as Required<Draft>['articleClientScope'])
            }
          >
            {ARTICLE_CLIENT_SCOPES.map((r) => (
              <option key={r} value={r}>
                {ARTICLE_CLIENT_SCOPE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Client reminders go by">
          <Select
            value={draft.clientReminderChannel}
            disabled={!mayManage}
            onChange={(e) =>
              set(
                'clientReminderChannel',
                e.target.value as Required<Draft>['clientReminderChannel'],
              )
            }
          >
            {REMINDER_CHANNEL_SETTINGS.map((r) => (
              <option key={r} value={r}>
                {REMINDER_CHANNEL_SETTING_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Who may bulk-assign a filing run">
          <Select
            value={draft.bulkAssignScope}
            disabled={!mayManage}
            onChange={(e) =>
              set('bulkAssignScope', e.target.value as Required<Draft>['bulkAssignScope'])
            }
          >
            {BULK_ASSIGN_SCOPES.map((r) => (
              <option key={r} value={r}>
                {BULK_ASSIGN_SCOPE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Remind the client (days before internal due)">
          <Input
            type="number"
            min={0}
            max={60}
            value={draft.clientReminderDays}
            disabled={!mayManage}
            onChange={(e) => set('clientReminderDays', e.target.valueAsNumber)}
          />
        </Field>
        <Field
          label="Escalate to the stream lead (days before internal due)"
          hint="No more than the reminder days."
        >
          <Input
            type="number"
            min={0}
            max={60}
            value={draft.clientEscalationDays}
            disabled={!mayManage}
            onChange={(e) => set('clientEscalationDays', e.target.valueAsNumber)}
          />
        </Field>
      </div>
      {mayManage && (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => setDraft(draftOf(s))}
          >
            Discard
          </Button>
          <Button type="submit" disabled={!dirty || daysInvalid || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save policy'}
          </Button>
        </div>
      )}
    </form>
  );
}

function InternalDueTable({ mayManage }: { mayManage: boolean }): JSX.Element {
  const list = useQuery({
    queryKey: ['workflow-settings', 'internal-due'],
    queryFn: () => apiFetch<FormInternalDueList>('/workflow-settings/internal-due'),
  });
  if (list.isLoading) return <Spinner label="Loading the forms…" />;
  const items = list.data?.items ?? [];
  return (
    <section aria-labelledby="internal-due-heading" className="space-y-3">
      <div>
        <h2 id="internal-due-heading" className="text-base font-semibold text-ink">
          Internal due date per form
        </h2>
        <p className="text-sm text-ink-muted">
          Days before the statutory date the firm wants each form done, moved back to a working day.
          Changing one re-dates its open filings, except those with a date set by hand.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-ink-faint">
          <tr>
            <th className="py-2 pr-3 font-medium">Form</th>
            <th className="py-2 pr-3 font-medium">Stream</th>
            <th className="py-2 pr-3 font-medium">Days before</th>
            <th className="py-2 pr-3 font-medium">Suggested</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((f) => (
            <InternalDueRow key={f.ruleId} form={f} mayManage={mayManage} />
          ))}
        </tbody>
      </table>
      {items.length === 0 && <p className="text-sm text-ink-muted">No compliance forms yet.</p>}
    </section>
  );
}

function InternalDueRow({
  form,
  mayManage,
}: {
  form: FormInternalDue;
  mayManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState(form.internalSlaOffsetDays);
  useEffect(() => setDays(form.internalSlaOffsetDays), [form.internalSlaOffsetDays]);
  const save = useMutation({
    mutationFn: (value: number) =>
      apiFetch<FormInternalDueUpdate>(`/workflow-settings/internal-due/${form.ruleId}`, {
        method: 'PATCH',
        body: { internalSlaOffsetDays: value },
      }),
    onSuccess: (res) => {
      qc.setQueryData<FormInternalDueList>(['workflow-settings', 'internal-due'], (old) =>
        old ? { items: old.items.map((i) => (i.ruleId === res.item.ruleId ? res.item : i)) } : old,
      );
      toast(
        `${res.item.label}: T-${res.item.internalSlaOffsetDays}. ${
          res.filingsRedated === 1 ? '1 open filing' : `${res.filingsRedated} open filings`
        } re-dated.`,
      );
    },
    onError: (err) =>
      toast(
        err instanceof ApiError ? err.message : 'Could not set the internal due date.',
        'error',
      ),
  });
  const valid = Number.isInteger(days) && days >= 0 && days <= 60;
  const changed = days !== form.internalSlaOffsetDays;
  return (
    <tr className="border-t border-line">
      <td className="py-2 pr-3 font-medium text-ink">{form.label}</td>
      <td className="py-2 pr-3 uppercase text-ink-muted">{form.stream ?? '—'}</td>
      <td className="py-2 pr-3">
        {mayManage ? (
          <Input
            type="number"
            min={0}
            max={60}
            className="w-20"
            aria-label={`Days before for ${form.label}`}
            value={Number.isNaN(days) ? '' : days}
            onChange={(e) => setDays(e.target.valueAsNumber)}
          />
        ) : (
          `T-${form.internalSlaOffsetDays}`
        )}
      </td>
      <td className="py-2 pr-3 text-ink-muted">
        {form.suggestedDays === null ? '—' : `T-${form.suggestedDays}`}
      </td>
      <td className="py-2 text-right">
        {mayManage && (
          <div className="flex justify-end gap-2">
            {form.suggestedDays !== null && form.suggestedDays !== form.internalSlaOffsetDays && (
              <Button
                size="sm"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => save.mutate(form.suggestedDays!)}
              >
                Use suggested
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={!changed || !valid || save.isPending}
              onClick={() => save.mutate(days)}
              aria-label={`Save ${form.label}`}
            >
              Save
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
