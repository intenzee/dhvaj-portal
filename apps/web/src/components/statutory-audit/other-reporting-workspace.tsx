'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, MinusCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  OTHER_REPORTING_CONCLUSIONS,
  OTHER_REPORTING_OUTCOME_LABEL,
  type OtherReportingOutcome,
  type RecordOtherReportingDecisionInput,
  type StatutoryAuditOtherReporting,
  type Tri,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { OtherReportingAuditTrail } from './other-reporting-audit-trail';
import { OtherReportingCrossRefs } from './other-reporting-cross-refs';
import { OtherReportingDirectors } from './other-reporting-directors';
import { OtherReportingFraud } from './other-reporting-fraud';
import { OtherReportingMatrix } from './other-reporting-matrix';
import { OtherReportingRemuneration } from './other-reporting-remuneration';
import { OtherReportingRule11 } from './other-reporting-rule11';
import { Section, TriSelect, rupees, type FactsPatch } from './other-reporting-ui';

/**
 * 02.7 Other Companies Act & Statutory Reporting workspace (DHVAJ 02.7 spec
 * §3): status, the system assessment with the Rules Library values used,
 * Section 143(3) facts, the requirement matrix, Rule 11(a)–(f), the Rule 11(g)
 * register, Section 197(16), Section 143(12) fraud, Section 164(2) directors,
 * the 02.4 / 02.5 / 02.6 cross-references, the professional conclusion with
 * Engagement Partner approval, and the §20 completion checklist. Every section
 * expands in place — no pop-ups.
 */

type Decision = Omit<RecordOtherReportingDecisionInput, 'version'>;

const DECIDED = new Set(['applicable', 'not_applicable', 'overridden', 'approved']);
const outcomeLabel = (o: string | null | undefined) =>
  o ? (OTHER_REPORTING_OUTCOME_LABEL[o as OtherReportingOutcome] ?? o) : '—';

export function OtherReportingWorkspace({
  engagementId,
  or,
  canManage,
}: {
  engagementId: string;
  or: StatutoryAuditOtherReporting;
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const a = or.assessment;
  const d = or.detail;
  const base = `/engagements/${engagementId}/statutory-audit/${or.workflowInstanceId}/other-reporting`;
  const decided = DECIDED.has(a.state);
  const approved = or.approved ?? a.state === 'approved';
  const factsEditable = canManage && !approved;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
  const fail = (e: unknown, what: string) =>
    toast(e instanceof ApiError ? e.message : `Could not ${what}.`);

  const facts = useMutation({
    mutationFn: (patch: FactsPatch) =>
      apiFetch(`${base}/facts`, { method: 'POST', body: { ...patch, version: a.version } }),
    onSuccess: () => {
      toast(decided ? 'Saved — an applicability change is flagged for re-evaluation.' : 'Saved.');
      refresh();
    },
    onError: (e) => fail(e, 'save'),
  });
  const run = useMutation({
    mutationFn: () => apiFetch(`${base}/run-suggestions`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast('Assessment refreshed.');
      refresh();
    },
    onError: (e) => fail(e, 'run the assessment'),
  });
  const decision = useMutation({
    mutationFn: (body: Decision) =>
      apiFetch(`${base}/decision`, { method: 'POST', body: { ...body, version: a.version } }),
    onSuccess: () => {
      toast('Conclusion recorded.');
      refresh();
    },
    onError: (e) => fail(e, 'record the conclusion'),
  });
  const partner = useMutation({
    mutationFn: (note: string) =>
      apiFetch(`${base}/partner-approve`, {
        method: 'POST',
        body: { note: note || undefined, version: a.version },
      }),
    onSuccess: () => {
      toast('Partner approval recorded.');
      refresh();
    },
    onError: (e) => fail(e, 'approve'),
  });
  const busy = facts.isPending || decision.isPending || partner.isPending || run.isPending;
  const save = (patch: FactsPatch) => facts.mutate(patch);

  const completion = or.completion;
  const blocking = (d?.missingFacts ?? []).filter((m) => m.blocking);
  const awaiting = (d?.missingFacts ?? []).filter((m) => !m.blocking);
  const status = approved
    ? 'Approved (Section 02)'
    : completion?.complete
      ? '02.7 COMPLETE'
      : blocking.length
        ? 'Pending facts'
        : a.systemOutcome === 'attention_required'
          ? 'Attention required'
          : completion?.status === 'not_started'
            ? 'Not started'
            : 'In progress';
  const statusTone =
    approved || completion?.complete ? 'success' : status === 'Attention required' ? 'danger' : 'warn';
  const cf = or.capturedFacts;
  const fraud = d?.fraud;

  return (
    <div className="space-y-3" data-testid="other-reporting-workspace">
      {/* Header (§3) */}
      <div className="space-y-1 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">
            Other Companies Act &amp; Statutory Reporting
          </span>
          <Badge tone={statusTone}>{status}</Badge>
          <span className="text-ink-muted">
            Current conclusion:{' '}
            <span className="font-medium text-ink">
              {decided
                ? outcomeLabel(a.conclusion)
                : or.professionalAction === 'information_pending'
                  ? 'Information Pending'
                  : 'Not concluded'}
            </span>
          </span>
          {a.needsReevaluation && (
            <Badge tone="warn">Needs re-evaluation — an applicability fact changed</Badge>
          )}
          {!or.upstreamReady && <Badge tone="neutral">Provisional — 02.1 not confirmed</Badge>}
          {canManage && !approved && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run.mutate()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Re-run assessment
            </Button>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          Identifies every statutory reporting obligation for this audit period and where its work
          happens. 02.7 is complete once applicability is determined — the cards can stay Work
          Pending until the reporting work is done.
          {d?.rule11Version &&
            ` Rule 11 version: ${d.rule11Version.code} from ${d.rule11Version.effectiveFrom}.`}
        </p>
      </div>

      {/* System assessment (§3, §20) */}
      <Section id="or-system" title="System assessment" open>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={a.systemOutcome === 'configured' ? 'success' : 'warn'}>
            {outcomeLabel(a.systemOutcome)}
          </Badge>
          <span className="text-ink">{a.systemBasis}</span>
        </p>
        {blocking.length > 0 && (
          <div className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-800">
            <p className="font-medium">Pending facts — these block the matrix:</p>
            <ul className="ml-5 list-disc">
              {blocking.map((m) => (
                <li key={m.key}>{m.label}</li>
              ))}
            </ul>
          </div>
        )}
        {awaiting.length > 0 && (
          <p className="text-xs text-ink-muted">
            Awaiting other work (not blocking): {awaiting.map((m) => m.label).join('; ')}
          </p>
        )}
        {(d?.matters ?? []).length > 0 && (
          <ul className="space-y-1 text-sm" aria-label="Reporting matters">
            {d!.matters.map((m, i) => (
              <li key={`${m.code}-${i}`} className="flex gap-2">
                <Badge tone={m.severity === 'high' ? 'danger' : 'warn'}>{m.severity}</Badge>
                <span className="text-ink">{m.message}</span>
              </li>
            ))}
          </ul>
        )}
        {(d?.rulesUsed ?? []).length > 0 && (
          <table className="w-full text-xs" aria-label="Rules Library values used">
            <thead className="text-left uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="py-1">Rule</th>
                <th>Value</th>
                <th>In force from</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d!.rulesUsed.map((r) => (
                <tr key={r.code}>
                  <td className="py-1 text-ink">
                    {r.label} <span className="text-ink-faint">({r.code})</span>
                  </td>
                  <td>{r.value == null ? 'Not configured' : `${r.value} ${r.unit}`}</td>
                  <td>{r.effectiveFrom ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Section 143(3) core facts (§4) */}
      <Section id="or-143-facts" title="Section 143(3) — team confirmations">
        <Core facts={cf} disabled={!factsEditable || busy} onSave={save} />
      </Section>

      {/* Requirement matrix (§16, §17) */}
      <Section id="or-matrix" title="Statutory reporting matrix" open>
        <OtherReportingMatrix
          engagementId={engagementId}
          or={or}
          canManage={canManage}
          factsEditable={factsEditable}
          onSaveFacts={save}
          busy={busy}
        />
      </Section>

      <Section id="or-rule11" title="Rule 11(a)–(f)">
        <OtherReportingRule11 facts={cf} disabled={!factsEditable || busy} onSave={save} />
      </Section>

      <Section id="or-audit-trail" title="Rule 11(g) — audit trail">
        <OtherReportingAuditTrail
          systems={cf.softwareSystems}
          result={d?.rule11g}
          disabled={!factsEditable || busy}
          onSave={(softwareSystems) => save({ softwareSystems })}
        />
      </Section>

      <Section id="or-197" title="Section 197(16) — managerial remuneration">
        <OtherReportingRemuneration
          facts={cf}
          result={d?.remuneration}
          publicCompany={or.baseFacts.isPublicCompany}
          publicSource={or.baseFacts.publicCompanySource}
          disabled={!factsEditable || busy}
          onSave={save}
        />
      </Section>

      <Section id="or-fraud" title="Section 143(12) — fraud reporting">
        {fraud && (
          <p className="text-sm text-ink-muted">
            {fraud.basis}
            {fraud.thresholdAmount != null &&
              ` Central Government threshold: ${rupees(fraud.thresholdAmount)}.`}
          </p>
        )}
        <OtherReportingFraud
          engagementId={engagementId}
          workflowInstanceId={or.workflowInstanceId}
          canManage={canManage}
        />
      </Section>

      <Section id="or-directors" title="Section 164(2) — director disqualification">
        <OtherReportingDirectors
          engagementId={engagementId}
          workflowInstanceId={or.workflowInstanceId}
          canManage={canManage}
        />
      </Section>

      <Section id="or-cross-refs" title="CARO, ICFR and branch reporting (02.4 / 02.5 / 02.6)">
        <OtherReportingCrossRefs
          engagementId={engagementId}
          workflowInstanceId={or.workflowInstanceId}
          canManage={canManage}
        />
      </Section>

      <Section id="or-conclusion" title="Professional conclusion" open>
        <Conclusion
          or={or}
          canManage={canManage}
          disabled={!canManage || approved || busy}
          onDecide={(b) => decision.mutate(b)}
          onPartnerApprove={(n) => partner.mutate(n)}
          partnerBusy={partner.isPending}
        />
      </Section>

      {completion && (
        <Section
          id="or-completion"
          title="Completion"
          badge={
            <Badge tone={completion.complete ? 'success' : 'warn'}>
              {completion.complete ? '02.7 COMPLETE' : 'Open items'}
            </Badge>
          }
          open
        >
          <ul className="space-y-1 text-sm" aria-label="02.7 completion checklist">
            {completion.items.map((i) => (
              <li key={i.key} className="flex items-start gap-2">
                {i.met === null ? (
                  <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-label="Not relevant" />
                ) : i.met ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" aria-label="Done" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-warning-600" aria-label="Open" />
                )}
                <span>
                  <span className="text-ink">{i.label}</span>
                  {i.detail && <span className="block text-xs text-ink-muted">{i.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

const CORE: Array<[keyof Pick<StatutoryAuditOtherReporting['capturedFacts'], 'informationObtained' | 'booksProper' | 'adverseObservations' | 'accountsQualification'>, string]> = [
  ['informationObtained', '143(3)(a) — all information and explanations obtained?'],
  ['booksProper', '143(3)(b) — proper books of account kept?'],
  ['adverseObservations', '143(3)(f) — observations with an adverse effect on functioning?'],
  ['accountsQualification', '143(3)(h) — qualification relating to maintenance of accounts?'],
];

function Core({
  facts,
  disabled,
  onSave,
}: {
  facts: StatutoryAuditOtherReporting['capturedFacts'];
  disabled: boolean;
  onSave: (patch: FactsPatch) => void;
}): JSX.Element {
  const [v, setV] = useState<Record<string, Tri>>(
    Object.fromEntries(CORE.map(([k]) => [k, facts[k] ?? 'pending'])),
  );
  return (
    <div className="space-y-1">
      {CORE.map(([k, label]) => (
        <TriSelect
          key={k}
          label={label}
          value={v[k] ?? 'pending'}
          disabled={disabled}
          onChange={(t) => setV({ ...v, [k]: t })}
        />
      ))}
      <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onSave(v)}>
        Save
      </Button>
    </div>
  );
}

function Conclusion({
  or,
  canManage,
  disabled,
  onDecide,
  onPartnerApprove,
  partnerBusy,
}: {
  or: StatutoryAuditOtherReporting;
  canManage: boolean;
  disabled: boolean;
  onDecide: (b: Decision) => void;
  onPartnerApprove: (note: string) => void;
  partnerBusy: boolean;
}): JSX.Element {
  const a = or.assessment;
  const [mode, setMode] = useState<'none' | 'override' | 'pending'>('none');
  const [conclusion, setConclusion] = useState('');
  const [basis, setBasis] = useState('');
  const [technical, setTechnical] = useState('');
  const [evidence, setEvidence] = useState('');
  const [pending, setPending] = useState('');
  const [note, setNote] = useState('');
  const decided = DECIDED.has(a.state);
  const decisive = a.systemOutcome === 'configured' || a.systemOutcome === 'attention_required';
  const pa = or.partnerApproval;
  const blocking = (or.detail?.missingFacts ?? []).filter((m) => m.blocking);

  return (
    <div className="space-y-3 text-sm">
      {decided ? (
        <div className="text-ink">
          <p>
            <span className="font-semibold">{outcomeLabel(a.conclusion)}</span>
            {a.isOverridden ? ' — overrides the system assessment' : ' — system assessment confirmed'}
            {a.decidedByName && ` · ${a.decidedByName}`}
            {a.decidedAt && ` · ${formatDate(a.decidedAt)}`}
          </p>
          {a.isOverridden && (
            <p className="text-ink-muted">System conclusion retained: {outcomeLabel(a.systemOutcome)}</p>
          )}
          {a.basis && <p className="text-ink-muted">Reason: {a.basis}</p>}
          {or.capturedFacts.technicalBasis && (
            <p className="text-ink-muted">Technical basis: {or.capturedFacts.technicalBasis}</p>
          )}
          {or.capturedFacts.supportingEvidence && (
            <p className="text-ink-muted">Supporting evidence: {or.capturedFacts.supportingEvidence}</p>
          )}
        </div>
      ) : or.professionalAction === 'information_pending' ? (
        <p className="text-warning-700">Information Pending — {or.pendingReason}</p>
      ) : (
        <p className="text-ink-muted">
          Not concluded yet — the Manager normally confirms the system assessment.
        </p>
      )}

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={disabled || !decisive}
            title={decisive ? undefined : 'Pending facts block the matrix'}
            onClick={() => onDecide({ action: 'confirm' })}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm System Assessment
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            aria-expanded={mode === 'override'}
            onClick={() => setMode(mode === 'override' ? 'none' : 'override')}
          >
            Override Assessment
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            aria-expanded={mode === 'pending'}
            onClick={() => setMode(mode === 'pending' ? 'none' : 'pending')}
          >
            Information Pending
          </Button>
        </div>
      )}

      {mode === 'override' && (
        <div className="space-y-2 rounded-md border border-line p-3">
          <Field label="Final conclusion" required>
            <Select value={conclusion} onChange={(e) => setConclusion(e.target.value)}>
              <option value="">Select…</option>
              {OTHER_REPORTING_CONCLUSIONS.map((o) => (
                <option key={o} value={o}>
                  {OTHER_REPORTING_OUTCOME_LABEL[o]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason (mandatory)" required>
            <Textarea rows={2} value={basis} onChange={(e) => setBasis(e.target.value)} />
          </Field>
          <Field label="Technical basis (mandatory)" required>
            <Textarea rows={2} value={technical} onChange={(e) => setTechnical(e.target.value)} />
          </Field>
          <Field
            label="Supporting evidence"
            hint="Describe it, or link a file on a card. A significant override needs Engagement Partner approval."
          >
            <Textarea rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </Field>
          <Button
            size="sm"
            disabled={disabled || !conclusion || !basis.trim() || !technical.trim()}
            onClick={() => {
              onDecide({
                action: 'override',
                conclusion: conclusion as OtherReportingOutcome,
                basis: basis.trim(),
                technicalBasis: technical.trim(),
                supportingEvidence: evidence.trim() || undefined,
              });
              setMode('none');
            }}
          >
            Record override
          </Button>
        </div>
      )}

      {mode === 'pending' && (
        <div className="space-y-2 rounded-md border border-line p-3">
          {blocking.length > 0 && (
            <p className="text-xs text-ink-muted">
              Blocking facts identified by the system: {blocking.map((m) => m.label).join(', ')}.
            </p>
          )}
          <Field label="Which information is pending?" required={blocking.length === 0}>
            <Input value={pending} onChange={(e) => setPending(e.target.value)} />
          </Field>
          <Button
            size="sm"
            disabled={disabled || (!pending.trim() && blocking.length === 0)}
            onClick={() => {
              onDecide({ action: 'information_pending', pendingReason: pending.trim() || undefined });
              setMode('none');
            }}
          >
            Mark Information Pending
          </Button>
        </div>
      )}

      {pa?.required && (
        <div className="rounded-md border border-line bg-surface-sunken p-3">
          <p className="flex items-center gap-1.5 font-medium text-ink">
            <ShieldCheck className="h-4 w-4" /> Engagement Partner approval
          </p>
          <p className="text-xs text-ink-muted">{pa.reason}</p>
          {pa.approvedAt ? (
            <p className="text-success-700">
              Approved by {pa.approvedByName ?? 'the Engagement Partner'} · {formatDate(pa.approvedAt)}
              {pa.note && ` — ${pa.note}`}
            </p>
          ) : or.viewerIsPartner && canManage ? (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <Field label="Approval note (optional)">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </div>
              <Button size="sm" disabled={partnerBusy} onClick={() => onPartnerApprove(note.trim())}>
                Approve as Engagement Partner
              </Button>
            </div>
          ) : (
            <p className="text-warning-700">Awaiting Engagement Partner approval.</p>
          )}
        </div>
      )}
    </div>
  );
}
