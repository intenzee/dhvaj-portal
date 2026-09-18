'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Link2, AlertTriangle, FileText } from 'lucide-react';
import {
  PERMISSION,
  PROCEDURE_STATE,
  RISK_ASSERTION,
  SAMPLING_METHOD,
  EVIDENCE_KIND,
  AREA_RISK_LEVEL,
  procedureCompletionBlock,
  type AuditProcedure,
  type AuditWorkArea,
  type ProcedureAssertion,
  type ProcedureState,
  type SamplingMethod,
  type EvidenceKind,
  type StatutoryAuditProcedures,
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
 * Audit Area screen (Audit Spec §11–§14) — the professional detail overlaid on a
 * generated work area plus the procedures inside it, their evidence and
 * exceptions. A procedure can be linked to several areas (§14 reuse) and its
 * evidence supports it wherever it appears (§9). Conclusion is "Save Draft" /
 * "Submit for Review".
 */

const PROC_QK = (id: string) => ['engagement', id, 'statutory-audit-procedures'];
const WORK_QK = (id: string) => ['engagement', id, 'statutory-audit-work-areas'];

const STATE_TONE: Record<ProcedureState, string> = {
  not_started: 'neutral',
  in_progress: 'info',
  ready_for_review: 'warn',
  returned: 'danger',
  complete: 'success',
};

function money(n: number | null): string {
  return n == null ? '—' : `₹ ${n.toLocaleString('en-IN')}`;
}

export function AuditAreaScreen({
  engagementId,
  area,
  allAreas,
  team,
  onBack,
}: {
  engagementId: string;
  area: AuditWorkArea;
  allAreas: AuditWorkArea[];
  team: TeamMember[];
  onBack: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const canManage = can(principal, PERMISSION.engagementManage);

  const procQuery = useQuery({
    queryKey: PROC_QK(engagementId),
    queryFn: () =>
      apiFetch<StatutoryAuditProcedures[]>(
        `/engagements/${engagementId}/statutory-audit/procedures`,
      ),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: PROC_QK(engagementId) });
    void qc.invalidateQueries({ queryKey: WORK_QK(engagementId) });
  };

  const [adding, setAdding] = useState(false);
  const addProc = useMutation({
    mutationFn: (draft: ProcDraft) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/areas/${area.id}/procedures`, {
        method: 'POST',
        body: procToCreateBody(draft),
      }),
    onSuccess: () => {
      toast('Procedure added.');
      setAdding(false);
      invalidate();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not add procedure.'),
  });

  const d = area.detail;
  const areaProcs = (procQuery.data?.[0]?.procedures ?? []).filter((p) =>
    p.linkedAreas.some((l) => l.workAreaId === area.id),
  );

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All audit areas
      </button>

      <DetailCard engagementId={engagementId} area={area} team={team} canManage={canManage} onChanged={invalidate} />

      {/* Financial data (§11) */}
      <Card className="p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Financial data</h3>
        <div className="mt-2 grid gap-3 text-sm sm:grid-cols-3">
          <div><span className="text-ink-muted">Current</span><p className="text-ink">{money(d.financialCurrent)}</p></div>
          <div><span className="text-ink-muted">Prior year</span><p className="text-ink">{money(d.financialPrior)}</p></div>
          <div>
            <span className="text-ink-muted">Movement</span>
            <p className="text-ink">
              {d.financialMovement == null ? '—' : `${(d.financialMovement * 100).toFixed(1)}%`}
            </p>
          </div>
        </div>
        {d.financialSource && <p className="mt-2 text-xs text-ink-muted">Source: {d.financialSource}</p>}
      </Card>

      {/* Procedures (§11–§14) */}
      <Card className="flex items-center justify-between gap-3 p-4">
        <div>
          <h3 className="text-sm font-semibold text-ink">Procedures</h3>
          <p className="text-xs text-ink-muted">{areaProcs.length} procedure(s) in this area</p>
        </div>
        {canManage && (
          <Button onClick={() => setAdding((a) => !a)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add procedure
          </Button>
        )}
      </Card>

      {adding && canManage && (
        <ProcedureForm
          team={team}
          submitLabel="Add procedure"
          pending={addProc.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={(d2) => addProc.mutate(d2)}
        />
      )}

      {procQuery.isLoading && <Spinner label="Loading procedures…" />}
      {!procQuery.isLoading && areaProcs.length === 0 && (
        <Card className="p-5">
          <EmptyState>No procedures recorded in this area yet.</EmptyState>
        </Card>
      )}
      {areaProcs.map((p) => (
        <ProcedureCard
          key={p.id}
          engagementId={engagementId}
          procedure={p}
          allAreas={allAreas}
          team={team}
          canManage={canManage}
          onChanged={invalidate}
        />
      ))}

      {/* Area conclusion (§11) */}
      <ConclusionCard engagementId={engagementId} area={area} canManage={canManage} onChanged={invalidate} />
    </div>
  );
}

// ── Area detail ──────────────────────────────────────────────────────────────

function DetailCard({
  engagementId,
  area,
  team,
  canManage,
  onChanged,
}: {
  engagementId: string;
  area: AuditWorkArea;
  team: TeamMember[];
  canManage: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const d = area.detail;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/areas/${area.id}/detail`, {
        method: 'POST',
        body: { ...body, detailVersion: d.detailVersion },
      }),
    onSuccess: () => {
      toast('Area detail saved.');
      setEditing(false);
      onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save.'),
  });

  if (editing) {
    return <DetailForm area={area} team={team} pending={save.isPending} onCancel={() => setEditing(false)} onSubmit={(b) => save.mutate(b)} />;
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{area.title}</h2>
          {area.scope && <p className="mt-0.5 text-xs text-ink-muted">{area.scope}</p>}
          <p className="mt-2 text-xs text-ink-muted">
            {d.riskLevel && <>Risk: {humanize(d.riskLevel)} · </>}
            {d.materiality != null && <>Materiality: {money(d.materiality)} · </>}
            {d.dueDate && <>Due: {d.dueDate} · </>}
            Owner: {d.ownerName ?? '—'} · Reviewer: {d.reviewerName ?? '—'}
          </p>
        </div>
        {canManage && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit detail
          </Button>
        )}
      </div>
    </Card>
  );
}

function DetailForm({
  area,
  team,
  pending,
  onSubmit,
  onCancel,
}: {
  area: AuditWorkArea;
  team: TeamMember[];
  pending: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}): JSX.Element {
  const d = area.detail;
  const [ownerEmployeeId, setOwner] = useState(d.ownerEmployeeId ?? '');
  const [reviewerEmployeeId, setReviewer] = useState(d.reviewerEmployeeId ?? '');
  const [riskLevel, setRiskLevel] = useState(d.riskLevel ?? '');
  const [materiality, setMateriality] = useState(d.materiality?.toString() ?? '');
  const [dueDate, setDueDate] = useState(d.dueDate ?? '');
  const [financialCurrent, setCurrent] = useState(d.financialCurrent?.toString() ?? '');
  const [financialPrior, setPrior] = useState(d.financialPrior?.toString() ?? '');
  const [financialSource, setSource] = useState(d.financialSource ?? '');

  const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v));

  return (
    <Card className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Owner">
          <Select value={ownerEmployeeId} onChange={(e) => setOwner(e.target.value)}>
            <option value="">—</option>
            {team.map((m) => <option key={m.employeeId} value={m.employeeId}>{m.employeeName}</option>)}
          </Select>
        </Field>
        <Field label="Reviewer">
          <Select value={reviewerEmployeeId} onChange={(e) => setReviewer(e.target.value)}>
            <option value="">—</option>
            {team.map((m) => <option key={m.employeeId} value={m.employeeId}>{m.employeeName}</option>)}
          </Select>
        </Field>
        <Field label="Risk level">
          <Select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)}>
            <option value="">—</option>
            {Object.values(AREA_RISK_LEVEL).map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
          </Select>
        </Field>
        <Field label="Materiality (₹)">
          <Input type="number" min={0} value={materiality} onChange={(e) => setMateriality(e.target.value)} />
        </Field>
        <Field label="Due date">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Financial source">
          <Input placeholder="Financial Statements.xlsx" value={financialSource} onChange={(e) => setSource(e.target.value)} />
        </Field>
        <Field label="Current-year balance (₹)">
          <Input type="number" value={financialCurrent} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Prior-year balance (₹)">
          <Input type="number" value={financialPrior} onChange={(e) => setPrior(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            onSubmit({
              ownerEmployeeId: ownerEmployeeId || null,
              reviewerEmployeeId: reviewerEmployeeId || null,
              riskLevel: riskLevel || undefined,
              materiality: numOrNull(materiality),
              dueDate: dueDate || null,
              financialCurrent: numOrNull(financialCurrent),
              financialPrior: numOrNull(financialPrior),
              financialSource: financialSource.trim() || null,
            })
          }
        >
          Save
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
      </div>
    </Card>
  );
}

function ConclusionCard({
  engagementId,
  area,
  canManage,
  onChanged,
}: {
  engagementId: string;
  area: AuditWorkArea;
  canManage: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [conclusion, setConclusion] = useState(area.detail.conclusion ?? '');

  const save = useMutation({
    mutationFn: (conclusionState: 'draft' | 'submitted') =>
      apiFetch(`/engagements/${engagementId}/statutory-audit/areas/${area.id}/detail`, {
        method: 'POST',
        body: { conclusion, conclusionState, detailVersion: area.detail.detailVersion },
      }),
    onSuccess: (_data, state) => {
      toast(state === 'submitted' ? 'Conclusion submitted for review.' : 'Draft saved.');
      onChanged();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save conclusion.'),
  });

  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Conclusion</h3>
        <Badge tone={area.detail.conclusionState === 'submitted' ? 'success' : 'neutral'}>
          {humanize(area.detail.conclusionState)}
        </Badge>
      </div>
      {canManage ? (
        <>
          <Textarea rows={3} value={conclusion} onChange={(e) => setConclusion(e.target.value)} placeholder="Structured conclusion…" />
          <div className="flex gap-2">
            <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate('draft')}>Save Draft</Button>
            <Button disabled={save.isPending || conclusion.trim().length === 0} onClick={() => save.mutate('submitted')}>
              Submit for Review
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-ink">{area.detail.conclusion || <span className="text-ink-faint">No conclusion recorded.</span>}</p>
      )}
    </Card>
  );
}

// ── Procedures ─────────────────────────────────────────────────────────────

interface ProcDraft {
  title: string;
  objective: string;
  assertions: ProcedureAssertion[];
  riskId: string;
  population: string;
  samplingMethod: SamplingMethod | '';
  sampleSize: string;
  ownerEmployeeId: string;
  reviewerEmployeeId: string;
  dueDate: string;
  expectedEvidence: string;
  conclusion: string;
}

const EMPTY_PROC: ProcDraft = {
  title: '', objective: '', assertions: [], riskId: '', population: '', samplingMethod: '',
  sampleSize: '', ownerEmployeeId: '', reviewerEmployeeId: '', dueDate: '', expectedEvidence: '', conclusion: '',
};

function procToCreateBody(d: ProcDraft) {
  return {
    title: d.title,
    objective: d.objective || undefined,
    assertions: d.assertions,
    riskId: d.riskId || undefined,
    population: d.population || undefined,
    samplingMethod: d.samplingMethod || undefined,
    sampleSize: d.sampleSize ? Number(d.sampleSize) : undefined,
    ownerEmployeeId: d.ownerEmployeeId || undefined,
    reviewerEmployeeId: d.reviewerEmployeeId || undefined,
    dueDate: d.dueDate || undefined,
    expectedEvidence: d.expectedEvidence || undefined,
    conclusion: d.conclusion || undefined,
  };
}

function procToUpdateBody(d: ProcDraft) {
  return {
    title: d.title,
    objective: d.objective.trim() || null,
    assertions: d.assertions,
    riskId: d.riskId || null,
    population: d.population.trim() || null,
    samplingMethod: d.samplingMethod || null,
    sampleSize: d.sampleSize ? Number(d.sampleSize) : null,
    ownerEmployeeId: d.ownerEmployeeId || null,
    reviewerEmployeeId: d.reviewerEmployeeId || null,
    dueDate: d.dueDate || null,
    expectedEvidence: d.expectedEvidence.trim() || null,
    conclusion: d.conclusion.trim() || null,
  };
}

function ProcedureCard({
  engagementId,
  procedure,
  allAreas,
  team,
  canManage,
  onChanged,
}: {
  engagementId: string;
  procedure: AuditProcedure;
  allAreas: AuditWorkArea[];
  team: TeamMember[];
  canManage: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const p = procedure;
  const openExceptions = p.exceptions.filter((x) => x.status === 'open').length;

  const mutate = (path: string, body?: unknown, method: 'POST' | 'DELETE' = 'POST') =>
    apiFetch(`/engagements/${engagementId}/statutory-audit/${path}`, { method, body: body as object });

  const onErr = (e: unknown) => toast(e instanceof ApiError ? e.message : 'Action failed.');

  const update = useMutation({
    mutationFn: (draft: ProcDraft) =>
      mutate(`procedures/${p.id}`, { ...procToUpdateBody(draft), version: p.version }),
    onSuccess: () => { toast(`${p.procedureRef}: updated.`); setEditing(false); onChanged(); },
    onError: onErr,
  });
  const setState = useMutation({
    mutationFn: (state: ProcedureState) => mutate(`procedures/${p.id}/state`, { state, version: p.version }),
    onSuccess: () => { toast(`${p.procedureRef}: state updated.`); onChanged(); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: () => mutate(`procedures/${p.id}`, undefined, 'DELETE'),
    onSuccess: () => { toast(`${p.procedureRef}: removed.`); onChanged(); },
    onError: onErr,
  });
  const linkArea = useMutation({
    mutationFn: (workAreaId: string) => mutate(`procedures/${p.id}/areas`, { workAreaId }),
    onSuccess: () => { toast('Linked to area.'); onChanged(); },
    onError: onErr,
  });
  const addEvidence = useMutation({
    mutationFn: (body: { title: string; kind: EvidenceKind; note?: string }) =>
      mutate(`procedures/${p.id}/evidence`, body),
    onSuccess: () => { toast('Evidence added.'); onChanged(); },
    onError: onErr,
  });
  const unlinkEvidence = useMutation({
    mutationFn: (evidenceId: string) => mutate(`procedures/${p.id}/evidence/${evidenceId}`, undefined, 'DELETE'),
    onSuccess: () => { toast('Evidence detached.'); onChanged(); },
    onError: onErr,
  });
  const addException = useMutation({
    mutationFn: (description: string) => mutate(`procedures/${p.id}/exceptions`, { description }),
    onSuccess: () => { toast('Exception raised.'); onChanged(); },
    onError: onErr,
  });
  const setException = useMutation({
    mutationFn: (v: { id: string; status: string; version: number }) =>
      mutate(`exceptions/${v.id}`, { status: v.status, version: v.version }),
    onSuccess: () => { toast('Exception updated.'); onChanged(); },
    onError: onErr,
  });

  if (editing) {
    return (
      <ProcedureForm
        team={team}
        initial={{
          title: p.title,
          objective: p.objective ?? '',
          assertions: p.assertions,
          riskId: p.riskId ?? '',
          population: p.population ?? '',
          samplingMethod: p.samplingMethod ?? '',
          sampleSize: p.sampleSize?.toString() ?? '',
          ownerEmployeeId: p.ownerEmployeeId ?? '',
          reviewerEmployeeId: p.reviewerEmployeeId ?? '',
          dueDate: p.dueDate ?? '',
          expectedEvidence: p.expectedEvidence ?? '',
          conclusion: p.conclusion ?? '',
        }}
        submitLabel="Save"
        pending={update.isPending}
        onCancel={() => setEditing(false)}
        onSubmit={(d) => update.mutate(d)}
      />
    );
  }

  const completeBlock = procedureCompletionBlock({
    objective: p.objective,
    conclusion: p.conclusion,
    openExceptions,
  });
  const linkableAreas = allAreas.filter(
    (a) => a.isActive && !p.linkedAreas.some((l) => l.workAreaId === a.id),
  );

  return (
    <Card className="space-y-2.5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-ink-faint">{p.procedureRef}</span>
            <Badge tone={STATE_TONE[p.state]}>{humanize(p.state)}</Badge>
            {p.riskRef && <Badge tone="warn">↔ {p.riskRef}</Badge>}
          </div>
          <p className="mt-1.5 text-sm font-medium text-ink">{p.title}</p>
          {p.objective && <p className="mt-0.5 text-xs text-ink-muted">{p.objective}</p>}
          <p className="mt-1 text-xs text-ink-muted">
            {p.assertions.length > 0 && <>{p.assertions.map(humanize).join(', ')} · </>}
            Owner: {p.ownerName ?? '—'} · Reviewer: {p.reviewerName ?? '—'}
            {p.dueDate && <> · Due {p.dueDate}</>}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
            <button type="button" onClick={() => remove.mutate()} title="Delete procedure" className="text-ink-faint hover:text-danger-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Linked areas (§14 reuse) */}
      {p.linkedAreas.length > 1 && (
        <p className="text-xs text-ink-muted">
          <Link2 className="mr-1 inline h-3 w-3" />
          Linked: {p.linkedAreas.map((l) => l.title).join(', ')}
        </p>
      )}

      {/* Evidence (§9, §12) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 text-ink-faint" />
        {p.evidence.length === 0 && <span className="text-xs text-ink-faint">No evidence</span>}
        {p.evidence.map((ev) => (
          <span key={ev.id} className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-ink">
            {ev.title}
            {canManage && (
              <button type="button" onClick={() => unlinkEvidence.mutate(ev.id)} className="text-ink-faint hover:text-danger-600" title="Detach">
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {/* Exceptions (§12) */}
      {p.exceptions.length > 0 && (
        <div className="space-y-1">
          {p.exceptions.map((x) => (
            <p key={x.id} className="flex items-center gap-2 text-xs">
              <AlertTriangle className={`h-3.5 w-3.5 ${x.status === 'open' ? 'text-danger-600' : 'text-ink-faint'}`} />
              <span className={x.status === 'open' ? 'text-ink' : 'text-ink-muted line-through'}>{x.description}</span>
              {canManage && x.status === 'open' && (
                <button type="button" className="text-brand-600 hover:underline" onClick={() => setException.mutate({ id: x.id, status: 'resolved', version: x.version })}>
                  resolve
                </button>
              )}
            </p>
          ))}
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
          <ProcedureStateButtons state={p.state} pending={setState.isPending} completeBlock={completeBlock} onSet={(s) => setState.mutate(s)} />
          <AddEvidenceInline pending={addEvidence.isPending} onAdd={(b) => addEvidence.mutate(b)} />
          <AddExceptionInline pending={addException.isPending} onAdd={(desc) => addException.mutate(desc)} />
          {linkableAreas.length > 0 && (
            <InlineSelect
              label="Link to area…"
              options={linkableAreas.map((a) => ({ value: a.id, label: a.title }))}
              onPick={(v) => linkArea.mutate(v)}
            />
          )}
        </div>
      )}
    </Card>
  );
}

function ProcedureStateButtons({
  state,
  pending,
  completeBlock,
  onSet,
}: {
  state: ProcedureState;
  pending: boolean;
  completeBlock: string | null;
  onSet: (s: ProcedureState) => void;
}): JSX.Element {
  const next: { label: string; state: ProcedureState; disabled?: boolean; title?: string }[] = [];
  if (state === PROCEDURE_STATE.notStarted) next.push({ label: 'Start', state: PROCEDURE_STATE.inProgress });
  if (state === PROCEDURE_STATE.inProgress || state === PROCEDURE_STATE.returned)
    next.push({ label: 'Ready for review', state: PROCEDURE_STATE.readyForReview });
  if (state === PROCEDURE_STATE.readyForReview) next.push({ label: 'Return', state: PROCEDURE_STATE.returned });
  if (state !== PROCEDURE_STATE.complete)
    next.push({ label: 'Complete', state: PROCEDURE_STATE.complete, disabled: !!completeBlock, title: completeBlock ?? undefined });
  return (
    <>
      {next.map((n) => (
        <Button key={n.state} variant="secondary" disabled={pending || n.disabled} title={n.title} onClick={() => onSet(n.state)}>
          {n.label}
        </Button>
      ))}
    </>
  );
}

function AddEvidenceInline({ pending, onAdd }: { pending: boolean; onAdd: (b: { title: string; kind: EvidenceKind }) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<EvidenceKind>(EVIDENCE_KIND.document);
  if (!open) return <Button variant="ghost" onClick={() => setOpen(true)}>+ Evidence</Button>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Input placeholder="Evidence title" value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 w-40" />
      <Select value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind)} className="h-8">
        {Object.values(EVIDENCE_KIND).map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
      </Select>
      <Button disabled={pending || !title.trim()} onClick={() => { onAdd({ title, kind }); setTitle(''); setOpen(false); }}>Add</Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </span>
  );
}

function AddExceptionInline({ pending, onAdd }: { pending: boolean; onAdd: (desc: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState('');
  if (!open) return <Button variant="ghost" onClick={() => setOpen(true)}>+ Exception</Button>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Input placeholder="Exception" value={desc} onChange={(e) => setDesc(e.target.value)} className="h-8 w-52" />
      <Button disabled={pending || !desc.trim()} onClick={() => { onAdd(desc); setDesc(''); setOpen(false); }}>Raise</Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </span>
  );
}

function InlineSelect({
  label,
  options,
  onPick,
}: {
  label: string;
  options: { value: string; label: string }[];
  onPick: (v: string) => void;
}): JSX.Element {
  return (
    <Select
      className="h-8 w-40"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
      }}
    >
      <option value="">{label}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}

function ProcedureForm({
  team,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  team: TeamMember[];
  initial?: ProcDraft;
  submitLabel: string;
  pending: boolean;
  onSubmit: (d: ProcDraft) => void;
  onCancel: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<ProcDraft>(initial ?? EMPTY_PROC);
  const set = <K extends keyof ProcDraft>(k: K, v: ProcDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const toggleAssertion = (a: ProcedureAssertion) =>
    setDraft((d) => ({
      ...d,
      assertions: d.assertions.includes(a) ? d.assertions.filter((x) => x !== a) : [...d.assertions, a],
    }));

  return (
    <Card className="space-y-3 p-4">
      <Field label="Title" required>
        <Input value={draft.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Objective">
        <Textarea rows={2} value={draft.objective} onChange={(e) => set('objective', e.target.value)} />
      </Field>
      <Field label="Assertions">
        <div className="flex flex-wrap gap-2">
          {Object.values(RISK_ASSERTION).map((a) => (
            <label key={a} className="inline-flex items-center gap-1.5 rounded border border-line px-2 py-1 text-xs text-ink">
              <input type="checkbox" checked={draft.assertions.includes(a)} onChange={() => toggleAssertion(a)} />
              {humanize(a)}
            </label>
          ))}
        </div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Owner">
          <Select value={draft.ownerEmployeeId} onChange={(e) => set('ownerEmployeeId', e.target.value)}>
            <option value="">—</option>
            {team.map((m) => <option key={m.employeeId} value={m.employeeId}>{m.employeeName}</option>)}
          </Select>
        </Field>
        <Field label="Reviewer">
          <Select value={draft.reviewerEmployeeId} onChange={(e) => set('reviewerEmployeeId', e.target.value)}>
            <option value="">—</option>
            {team.map((m) => <option key={m.employeeId} value={m.employeeId}>{m.employeeName}</option>)}
          </Select>
        </Field>
        <Field label="Sampling method">
          <Select value={draft.samplingMethod} onChange={(e) => set('samplingMethod', e.target.value as SamplingMethod | '')}>
            <option value="">—</option>
            {Object.values(SAMPLING_METHOD).map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
        </Field>
        <Field label="Sample size">
          <Input type="number" min={0} value={draft.sampleSize} onChange={(e) => set('sampleSize', e.target.value)} />
        </Field>
        <Field label="Due date">
          <Input type="date" value={draft.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
      </div>
      <Field label="Population">
        <Textarea rows={2} value={draft.population} onChange={(e) => set('population', e.target.value)} />
      </Field>
      <Field label="Expected evidence">
        <Textarea rows={2} value={draft.expectedEvidence} onChange={(e) => set('expectedEvidence', e.target.value)} />
      </Field>
      <Field label="Conclusion">
        <Textarea rows={2} value={draft.conclusion} onChange={(e) => set('conclusion', e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button disabled={pending || draft.title.trim().length === 0} onClick={() => onSubmit(draft)}>{submitLabel}</Button>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
      </div>
    </Card>
  );
}
