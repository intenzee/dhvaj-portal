'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Link2,
  Minus,
  Plus,
} from 'lucide-react';
import {
  CARO_CLAUSE_CONCLUSION_LABEL,
  CARO_CLAUSE_CONCLUSIONS,
  CARO_COMPONENT_APPLICABLE,
  CARO_COMPONENT_APPLICABLE_LABEL,
  CARO_CONSOLIDATED_STATE_LABEL,
  CARO_PROGRAMME_STATE_LABEL,
  CARO_RELEVANCE_LABEL,
  CARO_RELEVANCES,
  CARO_REVIEW_STATE_LABEL,
  PERMISSION,
  type AuthorityProvisionRecord,
  type CaroClauseConclusion,
  type CaroClauseItem,
  type CaroComponent,
  type CaroComponentApplicable,
  type CaroFinding,
  type CaroFindingSeverity,
  type CaroRelevance,
  type CaroReportingSummary,
  type CaroReviewAction,
  type StatutoryAuditCaroProgramme,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/principal';
import { useToast } from '@/lib/toast';
import type { DocumentRow } from '@/lib/types';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { DocumentPreview } from '@/components/document-preview';
import { LinkPicker } from './acceptance-file-card';
import { ProvisionViewer } from './provision-viewer';

/**
 * 02.4 CARO Work Programme (DHVAJ 02.4 spec §11–§15, §18) — Level 2. Generated
 * by the server from the versioned clause library once the 02.4 applicability
 * is confirmed; the team never creates a clause by hand. Each clause row
 * expands in place (+/−): the requirement, View CARO Clause / View ICAI
 * Guidance through the Provision Library, the related audit areas and 02.3
 * disclosures, relevance to the facts, work, evidence links (never a second
 * upload), findings, management response, draft reporting language, the
 * conclusion and its review. Clause 3(xxi) carries the companies in the CFS.
 * A clause Not Applicable to Facts never changes the Level-1 conclusion.
 */

type Busy = (fn: () => Promise<StatutoryAuditCaroProgramme>, ok?: string) => Promise<void>;

const RELEVANCE_TONE: Record<CaroRelevance, string> = {
  applicable: 'info',
  not_applicable_to_facts: 'neutral',
  assessment_required: 'warn',
};
const CONCLUSION_TONE: Record<CaroClauseConclusion, string> = {
  no_reportable_exception: 'success',
  reportable_matter: 'danger',
  not_applicable_to_facts: 'neutral',
  further_work_required: 'warn',
};

export function CaroProgramme({
  engagementId,
  workflowInstanceId,
  canManage,
}: {
  engagementId: string;
  workflowInstanceId: string;
  canManage: boolean;
}): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const { principal } = useAuth();
  const base = `/engagements/${engagementId}/statutory-audit/${workflowInstanceId}/caro`;
  const key = ['engagement', engagementId, 'caro-programme', workflowInstanceId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<StatutoryAuditCaroProgramme>(`${base}/programme`),
  });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [annexure, setAnnexure] = useState(false);

  if (q.isLoading) return <Spinner label="Loading the CARO work programme…" />;
  if (q.isError || !q.data) {
    return (
      <p className="text-xs text-danger-700">
        {q.error instanceof ApiError ? q.error.message : 'Could not load the CARO work programme.'}
      </p>
    );
  }
  const view = q.data;
  const editable = canManage && !view.readOnly && can(principal, PERMISSION.engagementManage);
  const act: Busy = async (fn, ok) => {
    setBusy(true);
    try {
      qc.setQueryData(key, await fn());
      void qc.invalidateQueries({ queryKey: [...key, 'annexure'] });
      if (ok) toast(ok);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update the clause.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const s = view.summary;
  const on = view.programme?.periodStart ?? view.level1?.periodStart ?? undefined;

  // Group standalone items under their paragraph-3 clause heading.
  const groups: Array<{ ref: string; title: string; items: CaroClauseItem[] }> = [];
  for (const i of view.standalone) {
    const head = i.parentClauseCode ? (i.parentTitle ?? i.title) : i.title;
    const ref = i.parentClauseCode
      ? (/^\d+\([a-z]+\)/.exec(i.clauseRef)?.[0] ?? i.clauseRef)
      : i.clauseRef;
    const g = groups.find((x) => x.ref === ref);
    if (g) g.items.push(i);
    else groups.push({ ref, title: head, items: [i] });
  }

  return (
    <section className="space-y-3" aria-label="CARO Work Programme">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-ink">CARO Work Programme</h4>
        <Badge
          tone={view.state === 'active' ? 'info' : view.state === 'withdrawn' ? 'warn' : 'neutral'}
        >
          {CARO_PROGRAMME_STATE_LABEL[view.state]}
        </Badge>
      </div>
      <p className="text-xs text-ink-muted">{view.reason}</p>
      {view.programme && (
        <p className="text-xs text-ink-faint">
          {view.programme.orderTitle} — {view.programme.orderVersionLabel} · resolved for the period
          from {formatDate(view.programme.periodStart)} · instantiated{' '}
          {formatDate(view.programme.instantiatedAt)}
          {view.programme.withdrawnAt
            ? ` · withdrawn ${formatDate(view.programme.withdrawnAt)}`
            : ''}
        </p>
      )}
      {s.total > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs" aria-label="Programme summary">
          <Badge>{s.total} clause items</Badge>
          <Badge tone="info">{s.applicable} applicable</Badge>
          <Badge>{s.notApplicableToFacts} not applicable to facts</Badge>
          {s.assessmentRequired > 0 && (
            <Badge tone="warn">{s.assessmentRequired} assessment required</Badge>
          )}
          <Badge tone="success">
            {s.approved} of {s.total} approved
          </Badge>
          {s.reportable > 0 && <Badge tone="danger">{s.reportable} reportable</Badge>}
          {s.openFindings > 0 && <Badge tone="warn">{s.openFindings} open findings</Badge>}
        </div>
      )}
      {view.state !== 'awaiting_conclusion' && s.total > 0 && (
        <p className="text-[11px] text-ink-faint">
          Level 2 — a clause Not Applicable to Facts never changes the overall CARO applicability.
        </p>
      )}

      {view.priorYear && view.priorYear.reportableClauses.length > 0 && (
        <div className="rounded-md border border-warning-100 bg-warning-50/60 px-3 py-2 text-xs">
          <p className="font-medium text-ink">
            FY {view.priorYear.financialYear} reportable CARO matters — for this year&apos;s risk
            and planning follow-up (reference only)
          </p>
          <ul className="mt-1 list-disc pl-4 text-ink-muted">
            {view.priorYear.reportableClauses.map((c) => (
              <li key={c.clauseRef}>
                {c.clauseRef} {c.title}
                {c.reportingLanguage ? ` — “${c.reportingLanguage}”` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.length > 0 && (
        <div className="divide-y divide-line rounded-md border border-line">
          {groups.map((g) => (
            <div key={g.ref}>
              {g.items.length > 1 || g.items[0]!.parentClauseCode ? (
                <p className="bg-surface-sunken/60 px-3 py-1.5 text-xs font-semibold text-ink">
                  {g.ref} {g.title}
                </p>
              ) : null}
              {g.items.map((i) => (
                <ClauseRow
                  key={i.id}
                  item={i}
                  open={open.has(i.id)}
                  onToggle={() => toggle(i.id)}
                  engagementId={engagementId}
                  base={base}
                  editable={editable && !i.withdrawn}
                  busy={busy}
                  act={act}
                  on={on}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {(view.consolidated || view.level1?.cfsInScope) && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="text-xs font-semibold text-ink">Consolidated financial statements</h5>
            <Badge tone={view.consolidatedState === 'configured' ? 'info' : 'warn'}>
              {CARO_CONSOLIDATED_STATE_LABEL[view.consolidatedState]}
            </Badge>
          </div>
          <p className="text-xs text-ink-faint">
            The full paragraph 3 programme is not repeated for the CFS — only clause 3(xxi), using
            the CARO reports of the companies included in it.
          </p>
          {view.consolidated && (
            <div className="rounded-md border border-line">
              <ClauseRow
                item={view.consolidated}
                open={open.has(view.consolidated.id)}
                onToggle={() => toggle(view.consolidated!.id)}
                engagementId={engagementId}
                base={base}
                editable={editable}
                busy={busy}
                act={act}
                on={on}
              />
            </div>
          )}
        </div>
      )}

      {s.total > 0 && (
        <div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"
            aria-expanded={annexure}
            onClick={() => setAnnexure((o) => !o)}
          >
            {annexure ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Draft CARO annexure
          </button>
          {annexure && <AnnexurePreview base={base} queryKey={[...key, 'annexure']} />}
        </div>
      )}
    </section>
  );
}

// ── One clause ─────────────────────────────────────────────────────────────

function ClauseRow({
  item,
  open,
  onToggle,
  engagementId,
  base,
  editable,
  busy,
  act,
  on,
}: {
  item: CaroClauseItem;
  open: boolean;
  onToggle: () => void;
  engagementId: string;
  base: string;
  editable: boolean;
  busy: boolean;
  act: Busy;
  on: string | undefined;
}): JSX.Element {
  return (
    <div className={item.withdrawn ? 'opacity-60' : undefined}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-sunken/50"
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} clause ${item.clauseRef}`}
        onClick={onToggle}
      >
        {open ? (
          <Minus className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        ) : (
          <Plus className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        )}
        <span className="w-20 shrink-0 font-mono text-ink-muted">{item.clauseRef}</span>
        <span className="min-w-0 flex-1 truncate text-ink">{item.title}</span>
        {item.withdrawn ? (
          <Badge tone="warn">Withdrawn</Badge>
        ) : (
          <>
            <Badge tone={RELEVANCE_TONE[item.relevance]}>
              {CARO_RELEVANCE_LABEL[item.relevance]}
            </Badge>
            {item.conclusion && (
              <Badge tone={CONCLUSION_TONE[item.conclusion]}>
                {CARO_CLAUSE_CONCLUSION_LABEL[item.conclusion]}
              </Badge>
            )}
            <Badge tone={item.reviewState === 'approved' ? 'success' : 'neutral'}>
              {CARO_REVIEW_STATE_LABEL[item.reviewState]}
            </Badge>
          </>
        )}
      </button>
      {open && (
        <ClauseDetail
          item={item}
          engagementId={engagementId}
          base={base}
          editable={editable}
          busy={busy}
          act={act}
          on={on}
        />
      )}
    </div>
  );
}

function ClauseDetail({
  item,
  engagementId,
  base,
  editable,
  busy,
  act,
  on,
}: {
  item: CaroClauseItem;
  engagementId: string;
  base: string;
  editable: boolean;
  busy: boolean;
  act: Busy;
  on: string | undefined;
}): JSX.Element {
  const locked = item.reviewState === 'approved' || item.reviewState === 'submitted';
  const canEdit = editable && !locked;
  return (
    <div className="space-y-3 border-t border-line bg-surface-sunken/30 px-4 py-3 text-xs">
      <p className="whitespace-pre-line text-ink">{item.requirement}</p>
      {item.relevanceHint && <p className="text-ink-faint">{item.relevanceHint}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <CodeReference
          code={item.provisionCode}
          label={`View CARO Clause ${item.clauseRef}`}
          on={on}
        />
        {item.guidanceProvisionCode && (
          <CodeReference
            code={item.guidanceProvisionCode}
            label={`View ICAI Guidance — ${item.guidanceReference ?? 'Guidance Note'}`}
            on={on}
          />
        )}
      </div>

      <CrossReferences item={item} />

      {item.procedures.length > 0 && (
        <div>
          <p className="font-medium text-ink">Methodology procedures</p>
          <ul className="mt-1 space-y-1">
            {item.procedures.map((p) => (
              <li key={p.key} className="text-ink-muted">
                <span className="font-medium text-ink">{p.title}.</span> {p.objective}
                {p.evidence ? (
                  <span className="text-ink-faint"> Evidence: {p.evidence}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {item.priorYear && (
        <div className="rounded-md bg-surface-sunken px-3 py-2 text-ink-muted">
          <p className="font-medium text-ink">
            FY {item.priorYear.financialYear} (reference only — never concludes this year)
          </p>
          <p>
            Conclusion:{' '}
            {item.priorYear.conclusion
              ? CARO_CLAUSE_CONCLUSION_LABEL[item.priorYear.conclusion]
              : 'not concluded'}
            {item.priorYear.reportingLanguage ? ` — “${item.priorYear.reportingLanguage}”` : ''}
          </p>
          {item.priorYear.findings.length > 0 && (
            <p>Findings: {item.priorYear.findings.join('; ')}</p>
          )}
        </div>
      )}

      <ClauseForm item={item} base={base} editable={canEdit} busy={busy} act={act} />

      <EvidenceLinks
        item={item}
        engagementId={engagementId}
        base={base}
        editable={canEdit}
        busy={busy}
        act={act}
      />

      <Findings item={item} base={base} editable={canEdit} busy={busy} act={act} />

      {item.reportContext === 'consolidated' && (
        <Components
          item={item}
          engagementId={engagementId}
          base={base}
          editable={canEdit}
          busy={busy}
          act={act}
        />
      )}

      <ReviewBar item={item} base={base} editable={editable} busy={busy} act={act} />
    </div>
  );
}

function CrossReferences({ item }: { item: CaroClauseItem }): JSX.Element | null {
  if (
    item.relatedWorkAreas.length === 0 &&
    item.scheduleIiiRequirementCodes.length === 0 &&
    !item.procedureRef
  )
    return null;
  return (
    <div className="space-y-1" aria-label="Cross-references">
      {item.procedureRef && (
        <p className="text-ink-muted">
          Section 06 procedure: <span className="font-mono">{item.procedureRef}</span>
        </p>
      )}
      {item.relatedWorkAreas.length > 0 && (
        <p className="text-ink-muted">
          Related audit work: {item.relatedWorkAreas.map((a) => a.title).join(' · ')}
        </p>
      )}
      {item.scheduleIiiRequirementCodes.length > 0 && (
        <p className="text-ink-muted">
          Related Schedule III disclosure (02.3):{' '}
          {item.scheduleIiiRequirementCodes.map((c) => (
            <span key={c} className="mr-1 font-mono">
              {c}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** "View …" through the Provision Library, resolved for the audit period. */
function CodeReference({
  code,
  label,
  on,
}: {
  code: string;
  label: string;
  on: string | undefined;
}): JSX.Element {
  const { principal } = useAuth();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['authority-provision', code, on ?? null],
    queryFn: () =>
      apiFetch<AuthorityProvisionRecord>(
        `/authority-provisions/${encodeURIComponent(code)}${on ? `?on=${on}` : ''}`,
      ),
    enabled: open,
    retry: false,
    staleTime: 5 * 60_000,
  });
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-left font-medium text-primary-600 hover:underline"
      >
        <BookOpen className="h-3.5 w-3.5 shrink-0" /> {label}
      </button>
      {open &&
        (q.isLoading ? (
          <p className="mt-1 text-ink-faint">Loading…</p>
        ) : (
          <ProvisionViewer
            reference={{ anchor: code.toLowerCase(), label, code, provision: q.data ?? null }}
            canAdmin={can(principal, PERMISSION.serviceManage)}
          />
        ))}
    </div>
  );
}

// ── Clause work ────────────────────────────────────────────────────────────

function ClauseForm({
  item,
  base,
  editable,
  busy,
  act,
}: {
  item: CaroClauseItem;
  base: string;
  editable: boolean;
  busy: boolean;
  act: Busy;
}): JSX.Element {
  const [relevance, setRelevance] = useState<CaroRelevance>(item.relevance);
  const [relevanceReason, setRelevanceReason] = useState(item.relevanceReason ?? '');
  const [workPerformed, setWorkPerformed] = useState(item.workPerformed ?? '');
  const [managementResponse, setManagementResponse] = useState(item.managementResponse ?? '');
  const [draftReporting, setDraftReporting] = useState(item.draftReporting ?? '');
  const [conclusion, setConclusion] = useState<CaroClauseConclusion | ''>(item.conclusion ?? '');
  const [conclusionNote, setConclusionNote] = useState(item.conclusionNote ?? '');
  const id = item.id;

  if (!editable) {
    return (
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
        <dt className="text-ink-faint">Relevance to facts</dt>
        <dd className="text-ink">
          {CARO_RELEVANCE_LABEL[item.relevance]}
          {item.relevanceReason ? ` — ${item.relevanceReason}` : ''}
        </dd>
        <dt className="text-ink-faint">Work performed</dt>
        <dd className="whitespace-pre-line text-ink">{item.workPerformed ?? '—'}</dd>
        <dt className="text-ink-faint">Management response</dt>
        <dd className="whitespace-pre-line text-ink">{item.managementResponse ?? '—'}</dd>
        <dt className="text-ink-faint">Proposed reporting (draft)</dt>
        <dd className="whitespace-pre-line text-ink">{item.draftReporting ?? '—'}</dd>
        <dt className="text-ink-faint">Conclusion</dt>
        <dd className="text-ink">
          {item.conclusion ? CARO_CLAUSE_CONCLUSION_LABEL[item.conclusion] : 'Not concluded'}
          {item.conclusionNote ? ` — ${item.conclusionNote}` : ''}
        </dd>
      </dl>
    );
  }
  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      aria-label={`Clause ${item.clauseRef} work`}
      onSubmit={(e) => {
        e.preventDefault();
        void act(
          () =>
            apiFetch<StatutoryAuditCaroProgramme>(`${base}/clauses/${id}`, {
              method: 'PATCH',
              body: {
                relevance,
                relevanceReason: relevanceReason || null,
                workPerformed: workPerformed || null,
                managementResponse: managementResponse || null,
                draftReporting: draftReporting || null,
                conclusion: conclusion || null,
                conclusionNote: conclusionNote || null,
                version: item.version,
              },
            }),
          `Clause ${item.clauseRef} saved.`,
        );
      }}
    >
      <Field label="Relevance to the entity's facts">
        <Select
          value={relevance}
          onChange={(e) => setRelevance(e.target.value as CaroRelevance)}
          aria-label="Relevance to facts"
        >
          {CARO_RELEVANCES.map((r) => (
            <option key={r} value={r}>
              {CARO_RELEVANCE_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reason" hint="Required when Not Applicable to Facts.">
        <Input
          value={relevanceReason}
          onChange={(e) => setRelevanceReason(e.target.value)}
          aria-label="Relevance reason"
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Work performed">
          <Textarea
            value={workPerformed}
            onChange={(e) => setWorkPerformed(e.target.value)}
            aria-label="Work performed"
          />
        </Field>
      </div>
      <Field label="Management response">
        <Textarea
          value={managementResponse}
          onChange={(e) => setManagementResponse(e.target.value)}
          aria-label="Management response"
        />
      </Field>
      <Field label="Proposed reporting language (draft)" hint="Subject to review and approval.">
        <Textarea
          value={draftReporting}
          onChange={(e) => setDraftReporting(e.target.value)}
          aria-label="Proposed reporting language"
        />
      </Field>
      <Field label="Conclusion">
        <Select
          value={conclusion}
          onChange={(e) => setConclusion(e.target.value as CaroClauseConclusion | '')}
          aria-label="Clause conclusion"
        >
          <option value="">Not concluded</option>
          {CARO_CLAUSE_CONCLUSIONS.map((c) => (
            <option key={c} value={c}>
              {CARO_CLAUSE_CONCLUSION_LABEL[c]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Conclusion note">
        <Input
          value={conclusionNote}
          onChange={(e) => setConclusionNote(e.target.value)}
          aria-label="Conclusion note"
        />
      </Field>
      <div className="sm:col-span-2">
        <Button size="sm" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save clause'}
        </Button>
      </div>
    </form>
  );
}

function EvidenceLinks({
  item,
  engagementId,
  base,
  editable,
  busy,
  act,
}: {
  item: CaroClauseItem;
  engagementId: string;
  base: string;
  editable: boolean;
  busy: boolean;
  act: Busy;
}): JSX.Element {
  const toast = useToast();
  const [linking, setLinking] = useState(false);
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const openDoc = async (documentId: string) => {
    try {
      setDoc(await apiFetch<DocumentRow>(`/engagements/${engagementId}/documents/${documentId}`));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not open the document.', 'error');
    }
  };
  return (
    <div aria-label={`Clause ${item.clauseRef} evidence`}>
      <p className="font-medium text-ink">Evidence</p>
      {item.evidence.length === 0 ? (
        <p className="text-ink-faint">
          No evidence linked. Link the approved evidence already on the file — no second upload.
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {item.evidence.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2">
              {e.documentId ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                  onClick={() => void openDoc(e.documentId!)}
                >
                  {e.title} <ExternalLink className="h-3 w-3" />
                </button>
              ) : (
                <span className="text-ink">{e.title}</span>
              )}
              {e.inSharePoint && <Badge tone="info">SharePoint</Badge>}
              {e.auditEvidenceId && <Badge>Section 06 evidence</Badge>}
              <span className="text-ink-faint">
                linked {formatDate(e.linkedAt)}
                {e.linkedByName ? ` by ${e.linkedByName}` : ''}
              </span>
              {editable && (
                <button
                  type="button"
                  className="text-ink-faint hover:text-danger-700"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      apiFetch<StatutoryAuditCaroProgramme>(
                        `${base}/clauses/${item.id}/evidence/${e.id}/unlink`,
                        { method: 'POST', body: {} },
                      ),
                    )
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-1"
          aria-expanded={linking}
          onClick={() => setLinking((o) => !o)}
        >
          <Link2 className="h-3.5 w-3.5" /> Link Existing File
        </Button>
      )}
      {editable && linking && (
        <LinkPicker
          engagementId={engagementId}
          exclude={item.evidence.map((e) => e.documentId).filter((d): d is string => !!d)}
          onPick={async (documentId) => {
            await act(() =>
              apiFetch<StatutoryAuditCaroProgramme>(`${base}/clauses/${item.id}/evidence`, {
                method: 'POST',
                body: { documentId },
              }),
            );
            setLinking(false);
          }}
        />
      )}
      {doc && (
        <DocumentPreview
          engagementId={engagementId}
          doc={doc}
          canEdit={false}
          onClose={() => setDoc(null)}
        />
      )}
    </div>
  );
}

function Findings({
  item,
  base,
  editable,
  busy,
  act,
}: {
  item: CaroClauseItem;
  base: string;
  editable: boolean;
  busy: boolean;
  act: Busy;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<CaroFindingSeverity>('medium');
  const [workAreaKey, setWorkAreaKey] = useState(item.relatedWorkAreas[0]?.workAreaKey ?? 'caro');
  const [includeInReport, setIncludeInReport] = useState(true);
  const [managementResponse, setManagementResponse] = useState('');
  const live = item.findings.filter((f) => !f.withdrawn);
  return (
    <div aria-label={`Clause ${item.clauseRef} findings`}>
      <p className="font-medium text-ink">Findings</p>
      {live.length === 0 ? (
        <p className="text-ink-faint">No findings.</p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {live.map((f) => (
            <FindingRow
              key={f.id}
              finding={f}
              base={base}
              editable={editable}
              busy={busy}
              act={act}
            />
          ))}
        </ul>
      )}
      {editable && !adding && (
        <Button size="sm" variant="secondary" className="mt-1" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> Add finding
        </Button>
      )}
      {editable && adding && (
        <form
          className="mt-1 grid gap-2 rounded-md border border-line bg-surface p-2 sm:grid-cols-2"
          aria-label="New finding"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () =>
                apiFetch<StatutoryAuditCaroProgramme>(`${base}/clauses/${item.id}/findings`, {
                  method: 'POST',
                  body: {
                    description,
                    severity,
                    workAreaKey,
                    includeInReport,
                    managementResponse: managementResponse || null,
                  },
                }),
              'Finding recorded.',
            ).then(() => {
              setAdding(false);
              setDescription('');
              setManagementResponse('');
            });
          }}
        >
          <div className="sm:col-span-2">
            <Field label="Finding" required>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                aria-label="Finding description"
                required
              />
            </Field>
          </div>
          <Field label="Severity">
            <Select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as CaroFindingSeverity)}
              aria-label="Finding severity"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </Field>
          <Field label="Audit area">
            <Select
              value={workAreaKey}
              onChange={(e) => setWorkAreaKey(e.target.value)}
              aria-label="Finding audit area"
            >
              {(item.relatedWorkAreas.length
                ? item.relatedWorkAreas
                : [{ workAreaKey: 'caro', title: 'CARO' }]
              ).map((a) => (
                <option key={a.workAreaKey} value={a.workAreaKey}>
                  {a.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Management response">
            <Input
              value={managementResponse}
              onChange={(e) => setManagementResponse(e.target.value)}
              aria-label="Finding management response"
            />
          </Field>
          <label className="flex items-center gap-2 self-end text-ink">
            <input
              type="checkbox"
              checked={includeInReport}
              onChange={(e) => setIncludeInReport(e.target.checked)}
            />
            Link to CARO reporting
          </label>
          <div className="flex gap-1.5 sm:col-span-2">
            <Button size="sm" type="submit" disabled={busy || !description.trim()}>
              Record finding
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function FindingRow({
  finding: f,
  base,
  editable,
  busy,
  act,
}: {
  finding: CaroFinding;
  base: string;
  editable: boolean;
  busy: boolean;
  act: Busy;
}): JSX.Element {
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState('');
  return (
    <li className="rounded-md border border-line bg-surface px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-ink-muted">{f.code}</span>
        <Badge
          tone={f.severity === 'high' ? 'danger' : f.severity === 'medium' ? 'warn' : 'neutral'}
        >
          {f.severity}
        </Badge>
        <Badge tone={f.status === 'open' ? 'warn' : 'success'}>{f.status}</Badge>
        {f.includeInReport && <Badge tone="info">Reporting</Badge>}
        {f.workAreaTitle && <span className="text-ink-faint">{f.workAreaTitle}</span>}
        {f.procedureRef && <span className="font-mono text-ink-faint">{f.procedureRef}</span>}
      </div>
      <p className="mt-0.5 whitespace-pre-line text-ink">{f.description}</p>
      {f.managementResponse && (
        <p className="text-ink-muted">Management response: {f.managementResponse}</p>
      )}
      {f.resolution && <p className="text-ink-muted">Resolution: {f.resolution}</p>}
      {editable && f.status === 'open' && !resolving && (
        <button
          type="button"
          className="mt-0.5 text-primary-600 hover:underline"
          onClick={() => setResolving(true)}
        >
          Resolve…
        </button>
      )}
      {editable && resolving && (
        <div className="mt-1 flex gap-1.5">
          <Input
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            aria-label={`Resolution of ${f.code}`}
            placeholder="How was it resolved?"
          />
          <Button
            size="sm"
            disabled={busy || !resolution.trim()}
            onClick={() =>
              void act(() =>
                apiFetch<StatutoryAuditCaroProgramme>(`${base}/findings/${f.id}`, {
                  method: 'PATCH',
                  body: { status: 'resolved', resolution, version: f.version },
                }),
              )
            }
          >
            Resolve
          </Button>
        </div>
      )}
    </li>
  );
}

// ── Clause 3(xxi) components (spec §14) ─────────────────────────────────────

function Components({
  item,
  engagementId,
  base,
  editable,
  busy,
  act,
}: {
  item: CaroClauseItem;
  engagementId: string;
  base: string;
  editable: boolean;
  busy: boolean;
  act: Busy;
}): JSX.Element {
  const [name, setName] = useState('');
  const live = item.components.filter((c) => !c.withdrawn);
  return (
    <div aria-label="Companies included in the CFS">
      <p className="font-medium text-ink">
        Companies included in the consolidated financial statements
      </p>
      <p className="text-ink-faint">From the 02.6 group structure — one source, no re-entry.</p>
      {live.length === 0 ? (
        <p className="mt-1 text-ink-faint">No companies yet — conclude 02.6 or add one.</p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {live.map((c) => (
            <ComponentRow
              key={c.id}
              component={c}
              engagementId={engagementId}
              base={base}
              editable={editable}
              busy={busy}
              act={act}
            />
          ))}
        </ul>
      )}
      {editable && (
        <form
          className="mt-1 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              apiFetch<StatutoryAuditCaroProgramme>(`${base}/clauses/${item.id}/components`, {
                method: 'POST',
                body: { componentName: name },
              }),
            ).then(() => setName(''));
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Add a company not in 02.6…"
            aria-label="Company name"
          />
          <Button size="sm" variant="secondary" type="submit" disabled={busy || !name.trim()}>
            Add
          </Button>
        </form>
      )}
    </div>
  );
}

function ComponentRow({
  component: c,
  engagementId,
  base,
  editable,
  busy,
  act,
}: {
  component: CaroComponent;
  engagementId: string;
  base: string;
  editable: boolean;
  busy: boolean;
  act: Busy;
}): JSX.Element {
  const [linking, setLinking] = useState(false);
  const [refs, setRefs] = useState(c.paragraphRefs ?? '');
  const [auditor, setAuditor] = useState(c.auditorName ?? '');
  const patch = (body: Record<string, unknown>) =>
    act(() =>
      apiFetch<StatutoryAuditCaroProgramme>(`${base}/components/${c.id}`, {
        method: 'PATCH',
        body: { ...body, version: c.version },
      }),
    );
  return (
    <li className="space-y-1 rounded-md border border-line bg-surface px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{c.componentName}</span>
        {c.relationship && <span className="text-ink-faint">{c.relationship}</span>}
        <Badge>{c.source === '02.6' ? 'From 02.6' : 'Added'}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="CARO applicable">
          <Select
            value={c.caroApplicable}
            disabled={!editable || busy}
            aria-label={`CARO applicable to ${c.componentName}`}
            onChange={(e) =>
              void patch({ caroApplicable: e.target.value as CaroComponentApplicable })
            }
          >
            {CARO_COMPONENT_APPLICABLE.map((v) => (
              <option key={v} value={v}>
                {CARO_COMPONENT_APPLICABLE_LABEL[v]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Qualification / adverse remark">
          <Select
            value={
              c.qualificationIdentified == null ? '' : c.qualificationIdentified ? 'yes' : 'no'
            }
            disabled={!editable || busy || c.caroApplicable !== 'yes'}
            aria-label={`Qualification in ${c.componentName}'s CARO report`}
            onChange={(e) =>
              void patch({
                qualificationIdentified: e.target.value === '' ? null : e.target.value === 'yes',
              })
            }
          >
            <option value="">Not recorded</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </Field>
        <Field label="CARO paragraph numbers">
          <Input
            value={refs}
            disabled={!editable}
            onChange={(e) => setRefs(e.target.value)}
            onBlur={() =>
              refs !== (c.paragraphRefs ?? '') && void patch({ paragraphRefs: refs || null })
            }
            aria-label={`CARO paragraph numbers for ${c.componentName}`}
          />
        </Field>
        <Field label="Component auditor">
          <Input
            value={auditor}
            disabled={!editable}
            onChange={(e) => setAuditor(e.target.value)}
            onBlur={() =>
              auditor !== (c.auditorName ?? '') && void patch({ auditorName: auditor || null })
            }
            aria-label={`Auditor of ${c.componentName}`}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink-faint">Auditor&apos;s report:</span>
        <span className="text-ink">{c.auditorReportTitle ?? 'Not linked'}</span>
        {editable && (
          <button
            type="button"
            className="text-primary-600 hover:underline"
            aria-expanded={linking}
            onClick={() => setLinking((o) => !o)}
          >
            {c.auditorReportDocumentId ? 'Change' : 'Link report'}
          </button>
        )}
      </div>
      {editable && linking && (
        <LinkPicker
          engagementId={engagementId}
          exclude={c.auditorReportDocumentId ? [c.auditorReportDocumentId] : []}
          onPick={async (documentId) => {
            await patch({ auditorReportDocumentId: documentId });
            setLinking(false);
          }}
        />
      )}
    </li>
  );
}

// ── Review (spec §13) ──────────────────────────────────────────────────────

function ReviewBar({
  item,
  base,
  editable,
  busy,
  act,
}: {
  item: CaroClauseItem;
  base: string;
  editable: boolean;
  busy: boolean;
  act: Busy;
}): JSX.Element {
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState('');
  const review = (action: CaroReviewAction, ok: string, extra: Record<string, unknown> = {}) =>
    act(
      () =>
        apiFetch<StatutoryAuditCaroProgramme>(`${base}/clauses/${item.id}/review`, {
          method: 'POST',
          body: { action, version: item.version, ...extra },
        }),
      ok,
    );
  const s = item.reviewState;
  return (
    <div
      className="space-y-1.5 border-t border-line pt-2"
      aria-label={`Clause ${item.clauseRef} review`}
    >
      <p className="text-ink-muted">
        {CARO_REVIEW_STATE_LABEL[s]}
        {item.submittedByName && item.submittedAt
          ? ` · submitted by ${item.submittedByName} on ${formatDate(item.submittedAt)}`
          : ''}
        {item.approvedByName && item.approvedAt
          ? ` · approved by ${item.approvedByName} on ${formatDate(item.approvedAt)}`
          : ''}
        {item.requiresPartnerReview
          ? item.partnerReviewedAt
            ? ` · Partner review by ${item.partnerReviewedByName ?? 'the Engagement Partner'} on ${formatDate(item.partnerReviewedAt)}`
            : ' · Partner review required'
          : ''}
      </p>
      {s === 'returned' && item.returnNote && (
        <p className="text-warning-700">Returned: {item.returnNote}</p>
      )}
      {s !== 'approved' && item.approvalBlockers.length > 0 && (
        <ul className="list-disc pl-4 text-warning-700" aria-label="Still needed">
          {item.approvalBlockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="flex flex-wrap gap-1.5">
          {(s === 'open' || s === 'returned') && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void review('submit', 'Submitted for review.')}
            >
              Submit for review
            </Button>
          )}
          {s === 'submitted' && (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void review('approve', 'Clause conclusion approved.')}
              >
                Approve
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setReturning((o) => !o)}>
                Return…
              </Button>
            </>
          )}
          {item.requiresPartnerReview && !item.partnerReviewedAt && s !== 'approved' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void review('partner_review', 'Partner review recorded.')}
            >
              Record Partner review
            </Button>
          )}
          {s === 'approved' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void review('reopen', 'Clause reopened — the approval is withdrawn.')}
            >
              Reopen
            </Button>
          )}
        </div>
      )}
      {editable && returning && s === 'submitted' && (
        <div className="flex gap-1.5">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What needs to change?"
            aria-label="Return note"
          />
          <Button
            size="sm"
            disabled={busy || !note.trim()}
            onClick={() => void review('return', 'Returned to the preparer.', { note })}
          >
            Return
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Draft annexure (spec §18) ──────────────────────────────────────────────

function AnnexurePreview({ base, queryKey }: { base: string; queryKey: unknown[] }): JSX.Element {
  const q = useQuery({
    queryKey,
    queryFn: () => apiFetch<CaroReportingSummary>(`${base}/annexure`),
  });
  if (q.isLoading) return <Spinner label="Building the draft annexure…" />;
  if (q.isError || !q.data)
    return <p className="text-xs text-danger-700">Could not build the draft annexure.</p>;
  const drafts = [q.data.standalone, q.data.consolidated].filter(
    (d): d is NonNullable<typeof d> => d !== null,
  );
  return (
    <div className="mt-1 space-y-3 rounded-md border border-line bg-surface px-3 py-2 text-xs">
      {drafts.map((d) => (
        <div key={d.reportContext} aria-label={`Draft annexure — ${d.reportContext}`}>
          <p className="font-semibold text-ink">{d.heading}</p>
          <p className="text-ink-faint">
            {d.approvedCount} of {d.totalCount} clause conclusions approved
            {d.reportableCount ? ` · ${d.reportableCount} reportable` : ''}
            {d.complete ? ' · complete' : ' · draft'}
          </p>
          <ol className="mt-1 space-y-1">
            {d.paragraphs.map((p) => (
              <li key={p.clauseCode}>
                <span className="font-mono text-ink-muted">{p.clauseRef}</span>{' '}
                {p.text ? (
                  <span className="text-ink">{p.text}</span>
                ) : (
                  <span className="italic text-ink-faint">[{p.title} — awaiting approval]</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
