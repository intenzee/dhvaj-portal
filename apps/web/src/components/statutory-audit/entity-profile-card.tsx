'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, RefreshCw } from 'lucide-react';
import {
  PERMISSION,
  type SmallCompanyOutcome,
  type SpecialEntityType,
  type StatutoryAuditEntityProfile,
  type StatutoryAuditEntityProfileMasterFillResult,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { Badge, Button, Card } from '@/components/ui';
import { FixLink, MasterFactList } from './master-fact-list';

/**
 * 02.1 Entity & Regulatory Profile, read-only (spec 02.1 §4 "manager opens
 * 02.1 and sees entity/engagement data pre-populated"). Classification, group,
 * listing and the deciding figures come from the entity master with their
 * source, and the small-company / SA-trigger results are computed from them —
 * nothing here is typed in by the audit team. The special entity types (bank,
 * NBFC, Section 8, …) are read off the client's industries and regulatory facts.
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

export function EntityProfileCard({ engagementId }: { engagementId: string }): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);
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

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Database className="h-4 w-4 text-ink-faint" aria-hidden />
          Entity &amp; Regulatory Profile · 02.1
        </h3>
        <div className="flex flex-wrap gap-1.5">
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
    </Card>
  );
}
