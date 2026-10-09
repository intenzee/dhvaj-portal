'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, RefreshCw } from 'lucide-react';
import {
  COMPLETENESS_STATUS_LABEL,
  PERMISSION,
  type CompletenessStatus,
  type SmallCompanyOutcome,
  type SpecialEntityType,
  type StatutoryAuditEntityProfile,
  type StatutoryAuditEntityProfileMasterFillResult,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card } from '@/components/ui';
import { ExpandToggle } from '@/components/inline-panel';
import { FixLink, MasterFactList } from './master-fact-list';
import { EntityProfileWorkspace } from './entity-profile-workspace';

/**
 * 02.1 Entity & Regulatory Profile (DHVAJ 02.1 spec §2). The header carries the
 * subtitle, the profile status, Card J's completeness and who manages / last
 * prepared it, above the facts pre-populated from the client master with their
 * source. `+` opens the full workspace (Cards A–J, context panel, Save Draft /
 * CONFIRM PROFILE) in place, directly under the header.
 */

const SPECIAL_LABEL: Record<SpecialEntityType, string> = {
  bank: 'Banking company',
  insurance: 'Insurance company',
  nbfc: 'NBFC',
  hfc: 'Housing finance company',
  section_8: 'Section 8 company',
  government: 'Government company',
  nidhi: 'Nidhi company',
  producer: 'Producer company',
  dormant: 'Dormant company',
  other_regulator: 'Other regulator',
};

const SMALL_LABEL: Record<SmallCompanyOutcome, string> = {
  small: 'Small company',
  not_small: 'Not a small company',
  not_applicable: 'Not applicable',
  pending: 'Pending information',
};

const COMPLETENESS_TONE: Record<CompletenessStatus, string> = {
  complete: 'success',
  information_incomplete: 'warn',
  attention_required: 'danger',
};

export function EntityProfileCard({ engagementId }: { engagementId: string }): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);
  const canAdmin = can(principal, PERMISSION.serviceManage);
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['engagement', engagementId, 'statutory-audit-profile'],
    queryFn: () =>
      apiFetch<StatutoryAuditEntityProfile[]>(
        `/engagements/${engagementId}/statutory-audit/profile`,
      ),
  });
  const p = query.data?.[0];
  const fill = useMutation({
    mutationFn: () =>
      apiFetch<StatutoryAuditEntityProfileMasterFillResult>(
        `/engagements/${engagementId}/statutory-audit/${p!.workflowInstanceId}/profile/fill-from-master`,
        { method: 'POST', body: {} },
      ),
    onSuccess: (res) => {
      toast(
        res.filled.length
          ? `Added from the client master: ${res.filled.join(', ')}.`
          : 'Nothing new on the client master.',
      );
      void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
    onError: (e) =>
      toast(e instanceof ApiError ? e.message : 'Could not fill from the client master.'),
  });
  if (!p) return null;
  const triggered = p.saTriggers.filter((t) => t.triggered).map((t) => t.code);
  const completeness = p.completeness;
  const header = p.header;
  // The workspace needs the full 02.1 view; an older payload shows the summary only.
  const hasWorkspace = !!completeness && !!p.cards;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Database className="h-4 w-4 text-ink-faint" aria-hidden />
            Entity &amp; Regulatory Profile · 02.1
          </h3>
          <p className="text-xs text-ink-muted">
            Confirm the information below. DHVAJ will use these facts to determine the applicable
            audit and reporting framework.
          </p>
          {(header || completeness) && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
              <span>
                Status:{' '}
                <span className="font-medium text-ink">
                  {p.state === 'confirmed'
                    ? p.needsReevaluation
                      ? 'Needs re-evaluation'
                      : 'Confirmed'
                    : 'Draft'}
                </span>
              </span>
              {completeness && (
                <span>
                  Completeness:{' '}
                  <span className="font-medium text-ink">{completeness.percent}%</span>
                </span>
              )}
              {header && (
                <>
                  <span>
                    Manager: <span className="text-ink">{header.managerName ?? '—'}</span>
                  </span>
                  {header.partnerName && (
                    <span>
                      Partner: <span className="text-ink">{header.partnerName}</span>
                    </span>
                  )}
                  <span>
                    Last prepared by:{' '}
                    <span className="text-ink">{header.lastUpdatedByName ?? '—'}</span>
                    {header.lastUpdatedAt ? ` · ${formatDate(header.lastUpdatedAt)}` : ''}
                  </span>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {completeness && (
            <Badge tone={COMPLETENESS_TONE[completeness.status]}>
              {COMPLETENESS_STATUS_LABEL[completeness.status]}
            </Badge>
          )}
          <Badge tone={p.smallCompany.outcome === 'pending' ? 'warn' : 'info'}>
            {SMALL_LABEL[p.smallCompany.outcome]}
          </Badge>
          <Badge tone="neutral">{p.initialAudit ? 'First-year audit' : 'Continuing audit'}</Badge>
          {triggered.length > 0 && <Badge tone="warn">{triggered.join(' · ')}</Badge>}
          {p.specialEntityTypes.map((t) => (
            <Badge key={t} tone="warn">
              {SPECIAL_LABEL[t]}
            </Badge>
          ))}
          {canManage && p.state === 'draft' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fill.mutate()}
              disabled={fill.isPending}
              title="Add the special entity types the client master shows; never removes one"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Fill from client master
            </Button>
          )}
        </div>
      </div>
      <MasterFactList facts={p.masterFacts} columns={3} />
      <p className="text-xs text-ink-muted">{p.smallCompany.basis}</p>
      {p.missingFacts.length > 0 && (
        <ul className="space-y-0.5 text-xs text-warning-700">
          {p.missingFacts.map((m, i) => {
            const fix = p.missingFactFixes?.[i];
            return (
              <li key={m} className="flex flex-wrap items-baseline gap-x-2">
                <span>• {m}</span>
                {fix && <FixLink fix={fix} missing />}
              </li>
            );
          })}
        </ul>
      )}
      {hasWorkspace && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="group flex items-center gap-2 text-sm font-medium text-primary-600"
          >
            <ExpandToggle open={open} />
            {open ? 'Close the 02.1 workspace' : 'Open the 02.1 workspace — Cards A–J'}
          </button>
          {open && (
            <EntityProfileWorkspace
              engagementId={engagementId}
              profile={p}
              canManage={canManage}
              canAdmin={canAdmin}
            />
          )}
        </>
      )}
    </Card>
  );
}
