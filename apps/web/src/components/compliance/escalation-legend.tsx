'use client';

import { ESCALATION_LADDER } from '@hsdg/contracts';
import { Badge, Card } from '@/components/ui';

/** Humanise an escalation action code, e.g. escalate_partner → "Escalate to partner". */
const ACTION_LABEL: Record<string, string> = {
  monitor: 'Monitor — no alert',
  notify_owner: 'Notify owner',
  alert_manager: 'Alert owner + manager',
  escalate_partner: 'Escalate to partner',
  escalate_firm: 'Escalate to firm',
};

/**
 * The §24 escalation ladder as a legend: each band's colour, its distinct action,
 * and who it reaches. Sourced from the shared `ESCALATION_LADDER` so it never
 * drifts from the API's escalation classification or the notification engine.
 */
export function EscalationLegend(): JSX.Element {
  return (
    <Card className="p-4">
      <h2 className="mb-1 text-sm font-semibold text-ink">Escalation ladder (§24)</h2>
      <p className="mb-3 text-xs text-ink-faint">
        Each band on an open obligation triggers a distinct action addressed to a distinct tier.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {ESCALATION_LADDER.map((band) => (
          <li key={band.level} className="flex items-start gap-2">
            <Badge tone={band.tone}>{band.label}</Badge>
            <span className="text-xs leading-5 text-ink-muted">
              <span className="font-medium text-ink">
                {ACTION_LABEL[band.action] ?? band.action}
              </span>
              {band.recipients.length > 0 && (
                <span className="text-ink-faint"> · {band.recipients.join(' → ')}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
