'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  conditionProblems,
  describeCondition,
  TAX_AUDIT_ACTS,
  TAX_AUDIT_DRAFT_SOURCE_LABEL,
  TAX_AUDIT_DRAFT_SOURCES,
  TAX_AUDIT_GRADE_LABEL,
  TAX_AUDIT_GRADES,
  TAX_AUDIT_PACKAGE_LABEL,
  TAX_AUDIT_PACKAGES,
  type CreateTaxAuditLibraryDraftInput,
  type TaxAuditAct,
  type TaxAuditCondition,
  type TaxAuditDraftSource,
  type TaxAuditGrade,
  type TaxAuditLibraryClause,
  type TaxAuditLibraryClauseInput,
  type TaxAuditLibraryView,
  type TaxAuditPackage,
  type TaxAuditSubItem,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/lib/toast';
import { Badge, Button, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ExpandToggle } from '@/components/inline-panel';

const API = '/tax-audit-clause-library';
const ACT_LABEL: Record<TaxAuditAct, string> = {
  '1961': 'Income-tax Act 1961',
  '2025': 'Income-tax Act 2025',
};
const FY = /^[0-9]{4}-[0-9]{2}$/;

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Send = (method: Method, path: string, body: unknown, done: string, after?: () => void) => void;

/**
 * Form 3CD clause library (Phase 4, F-4): every clause of the tax audit
 * report with its sub-items, when it applies (and why it is Not applicable
 * otherwise), the work package and grade it goes to, the evidence it needs
 * and where its draft comes from. A published version never changes; the
 * next one is a draft — a copy, or a whole form imported as JSON — that is
 * published in its turn. An audit uses the newest version published for its
 * year.
 */
export function TaxAuditClauseLibrarySection(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [versionNo, setVersionNo] = useState<number | null>(null);
  const lib = useQuery({
    queryKey: ['tax-audit-clause-library', versionNo ?? 'default'],
    queryFn: () => apiFetch<TaxAuditLibraryView>(versionNo ? `${API}?version=${versionNo}` : API),
  });
  const mutation = useMutation({
    mutationFn: (v: {
      method: Method;
      path: string;
      body: unknown;
      done: string;
      after?: () => void;
    }) =>
      apiFetch<TaxAuditLibraryView>(`${API}${v.path}`, {
        method: v.method,
        body: v.method === 'DELETE' ? undefined : v.body,
      }),
    onSuccess: (data, v) => {
      void qc.invalidateQueries({ queryKey: ['tax-audit-clause-library'] });
      const shown = data.selected?.versionNo ?? null;
      qc.setQueryData(['tax-audit-clause-library', shown ?? 'default'], data);
      setVersionNo(shown);
      toast(v.done);
      v.after?.();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save the library.'),
  });
  const send: Send = (method, path, body, done, after) =>
    mutation.mutate({ method, path, body, done, after });

  const v = lib.data;
  const draft = v?.versions.find((x) => x.status === 'draft') ?? null;
  const sel = v?.selected ?? null;
  const editable = sel?.status === 'draft';

  return (
    <div className="space-y-4">
      <div className="max-w-3xl space-y-2">
        <h3 className="text-sm font-semibold text-ink">Form 3CD Library</h3>
        <p className="text-xs text-ink-muted">
          Every clause of the tax audit report: its sub-items, when it applies and why it is Not
          applicable otherwise, the package and grade it goes to, the evidence it needs and where
          its draft comes from. A published version is never edited — start a draft (a copy, or a
          new form imported as JSON), change it and publish it. An audit uses the newest version
          published for its year.
        </p>
      </div>
      {lib.isLoading ? (
        <Spinner label="Loading the library…" />
      ) : lib.isError || !v ? (
        <p className="text-sm text-danger-600">Could not load the Form 3CD Library.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-muted">
              <tr>
                <th className="py-1">Version</th>
                <th>Name</th>
                <th>Act</th>
                <th>From</th>
                <th>Clauses</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {v.versions.map((r) => (
                <tr
                  key={r.versionNo}
                  className={r.versionNo === sel?.versionNo ? 'bg-primary-50/40' : ''}
                >
                  <td className="py-1.5 font-mono text-xs">v{r.versionNo}</td>
                  <td>
                    {r.label}
                    {r.basedOnVersionNo && (
                      <span className="text-xs text-ink-faint"> (from v{r.basedOnVersionNo})</span>
                    )}
                  </td>
                  <td className="text-xs">{ACT_LABEL[r.act]}</td>
                  <td className="text-xs">FY {r.appliesFromFy}</td>
                  <td>{r.clauseCount}</td>
                  <td>
                    <Badge tone={r.status === 'draft' ? 'warn' : 'success'}>
                      {r.status === 'draft'
                        ? 'Draft'
                        : `Published ${r.publishedAt ? formatDate(r.publishedAt) : ''}`}
                    </Badge>
                  </td>
                  <td className="text-right">
                    {r.versionNo !== sel?.versionNo && (
                      <button
                        type="button"
                        className="text-xs text-primary-700 hover:underline"
                        onClick={() => setVersionNo(r.versionNo)}
                      >
                        View
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!draft && (
            <NewDraftForm
              newest={v.versions.find((x) => x.status === 'published') ?? null}
              pending={mutation.isPending}
              send={send}
            />
          )}

          {sel && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">
                  v{sel.versionNo} — {v.clauses.length} clause{v.clauses.length === 1 ? '' : 's'}
                </span>
                {editable && (
                  <DraftActions
                    versionNo={sel.versionNo}
                    canPublish={v.clauses.length > 0}
                    pending={mutation.isPending}
                    send={send}
                  />
                )}
              </div>
              {sel.notes && <p className="text-xs text-ink-muted">{sel.notes}</p>}
              <ul className="divide-y divide-line rounded-lg border border-line">
                {editable && (
                  <ClauseEditor
                    key="new"
                    clause={null}
                    nextSort={(v.clauses.at(-1)?.sortOrder ?? 0) + 10}
                    versionNo={sel.versionNo}
                    pending={mutation.isPending}
                    send={send}
                  />
                )}
                {v.clauses.map((c) => (
                  <ClauseEditor
                    key={c.id}
                    clause={c}
                    nextSort={c.sortOrder}
                    versionNo={sel.versionNo}
                    editable={editable}
                    pending={mutation.isPending}
                    send={send}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NewDraftForm({
  newest,
  pending,
  send,
}: {
  newest: TaxAuditLibraryView['versions'][number] | null;
  pending: boolean;
  send: Send;
}): JSX.Element {
  const [label, setLabel] = useState('');
  const [act, setAct] = useState<TaxAuditAct>(newest?.act ?? '1961');
  const [fy, setFy] = useState('');
  const [notes, setNotes] = useState('');
  const [importing, setImporting] = useState(false);
  const [json, setJson] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const start = () => {
    const body: CreateTaxAuditLibraryDraftInput = {
      label: label.trim(),
      act,
      appliesFromFy: fy.trim(),
      notes: notes.trim() || null,
    };
    if (importing) {
      let clauses: unknown;
      try {
        clauses = JSON.parse(json);
      } catch {
        setProblem('The import is not valid JSON.');
        return;
      }
      if (!Array.isArray(clauses)) {
        setProblem('The import must be a JSON list of clauses.');
        return;
      }
      body.clauses = clauses as TaxAuditLibraryClauseInput[];
    } else if (newest) {
      body.basedOnVersionNo = newest.versionNo;
    }
    setProblem(null);
    send(
      'POST',
      '/drafts',
      body,
      importing ? 'Draft loaded from the import.' : 'Draft started as a copy.',
      () => {
        setLabel('');
        setFy('');
        setNotes('');
        setJson('');
      },
    );
  };

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-line p-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={!importing} onChange={() => setImporting(false)} />
          Copy {newest ? `v${newest.versionNo}` : 'the newest version'}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={importing} onChange={() => setImporting(true)} />
          Import a new form (JSON)
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Field label="Name of the version" required>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
        </div>
        <Field label="Act">
          <Select value={act} onChange={(e) => setAct(e.target.value as TaxAuditAct)}>
            {TAX_AUDIT_ACTS.map((a) => (
              <option key={a} value={a}>
                {ACT_LABEL[a]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="First year audited on it" hint="e.g. 2026-27" required>
          <Input value={fy} onChange={(e) => setFy(e.target.value)} />
        </Field>
      </div>
      <Field label="What this version changes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {importing && (
        <Field
          label="Clauses"
          hint="A JSON list; each clause has clauseNo, part, title, subItems, appliesWhen, notApplicableReason, defaultPackage, defaultGrade, evidence, draftSource, partnerReview and sortOrder."
        >
          <Textarea
            aria-label="Clauses JSON"
            rows={8}
            className="font-mono text-xs"
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
        </Field>
      )}
      {problem && <p className="text-xs text-danger-600">{problem}</p>}
      <Button
        variant="secondary"
        disabled={pending || !label.trim() || !FY.test(fy.trim()) || (importing && !json.trim())}
        onClick={start}
      >
        Start draft
      </Button>
    </div>
  );
}

function DraftActions({
  versionNo,
  canPublish,
  pending,
  send,
}: {
  versionNo: number;
  canPublish: boolean;
  pending: boolean;
  send: Send;
}): JSX.Element {
  const [confirming, setConfirming] = useState<'publish' | 'discard' | null>(null);
  if (confirming) {
    const publish = confirming === 'publish';
    return (
      <span className="flex items-center gap-2 text-xs">
        <span className="text-warning-800">
          {publish
            ? `Publish v${versionNo}? Audits of its years will use it, and it can no longer be edited.`
            : `Discard draft v${versionNo} and its changes?`}
        </span>
        <Button
          size="sm"
          variant={publish ? 'primary' : 'secondary'}
          disabled={pending}
          onClick={() =>
            publish
              ? send('POST', `/${versionNo}/publish`, {}, `v${versionNo} published.`, () =>
                  setConfirming(null),
                )
              : send('DELETE', `/${versionNo}`, null, `Draft v${versionNo} discarded.`, () =>
                  setConfirming(null),
                )
          }
        >
          {publish ? 'Publish' : 'Discard'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
          Cancel
        </Button>
      </span>
    );
  }
  return (
    <>
      <Button size="sm" disabled={!canPublish} onClick={() => setConfirming('publish')}>
        Publish draft
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming('discard')}>
        Discard draft
      </Button>
    </>
  );
}

const EMPTY: TaxAuditLibraryClauseInput = {
  clauseNo: '',
  part: 'B',
  title: '',
  subItems: [],
  appliesWhen: null,
  notApplicableReason: null,
  defaultPackage: 'general',
  defaultGrade: 'article',
  evidence: [],
  draftSource: null,
  partnerReview: false,
  sortOrder: 0,
};

const toInput = (c: TaxAuditLibraryClause): TaxAuditLibraryClauseInput =>
  (({ id: _id, ...rest }) => rest)(c);
const pretty = (x: unknown): string => (x == null ? '' : JSON.stringify(x, null, 2));

/** One clause, opened under itself (+/−); a draft's clauses are editable in place. */
function ClauseEditor({
  clause,
  nextSort,
  versionNo,
  editable = true,
  pending,
  send,
}: {
  clause: TaxAuditLibraryClause | null;
  nextSort: number;
  versionNo: number;
  editable?: boolean;
  pending: boolean;
  send: Send;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const initial = clause ? toInput(clause) : { ...EMPTY, sortOrder: nextSort };
  const [f, setF] = useState<TaxAuditLibraryClauseInput>(initial);
  const [evidence, setEvidence] = useState(initial.evidence.join('\n'));
  const [subItems, setSubItems] = useState(pretty(initial.subItems));
  const [condition, setCondition] = useState(pretty(initial.appliesWhen));
  const set = <K extends keyof TaxAuditLibraryClauseInput>(
    k: K,
    value: TaxAuditLibraryClauseInput[K],
  ) => setF((x) => ({ ...x, [k]: value }));

  // The sub-items and the condition are edited as JSON; read them as typed.
  const parsed = (() => {
    const problems: string[] = [];
    let items: TaxAuditSubItem[] = [];
    let cond: TaxAuditCondition | null = null;
    try {
      const x: unknown = subItems.trim() ? JSON.parse(subItems) : [];
      if (Array.isArray(x)) items = x as TaxAuditSubItem[];
      else problems.push('Sub-items must be a JSON list.');
    } catch {
      problems.push('Sub-items are not valid JSON.');
    }
    try {
      cond = condition.trim() ? (JSON.parse(condition) as TaxAuditCondition) : null;
      problems.push(...conditionProblems(cond));
    } catch {
      problems.push('The condition is not valid JSON.');
    }
    if (cond && !f.notApplicableReason?.trim()) {
      problems.push('Say why the clause is Not applicable when its condition fails.');
    }
    return { problems, items, cond };
  })();

  const save = () =>
    send(
      clause ? 'PUT' : 'POST',
      clause ? `/${versionNo}/clauses/${clause.id}` : `/${versionNo}/clauses`,
      {
        ...f,
        clauseNo: f.clauseNo.trim(),
        title: f.title.trim(),
        subItems: parsed.items,
        appliesWhen: parsed.cond,
        notApplicableReason: parsed.cond ? (f.notApplicableReason?.trim() ?? null) : null,
        evidence: evidence
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
      },
      clause ? `Clause ${f.clauseNo} saved.` : `Clause ${f.clauseNo} added to v${versionNo}.`,
      () => {
        if (!clause) {
          setF({ ...EMPTY, sortOrder: f.sortOrder + 10 });
          setEvidence('');
          setSubItems('');
          setCondition('');
        }
        setOpen(false);
      },
    );

  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="group flex flex-1 flex-wrap items-center gap-2.5 text-left"
        >
          <ExpandToggle open={open} />
          {clause ? (
            <>
              <span className="w-12 font-mono text-xs text-ink">{clause.clauseNo}</span>
              <span className="text-sm text-ink">{clause.title}</span>
              {clause.appliesWhen && <Badge tone="info">Conditional</Badge>}
              {clause.partnerReview && <Badge tone="warn">Partner review</Badge>}
              <span className="ml-auto text-xs text-ink-faint">
                {TAX_AUDIT_PACKAGE_LABEL[clause.defaultPackage]} ·{' '}
                {TAX_AUDIT_GRADE_LABEL[clause.defaultGrade]}
              </span>
            </>
          ) : (
            <span className="text-sm font-medium text-primary-700">
              Add a clause to v{versionNo}
            </span>
          )}
        </button>
        {clause && editable && (
          <button
            type="button"
            className="text-xs text-danger-600 hover:underline"
            disabled={pending}
            onClick={() =>
              send(
                'DELETE',
                `/${versionNo}/clauses/${clause.id}`,
                null,
                `Clause ${clause.clauseNo} taken off v${versionNo}.`,
              )
            }
          >
            Remove
          </button>
        )}
      </div>
      {open && (
        <fieldset disabled={!editable} className="mt-3 space-y-3 pl-7">
          <div className="grid gap-3 sm:grid-cols-6">
            <Field label="Clause" hint="8a, 21(d), 29A">
              <Input value={f.clauseNo} onChange={(e) => set('clauseNo', e.target.value)} />
            </Field>
            <Field label="Part">
              <Select value={f.part} onChange={(e) => set('part', e.target.value as 'A' | 'B')}>
                <option value="A">A</option>
                <option value="B">B</option>
              </Select>
            </Field>
            <div className="sm:col-span-4">
              <Field label="Title">
                <Input value={f.title} onChange={(e) => set('title', e.target.value)} />
              </Field>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Work package">
              <Select
                value={f.defaultPackage}
                onChange={(e) => set('defaultPackage', e.target.value as TaxAuditPackage)}
              >
                {TAX_AUDIT_PACKAGES.map((p) => (
                  <option key={p} value={p}>
                    {TAX_AUDIT_PACKAGE_LABEL[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prepared by">
              <Select
                value={f.defaultGrade}
                onChange={(e) => set('defaultGrade', e.target.value as TaxAuditGrade)}
              >
                {TAX_AUDIT_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {TAX_AUDIT_GRADE_LABEL[g]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Draft from">
              <Select
                value={f.draftSource ?? ''}
                onChange={(e) =>
                  set('draftSource', (e.target.value || null) as TaxAuditDraftSource | null)
                }
              >
                <option value="">Nothing — typed in</option>
                {TAX_AUDIT_DRAFT_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {TAX_AUDIT_DRAFT_SOURCE_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sort order">
              <Input
                type="number"
                value={String(f.sortOrder)}
                onChange={(e) =>
                  set('sortOrder', Math.max(0, Math.trunc(Number(e.target.value) || 0)))
                }
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.partnerReview}
              onChange={(e) => set('partnerReview', e.target.checked)}
            />
            The partner reviews this clause themselves
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Applies when"
              hint={`Blank = always. ${parsed.problems.length ? '' : describeCondition(parsed.cond)}`}
            >
              <Textarea
                aria-label="Applies when"
                rows={4}
                className="font-mono text-xs"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
              />
            </Field>
            <Field label="Why it is Not applicable otherwise">
              <Textarea
                rows={4}
                value={f.notApplicableReason ?? ''}
                onChange={(e) => set('notApplicableReason', e.target.value || null)}
              />
            </Field>
            <Field label="Sub-items" hint='[{"key":"a","label":"…","kind":"table"}]'>
              <Textarea
                aria-label="Sub-items"
                rows={4}
                className="font-mono text-xs"
                value={subItems}
                onChange={(e) => setSubItems(e.target.value)}
              />
            </Field>
            <Field label="Evidence" hint="One per line">
              <Textarea rows={4} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
            </Field>
          </div>
          {editable && parsed.problems.length > 0 && (
            <ul className="text-xs text-danger-600">
              {parsed.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {editable && (
            <Button
              variant="secondary"
              disabled={
                pending || !f.clauseNo.trim() || !f.title.trim() || parsed.problems.length > 0
              }
              onClick={save}
            >
              {clause ? 'Save clause' : 'Add clause'}
            </Button>
          )}
        </fieldset>
      )}
    </li>
  );
}
