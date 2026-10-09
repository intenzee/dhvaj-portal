'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, CircleDashed, MinusCircle } from 'lucide-react';
import {
  DOWNSTREAM_STATUS_LABEL,
  type DownstreamStatus,
  type FinancialReportingDownstreamView,
  type FrameworkDownstreamItem,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Badge, Spinner } from '@/components/ui';

const STATUS_TONE: Record<DownstreamStatus, string> = {
  pending: 'neutral',
  activated: 'success',
  withdrawn: 'warn',
};

const STATUS_ICON: Record<DownstreamStatus, JSX.Element> = {
  pending: <CircleDashed className="h-4 w-4 shrink-0 text-ink-faint" />,
  activated: <CheckCircle2 className="h-4 w-4 shrink-0 text-success-700" />,
  withdrawn: <MinusCircle className="h-4 w-4 shrink-0 text-warning-700" />,
};

/**
 * 02.2 "Downstream impact" (DHVAJ 02.2 spec §5, §19): what the current
 * conclusion activates in 02.3 and the later audit work — the Schedule III
 * Division 02.3 routes to, the Ind AS / AS review framework, the SMC
 * relaxations the AS review applies and the Ind AS 101 transition work. Each
 * shows whether it is live (Section 02 approved) or activates on approval.
 */
export function FinancialReportingDownstream({
  engagementId,
  workflowInstanceId,
}: {
  engagementId: string;
  workflowInstanceId: string;
}): JSX.Element {
  const q = useQuery({
    queryKey: ['engagement', engagementId, 'financial-reporting-downstream', workflowInstanceId],
    queryFn: () =>
      apiFetch<FinancialReportingDownstreamView>(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/financial-reporting/downstream`,
      ),
  });
  if (q.isLoading) return <Spinner label="Loading downstream impact…" />;
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-danger-700">
        {q.error instanceof ApiError ? q.error.message : 'Could not load the downstream impact.'}
      </p>
    );
  }
  const v = q.data;
  if (v.items.length === 0) {
    return (
      <p className="text-xs text-ink-faint">
        Nothing activates yet — the downstream impact shows once 02.2 reaches a conclusion.
      </p>
    );
  }
  return (
    <div className="space-y-2" aria-label="Downstream impact">
      <p className="text-xs text-ink-muted">
        {v.approved
          ? 'Section 02 is approved — these are live in 02.3 and the audit work.'
          : 'These activate when Section 02 is approved (02.9).'}
        {v.scheduleIiiDivision && (
          <>
            {' '}
            02.3 routes to{' '}
            <span className="font-medium text-ink">
              Schedule III Division {v.scheduleIiiDivision}
            </span>
            .
          </>
        )}
      </p>
      <ul className="space-y-1.5">
        {v.items.map((item) => (
          <DownstreamRow key={item.key} item={item} />
        ))}
      </ul>
    </div>
  );
}

function DownstreamRow({ item }: { item: FrameworkDownstreamItem }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-line bg-surface p-2 text-xs">
      <div className="flex items-start gap-2">
        {STATUS_ICON[item.status]}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={
                item.status === 'withdrawn' ? 'text-ink-muted line-through' : 'font-medium text-ink'
              }
            >
              {item.title}
            </span>
            <Badge tone={STATUS_TONE[item.status]}>
              {item.managedBy02_2 ? 'Raised in 02.2' : DOWNSTREAM_STATUS_LABEL[item.status]}
            </Badge>
            <span className="inline-flex items-center gap-0.5 text-[11px] text-ink-faint">
              <ArrowRight className="h-3 w-3" /> {item.target}
            </span>
          </div>
          <p className="text-ink-muted">{item.detail}</p>
          {item.activatedAt && (
            <p className="text-[11px] text-ink-faint">
              {item.status === 'withdrawn' ? 'Was activated' : 'Activated'}{' '}
              {formatDate(item.activatedAt)}
              {item.activatedByName ? ` · ${item.activatedByName}` : ''}
            </p>
          )}
          {item.relaxations.length > 0 && (
            <div className="mt-1">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="text-[11px] font-medium text-primary-600 hover:underline"
              >
                {open ? 'Hide' : 'Show'} the {item.relaxations.length} SMC exemptions and
                relaxations
              </button>
              {open && (
                <ul className="mt-1 space-y-1 border-l-2 border-line pl-2">
                  {item.relaxations.map((r) => (
                    <li key={r.key}>
                      <span className="font-medium text-ink">{r.standardLabel}</span>
                      {r.paragraphs && (
                        <span className="text-ink-faint"> · paras {r.paragraphs}</span>
                      )}
                      <span className="block text-ink-muted">{r.relaxation}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {item.key === 'smc_relaxations' && item.relaxations.length === 0 && (
            <p className="text-[11px] text-warning-700">
              The methodology library holds no SMC relaxations in force for this audit period.
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
