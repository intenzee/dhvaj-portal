'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import {
  OTHER_REPORTING_REFERENCE_ANCHOR as ANCHOR,
  REPORTING_CARD,
  TRI_LABEL,
  TRIS,
  type DirectorCheck,
  type StatutoryAuditReportingRecords,
  type Tri,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { FrameworkReferences } from './framework-references';
import { ReportingCardEvidence } from './other-reporting-evidence';
import { orNull, useReportingRecords, type RecordsAct } from './reporting-records-query';

/**
 * 02.7 Section 164(2) director workpaper (spec §12) behind the Section
 * 143(3)(g) card: one row per director — filled once from the entity's
 * contacts master, then the team's — with DIN, the appointment period,
 * directorship information, the management representation and MCA / statutory
 * evidence, and a Yes / No / Pending conclusion that needs the legal analysis
 * (a DIN status alone is never the conclusion). Rows expand in place (+/−).
 */

const TRI_TONE: Record<Tri, string> = { yes: 'danger', no: 'success', pending: 'warn' };
const CONCLUSION_TEXT: Record<
  StatutoryAuditReportingRecords['directors']['status']['conclusion'],
  string
> = {
  not_started: 'Not started',
  pending: 'Pending',
  none_found: 'No director disqualified',
  identified: 'Disqualification identified',
};

export function OtherReportingDirectors({
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
  const [adding, setAdding] = useState(false);

  if (q.isLoading) return <Spinner label="Loading the director workpaper…" />;
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-danger-700">
        {q.error instanceof ApiError ? q.error.message : 'Could not load the director workpaper.'}
      </p>
    );
  }
  const view = q.data;
  const editable = canManage && view.canManage;
  const { status, rows, contactsAvailable } = view.directors;
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section className="space-y-2 text-xs" aria-label="Section 164(2) director workpaper">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          tone={
            status.conclusion === 'identified'
              ? 'danger'
              : status.conclusion === 'none_found'
                ? 'success'
                : 'warn'
          }
        >
          {CONCLUSION_TEXT[status.conclusion]}
        </Badge>
        <Badge>{status.total} director(s)</Badge>
        {status.cleared > 0 && <Badge tone="success">{status.cleared} not disqualified</Badge>}
        {status.pending > 0 && <Badge tone="warn">{status.pending} pending</Badge>}
        {status.disqualified > 0 && <Badge tone="danger">{status.disqualified} disqualified</Badge>}
        {editable && contactsAvailable > 0 && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void act(
                (base) =>
                  apiFetch<StatutoryAuditReportingRecords>(`${base}/directors/fill`, {
                    method: 'POST',
                    body: {},
                  }),
                'Directors added from the contacts master.',
              )
            }
          >
            Add {contactsAvailable} from the contacts master
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-ink-faint">
          No director on the workpaper. Add the directors on the contacts master, or add them here.
        </p>
      ) : (
        <div className="divide-y divide-line rounded-md border border-line">
          {rows.map((d) => (
            <DirectorRow
              key={d.id}
              director={d}
              open={open.has(d.id)}
              onToggle={() => toggle(d.id)}
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
            aria-expanded={adding}
            onClick={() => setAdding((o) => !o)}
          >
            {adding ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />} Add a director
          </button>
          {adding && (
            <AddDirectorForm
              busy={busy}
              onSubmit={async (body) => {
                const ok = await act(
                  (base) =>
                    apiFetch<StatutoryAuditReportingRecords>(`${base}/directors`, {
                      method: 'POST',
                      body,
                    }),
                  'Director added.',
                );
                if (ok) setAdding(false);
              }}
            />
          )}
        </div>
      )}

      <ReportingCardEvidence
        engagementId={engagementId}
        workflowInstanceId={workflowInstanceId}
        cardKey={REPORTING_CARD.s143Directors}
        canManage={canManage}
      />
      <FrameworkReferences
        contextKey="02.7"
        anchors={[ANCHOR.section164_2, ANCHOR.section143_3]}
        effectiveOn={view.periodStart}
      />
    </section>
  );
}

function DirectorRow({
  director: d,
  open,
  onToggle,
  engagementId,
  workflowInstanceId,
  editable,
  busy,
  act,
}: {
  director: DirectorCheck;
  open: boolean;
  onToggle: () => void;
  engagementId: string;
  workflowInstanceId: string;
  editable: boolean;
  busy: boolean;
  act: RecordsAct;
}): JSX.Element {
  return (
    <div className={d.withdrawn ? 'opacity-60' : undefined}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-sunken/50"
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${d.name}`}
        onClick={onToggle}
      >
        {open ? (
          <Minus className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        ) : (
          <Plus className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        )}
        <span className="min-w-0 flex-1 truncate text-ink">
          {d.name}
          {d.designation && <span className="text-ink-faint"> · {d.designation}</span>}
        </span>
        <span className="w-20 shrink-0 font-mono text-ink-muted">{d.din ?? 'No DIN'}</span>
        {d.withdrawn ? (
          <Badge tone="warn">Withdrawn</Badge>
        ) : (
          <>
            <Badge tone={TRI_TONE[d.disqualified]}>Disqualified: {TRI_LABEL[d.disqualified]}</Badge>
            {d.evidenceCount > 0 && <Badge>{d.evidenceCount} evidence</Badge>}
          </>
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t border-line bg-surface-sunken/30 px-3 py-3">
          <p className="text-ink-faint">
            {d.source === 'contacts' ? 'From the contacts master.' : 'Added by the team.'}
            {d.appointedOn ? ` Appointed ${formatDate(d.appointedOn)}.` : ''}
            {d.ceasedOn ? ` Ceased ${formatDate(d.ceasedOn)}.` : ''}
          </p>
          <DirectorForm director={d} editable={editable} busy={busy} act={act} />
          <ReportingCardEvidence
            engagementId={engagementId}
            workflowInstanceId={workflowInstanceId}
            cardKey={REPORTING_CARD.s143Directors}
            canManage={editable}
            directorId={d.id}
          />
          {editable && (
            <button
              type="button"
              className="text-ink-faint hover:text-danger-700"
              disabled={busy}
              onClick={() =>
                void act(
                  (base) =>
                    apiFetch<StatutoryAuditReportingRecords>(`${base}/directors/${d.id}`, {
                      method: 'PATCH',
                      body: { withdrawn: !d.withdrawn, version: d.version },
                    }),
                  d.withdrawn ? `${d.name} restored.` : `${d.name} withdrawn.`,
                )
              }
            >
              {d.withdrawn ? 'Restore' : 'Withdraw'} {d.name}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const DIN_RE = /^\d{8}$/;

function AddDirectorForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: {
    name: string;
    din: string | null;
    designation: string | null;
  }) => Promise<void>;
}): JSX.Element {
  const [name, setName] = useState('');
  const [din, setDin] = useState('');
  const [designation, setDesignation] = useState('');
  const dinBad = din.trim() !== '' && !DIN_RE.test(din.trim());
  return (
    <form
      className="mt-2 grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({ name: name.trim(), din: orNull(din), designation: orNull(designation) });
      }}
    >
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Director name" />
      </Field>
      <Field label="DIN" hint={dinBad ? 'DIN must be 8 digits.' : undefined}>
        <Input
          inputMode="numeric"
          value={din}
          onChange={(e) => setDin(e.target.value)}
          aria-label="DIN"
        />
      </Field>
      <Field label="Designation">
        <Input
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
          aria-label="Designation"
        />
      </Field>
      <div className="sm:col-span-3">
        <Button size="sm" type="submit" disabled={busy || !name.trim() || dinBad}>
          Add director
        </Button>
      </div>
    </form>
  );
}

function DirectorForm({
  director: d,
  editable,
  busy,
  act,
}: {
  director: DirectorCheck;
  editable: boolean;
  busy: boolean;
  act: RecordsAct;
}): JSX.Element {
  const [name, setName] = useState(d.name);
  const [din, setDin] = useState(d.din ?? '');
  const [designation, setDesignation] = useState(d.designation ?? '');
  const [appointed, setAppointed] = useState(d.appointedOn ?? '');
  const [ceased, setCeased] = useState(d.ceasedOn ?? '');
  const [info, setInfo] = useState(d.directorshipInfo ?? '');
  const [representation, setRepresentation] = useState(d.representationRef ?? '');
  const [mca, setMca] = useState(d.mcaSource ?? '');
  const [disqualified, setDisqualified] = useState<Tri>(d.disqualified);
  const [analysis, setAnalysis] = useState(d.legalAnalysis ?? '');
  const [conclusion, setConclusion] = useState(d.auditorConclusion ?? '');
  const disabled = !editable || d.withdrawn;
  const dinBad = din.trim() !== '' && !DIN_RE.test(din.trim());
  const needsAnalysis = disqualified !== 'pending' && !analysis.trim();
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      aria-label={`${d.name} Section 164(2) check`}
      onSubmit={(e) => {
        e.preventDefault();
        void act(
          (base) =>
            apiFetch<StatutoryAuditReportingRecords>(`${base}/directors/${d.id}`, {
              method: 'PATCH',
              body: {
                name: name.trim(),
                din: orNull(din),
                designation: orNull(designation),
                appointedOn: appointed || null,
                ceasedOn: ceased || null,
                directorshipInfo: orNull(info),
                representationRef: orNull(representation),
                mcaSource: orNull(mca),
                disqualified,
                legalAnalysis: orNull(analysis),
                auditorConclusion: orNull(conclusion),
                version: d.version,
              },
            }),
          `${d.name} saved.`,
        );
      }}
    >
      <fieldset disabled={disabled} className="contents">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Director name"
          />
        </Field>
        <Field label="DIN" hint={dinBad ? 'DIN must be 8 digits.' : undefined}>
          <Input
            inputMode="numeric"
            value={din}
            onChange={(e) => setDin(e.target.value)}
            aria-label="DIN"
          />
        </Field>
        <Field label="Designation">
          <Input
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            aria-label="Designation"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Appointed on">
            <Input
              type="date"
              value={appointed}
              onChange={(e) => setAppointed(e.target.value)}
              aria-label="Appointed on"
            />
          </Field>
          <Field label="Ceased on">
            <Input
              type="date"
              value={ceased}
              onChange={(e) => setCeased(e.target.value)}
              aria-label="Ceased on"
            />
          </Field>
        </div>
        <Field
          label="Directorship information"
          hint="Other directorships, filing defaults of those companies…"
          className="sm:col-span-2"
        >
          <Textarea
            value={info}
            onChange={(e) => setInfo(e.target.value)}
            aria-label="Directorship info"
          />
        </Field>
        <Field label="Management representation (DIR-8) reference">
          <Input
            value={representation}
            onChange={(e) => setRepresentation(e.target.value)}
            aria-label="Representation reference"
          />
        </Field>
        <Field label="MCA / statutory evidence">
          <Input value={mca} onChange={(e) => setMca(e.target.value)} aria-label="MCA source" />
        </Field>
        <Field label="Disqualified under Section 164(2)?">
          <Select
            value={disqualified}
            onChange={(e) => setDisqualified(e.target.value as Tri)}
            aria-label="Disqualified"
          >
            {TRIS.map((t) => (
              <option key={t} value={t}>
                {TRI_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Auditor conclusion">
          <Input
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            aria-label="Auditor conclusion"
          />
        </Field>
        <Field
          label="Section 164(2) legal analysis"
          hint={
            needsAnalysis
              ? 'Required for a Yes / No — a DIN status alone is not the conclusion.'
              : undefined
          }
          className="sm:col-span-2"
        >
          <Textarea
            value={analysis}
            onChange={(e) => setAnalysis(e.target.value)}
            aria-label="Legal analysis"
          />
        </Field>
        {!disabled && (
          <div className="sm:col-span-2">
            <Button
              size="sm"
              type="submit"
              disabled={busy || !name.trim() || dinBad || needsAnalysis}
            >
              {busy ? 'Saving…' : 'Save director'}
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
