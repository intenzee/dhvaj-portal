'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FIRM_CHECK_GROUPS,
  FIRM_CHECK_KEYS,
  RELAXED_FIRM_CHECKS,
  STRICT_FIRM_CHECKS,
  type FirmChecks,
  type UpdateFirmChecksInput,
  type WorkflowSettings,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { fetchWorkflowSettings, WORKFLOW_SETTINGS_KEY } from '@/lib/firm-checks';
import { Button, Spinner } from '@/components/ui';

/**
 * Admin → Checks: the rules the portal can enforce, each switched on when the
 * firm is ready. While a check is off the work goes ahead and the portal warns
 * instead. The managing partner and the administrator switch them (audited);
 * partners see where the firm stands.
 */
export function ChecksSection(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: WORKFLOW_SETTINGS_KEY, queryFn: fetchWorkflowSettings });
  const [draft, setDraft] = useState<FirmChecks | null>(null);
  useEffect(() => {
    if (settings.data) setDraft(settings.data.checks);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => {
      const current = settings.data!.checks;
      const changed = FIRM_CHECK_KEYS.filter((k) => draft![k] !== current[k]);
      const body: UpdateFirmChecksInput = {
        version: settings.data!.version,
        checks: Object.fromEntries(changed.map((k) => [k, draft![k]])),
      };
      return apiFetch<WorkflowSettings>('/workflow-settings/checks', { method: 'PATCH', body });
    },
    onSuccess: (next) => {
      qc.setQueryData(WORKFLOW_SETTINGS_KEY, next);
      void qc.invalidateQueries({ queryKey: WORKFLOW_SETTINGS_KEY });
      toast('Checks saved.');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        void qc.invalidateQueries({ queryKey: WORKFLOW_SETTINGS_KEY });
        toast('Someone else changed the settings; they have been reloaded.', 'error');
        return;
      }
      toast(err instanceof ApiError ? err.message : 'Could not save the checks.', 'error');
    },
  });

  if (settings.isError) {
    return <p className="text-sm text-danger-700">Could not load the firm’s checks.</p>;
  }
  if (settings.isLoading || !draft) return <Spinner label="Loading the firm’s checks…" />;
  const s = settings.data!;
  const editable = s.checksEditable;
  const dirty = FIRM_CHECK_KEYS.some((k) => draft[k] !== s.checks[k]);
  const onCount = FIRM_CHECK_KEYS.filter((k) => s.checks[k]).length;

  return (
    <form
      aria-label="Firm checks"
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-ink">Checks</h2>
        <p className="text-sm text-ink-muted">
          Rules the portal enforces once switched on. While a check is off the work goes ahead, the
          portal shows a warning, and the audit log still records everything.{' '}
          {onCount === 0
            ? 'Every check is off.'
            : `${onCount} of ${FIRM_CHECK_KEYS.length} checks are on.`}{' '}
          {s.updatedByName ? `Settings last changed by ${s.updatedByName}.` : ''}
        </p>
        {!editable && (
          <p className="text-sm text-ink-muted">
            Only the managing partner or the administrator can switch checks.
          </p>
        )}
      </div>

      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setDraft({ ...RELAXED_FIRM_CHECKS })}
          >
            Switch all off
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setDraft({ ...STRICT_FIRM_CHECKS })}
          >
            Switch all on
          </Button>
        </div>
      )}

      {FIRM_CHECK_GROUPS.map((group) => (
        <fieldset key={group.title} className="space-y-3">
          <legend className="text-sm font-semibold text-ink">{group.title}</legend>
          <ul className="divide-y divide-line rounded-md border border-line">
            {group.checks.map((c) => {
              const on = draft[c.key];
              return (
                <li key={c.key} className="flex items-start gap-3 px-3 py-2">
                  <input
                    id={`check-${c.key}`}
                    type="checkbox"
                    className="mt-1"
                    checked={on}
                    disabled={!editable || save.isPending}
                    onChange={(e) => setDraft((d) => (d ? { ...d, [c.key]: e.target.checked } : d))}
                  />
                  <label htmlFor={`check-${c.key}`} className="flex-1 text-sm">
                    <span className="block text-ink">{c.label}</span>
                    <span className="block text-ink-muted">
                      {on ? 'On.' : `Off — ${c.whenOff}`}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      {editable && (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => setDraft(s.checks)}
          >
            Discard
          </Button>
          <Button type="submit" disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save checks'}
          </Button>
        </div>
      )}
    </form>
  );
}
