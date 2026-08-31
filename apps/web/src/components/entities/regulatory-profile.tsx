'use client';

/**
 * Read-only Regulatory Profile surface (spec §20–§22). The Add Client module
 * NEVER decides applicability (§32/§35): these results are produced by the
 * downstream versioned Regulatory Applicability Engine from the entity's facts.
 * Until that engine runs, every result is "Not Assessed" — which is explicitly
 * NOT the same as "Not Applicable" (§21). Each row exposes a "View Basis" that,
 * once the engine exists, shows the rule code/version, inputs, thresholds,
 * exceptions checked and conclusion.
 */
import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { EntityDetail } from '@/lib/types';

// The §20 result set the engine will compute.
const RESULTS = [
  'Accounting Framework',
  'SMC',
  'Ind AS',
  'CARO',
  'IFC Reporting',
  'Internal Audit',
  'CSR',
  'Audit Committee',
  'NRC',
  'Independent Directors',
  'Vigil Mechanism',
  'Stakeholders Relationship Committee',
  'Secretarial Audit',
  'Cost Records',
  'Cost Audit',
] as const;

const STATE_TONE: Record<string, string> = {
  not_assessed: 'neutral',
  under_review: 'warn',
  incomplete: 'warn',
  complete: 'success',
  needs_reassessment: 'danger',
};

export function RegulatoryProfile({ entity }: { entity: EntityDetail }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const profileState = entity.regulatoryProfileStatus ?? 'incomplete';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Info className="h-4 w-4 text-primary-500" />
          Calculated downstream by the Regulatory Engine — not decided here (§32).
        </div>
        <Badge tone={STATE_TONE[profileState] ?? 'neutral'}>
          Profile: {label(profileState)}
        </Badge>
      </div>

      <div className="divide-y divide-line rounded-lg border border-line">
        {RESULTS.map((name) => {
          const isOpen = open === name;
          return (
            <div key={name}>
              <button
                onClick={() => setOpen(isOpen ? null : name)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-surface-sunken"
              >
                <span className="font-medium text-ink">{name}</span>
                <span className="flex items-center gap-2">
                  <Badge tone="neutral">Not Assessed</Badge>
                  <ChevronDown className={cn('h-4 w-4 text-ink-faint transition', isOpen && 'rotate-180')} />
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-line/60 bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
                  <p className="mb-1 font-medium text-ink">View Basis</p>
                  <p>
                    No assessment yet. Once the versioned Regulatory Applicability Engine runs, this
                    shows the rule code &amp; version, the inputs and thresholds used, exceptions
                    checked, the conclusion and the calculation timestamp (§22). Insufficient
                    information yields <em>Not Assessed</em> — never <em>Not Applicable</em> (§21).
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function label(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
