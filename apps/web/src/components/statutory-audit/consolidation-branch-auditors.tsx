'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  BR01_ANSWER_LABEL,
  BR01_ANSWERS,
  BR01_QUESTION,
  BRANCH_APPOINTMENT_BASES,
  BRANCH_APPOINTMENT_BASIS_LABEL,
  BRANCH_CONCLUSION_LABEL,
  BRANCH_CONCLUSIONS,
  COMPONENT_SIGNIFICANCE,
  COMPONENT_SIGNIFICANCE_LABEL,
  type Br01Answer,
  type BranchConclusion,
  type GroupAuditBranch,
} from '@hsdg/contracts';
import { ApiError } from '@/lib/api';
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
import { Sa600Questions } from './consolidation-other-auditors';

/**
 * 02.6 Part B — Branch Auditors (DHVAJ 02.6 spec §17; section 143(8), Rule 12).
 * BR-01 is suggested from the master's branches and the records here; the team
 * may answer otherwise with a reason. Each branch auditor record holds the
 * appointment, the instructions and report, the GA-02..04 answers and the
 * principal auditor's response before concluding on the report. Applies with
 * or without a CFS. Rows expand inline (+/−); nothing opens a modal.
 */
export function ConsolidationBranchAuditors({
  engagementId,
  workflowInstanceId,
  canManage = true,
}: {
  engagementId: string;
  workflowInstanceId: string;
  canManage?: boolean;
}): JSX.Element {
  const { q, base, editable, busy, act, send } = useGroupAudit(
    engagementId,
    workflowInstanceId,
    canManage,
  );
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');

  if (q.isLoading) return <Spinner label="Loading the branch auditors…" />;
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-danger-700">
        {q.error instanceof ApiError ? q.error.message : 'Could not load the branch auditors.'}
      </p>
    );
  }
  const view = q.data;
  const live = view.branches.filter((b) => !b.withdrawn);
  const withdrawn = view.branches.filter((b) => b.withdrawn);
  const blockedNo = view.br01 === 'no' && view.br01Source === 'team';

  return (
    <section className="space-y-3" aria-label="Branch auditors">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-ink">Branch auditors</h4>
        {view.status.branchPending > 0 && (
          <Badge tone="warn">{view.status.branchPending} branch records incomplete</Badge>
        )}
      </div>
      <Br01 view={view} editable={editable} busy={busy} act={act} send={send} />

      {live.length > 0 && (
        <ul
          className="divide-y divide-line rounded-md border border-line"
          aria-label="Branch auditor records"
        >
          {live.map((b) => (
            <li key={b.id}>
              <ToggleHeader
                open={open === b.id}
                onToggle={() => setOpen((o) => (o === b.id ? null : b.id))}
                label={`branch ${b.branchName}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  {b.branchName}
                  {b.location ? (
                    <span className="font-normal text-ink-faint"> · {b.location}</span>
                  ) : null}
                </span>
                {b.firmName && <span className="text-ink-muted">{b.firmName}</span>}
                {b.fromPriorYear && <Badge>Carried from last year</Badge>}
                <Badge
                  tone={
                    b.conclusion === 'pending'
                      ? 'warn'
                      : b.conclusion === 'not_relied'
                        ? 'danger'
                        : 'success'
                  }
                >
                  {BRANCH_CONCLUSION_LABEL[b.conclusion]}
                </Badge>
                {b.openFindings > 0 && <Badge tone="danger">{b.openFindings} open findings</Badge>}
                {b.missing.length > 0 && <Badge tone="warn">{b.missing.length} to do</Badge>}
              </ToggleHeader>
              {open === b.id && (
                <BranchDetail
                  engagementId={engagementId}
                  base={base}
                  b={b}
                  editable={editable}
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
          Withdrawn (kept for the record): {withdrawn.map((b) => b.branchName).join(', ')}
        </p>
      )}

      {editable && !blockedNo && (
        <>
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={adding}
            onClick={() => setAdding((o) => !o)}
          >
            <Plus className="h-3.5 w-3.5" /> Add branch auditor
          </Button>
          {adding && (
            <div className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-2">
              <Field label="Branch" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Location">
                <Input value={location} onChange={(e) => setLocation(e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Button
                  size="sm"
                  disabled={busy || !name.trim()}
                  onClick={async () => {
                    const ok = await act(
                      () =>
                        send('branches', 'POST', {
                          branchName: name.trim(),
                          location: location.trim() || null,
                        }),
                      'Branch auditor added.',
                    );
                    if (ok) {
                      setAdding(false);
                      setName('');
                      setLocation('');
                    }
                  }}
                >
                  Add branch auditor
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Br01({
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
  const [answer, setAnswer] = useState<Br01Answer>(view.br01);
  const [basis, setBasis] = useState(view.br01Source === 'team' ? view.br01Basis : '');
  return (
    <div className="space-y-1.5 rounded-md border border-line p-2 text-xs" aria-label="BR-01">
      <p className="text-ink">
        <span className="font-mono text-ink-muted">BR-01</span> {BR01_QUESTION}
      </p>
      <p className="text-ink-muted">
        {BR01_ANSWER_LABEL[view.br01]}
        {view.br01Source === 'system' ? ' (system suggestion)' : ''} — {view.br01Basis || '—'}
      </p>
      {editable && (
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <Field label="Answer">
            <Select
              value={answer}
              aria-label="BR-01 answer"
              onChange={(e) => setAnswer(e.target.value as Br01Answer)}
            >
              {BR01_ANSWERS.map((a) => (
                <option key={a} value={a}>
                  {BR01_ANSWER_LABEL[a]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason (when it differs from the suggestion)">
            <Input value={basis} onChange={(e) => setBasis(e.target.value)} />
          </Field>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  send('', 'PATCH', {
                    br01: answer,
                    br01Basis: basis.trim() || null,
                    version: view.version,
                  }),
                'BR-01 recorded.',
              )
            }
          >
            Record BR-01
          </Button>
        </div>
      )}
    </div>
  );
}

function BranchDetail({
  engagementId,
  base,
  b,
  editable,
  busy,
  act,
  send,
}: {
  engagementId: string;
  base: string;
  b: GroupAuditBranch;
  editable: boolean;
  busy: boolean;
  act: GroupAct;
  send: GroupSend;
}): JSX.Element {
  const patch = (body: object, ok?: string) =>
    act(() => send(`branches/${b.id}`, 'PATCH', { ...body, version: b.version }), ok);
  const [response, setResponse] = useState(b.principalResponse ?? '');
  const [conclusion, setConclusion] = useState<BranchConclusion>(b.conclusion);
  const ro = !editable || busy;
  const slot = { engagementId, base, editable, busy, act, ownerId: b.id };
  return (
    <div className="space-y-3 border-t border-line bg-surface-sunken/30 px-3 py-2 text-xs">
      {b.missing.length > 0 && (
        <ul className="list-disc pl-4 text-warning-700" aria-label="Still needed">
          {b.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <BlurField
          label="Branch"
          value={b.branchName}
          disabled={ro}
          required
          onSave={(v) => v && void patch({ branchName: v })}
        />
        <BlurField
          label="Location"
          value={b.location}
          disabled={ro}
          onSave={(v) => void patch({ location: v })}
        />
        <BlurField
          label="Country"
          value={b.country}
          disabled={ro}
          onSave={(v) => void patch({ country: v })}
        />
        <BlurField
          label="Branch auditor firm"
          value={b.firmName}
          disabled={ro}
          required
          onSave={(v) => void patch({ firmName: v })}
        />
        <BlurField label="FRN" value={b.frn} disabled={ro} onSave={(v) => void patch({ frn: v })} />
        <BlurField
          label="Partner / contact"
          value={b.partnerContact}
          disabled={ro}
          onSave={(v) => void patch({ partnerContact: v })}
        />
        <Field label="Appointment basis">
          <Select
            value={b.appointmentBasis ?? ''}
            disabled={ro}
            onChange={(e) => void patch({ appointmentBasis: e.target.value || null })}
          >
            <option value="">—</option>
            {BRANCH_APPOINTMENT_BASES.map((x) => (
              <option key={x} value={x}>
                {BRANCH_APPOINTMENT_BASIS_LABEL[x]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <BlurField
            label="Appointment — note"
            value={b.appointmentNote}
            disabled={ro}
            onSave={(v) => void patch({ appointmentNote: v })}
          />
        </div>
        <BlurField
          label="Period from"
          type="date"
          value={b.periodFrom}
          disabled={ro}
          onSave={(v) => void patch({ periodFrom: v })}
        />
        <BlurField
          label="Period to"
          type="date"
          value={b.periodTo}
          disabled={ro}
          onSave={(v) => void patch({ periodTo: v })}
        />
        <Field label="Significance">
          <Select
            value={b.significance}
            disabled={ro}
            onChange={(e) => void patch({ significance: e.target.value })}
          >
            {COMPONENT_SIGNIFICANCE.map((x) => (
              <option key={x} value={x}>
                {COMPONENT_SIGNIFICANCE_LABEL[x]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <GroupFileSlot
        {...slot}
        label="Instructions to the branch auditor"
        file={b.instructions}
        slot="branch_instructions"
      />
      <GroupFileSlot {...slot} label="Branch audit report" file={b.report} slot="branch_report" />

      <Sa600Questions answers={b.answers} editable={editable} busy={busy} patch={patch} />

      <div className="space-y-1.5" aria-label="Principal auditor conclusion">
        {editable ? (
          <>
            <Field label="Principal auditor's response" required={conclusion !== 'pending'}>
              <Textarea rows={2} value={response} onChange={(e) => setResponse(e.target.value)} />
            </Field>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="Conclusion on the branch report">
                <Select
                  value={conclusion}
                  aria-label="Branch conclusion"
                  onChange={(e) => setConclusion(e.target.value as BranchConclusion)}
                >
                  {BRANCH_CONCLUSIONS.map((x) => (
                    <option key={x} value={x}>
                      {BRANCH_CONCLUSION_LABEL[x]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || (conclusion !== 'pending' && !response.trim())}
                onClick={() =>
                  void patch(
                    { principalResponse: response.trim() || null, conclusion },
                    'Branch conclusion saved.',
                  )
                }
              >
                Save
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void patch({ withdrawn: true }, 'Branch auditor withdrawn.')}
            >
              Withdraw record
            </Button>
          </>
        ) : (
          <p className="text-ink-muted">
            {BRANCH_CONCLUSION_LABEL[b.conclusion]}
            {b.principalResponse ? ` — ${b.principalResponse}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
