'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import {
  FRAUD_CONCLUSION_LABEL,
  FRAUD_CONCLUSIONS,
  FRAUD_MATTER_ROUTE_LABEL,
  FRAUD_PERPETRATOR_LABEL,
  FRAUD_PERPETRATORS,
  FRAUD_REGULATORY_STATUS_LABEL,
  FRAUD_SOURCE_LABEL,
  FRAUD_SOURCES,
  OTHER_REPORTING_REFERENCE_ANCHOR as ANCHOR,
  REPORTING_CARD,
  type FraudConclusion,
  type FraudDeadline,
  type FraudMatter,
  type FraudMatterRoute,
  type FraudPerpetrator,
  type FraudSource,
  type StatutoryAuditReportingRecords,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { FrameworkReferences } from './framework-references';
import { ReportingCardEvidence } from './other-reporting-evidence';
import { orNull, useReportingRecords, type RecordsAct } from './reporting-records-query';

/**
 * 02.7 Section 143(12) fraud framework (spec §14) — always available, whatever
 * the other cards say. One central Fraud Matter per fraud: the facts, the
 * Rule 13 deadline engine (the Rules Library version in force on the date
 * knowledge was obtained), the Engagement Partner consultation and the
 * conclusion. Rows expand in place (+/−); nothing is deleted — matters are
 * withdrawn. 02.6 group findings categorised as fraud are offered to raise.
 */

const ROUTE_TONE: Record<FraudMatterRoute, string> = {
  central_government: 'danger',
  audit_committee_board: 'warn',
  pending: 'neutral',
};
const DEADLINE_TONE: Record<FraudDeadline['status'], string> = {
  met: 'success',
  met_late: 'warn',
  due: 'info',
  overdue: 'danger',
};

export function OtherReportingFraud({
  engagementId,
  workflowInstanceId,
  canManage,
}: {
  engagementId: string;
  workflowInstanceId: string;
  canManage: boolean;
}): JSX.Element {
  const { q, busy, act } = useReportingRecords(engagementId, workflowInstanceId);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [raising, setRaising] = useState(false);
  const [showWithdrawn, setShowWithdrawn] = useState(false);

  if (q.isLoading) return <Spinner label="Loading the Fraud Matters…" />;
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-danger-700">
        {q.error instanceof ApiError ? q.error.message : 'Could not load the Fraud Matters.'}
      </p>
    );
  }
  const view = q.data;
  const editable = canManage && view.canManage;
  const { status, rules, matters, candidates } = view.fraud;
  const live = matters.filter((m) => !m.withdrawn);
  const withdrawn = matters.filter((m) => m.withdrawn);
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section className="space-y-2 text-xs" aria-label="Section 143(12) Fraud Matters">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{status.matters} Fraud Matter(s)</Badge>
        {status.open > 0 && <Badge tone="warn">{status.open} open</Badge>}
        {status.overdue > 0 && <Badge tone="danger">{status.overdue} overdue</Badge>}
        {status.centralGovernmentRoute > 0 && (
          <Badge tone="danger">{status.centralGovernmentRoute} Central Government route</Badge>
        )}
        {status.belowThreshold > 0 && (
          <Badge tone="warn">{status.belowThreshold} Audit Committee / Board route</Badge>
        )}
        {status.nextDeadline && (
          <span className="text-ink-muted">Next deadline {formatDate(status.nextDeadline)}</span>
        )}
      </div>

      <RulesInForce view={view} />
      {!status.active && (
        <p className="text-danger-700">
          The Rule 13 rules are missing from the Rules Library for this period — the deadlines
          cannot be computed. Ask an administrator to configure them.
        </p>
      )}

      {editable && candidates.length > 0 && (
        <div className="rounded-md border border-warning-200 bg-warning-50/40 p-2">
          <p className="font-medium text-ink">Possible fraud from the file</p>
          <ul className="mt-1 space-y-1">
            {candidates.map((c) => (
              <li key={`${c.source}:${c.sourceRef}`} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-ink">
                  {c.label}
                  <span className="text-ink-faint"> · {FRAUD_SOURCE_LABEL[c.source]}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      (base) =>
                        apiFetch<StatutoryAuditReportingRecords>(`${base}/fraud-matters`, {
                          method: 'POST',
                          body: {
                            nature: c.label.slice(0, 500),
                            description: c.description || null,
                            source: c.source,
                            sourceRef: c.sourceRef,
                          },
                        }),
                      'Fraud Matter raised.',
                    )
                  }
                >
                  Raise as Fraud Matter
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {live.length === 0 ? (
        <p className="text-ink-faint">
          No Fraud Matter recorded. Raise one as soon as the auditor has reason to believe a fraud
          is being or has been committed — the Rule 13 periods run from that date.
        </p>
      ) : (
        <div className="divide-y divide-line rounded-md border border-line">
          {live.map((m) => (
            <MatterRow
              key={m.id}
              matter={m}
              view={view}
              open={open.has(m.id)}
              onToggle={() => toggle(m.id)}
              engagementId={engagementId}
              workflowInstanceId={workflowInstanceId}
              editable={editable}
              busy={busy}
              act={act}
            />
          ))}
        </div>
      )}

      {withdrawn.length > 0 && (
        <button
          type="button"
          className="text-ink-faint hover:text-ink"
          aria-expanded={showWithdrawn}
          onClick={() => setShowWithdrawn((o) => !o)}
        >
          {showWithdrawn ? 'Hide' : 'Show'} {withdrawn.length} withdrawn
        </button>
      )}
      {showWithdrawn && (
        <div className="divide-y divide-line rounded-md border border-line opacity-70">
          {withdrawn.map((m) => (
            <MatterRow
              key={m.id}
              matter={m}
              view={view}
              open={open.has(m.id)}
              onToggle={() => toggle(m.id)}
              engagementId={engagementId}
              workflowInstanceId={workflowInstanceId}
              editable={editable}
              busy={busy}
              act={act}
            />
          ))}
        </div>
      )}

      {editable && (
        <div>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-primary-600 hover:underline"
            aria-expanded={raising}
            onClick={() => setRaising((o) => !o)}
          >
            {raising ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />} Raise a Fraud
            Matter
          </button>
          {raising && (
            <NewMatterForm
              busy={busy}
              onSubmit={async (body) => {
                const ok = await act(
                  (base) =>
                    apiFetch<StatutoryAuditReportingRecords>(`${base}/fraud-matters`, {
                      method: 'POST',
                      body,
                    }),
                  'Fraud Matter raised.',
                );
                if (ok) setRaising(false);
              }}
            />
          )}
        </div>
      )}

      <ReportingCardEvidence
        engagementId={engagementId}
        workflowInstanceId={workflowInstanceId}
        cardKey={REPORTING_CARD.s143_12Fraud}
        canManage={canManage}
      />
      <FrameworkReferences
        contextKey="02.7"
        anchors={[ANCHOR.section143_12, ANCHOR.rule13, ANCHOR.formAdt4]}
        effectiveOn={view.periodStart}
      />
      {rules.thresholdAmount === null && status.active && (
        <p className="text-ink-faint">No threshold configured for this period.</p>
      )}
    </section>
  );
}

function RulesInForce({ view }: { view: StatutoryAuditReportingRecords }): JSX.Element {
  const r = view.fraud.rules;
  return (
    <p className="text-ink-muted" aria-label="Rule 13 rules in force">
      Rules Library for the period from {formatDate(view.periodStart)}:{' '}
      {r.thresholdAmount !== null
        ? `Central Government route at or above ${formatMoney(r.thresholdAmount)}`
        : 'threshold not configured'}
      {r.initialNoticeDays !== null ? ` · initial notice ${r.initialNoticeDays} days` : ''}
      {r.responseDays !== null ? ` · reply ${r.responseDays} days` : ''}
      {r.forwardDays !== null ? ` · forward ${r.forwardDays} days` : ''}. A matter uses the version
      in force on its knowledge date.
    </p>
  );
}

function MatterRow({
  matter: m,
  view,
  open,
  onToggle,
  engagementId,
  workflowInstanceId,
  editable,
  busy,
  act,
}: {
  matter: FraudMatter;
  view: StatutoryAuditReportingRecords;
  open: boolean;
  onToggle: () => void;
  engagementId: string;
  workflowInstanceId: string;
  editable: boolean;
  busy: boolean;
  act: RecordsAct;
}): JSX.Element {
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-sunken/50"
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${m.ref}`}
        onClick={onToggle}
      >
        {open ? (
          <Minus className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        ) : (
          <Plus className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        )}
        <span className="w-16 shrink-0 font-mono text-ink-muted">{m.ref}</span>
        <span className="min-w-0 flex-1 truncate text-ink">{m.nature}</span>
        {m.withdrawn ? (
          <Badge tone="warn">Withdrawn</Badge>
        ) : (
          <>
            {m.amount !== null && (
              <span className="text-ink-muted">
                {m.amountEstimated ? '≈ ' : ''}
                {formatMoney(m.amount)}
              </span>
            )}
            <Badge tone={ROUTE_TONE[m.route]}>
              {m.route === 'central_government'
                ? 'Central Government'
                : m.route === 'audit_committee_board'
                  ? 'Audit Committee / Board'
                  : 'Route pending'}
            </Badge>
            <Badge>{FRAUD_REGULATORY_STATUS_LABEL[m.regulatoryStatus]}</Badge>
            {m.overdue && <Badge tone="danger">Overdue</Badge>}
            {m.conclusion !== 'pending' && (
              <Badge tone="success">{FRAUD_CONCLUSION_LABEL[m.conclusion]}</Badge>
            )}
          </>
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t border-line bg-surface-sunken/30 px-3 py-3">
          {m.fromLegacy && (
            <p className="text-warning-700">
              Moved from the earlier 02.7 fraud facts — confirm the nature, the parties and that the
              date is the date knowledge was obtained.
            </p>
          )}
          <p className="text-ink-muted">
            Route: {FRAUD_MATTER_ROUTE_LABEL[m.route]} — {m.routeBasis}
          </p>
          <Deadlines deadlines={m.deadlines} />
          <MatterForm matter={m} editable={editable} busy={busy} act={act} />
          <Consultation matter={m} view={view} editable={editable} busy={busy} act={act} />
          <Conclusion matter={m} editable={editable} busy={busy} act={act} />
          <ReportingCardEvidence
            engagementId={engagementId}
            workflowInstanceId={workflowInstanceId}
            cardKey={REPORTING_CARD.s143_12Fraud}
            canManage={editable}
            fraudMatterId={m.id}
          />
          {editable && (
            <button
              type="button"
              className="text-ink-faint hover:text-danger-700"
              disabled={busy}
              onClick={() =>
                void act(
                  (base) =>
                    apiFetch<StatutoryAuditReportingRecords>(`${base}/fraud-matters/${m.id}`, {
                      method: 'PATCH',
                      body: { withdrawn: !m.withdrawn, version: m.version },
                    }),
                  m.withdrawn ? `${m.ref} restored.` : `${m.ref} withdrawn.`,
                )
              }
            >
              {m.withdrawn ? 'Restore' : 'Withdraw'} {m.ref}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Deadlines({ deadlines }: { deadlines: FraudDeadline[] }): JSX.Element {
  if (deadlines.length === 0)
    return (
      <p className="text-ink-faint">
        Record the date knowledge was obtained — the Rule 13 deadlines run from it.
      </p>
    );
  return (
    <table className="w-full text-left" aria-label="Rule 13 deadlines">
      <thead className="text-ink-faint">
        <tr>
          <th className="py-1 font-medium">Step</th>
          <th className="py-1 font-medium">From</th>
          <th className="py-1 font-medium">Due</th>
          <th className="py-1 font-medium">Done</th>
          <th className="py-1 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {deadlines.map((d) => (
          <tr key={d.key} className="border-t border-line">
            <td className="py-1 pr-2 text-ink">
              {d.label}
              {d.provisional && <span className="text-ink-faint"> (provisional)</span>}
            </td>
            <td className="py-1 pr-2 text-ink-muted">
              {d.fromEvent} {formatDate(d.fromDate)}
              {d.days > 0 ? ` + ${d.days} days` : ''}
            </td>
            <td className="py-1 pr-2 text-ink">{formatDate(d.dueDate)}</td>
            <td className="py-1 pr-2 text-ink-muted">{d.metOn ? formatDate(d.metOn) : '—'}</td>
            <td className="py-1">
              <Badge tone={DEADLINE_TONE[d.status]}>{d.status.replace('_', ' ')}</Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface MatterBody {
  nature: string;
  description: string | null;
  amount: number | null;
  amountEstimated: boolean;
  perpetrator: FraudPerpetrator;
  partiesInvolved: string | null;
  knowledgeDate: string | null;
  source: FraudSource;
}

function amountOf(s: string): number | null {
  const n = Number(s.replace(/,/g, ''));
  return s.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function NewMatterForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: MatterBody) => Promise<void>;
}): JSX.Element {
  const [nature, setNature] = useState('');
  const [amount, setAmount] = useState('');
  const [estimated, setEstimated] = useState(false);
  const [knowledge, setKnowledge] = useState('');
  const [source, setSource] = useState<FraudSource>('audit_procedure');
  return (
    <form
      className="mt-2 grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          nature: nature.trim(),
          description: null,
          amount: amountOf(amount),
          amountEstimated: estimated,
          perpetrator: 'unknown',
          partiesInvolved: null,
          knowledgeDate: knowledge || null,
          source,
        });
      }}
    >
      <Field label="Nature of the fraud" required className="sm:col-span-2">
        <Input value={nature} onChange={(e) => setNature(e.target.value)} aria-label="Nature" />
      </Field>
      <Field label="Amount involved (₹)" hint="An estimate is enough to set the route.">
        <Input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount"
        />
      </Field>
      <Field label="Date knowledge was obtained" hint="The Rule 13 periods run from this date.">
        <Input
          type="date"
          value={knowledge}
          onChange={(e) => setKnowledge(e.target.value)}
          aria-label="Knowledge date"
        />
      </Field>
      <label className="flex items-center gap-2 text-ink">
        <input
          type="checkbox"
          checked={estimated}
          onChange={(e) => setEstimated(e.target.checked)}
        />
        The amount is an estimate
      </label>
      <Field label="Identified through">
        <Select
          value={source}
          onChange={(e) => setSource(e.target.value as FraudSource)}
          aria-label="Source"
        >
          {FRAUD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {FRAUD_SOURCE_LABEL[s]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Button size="sm" type="submit" disabled={busy || !nature.trim()}>
          {busy ? 'Saving…' : 'Raise Fraud Matter'}
        </Button>
      </div>
    </form>
  );
}

function MatterForm({
  matter: m,
  editable,
  busy,
  act,
}: {
  matter: FraudMatter;
  editable: boolean;
  busy: boolean;
  act: RecordsAct;
}): JSX.Element {
  const [nature, setNature] = useState(m.nature);
  const [description, setDescription] = useState(m.description ?? '');
  const [amount, setAmount] = useState(m.amount === null ? '' : String(m.amount));
  const [estimated, setEstimated] = useState(m.amountEstimated);
  const [perpetrator, setPerpetrator] = useState<FraudPerpetrator>(m.perpetrator);
  const [parties, setParties] = useState(m.partiesInvolved ?? '');
  const [knowledge, setKnowledge] = useState(m.knowledgeDate ?? '');
  const [source, setSource] = useState<FraudSource>(m.source);
  const [procedures, setProcedures] = useState(m.auditProcedures ?? '');
  const [tcwg, setTcwg] = useState(m.tcwgCommunication ?? '');
  const [board, setBoard] = useState(m.boardReportedOn ?? '');
  const [reply, setReply] = useState(m.replyReceivedOn ?? '');
  const [forwarded, setForwarded] = useState(m.cgForwardedOn ?? '');
  const [adt4, setAdt4] = useState(m.adt4Reference ?? '');
  const [regulatory, setRegulatory] = useState(m.regulatoryNote ?? '');
  const disabled = !editable || m.withdrawn;
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      aria-label={`${m.ref} facts and Rule 13 dates`}
      onSubmit={(e) => {
        e.preventDefault();
        void act(
          (base) =>
            apiFetch<StatutoryAuditReportingRecords>(`${base}/fraud-matters/${m.id}`, {
              method: 'PATCH',
              body: {
                nature: nature.trim(),
                description: orNull(description),
                amount: amountOf(amount),
                amountEstimated: estimated,
                perpetrator,
                partiesInvolved: orNull(parties),
                knowledgeDate: knowledge || null,
                source,
                auditProcedures: orNull(procedures),
                tcwgCommunication: orNull(tcwg),
                boardReportedOn: board || null,
                replyReceivedOn: reply || null,
                cgForwardedOn: forwarded || null,
                adt4Reference: orNull(adt4),
                regulatoryNote: orNull(regulatory),
                version: m.version,
              },
            }),
          `${m.ref} saved.`,
        );
      }}
    >
      <fieldset disabled={disabled} className="contents">
        <Field label="Nature" className="sm:col-span-2">
          <Input value={nature} onChange={(e) => setNature(e.target.value)} aria-label="Nature" />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label="Description"
          />
        </Field>
        <Field label="Amount involved (₹)">
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Amount"
          />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-ink">
          <input
            type="checkbox"
            checked={estimated}
            onChange={(e) => setEstimated(e.target.checked)}
          />
          Estimated amount
        </label>
        <Field label="Perpetrator">
          <Select
            value={perpetrator}
            onChange={(e) => setPerpetrator(e.target.value as FraudPerpetrator)}
            aria-label="Perpetrator"
          >
            {FRAUD_PERPETRATORS.map((p) => (
              <option key={p} value={p}>
                {FRAUD_PERPETRATOR_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Parties involved">
          <Input
            value={parties}
            onChange={(e) => setParties(e.target.value)}
            aria-label="Parties"
          />
        </Field>
        <Field label="Date knowledge was obtained">
          <Input
            type="date"
            value={knowledge}
            onChange={(e) => setKnowledge(e.target.value)}
            aria-label="Knowledge date"
          />
        </Field>
        <Field label="Identified through">
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value as FraudSource)}
            aria-label="Source"
          >
            {FRAUD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {FRAUD_SOURCE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Audit procedures performed" className="sm:col-span-2">
          <Textarea
            value={procedures}
            onChange={(e) => setProcedures(e.target.value)}
            aria-label="Audit procedures"
          />
        </Field>
        <Field label="Communication with those charged with governance" className="sm:col-span-2">
          <Textarea value={tcwg} onChange={(e) => setTcwg(e.target.value)} aria-label="TCWG" />
        </Field>
        <Field label="Reported to the Board / Audit Committee on">
          <Input
            type="date"
            value={board}
            onChange={(e) => setBoard(e.target.value)}
            aria-label="Board reported on"
          />
        </Field>
        <Field label="Reply / observations received on">
          <Input
            type="date"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            aria-label="Reply received on"
          />
        </Field>
        <Field label="Forwarded to the Central Government on">
          <Input
            type="date"
            value={forwarded}
            onChange={(e) => setForwarded(e.target.value)}
            aria-label="Forwarded on"
          />
        </Field>
        <Field label="Form ADT-4 / SRN reference">
          <Input
            value={adt4}
            onChange={(e) => setAdt4(e.target.value)}
            aria-label="ADT-4 reference"
          />
        </Field>
        <Field
          label="Regulatory note"
          hint="e.g. no reply received — forwarded with a note under Rule 13."
          className="sm:col-span-2"
        >
          <Textarea
            value={regulatory}
            onChange={(e) => setRegulatory(e.target.value)}
            aria-label="Regulatory note"
          />
        </Field>
        {!disabled && (
          <div className="sm:col-span-2">
            <Button size="sm" type="submit" disabled={busy || !nature.trim()}>
              {busy ? 'Saving…' : `Save ${m.ref}`}
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}

function Consultation({
  matter: m,
  view,
  editable,
  busy,
  act,
}: {
  matter: FraudMatter;
  view: StatutoryAuditReportingRecords;
  editable: boolean;
  busy: boolean;
  act: RecordsAct;
}): JSX.Element {
  const [note, setNote] = useState('');
  return (
    <div aria-label={`${m.ref} partner consultation`}>
      <p className="font-medium text-ink">Engagement Partner consultation</p>
      {m.partnerConsultedAt ? (
        <p className="text-ink-muted">
          {m.partnerConsultedByName ?? 'Engagement Partner'} · {formatDate(m.partnerConsultedAt)}
          {m.partnerNote ? ` — ${m.partnerNote}` : ''}
        </p>
      ) : (
        <p className="text-ink-faint">
          Not yet consulted — required before the matter is concluded.
        </p>
      )}
      {editable && view.viewerIsPartner && !m.withdrawn && (
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Consultation note"
            placeholder="The consultation and its outcome…"
            className="min-w-[16rem] flex-1"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy || !note.trim()}
            onClick={async () => {
              const ok = await act(
                (base) =>
                  apiFetch<StatutoryAuditReportingRecords>(
                    `${base}/fraud-matters/${m.id}/partner-consultation`,
                    { method: 'POST', body: { note: note.trim(), version: m.version } },
                  ),
                'Consultation recorded.',
              );
              if (ok) setNote('');
            }}
          >
            {m.partnerConsultedAt ? 'Record again' : 'Record consultation'}
          </Button>
        </div>
      )}
    </div>
  );
}

function Conclusion({
  matter: m,
  editable,
  busy,
  act,
}: {
  matter: FraudMatter;
  editable: boolean;
  busy: boolean;
  act: RecordsAct;
}): JSX.Element {
  const [conclusion, setConclusion] = useState<FraudConclusion>(m.conclusion);
  const [note, setNote] = useState(m.conclusionNote ?? '');
  const disabled = !editable || m.withdrawn;
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      aria-label={`${m.ref} conclusion`}
      onSubmit={(e) => {
        e.preventDefault();
        void act(
          (base) =>
            apiFetch<StatutoryAuditReportingRecords>(`${base}/fraud-matters/${m.id}`, {
              method: 'PATCH',
              body: { conclusion, conclusionNote: orNull(note), version: m.version },
            }),
          `${m.ref} conclusion saved.`,
        );
      }}
    >
      <fieldset disabled={disabled} className="contents">
        <Field label="Conclusion">
          <Select
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value as FraudConclusion)}
            aria-label="Conclusion"
          >
            {FRAUD_CONCLUSIONS.map((c) => (
              <option key={c} value={c}>
                {FRAUD_CONCLUSION_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Basis of the conclusion">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Conclusion basis"
          />
        </Field>
        {!disabled && (
          <div className="sm:col-span-2">
            <Button size="sm" type="submit" disabled={busy}>
              Save conclusion
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
