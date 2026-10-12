'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, AlertTriangle, Sparkles } from 'lucide-react';
import {
  PERMISSION,
  RISK_ASSERTION,
  RISK_RATING,
  RISK_SOURCE,
  RISK_STATUS,
  type AssertionId,
  type AuditRisk,
  type RiskAreaOption,
  type RiskAssertion,
  type RiskRating,
  type RiskSource,
  type RiskStatus,
  type RiskSuggestionResult,
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
import { ExpandToggle, InlinePanel } from '@/components/inline-panel';
import { useAuditAnchor } from './audit-file-nav';
import { SectionPackChecks } from './section-pack-card';

/**
 * Risk Assessment (Phase 04) screen (Audit Spec §22). The risk register — each
 * risk with its source, FS area, assertion, rating, significant / fraud flags,
 * response, owner, reviewer, status and conclusion. Available once Planning is
 * approved. Risk ↔ procedure two-way navigation is added in SA-5.
 *
 * The register is a compact list; a risk's detail, edit form and removal open
 * in a pop-up, as does adding a risk, so the page never becomes a long stack.
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
  /** §24 — the retained 03.5 Audit Area the risk sits in. */
  auditAreaId: string;
  /** Canonical SA 315 assertions of that area the risk bears on. */
  assertionIds: AssertionId[];
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
  auditAreaId: '',
  assertionIds: [],
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
    auditAreaId: d.auditAreaId || undefined,
    assertionIds: d.assertionIds.length ? d.assertionIds : undefined,
    // With a 03.5 area the API derives the legacy assertion from the canonical ones.
    assertion: (!d.auditAreaId && d.assertion) || undefined,
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
    auditAreaId: d.auditAreaId || null,
    assertionIds: d.assertionIds,
    assertion: d.auditAreaId ? undefined : d.assertion || null,
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
  // "Go to" links name a risk (`risk-<id>`): open it for editing.
  const [focus, setFocus] = useState<{ id: string; at: number } | null>(null);
  useAuditAnchor('risk', (anchor) => {
    if (anchor.startsWith('risk-')) setFocus({ id: anchor.slice('risk-'.length), at: Date.now() });
  });

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

  const suggest = useMutation({
    mutationFn: () =>
      apiFetch<RiskSuggestionResult>(
        `/engagements/${engagementId}/statutory-audit/${query.data![0]!.workflowInstanceId}/risks/suggest`,
        { method: 'POST', body: {} },
      ),
    onSuccess: (r) => {
      toast(
        r.added
          ? `${r.added} suggested risk(s) added from Sections 02–03.`
          : 'No new suggestions — the register already covers what Sections 02–03 point to.',
      );
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not refresh the suggestions.'),
  });

  if (query.isLoading) return <Spinner label="Loading risks…" />;
  const register = query.data?.[0];
  if (!register) return null;

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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => suggest.mutate()}
              disabled={suggest.isPending}
              title="SA 240 presumptions, Enhanced / Partner signals, prior-year matters, Enhanced 03.5 areas, related parties, opening balances — a deleted suggestion never comes back"
            >
              <Sparkles className="mr-1.5 h-4 w-4" />
              Refresh suggested risks
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add risk
            </Button>
          </div>
        )}
      </Card>

      <Card className="space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Ready for the audit work?</h3>
          <Badge tone={register.pack.ready ? 'success' : 'warn'}>
            {register.pack.ready ? 'Ready' : 'Not yet'}
          </Badge>
        </div>
        <SectionPackChecks pack={register.pack} needsTitle="What the audit work needs" />
      </Card>

      <InlinePanel
        open={adding && canManage}
        onClose={() => setAdding(false)}
        title="Add risk"
        description="Risk Assessment · Phase 04"
        size="lg"
      >
        <RiskForm
          plain
          team={team}
          areas={register.areaOptions}
          submitLabel="Add risk"
          pending={create.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={(d) => create.mutate(d)}
        />
      </InlinePanel>

      {register.risks.length === 0 && (
        <Card className="p-5">
          <EmptyState>No risks recorded yet.</EmptyState>
        </Card>
      )}

      {register.risks.length > 0 && (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-line">
            {register.risks.map((risk) => (
              <RiskRow
                key={risk.id}
                engagementId={engagementId}
                risk={risk}
                focusAt={focus?.id === risk.id ? focus.at : null}
                team={team}
                areas={register.areaOptions}
                workflowInstanceId={register.workflowInstanceId}
                canManage={canManage}
                onChanged={invalidate}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function RiskRow({
  engagementId,
  risk,
  focusAt,
  team,
  areas,
  workflowInstanceId,
  canManage,
  onChanged,
}: {
  engagementId: string;
  risk: AuditRisk;
  /** Set when a "Go to" link targets this risk — opens it for editing. */
  focusAt: number | null;
  team: TeamMember[];
  areas: RiskAreaOption[];
  workflowInstanceId: string;
  canManage: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const close = () => {
    setOpen(false);
    setEditing(false);
  };
  useEffect(() => {
    if (focusAt == null) return;
    setOpen(true);
    setEditing(canManage);
  }, [focusAt, canManage]);

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
      apiFetch(`/engagements/${engagementId}/statutory-audit/risks/${risk.id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      toast(`${risk.riskRef}: removed.`);
      onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not remove risk.'),
  });

  return (
    <li id={`audit-anchor-risk-${risk.id}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface-sunken"
      >
        <ExpandToggle open={open} />
        <span className="w-16 shrink-0 font-mono text-xs text-ink-faint">{risk.riskRef}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{risk.description}</span>
          <span className="block truncate text-[11px] text-ink-muted">
            {humanize(risk.source)}
            {risk.fsArea && ` · ${risk.fsArea}`}
            {risk.ownerName && ` · ${risk.ownerName}`}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {risk.isSignificant && <Badge tone="danger">Significant</Badge>}
          {risk.isFraudRisk && <Badge tone="danger">Fraud</Badge>}
          {risk.sourceKey && <Badge tone="info">Suggested</Badge>}
          <Badge tone={RATING_TONE[risk.rating]}>{humanize(risk.rating)}</Badge>
          <Badge tone={STATUS_TONE[risk.status]}>{humanize(risk.status)}</Badge>
        </span>
      </button>

      <InlinePanel
        className="mx-4 mb-3"
        open={open}
        onClose={close}
        title={`${risk.riskRef} · ${editing ? 'Edit risk' : 'Risk'}`}
        description="Risk Assessment · Phase 04"
        size="lg"
      >
        {editing ? (
          <RiskForm
            plain
            team={team}
            areas={areas}
            initial={{
              description: risk.description,
              source: risk.source,
              fsArea: risk.fsArea ?? '',
              auditAreaId: risk.auditAreaId ?? '',
              assertionIds: risk.assertionIds,
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
        ) : (
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
              {risk.sourceNote && (
                <p className="mt-1 text-xs text-primary-700">Suggested from: {risk.sourceNote}</p>
              )}
              <p className="mt-1 text-xs text-ink-muted">
                {humanize(risk.source)}
                {risk.fsArea && ` · ${risk.fsArea}`}
                {risk.assertion && ` · ${humanize(risk.assertion)}`}
                {risk.ownerName && ` · Owner: ${risk.ownerName}`}
                {risk.reviewerName && ` · Reviewer: ${risk.reviewerName}`}
              </p>
              <AreaLine risk={risk} areas={areas} />
              {!risk.auditAreaId && (
                <AreaRequest
                  engagementId={engagementId}
                  workflowInstanceId={workflowInstanceId}
                  risk={risk}
                />
              )}
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
        )}
      </InlinePanel>
    </li>
  );
}

function RiskForm({
  team,
  areas,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  plain,
}: {
  /** Render without its card (inside a pop-up). */
  plain?: boolean;
  team: TeamMember[];
  areas: RiskAreaOption[];
  initial?: RiskDraft;
  submitLabel: string;
  pending: boolean;
  onSubmit: (draft: RiskDraft) => void;
  onCancel: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<RiskDraft>(initial ?? EMPTY_DRAFT);
  const set = <K extends keyof RiskDraft>(k: K, v: RiskDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const Wrapper = plain ? 'div' : Card;
  const area = areas.find((a) => a.id === draft.auditAreaId) ?? null;
  const pickArea = (id: string) => {
    const next = areas.find((a) => a.id === id) ?? null;
    setDraft((d) => ({
      ...d,
      auditAreaId: id,
      // Keep only assertions still active on the chosen area.
      assertionIds: next
        ? d.assertionIds.filter((x) => next.assertions.some((a) => a.id === x))
        : [],
      fsArea: next && (!d.fsArea.trim() || d.fsArea === area?.name) ? next.name : d.fsArea,
    }));
  };

  return (
    <Wrapper className={plain ? 'space-y-3' : 'space-y-3 p-4'}>
      <Field label="Description" required>
        <Textarea
          rows={2}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Source">
          <Select
            value={draft.source}
            onChange={(e) => set('source', e.target.value as RiskSource)}
          >
            {Object.values(RISK_SOURCE).map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="03.5 Audit Area"
          hint={
            areas.length
              ? 'Links the risk to the retained 03.5 area (lineage to the matrix and work).'
              : '03.5 has no retained areas yet.'
          }
        >
          <Select value={draft.auditAreaId} onChange={(e) => pickArea(e.target.value)}>
            <option value="">— Not linked —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="FS area">
          <Input
            placeholder="e.g. Revenue"
            value={draft.fsArea}
            onChange={(e) => set('fsArea', e.target.value)}
          />
        </Field>
        {area ? (
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-xs font-medium text-ink">
              Assertions (active on {area.name} in 03.5)
            </legend>
            <div className="flex flex-wrap gap-3">
              {area.assertions.map((a) => (
                <label key={a.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.assertionIds.includes(a.id)}
                    onChange={() =>
                      set(
                        'assertionIds',
                        draft.assertionIds.includes(a.id)
                          ? draft.assertionIds.filter((x) => x !== a.id)
                          : [...draft.assertionIds, a.id],
                      )
                    }
                  />
                  {a.label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <Field label="Assertion">
            <Select
              value={draft.assertion}
              onChange={(e) => set('assertion', e.target.value as RiskAssertion | '')}
            >
              <option value="">—</option>
              {Object.values(RISK_ASSERTION).map((a) => (
                <option key={a} value={a}>
                  {humanize(a)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Rating">
          <Select
            value={draft.rating}
            onChange={(e) => set('rating', e.target.value as RiskRating)}
          >
            {Object.values(RISK_RATING).map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner">
          <Select
            value={draft.ownerEmployeeId}
            onChange={(e) => set('ownerEmployeeId', e.target.value)}
          >
            <option value="">—</option>
            {team.map((m) => (
              <option key={m.employeeId} value={m.employeeId}>
                {m.employeeName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reviewer">
          <Select
            value={draft.reviewerEmployeeId}
            onChange={(e) => set('reviewerEmployeeId', e.target.value)}
          >
            <option value="">—</option>
            {team.map((m) => (
              <option key={m.employeeId} value={m.employeeId}>
                {m.employeeName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select
            value={draft.status}
            onChange={(e) => set('status', e.target.value as RiskStatus)}
          >
            {Object.values(RISK_STATUS).map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={draft.isSignificant}
            onChange={(e) => set('isSignificant', e.target.checked)}
          />
          Significant risk
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={draft.isFraudRisk}
            onChange={(e) => set('isFraudRisk', e.target.checked)}
          />
          Fraud risk
        </label>
      </div>
      <Field label="Planned response">
        <Textarea
          rows={2}
          value={draft.response}
          onChange={(e) => set('response', e.target.value)}
        />
      </Field>
      <Field label="Conclusion">
        <Textarea
          rows={2}
          value={draft.conclusion}
          onChange={(e) => set('conclusion', e.target.value)}
        />
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
    </Wrapper>
  );
}

/** §24 — where the risk sits in the 03.5 matrix. */
function AreaLine({
  risk,
  areas,
}: {
  risk: AuditRisk;
  areas: RiskAreaOption[];
}): JSX.Element | null {
  if (!risk.auditAreaId) return null;
  const area = areas.find((a) => a.id === risk.auditAreaId);
  const labels = risk.assertionIds.map(
    (id) => area?.assertions.find((a) => a.id === id)?.label ?? id,
  );
  return (
    <p className="mt-1 text-xs text-ink-muted">
      <span className="font-semibold text-ink">03.5 area:</span>{' '}
      {area ? area.name : 'no longer retained in 03.5 — review the link'}
      {labels.length > 0 && ` · ${labels.join(', ')}`}
    </p>
  );
}

/** §25 — the risk needs an Audit Area 03.5 does not retain: ask the Manager, never create it here. */
function AreaRequest({
  engagementId,
  workflowInstanceId,
  risk,
}: {
  engagementId: string;
  workflowInstanceId: string;
  risk: AuditRisk;
}): JSX.Element {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(risk.fsArea ?? '');
  const [reason, setReason] = useState('');
  const send = useMutation({
    mutationFn: () =>
      apiFetch(
        `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/audit-areas/requests`,
        {
          method: 'POST',
          body: { proposedAreaName: name.trim(), reason: reason.trim(), riskId: risk.id },
        },
      ),
    onSuccess: () => {
      toast('Area request sent to 03.5 — the Manager adds or explains it.');
      setOpen(false);
      setReason('');
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not send the request.'),
  });
  if (!open) {
    return (
      <button
        type="button"
        className="mt-1 text-xs text-primary-700 hover:underline"
        onClick={() => setOpen(true)}
      >
        Area missing from 03.5? Request it
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-line p-2">
      <Field label="Area needed">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="min-w-[14rem] flex-1">
        <Field label="Why the risk needs it">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <Button
        variant="secondary"
        disabled={send.isPending || !name.trim() || !reason.trim()}
        onClick={() => send.mutate()}
      >
        Send to 03.5
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
