'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2, AlertTriangle } from 'lucide-react';
import {
  PERMISSION,
  RISK_ASSERTION,
  RISK_RATING,
  RISK_SOURCE,
  RISK_STATUS,
  type AuditRisk,
  type RiskAssertion,
  type RiskRating,
  type RiskSource,
  type RiskStatus,
  type StatutoryAuditRiskRegister,
} from '@hsdg/contracts';
import type { TeamMember } from '@/lib/types';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import { humanize } from '@/lib/format';
import { Card, Badge, Button, Spinner, EmptyState } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';

/**
 * Risk Assessment (Phase 04) screen (Audit Spec §22). The risk register — each
 * risk with its source, FS area, assertion, rating, significant / fraud flags,
 * response, owner, reviewer, status and conclusion. Available once Planning is
 * approved. Risk ↔ procedure two-way navigation is added in SA-5.
 */

const RATING_TONE: Record<RiskRating, string> = {
  low: 'neutral',
  moderate: 'info',
  high: 'warn',
  significant: 'danger',
};
const STATUS_TONE: Record<RiskStatus, string> = {
  identified: 'neutral',
  response_planned: 'info',
  in_progress: 'info',
  addressed: 'success',
  concluded: 'success',
};

const RISK_QK = (id: string) => ['engagement', id, 'statutory-audit-risks'];

interface RiskDraft {
  description: string;
  source: RiskSource;
  fsArea: string;
  assertion: RiskAssertion | '';
  rating: RiskRating;
  isSignificant: boolean;
  isFraudRisk: boolean;
  response: string;
  ownerEmployeeId: string;
  reviewerEmployeeId: string;
  status: RiskStatus;
  conclusion: string;
}

const EMPTY_DRAFT: RiskDraft = {
  description: '',
  source: RISK_SOURCE.error,
  fsArea: '',
  assertion: '',
  rating: RISK_RATING.moderate,
  isSignificant: false,
  isFraudRisk: false,
  response: '',
  ownerEmployeeId: '',
  reviewerEmployeeId: '',
  status: RISK_STATUS.identified,
  conclusion: '',
};

// Create: empty optional fields are omitted (undefined) so inserts take defaults.
function draftToBody(d: RiskDraft) {
  return {
    description: d.description,
    source: d.source,
    fsArea: d.fsArea || undefined,
    assertion: d.assertion || undefined,
    rating: d.rating,
    isSignificant: d.isSignificant,
    isFraudRisk: d.isFraudRisk,
    response: d.response || undefined,
    ownerEmployeeId: d.ownerEmployeeId || undefined,
    reviewerEmployeeId: d.reviewerEmployeeId || undefined,
    status: d.status,
    conclusion: d.conclusion || undefined,
  };
}

// Update: the edit form is a full-replace, so a cleared field is sent as an
// explicit null to clear it (the API leaves undefined fields unchanged).
function draftToUpdateBody(d: RiskDraft) {
  return {
    description: d.description,
    source: d.source,
    fsArea: d.fsArea.trim() || null,
    assertion: d.assertion || null,
    rating: d.rating,
    isSignificant: d.isSignificant,
    isFraudRisk: d.isFraudRisk,
    response: d.response.trim() || null,
    ownerEmployeeId: d.ownerEmployeeId || null,
    reviewerEmployeeId: d.reviewerEmployeeId || null,
    status: d.status,
    conclusion: d.conclusion.trim() || null,
  };
}

export function RiskPanel({
  engagementId,
  team,
}: {
  engagementId: string;
  team: TeamMember[];
}): JSX.Element | null {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);
  const [adding, setAdding] = useState(false);

  const query = useQuery({
    queryKey: RISK_QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditRiskRegister[]>(`/engagements/${engagementId}/statutory-audit/risks`),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: RISK_QK(engagementId) });

  const create = useMutation({
    mutationFn: (draft: RiskDraft) =>
      apiFetch(
        `/engagements/${engagementId}/statutory-audit/${query.data![0]!.workflowInstanceId}/risks`,
        { method: 'POST', body: draftToBody(draft) },
      ),
    onSuccess: () => {
      toast('Risk added.');
      setAdding(false);
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not add risk.'),
  });

  if (query.isLoading) return <Spinner label="Loading risks…" />;
  const register = query.data?.[0];
  if (!register) return null;

  if (!register.planningApproved) {
    return (
      <Card className="p-5">
        <p className="inline-flex items-center gap-2 text-sm text-ink-muted">
          <Lock className="h-4 w-4" />
          Approve Planning (Phase 03) to open the risk register.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Risk Assessment · Phase 04</h2>
          <p className="text-xs text-ink-muted">
            {register.risks.length} risk(s)
            {register.significantRisksWithoutResponse > 0 && (
              <span className="ml-1 inline-flex items-center gap-1 text-danger-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                {register.significantRisksWithoutResponse} significant risk(s) need a response
              </span>
            )}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setAdding((a) => !a)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add risk
          </Button>
        )}
      </Card>

      {adding && canManage && (
        <RiskForm
          team={team}
          submitLabel="Add risk"
          pending={create.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={(d) => create.mutate(d)}
        />
      )}

      {register.risks.length === 0 && !adding && (
        <Card className="p-5">
          <EmptyState>No risks recorded yet.</EmptyState>
        </Card>
      )}

      {register.risks.map((risk) => (
        <RiskCard
          key={risk.id}
          engagementId={engagementId}
          risk={risk}
          team={team}
          canManage={canManage}
          onChanged={invalidate}
        />
      ))}
    </div>
  );
}

function RiskCard({
  engagementId,
  risk,
  team,
  canManage,
  onChanged,
}: {
  engagementId: string;
  risk: AuditRisk;
  team: TeamMember[];
  canManage: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [editing, setEditing] = useState(false);

  const update = useMutation({
    mutationFn: (draft: RiskDraft) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/risks/${risk.id}`, {
        method: 'POST',
        body: { ...draftToUpdateBody(draft), version: risk.version },
      }),
    onSuccess: () => {
      toast(`${risk.riskRef}: updated.`);
      setEditing(false);
      onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not update risk.'),
  });

  const remove = useMutation({
    mutationFn: () =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/risks/${risk.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast(`${risk.riskRef}: removed.`);
      onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not remove risk.'),
  });

  if (editing) {
    return (
      <RiskForm
        team={team}
        initial={{
          description: risk.description,
          source: risk.source,
          fsArea: risk.fsArea ?? '',
          assertion: risk.assertion ?? '',
          rating: risk.rating,
          isSignificant: risk.isSignificant,
          isFraudRisk: risk.isFraudRisk,
          response: risk.response ?? '',
          ownerEmployeeId: risk.ownerEmployeeId ?? '',
          reviewerEmployeeId: risk.reviewerEmployeeId ?? '',
          status: risk.status,
          conclusion: risk.conclusion ?? '',
        }}
        submitLabel="Save"
        pending={update.isPending}
        onCancel={() => setEditing(false)}
        onSubmit={(d) => update.mutate(d)}
      />
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-ink-faint">{risk.riskRef}</span>
            <Badge tone={RATING_TONE[risk.rating]}>{humanize(risk.rating)}</Badge>
            <Badge tone={STATUS_TONE[risk.status]}>{humanize(risk.status)}</Badge>
            {risk.isSignificant && <Badge tone="danger">Significant</Badge>}
            {risk.isFraudRisk && <Badge tone="danger">Fraud</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-ink">{risk.description}</p>
          <p className="mt-1 text-xs text-ink-muted">
            {humanize(risk.source)}
            {risk.fsArea && ` · ${risk.fsArea}`}
            {risk.assertion && ` · ${humanize(risk.assertion)}`}
            {risk.ownerName && ` · Owner: ${risk.ownerName}`}
            {risk.reviewerName && ` · Reviewer: ${risk.reviewerName}`}
          </p>
          {risk.response && (
            <p className="mt-1.5 text-xs text-ink-muted">
              <span className="font-semibold text-ink">Response:</span> {risk.response}
            </p>
          )}
          {risk.conclusion && (
            <p className="mt-1 text-xs text-ink-muted">
              <span className="font-semibold text-ink">Conclusion:</span> {risk.conclusion}
            </p>
          )}
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <button
              type="button"
              onClick={() => remove.mutate()}
              className="text-ink-faint hover:text-danger-600"
              title="Remove risk"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

function RiskForm({
  team,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  team: TeamMember[];
  initial?: RiskDraft;
  submitLabel: string;
  pending: boolean;
  onSubmit: (draft: RiskDraft) => void;
  onCancel: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<RiskDraft>(initial ?? EMPTY_DRAFT);
  const set = <K extends keyof RiskDraft>(k: K, v: RiskDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Card className="space-y-3 p-4">
      <Field label="Description" required>
        <Textarea
          rows={2}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Source">
          <Select value={draft.source} onChange={(e) => set('source', e.target.value as RiskSource)}>
            {Object.values(RISK_SOURCE).map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
        </Field>
        <Field label="FS area">
          <Input placeholder="e.g. Revenue" value={draft.fsArea} onChange={(e) => set('fsArea', e.target.value)} />
        </Field>
        <Field label="Assertion">
          <Select value={draft.assertion} onChange={(e) => set('assertion', e.target.value as RiskAssertion | '')}>
            <option value="">—</option>
            {Object.values(RISK_ASSERTION).map((a) => (
              <option key={a} value={a}>{humanize(a)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Rating">
          <Select value={draft.rating} onChange={(e) => set('rating', e.target.value as RiskRating)}>
            {Object.values(RISK_RATING).map((r) => (
              <option key={r} value={r}>{humanize(r)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Owner">
          <Select value={draft.ownerEmployeeId} onChange={(e) => set('ownerEmployeeId', e.target.value)}>
            <option value="">—</option>
            {team.map((m) => (
              <option key={m.employeeId} value={m.employeeId}>{m.employeeName}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reviewer">
          <Select value={draft.reviewerEmployeeId} onChange={(e) => set('reviewerEmployeeId', e.target.value)}>
            <option value="">—</option>
            {team.map((m) => (
              <option key={m.employeeId} value={m.employeeId}>{m.employeeName}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={draft.status} onChange={(e) => set('status', e.target.value as RiskStatus)}>
            {Object.values(RISK_STATUS).map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={draft.isSignificant} onChange={(e) => set('isSignificant', e.target.checked)} />
          Significant risk
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={draft.isFraudRisk} onChange={(e) => set('isFraudRisk', e.target.checked)} />
          Fraud risk
        </label>
      </div>
      <Field label="Planned response">
        <Textarea rows={2} value={draft.response} onChange={(e) => set('response', e.target.value)} />
      </Field>
      <Field label="Conclusion">
        <Textarea rows={2} value={draft.conclusion} onChange={(e) => set('conclusion', e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button
          onClick={() => onSubmit(draft)}
          disabled={pending || draft.description.trim().length === 0}
        >
          {submitLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
