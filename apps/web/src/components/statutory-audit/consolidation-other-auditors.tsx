'use client';

import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import {
  COMPONENT_AUDITOR_TYPE_LABEL,
  COMPONENT_REPORT_TYPE_LABEL,
  COMPONENT_REPORT_TYPES,
  COMPONENT_SIGNIFICANCE,
  COMPONENT_SIGNIFICANCE_LABEL,
  CONSOLIDATION_REFERENCE_ANCHOR,
  CONSOLIDATION_REFERENCE_CONTEXT,
  FINDING_CATEGORIES,
  FINDING_CATEGORY_LABEL,
  FINDING_IMPACT_CHOICES,
  FINDING_IMPACT_LABEL,
  GA01_ANSWER_LABEL,
  GA01_ANSWERS,
  GA02_ANSWERS,
  GA_ANSWER_LABEL,
  GA_YES_NO_PENDING,
  INVESTEE_RELATIONSHIP_LABEL,
  PACKAGE_DOCUMENT_STATUS_LABEL,
  PACKAGE_DOCUMENT_STATUSES,
  SA600_CONSIDERATION_LABEL,
  SA600_CONSIDERATIONS,
  SA600_QUESTION_TEXT,
  type ComponentAuditorType,
  type ComponentInstructionsCreated,
  type Ga01Answer,
  type GroupAuditComponent,
  type GroupAuditFinding,
  type GroupFindingCategory,
  type GroupFindingImpact,
  type PackageDocument,
  type PackageDocumentStatus,
  type Sa600Answers,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import {
  BlurField,
  GroupFileSlot,
  ToggleHeader,
  useGroupAudit,
  type GroupAct,
  type GroupSend,
  type GroupView,
} from './consolidation-group-shared';
import { FrameworkReferences } from './framework-references';

/**
 * 02.6 Part B — Other Auditors (DHVAJ 02.6 spec §12–§16). One matrix row per
 * included perimeter component (from 02.6, keyed on its stable id): who
 * audits it, the SA 600 answers GA-01..04, the Component Auditor Instructions
 * (generated from the approved Word template), the 10-document reporting
 * package (approved evidence is never silently replaced) and the findings
 * register. Values carried from last year are suggestions until confirmed.
 * Rows expand inline (+/−); nothing opens a modal.
 */

const AUDITOR_TYPES = Object.keys(COMPONENT_AUDITOR_TYPE_LABEL) as ComponentAuditorType[];
const SOURCE_LABEL: Record<string, string> = {
  system: 'From 02.6',
  prior_year: 'Carried from last year',
  team: 'Confirmed by the team',
};
const auditorTone = (t: ComponentAuditorType) =>
  t === 'tbd' ? 'warn' : t === 'other_auditor' ? 'info' : 'neutral';
const pkgTone = (s: PackageDocumentStatus) =>
  s === 'approved' ? 'success' : s === 'received' ? 'info' : s === 'pending' ? 'warn' : 'neutral';

export function ConsolidationOtherAuditors({
  engagementId,
  workflowInstanceId,
  canManage = true,
}: {
  engagementId: string;
  workflowInstanceId: string;
  /** The host's own edit gate; the server decides too. */
  canManage?: boolean;
}): JSX.Element {
  const { q, base, editable, matrixEditable, busy, act, send } = useGroupAudit(
    engagementId,
    workflowInstanceId,
    canManage,
  );
  const [open, setOpen] = useState<string | null>(null);

  if (q.isLoading) return <Spinner label="Loading the component auditor matrix…" />;
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-danger-700">
        {q.error instanceof ApiError ? q.error.message : 'Could not load the group audit.'}
      </p>
    );
  }
  const view = q.data;
  const s = view.status;
  const live = view.components.filter((c) => !c.withdrawn);
  const withdrawn = view.components.filter((c) => c.withdrawn);

  return (
    <section className="space-y-3" aria-label="Other auditors">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-ink">Component auditors (SA 600)</h4>
        <Badge
          tone={
            view.matrixState === 'active'
              ? s.matrixComplete
                ? 'success'
                : 'warn'
              : view.matrixState === 'awaiting'
                ? 'warn'
                : 'neutral'
          }
        >
          {view.matrixState === 'active'
            ? s.matrixComplete
              ? 'Matrix complete'
              : 'Matrix incomplete'
            : view.matrixState === 'awaiting'
              ? 'Awaiting 02.6'
              : 'Not required'}
        </Badge>
      </div>
      <p className="text-xs text-ink-muted">{view.matrixReason}</p>

      {view.matrixState === 'active' && (
        <>
          <div className="flex flex-wrap gap-1.5 text-xs" aria-label="Group audit summary">
            <Badge>{s.dhvajComponents} audited by DHVAJ</Badge>
            <Badge tone="info">{s.otherAuditorComponents} by another auditor</Badge>
            {s.tbdComponents > 0 && <Badge tone="warn">{s.tbdComponents} auditor TBD</Badge>}
            {s.sa600Pending > 0 && (
              <Badge tone="warn">{s.sa600Pending} SA 600 answers pending</Badge>
            )}
            {s.instructionsPending > 0 && (
              <Badge tone="warn">{s.instructionsPending} instructions pending</Badge>
            )}
            {s.pendingReports > 0 && (
              <Badge tone="warn">{s.pendingReports} package documents pending</Badge>
            )}
          </div>
          {s.blockingMatters.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-danger-700" aria-label="Blocking matters">
              {s.blockingMatters.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          <Ga01 view={view} editable={matrixEditable} busy={busy} act={act} send={send} />
          <p className="text-xs text-ink-faint">{view.materialityNote}</p>
        </>
      )}

      {live.length > 0 && (
        <ul
          className="divide-y divide-line rounded-md border border-line"
          aria-label="Component auditor matrix"
        >
          {live.map((c) => (
            <li key={c.id}>
              <ToggleHeader
                open={open === c.id}
                onToggle={() => setOpen((o) => (o === c.id ? null : c.id))}
                label={`component ${c.componentName}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  {c.componentName}
                </span>
                <span className="text-ink-faint">
                  {INVESTEE_RELATIONSHIP_LABEL[c.relationship] ?? c.relationship}
                </span>
                <Badge tone={auditorTone(c.auditorType)}>
                  {COMPONENT_AUDITOR_TYPE_LABEL[c.auditorType]}
                  {c.auditorType === 'other_auditor' && c.firmName ? ` — ${c.firmName}` : ''}
                </Badge>
                {c.auditorSource !== 'team' && <Badge>{SOURCE_LABEL[c.auditorSource]}</Badge>}
                {c.auditorChanged && <Badge tone="warn">Auditor changed</Badge>}
                {c.openFindings > 0 && <Badge tone="danger">{c.openFindings} open findings</Badge>}
                {c.missing.length > 0 && <Badge tone="warn">{c.missing.length} to do</Badge>}
              </ToggleHeader>
              {open === c.id && (
                <ComponentDetail
                  engagementId={engagementId}
                  base={base}
                  view={view}
                  c={c}
                  editable={matrixEditable}
                  busy={busy}
                  act={act}
                  send={send}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {withdrawn.length > 0 && (
        <p className="text-xs text-ink-faint">
          Left the perimeter (kept for the record):{' '}
          {withdrawn.map((c) => c.componentName).join(', ')}
        </p>
      )}

      {view.matrixState !== 'awaiting' && (
        <Findings view={view} editable={editable} busy={busy} act={act} send={send} />
      )}
    </section>
  );
}

function Ga01({
  view,
  editable,
  busy,
  act,
  send,
}: {
  view: GroupView;
  editable: boolean;
  busy: boolean;
  act: GroupAct;
  send: GroupSend;
}): JSX.Element {
  const [answer, setAnswer] = useState<Ga01Answer | ''>(view.ga01 ?? '');
  const [basis, setBasis] = useState(view.ga01Basis ?? '');
  return (
    <div className="space-y-1.5 rounded-md border border-line p-2 text-xs" aria-label="GA-01">
      <p className="text-ink">
        <span className="font-mono text-ink-muted">GA-01</span> {SA600_QUESTION_TEXT.ga_01}
      </p>
      <FrameworkReferences
        contextKey={CONSOLIDATION_REFERENCE_CONTEXT}
        anchors={[CONSOLIDATION_REFERENCE_ANCHOR.sa600]}
        effectiveOn={view.periodStart}
      />
      <p className="text-ink-muted">
        {view.ga01 ? GA01_ANSWER_LABEL[view.ga01] : 'Not answered'}
        {view.ga01Source === 'system' ? ' (system suggestion)' : ''}
        {view.ga01Suggested && view.ga01Source !== 'system'
          ? ` · Suggested: ${GA01_ANSWER_LABEL[view.ga01Suggested]}`
          : ''}{' '}
        — {view.ga01Basis || view.ga01SuggestedBasis}
      </p>
      {editable && (
        <div className="grid gap-2 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
          <Field label="Answer">
            <Select value={answer} onChange={(e) => setAnswer(e.target.value as Ga01Answer)}>
              <option value="">—</option>
              {GA01_ANSWERS.map((a) => (
                <option key={a} value={a}>
                  {GA01_ANSWER_LABEL[a]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Basis" required={answer === 'yes'}>
            <Input value={basis} onChange={(e) => setBasis(e.target.value)} />
          </Field>
          <Button
            size="sm"
            disabled={busy || !answer}
            onClick={() =>
              void act(
                () =>
                  send('', 'PATCH', {
                    ga01: answer,
                    ga01Basis: basis.trim() || null,
                    version: view.version,
                  }),
                'GA-01 recorded.',
              )
            }
          >
            Record GA-01
          </Button>
        </div>
      )}
    </div>
  );
}

function ComponentDetail({
  engagementId,
  base,
  view,
  c,
  editable,
  busy,
  act,
  send,
}: {
  engagementId: string;
  base: string;
  view: GroupView;
  c: GroupAuditComponent;
  editable: boolean;
  busy: boolean;
  act: GroupAct;
  send: GroupSend;
}): JSX.Element {
  const patch = (body: object, ok?: string) =>
    act(() => send(`components/${c.id}`, 'PATCH', { ...body, version: c.version }), ok);
  const other = c.auditorType === 'other_auditor';
  const slot = { engagementId, base, editable, busy, act, ownerId: c.id };
  return (
    <div className="space-y-3 border-t border-line bg-surface-sunken/30 px-3 py-2 text-xs">
      <p className="text-ink-muted">
        {c.country ?? 'Country not recorded'}
        {c.isIndianCompany === false ? ' · not an Indian company' : ''} · Suggested auditor:{' '}
        {COMPONENT_AUDITOR_TYPE_LABEL[c.suggestedAuditorType]} — {c.suggestedBasis}
      </p>
      {c.priorYear && (
        <p className="text-ink-muted" aria-label="Last year">
          Last year:{' '}
          {c.priorYear.auditorType ? COMPONENT_AUDITOR_TYPE_LABEL[c.priorYear.auditorType] : '—'}
          {c.priorYear.firmName ? ` — ${c.priorYear.firmName}` : ''}
          {c.priorYear.reportType
            ? ` · ${COMPONENT_REPORT_TYPE_LABEL[c.priorYear.reportType]}`
            : ''}
        </p>
      )}
      {c.missing.length > 0 && (
        <ul className="list-disc pl-4 text-warning-700" aria-label="Still needed">
          {c.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Auditor">
          <Select
            value={c.auditorType}
            disabled={!editable || busy}
            onChange={(e) => void patch({ auditorType: e.target.value })}
          >
            {AUDITOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {COMPONENT_AUDITOR_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="SA 600 consideration">
          <Select
            value={c.sa600}
            disabled={!editable || busy}
            onChange={(e) => void patch({ sa600: e.target.value })}
          >
            {SA600_CONSIDERATIONS.map((x) => (
              <option key={x} value={x}>
                {SA600_CONSIDERATION_LABEL[x]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Significance to the group">
          <Select
            value={c.significance}
            disabled={!editable || busy}
            onChange={(e) => void patch({ significance: e.target.value })}
          >
            {COMPONENT_SIGNIFICANCE.map((x) => (
              <option key={x} value={x}>
                {COMPONENT_SIGNIFICANCE_LABEL[x]}
              </option>
            ))}
          </Select>
        </Field>
        {other && (
          <>
            <BlurField
              label="Audit firm"
              value={c.firmName}
              disabled={!editable || busy}
              required
              onSave={(v) => void patch({ firmName: v })}
            />
            <BlurField
              label="FRN / registration"
              value={c.frn}
              disabled={!editable || busy}
              onSave={(v) => void patch({ frn: v })}
            />
            <BlurField
              label="Professional body"
              value={c.professionalBody}
              disabled={!editable || busy}
              onSave={(v) => void patch({ professionalBody: v })}
            />
            <BlurField
              label="Auditor country"
              value={c.auditorCountry}
              disabled={!editable || busy}
              onSave={(v) => void patch({ auditorCountry: v })}
            />
            <BlurField
              label="Partner / contact"
              value={c.partnerContact}
              disabled={!editable || busy}
              onSave={(v) => void patch({ partnerContact: v })}
            />
            <BlurField
              label="Reporting deadline"
              type="date"
              value={c.reportingDeadline}
              disabled={!editable || busy}
              onSave={(v) => void patch({ reportingDeadline: v })}
            />
          </>
        )}
        <BlurField
          label="Period from"
          type="date"
          value={c.periodFrom}
          disabled={!editable || busy}
          onSave={(v) => void patch({ periodFrom: v })}
        />
        <BlurField
          label="Period to"
          type="date"
          value={c.periodTo}
          disabled={!editable || busy}
          onSave={(v) => void patch({ periodTo: v })}
        />
        <Field label="Audit report type">
          <Select
            value={c.reportType ?? ''}
            disabled={!editable || busy}
            onChange={(e) => void patch({ reportType: e.target.value || null })}
          >
            <option value="">—</option>
            {COMPONENT_REPORT_TYPES.map((x) => (
              <option key={x} value={x}>
                {COMPONENT_REPORT_TYPE_LABEL[x]}
              </option>
            ))}
          </Select>
        </Field>
        <BlurField
          label="Report date"
          type="date"
          value={c.reportDate}
          disabled={!editable || busy}
          onSave={(v) => void patch({ reportDate: v })}
        />
        <div className="sm:col-span-2">
          <BlurField
            label="Significance — basis"
            value={c.significanceNote}
            disabled={!editable || busy}
            onSave={(v) => void patch({ significanceNote: v })}
          />
        </div>
      </div>

      {other && (
        <Sa600Questions answers={c.answers} editable={editable} busy={busy} patch={patch} />
      )}

      <div className="space-y-2">
        {other && (
          <GroupFileSlot
            {...slot}
            label="Component Auditor Instructions"
            file={c.instructions}
            slot="instructions"
            extra={
              editable && !c.instructions ? (
                <CreateInstructions base={base} rowId={c.id} busy={busy} act={act} />
              ) : null
            }
          />
        )}
        <GroupFileSlot {...slot} label="Component audit report" file={c.report} slot="report" />
        {other && (
          <GroupFileSlot
            {...slot}
            label="Completion memo / clearance"
            file={c.completionMemo}
            slot="completion_memo"
          />
        )}
      </div>

      {c.package.length > 0 && (
        <PackageChecklist
          engagementId={engagementId}
          base={base}
          c={c}
          editable={editable}
          busy={busy}
          act={act}
          send={send}
        />
      )}
      {!view.materialityApproved && other && (
        <p className="text-ink-faint">
          Materiality reaches the instructions only once Section 03.3 is approved.
        </p>
      )}
    </div>
  );
}

/** GA-02 .. GA-04 — a Yes / No needs its basis (spec §13). */
export function Sa600Questions({
  answers,
  editable,
  busy,
  patch,
}: {
  answers: Sa600Answers;
  editable: boolean;
  busy: boolean;
  patch: (body: object, ok?: string) => Promise<boolean>;
}): JSX.Element {
  const rows = [
    {
      ref: 'GA-02',
      q: SA600_QUESTION_TEXT.ga_02,
      key: 'ga02',
      basisKey: 'ga02Basis',
      value: answers.ga02,
      basis: answers.ga02Basis,
      choices: GA02_ANSWERS,
      basisLabel: 'Competence considered',
    },
    {
      ref: 'GA-03',
      q: SA600_QUESTION_TEXT.ga_03,
      key: 'ga03',
      basisKey: 'ga03Note',
      value: answers.ga03,
      basis: answers.ga03Note,
      choices: GA_YES_NO_PENDING,
      basisLabel: 'Note',
    },
    {
      ref: 'GA-04',
      q: SA600_QUESTION_TEXT.ga_04,
      key: 'ga04',
      basisKey: 'ga04Basis',
      value: answers.ga04,
      basis: answers.ga04Basis,
      choices: GA_YES_NO_PENDING,
      basisLabel: 'Evidence obtained',
    },
  ] as const;
  return (
    <div className="space-y-2" aria-label="SA 600 questions">
      {rows.map((r) => (
        <Sa600Row key={r.ref} row={r} editable={editable} busy={busy} patch={patch} />
      ))}
    </div>
  );
}

function Sa600Row({
  row,
  editable,
  busy,
  patch,
}: {
  row: {
    ref: string;
    q: string;
    key: string;
    basisKey: string;
    value: string;
    basis: string | null;
    choices: readonly string[];
    basisLabel: string;
  };
  editable: boolean;
  busy: boolean;
  patch: (body: object, ok?: string) => Promise<boolean>;
}): JSX.Element {
  const [value, setValue] = useState(row.value);
  const [basis, setBasis] = useState(row.basis ?? '');
  const needsBasis = (value === 'yes' || value === 'no') && row.ref !== 'GA-03';
  const changed = value !== row.value || basis.trim() !== (row.basis ?? '');
  return (
    <div className="space-y-1">
      <p className="text-ink">
        <span className="font-mono text-ink-muted">{row.ref}</span> {row.q}
      </p>
      {editable ? (
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <Field label="Answer">
            <Select
              value={value}
              aria-label={`${row.ref} answer`}
              onChange={(e) => setValue(e.target.value)}
            >
              {row.choices.map((x) => (
                <option key={x} value={x}>
                  {GA_ANSWER_LABEL[x as keyof typeof GA_ANSWER_LABEL]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={row.basisLabel} required={needsBasis}>
            <Input value={basis} onChange={(e) => setBasis(e.target.value)} />
          </Field>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !changed || (needsBasis && !basis.trim())}
            onClick={() =>
              void patch(
                { [row.key]: value, [row.basisKey]: basis.trim() || null },
                `${row.ref} recorded.`,
              )
            }
          >
            Save
          </Button>
        </div>
      ) : (
        <p className="text-ink-muted">
          {GA_ANSWER_LABEL[row.value as keyof typeof GA_ANSWER_LABEL]}
          {row.basis ? ` — ${row.basis}` : ''}
        </p>
      )}
    </div>
  );
}

function CreateInstructions({
  base,
  rowId,
  busy,
  act,
}: {
  base: string;
  rowId: string;
  busy: boolean;
  act: GroupAct;
}): JSX.Element {
  return (
    <Button
      size="sm"
      variant="subtle"
      disabled={busy}
      onClick={() =>
        void act(async () => {
          const res = await apiFetch<ComponentInstructionsCreated>(
            `${base}/components/${rowId}/instructions`,
            { method: 'POST', body: {} },
          );
          if (res.editorUrl) window.open(res.editorUrl, '_blank', 'noopener,noreferrer');
          return res.groupAudit;
        }, 'Component Auditor Instructions created.')
      }
    >
      <FileText className="h-3.5 w-3.5" /> Create instructions
    </Button>
  );
}

/** §15 — the 10-document reporting package. */
function PackageChecklist({
  engagementId,
  base,
  c,
  editable,
  busy,
  act,
  send,
}: {
  engagementId: string;
  base: string;
  c: GroupAuditComponent;
  editable: boolean;
  busy: boolean;
  act: GroupAct;
  send: GroupSend;
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const relevant = c.package.filter((p) => p.relevant);
  const done = relevant.filter((p) => p.status === 'approved' || p.status === 'not_applicable');
  return (
    <div className="space-y-1" aria-label={`${c.componentName} reporting package`}>
      <p className="font-medium text-ink">
        Reporting package — {done.length} of {relevant.length} approved / N/A
      </p>
      <ul className="divide-y divide-line rounded-md border border-line bg-surface">
        {c.package.map((p) => (
          <li key={p.key}>
            <ToggleHeader
              open={open === p.key}
              onToggle={() => setOpen((o) => (o === p.key ? null : p.key))}
              label={p.label}
              muted={!p.relevant}
            >
              <span className="min-w-0 flex-1 truncate text-ink">{p.label}</span>
              {!p.relevant && (
                <span className="text-ink-faint">Not required for this component</span>
              )}
              <Badge tone={pkgTone(p.status)}>{PACKAGE_DOCUMENT_STATUS_LABEL[p.status]}</Badge>
            </ToggleHeader>
            {open === p.key && (
              <PackageDocumentDetail
                engagementId={engagementId}
                base={base}
                rowId={c.id}
                p={p}
                editable={editable}
                busy={busy}
                act={act}
                send={send}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PackageDocumentDetail({
  engagementId,
  base,
  rowId,
  p,
  editable,
  busy,
  act,
  send,
}: {
  engagementId: string;
  base: string;
  rowId: string;
  p: PackageDocument;
  editable: boolean;
  busy: boolean;
  act: GroupAct;
  send: GroupSend;
}): JSX.Element {
  const [status, setStatus] = useState<PackageDocumentStatus>(p.status);
  const [note, setNote] = useState(p.note ?? '');
  return (
    <div className="space-y-2 border-t border-line px-3 py-2">
      <GroupFileSlot
        engagementId={engagementId}
        base={base}
        label="Document"
        file={p.file}
        superseded={p.superseded}
        slot="package"
        ownerId={rowId}
        packageKey={p.key}
        editable={editable}
        busy={busy}
        act={act}
        needsReason={p.status === 'approved'}
      />
      {p.approvedAt && (
        <p className="text-ink-muted">
          Approved by {p.approvedByName ?? '—'} on {formatDate(p.approvedAt)}
        </p>
      )}
      {p.note && !editable && <p className="text-ink-muted">{p.note}</p>}
      {editable && (
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <Field label="Status">
            <Select
              value={status}
              aria-label={`${p.label} status`}
              onChange={(e) => setStatus(e.target.value as PackageDocumentStatus)}
            >
              {PACKAGE_DOCUMENT_STATUSES.map((x) => (
                <option key={x} value={x}>
                  {PACKAGE_DOCUMENT_STATUS_LABEL[x]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note" required={status === 'not_applicable' && p.relevant}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || (status === p.status && note.trim() === (p.note ?? ''))}
            onClick={() =>
              void act(
                () =>
                  send(`components/${rowId}/package/${p.key}`, 'PATCH', {
                    status,
                    note: note.trim() || null,
                  }),
                `${p.label}: ${PACKAGE_DOCUMENT_STATUS_LABEL[status]}.`,
              )
            }
          >
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

/** §16 — the findings register over components and branches. */
function Findings({
  view,
  editable,
  busy,
  act,
  send,
}: {
  view: GroupView;
  editable: boolean;
  busy: boolean;
  act: GroupAct;
  send: GroupSend;
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const shown = view.findings.filter((f) => !f.withdrawn);
  return (
    <div className="space-y-1.5" aria-label="Findings register">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="text-xs font-semibold text-ink">Findings from other auditors</h5>
        {shown.filter((f) => f.status === 'open').length > 0 && (
          <Badge tone="warn">{shown.filter((f) => f.status === 'open').length} open</Badge>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-ink-faint">No findings recorded.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {shown.map((f) => (
            <li key={f.id}>
              <ToggleHeader
                open={open === f.id}
                onToggle={() => setOpen((o) => (o === f.id ? null : f.id))}
                label={`finding ${f.ref}`}
              >
                <span className="w-14 shrink-0 font-mono text-ink-muted">{f.ref}</span>
                <span className="min-w-0 flex-1 truncate text-ink">
                  {f.subjectName} — {FINDING_CATEGORY_LABEL[f.category]}
                </span>
                {f.priorYearRef && <Badge>Follow-up {f.priorYearRef}</Badge>}
                {f.escalated && <Badge tone="danger">Escalated</Badge>}
                <Badge tone={f.status === 'open' ? 'warn' : 'success'}>
                  {f.status === 'open' ? 'Open' : 'Resolved'}
                </Badge>
              </ToggleHeader>
              {open === f.id && (
                <FindingDetail f={f} editable={editable} busy={busy} act={act} send={send} />
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <>
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={adding}
            onClick={() => setAdding((o) => !o)}
          >
            <Plus className="h-3.5 w-3.5" /> Raise finding
          </Button>
          {adding && (
            <NewFinding
              view={view}
              busy={busy}
              act={act}
              send={send}
              onDone={() => setAdding(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

function ImpactChoices({
  category,
  value,
  onChange,
}: {
  category: GroupFindingCategory;
  value: GroupFindingImpact[];
  onChange: (v: GroupFindingImpact[]) => void;
}): JSX.Element {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-ink">Group impact</legend>
      {FINDING_IMPACT_CHOICES[category].map((i) => (
        <label key={i} className="flex items-center gap-1.5 text-xs text-ink">
          <input
            type="checkbox"
            checked={value.includes(i)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, i] : value.filter((x) => x !== i))
            }
          />
          {FINDING_IMPACT_LABEL[i]}
        </label>
      ))}
    </fieldset>
  );
}

function NewFinding({
  view,
  busy,
  act,
  send,
  onDone,
}: {
  view: GroupView;
  busy: boolean;
  act: GroupAct;
  send: GroupSend;
  onDone: () => void;
}): JSX.Element {
  const subjects = [
    ...view.components
      .filter((c) => !c.withdrawn)
      .map((c) => ({ v: `component:${c.id}`, label: c.componentName })),
    ...view.branches
      .filter((b) => !b.withdrawn)
      .map((b) => ({ v: `branch:${b.id}`, label: `${b.branchName} (branch)` })),
  ];
  const [subject, setSubject] = useState(subjects[0]?.v ?? '');
  const [category, setCategory] = useState<GroupFindingCategory>('modified_opinion');
  const [impacts, setImpacts] = useState<GroupFindingImpact[]>([]);
  const [description, setDescription] = useState('');
  const [icfr, setIcfr] = useState('');
  return (
    <div
      className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-2"
      aria-label="New finding"
    >
      <Field label="Component / branch" required>
        <Select value={subject} onChange={(e) => setSubject(e.target.value)}>
          {subjects.map((s) => (
            <option key={s.v} value={s.v}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Category" required>
        <Select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as GroupFindingCategory);
            setImpacts([]);
          }}
        >
          {FINDING_CATEGORIES.map((x) => (
            <option key={x} value={x}>
              {FINDING_CATEGORY_LABEL[x]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Finding" required>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <ImpactChoices category={category} value={impacts} onChange={setImpacts} />
      {category === 'control_deficiency' && (
        <Field label="ICFR cross-reference (02.5)">
          <Input value={icfr} onChange={(e) => setIcfr(e.target.value)} />
        </Field>
      )}
      {category === 'fraud' && (
        <p className="text-xs text-danger-700 sm:col-span-2">
          Fraud is always escalated to the Engagement Partner.
        </p>
      )}
      <div className="sm:col-span-2">
        <Button
          size="sm"
          disabled={busy || !subject || !description.trim() || impacts.length === 0}
          onClick={async () => {
            const [subjectKind, subjectId] = subject.split(':') as ['component' | 'branch', string];
            const ok = await act(
              () =>
                send('findings', 'POST', {
                  subjectKind,
                  subjectId,
                  category,
                  impacts,
                  description: description.trim(),
                  icfrCrossRef: icfr.trim() || null,
                }),
              'Finding raised.',
            );
            if (ok) onDone();
          }}
        >
          Raise finding
        </Button>
      </div>
    </div>
  );
}

function FindingDetail({
  f,
  editable,
  busy,
  act,
  send,
}: {
  f: GroupAuditFinding;
  editable: boolean;
  busy: boolean;
  act: GroupAct;
  send: GroupSend;
}): JSX.Element {
  const [response, setResponse] = useState(f.response ?? '');
  const patch = (body: object, ok?: string) =>
    act(() => send(`findings/${f.id}`, 'PATCH', { ...body, version: f.version }), ok);
  return (
    <div className="space-y-2 border-t border-line bg-surface-sunken/30 px-3 py-2 text-xs">
      <p className="text-ink">{f.description}</p>
      <p className="text-ink-muted">
        Impact: {f.impacts.map((i) => FINDING_IMPACT_LABEL[i]).join(', ') || '—'}
        {f.icfrCrossRef ? ` · ICFR ${f.icfrCrossRef}` : ''}
        {f.reportingConsideration ? ' · Considered for reporting (Section 07 / 08)' : ''}
      </p>
      {f.status === 'resolved' && (
        <p className="text-ink-muted">
          Resolved by {f.resolvedByName ?? '—'} {f.resolvedAt ? formatDate(f.resolvedAt) : ''}
        </p>
      )}
      {editable ? (
        <>
          <Field label="Principal auditor's response" required={f.status === 'open'}>
            <Textarea rows={2} value={response} onChange={(e) => setResponse(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || response.trim() === (f.response ?? '')}
              onClick={() => void patch({ response: response.trim() || null }, 'Response saved.')}
            >
              Save response
            </Button>
            {f.status === 'open' ? (
              <Button
                size="sm"
                disabled={busy || !response.trim()}
                onClick={() =>
                  void patch(
                    { status: 'resolved', response: response.trim() },
                    `${f.ref} resolved.`,
                  )
                }
              >
                Resolve
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void patch({ status: 'open' }, `${f.ref} reopened.`)}
              >
                Reopen
              </Button>
            )}
            <label className="flex items-center gap-1.5 text-ink">
              <input
                type="checkbox"
                checked={f.reportingConsideration}
                disabled={busy}
                onChange={(e) => void patch({ reportingConsideration: e.target.checked })}
              />
              Consider for reporting
            </label>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void patch({ withdrawn: true }, `${f.ref} withdrawn.`)}
            >
              Withdraw
            </Button>
          </div>
        </>
      ) : (
        f.response && <p className="text-ink-muted">Response: {f.response}</p>
      )}
    </div>
  );
}
