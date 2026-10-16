'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileUp } from 'lucide-react';
import {
  NOTICE_SERVED_VIAS,
  NOTICE_SERVED_VIA_LABEL,
  NOTICE_STREAMS,
  NOTICE_STREAM_LABEL,
  noticeTypeLabel,
  type Notice,
  type NoticeIntakeResponse,
  type NoticeServedVia,
  type NoticeType,
  type Paginated,
} from '@hsdg/contracts';
import { ApiError, apiFetch } from '@/lib/api';
import {
  createNotice,
  noticeIntake,
  noticeTypesQuery,
  uploadNoticeDocument,
  withdrawUpload,
} from '@/lib/notices-api';
import {
  defaultReplyDue,
  emptyNoticeForm,
  intakePrefill,
  toCreateNoticeRequest,
  type IntakeFormField,
  type IntakePrefill,
  type NoticeFormValues,
} from '@/lib/notices';
import type { EmployeeRow, EngagementRow } from '@/lib/types';
import { todayIst } from '@/components/work/my-task-columns';
import { Modal } from '@/components/modal';
import { Field, Input, Select, Textarea } from '@/components/form';
import { Button, Spinner } from '@/components/ui';
import { EntityPicker, type Picked } from '@/components/entity-picker';

const NO_EXCLUDE = new Set<string>();

export const employeesQuery = {
  queryKey: ['employees', 'pick'] as const,
  queryFn: () => apiFetch<Paginated<EmployeeRow>>('/employees?limit=100'),
  staleTime: 5 * 60 * 1000,
};

/** The library grouped by stream, active types only, for an <optgroup> select. */
export function typesByStream(
  types: NoticeType[],
): { stream: string; label: string; types: NoticeType[] }[] {
  return NOTICE_STREAMS.map((s) => ({
    stream: s,
    label: NOTICE_STREAM_LABEL[s],
    types: types.filter((t) => t.stream === s && t.isActive),
  })).filter((g) => g.types.length > 0);
}

export function NoticeTypeSelect({
  value,
  onChange,
  types,
}: {
  value: string;
  onChange: (code: string) => void;
  types: NoticeType[];
}): JSX.Element {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Notice type">
      <option value="">Choose the notice…</option>
      {typesByStream(types).map((g) => (
        <optgroup key={g.stream} label={g.label}>
          {g.types.map((t) => (
            <option key={t.code} value={t.code}>
              {noticeTypeLabel(t)}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** "Check this" / "the PDF may say" under a field the intake touched. */
function IntakeNoteLine({
  field,
  prefill,
  onUse,
}: {
  field: IntakeFormField;
  prefill: IntakePrefill | null;
  onUse: (value: string) => void;
}): JSX.Element | null {
  if (!prefill) return null;
  const check = prefill.check[field];
  if (check) {
    return (
      <span className="mt-1 flex items-start gap-1 text-xs text-warning-700">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        <span>
          Check this{check.snippet ? <> — read from &ldquo;{check.snippet}&rdquo;</> : ''}
        </span>
      </span>
    );
  }
  const unsure = prefill.unsure[field];
  if (unsure) {
    return (
      <span className="mt-1 block text-xs text-ink-faint">
        The PDF may say <span className="font-medium text-ink-muted">{unsure.value}</span>
        {unsure.snippet ? <> (&ldquo;{unsure.snippet}&rdquo;)</> : ''}.{' '}
        <button
          type="button"
          className="text-primary-700 hover:underline"
          onClick={() => onUse(unsure.value)}
        >
          Use it
        </button>
      </span>
    );
  }
  if (field in prefill.values) {
    return <span className="mt-1 block text-xs text-success-700">Read from the PDF.</span>;
  }
  return null;
}

interface IntakeState {
  file: File;
  documentId: string;
  /** The engagement the PDF was filed on. */
  engagementId: string;
}

/**
 * PS-102 / PS-104 — record a notice. Optionally start from the PDF: it is filed
 * on the chosen engagement as a `notice` document, read (POST /notices/intake,
 * polled while OCR runs) and the suggestions pre-fill the form. Nothing is
 * saved until the person submits.
 */
export function NewNoticeModal({
  onClose,
  onCreated,
  initial,
  pollMs = 3000,
}: {
  onClose: () => void;
  onCreated: (n: Notice) => void;
  /** Pre-pick the client and engagement (from an engagement's Overview). */
  initial?: { entityId: string; entityName: string; engagementId: string };
  /** How often to ask again while the PDF's OCR is pending. */
  pollMs?: number;
}): JSX.Element {
  const today = useMemo(() => todayIst(), []);
  const [v, setV] = useState<NoticeFormValues>(() => ({
    ...emptyNoticeForm(today),
    engagementId: initial?.engagementId ?? '',
  }));
  const [entity, setEntity] = useState<Picked | null>(
    initial ? { id: initial.entityId, label: initial.entityName } : null,
  );
  const [replyTouched, setReplyTouched] = useState(false);
  const [intake, setIntake] = useState<IntakeState | null>(null);
  const [prefill, setPrefill] = useState<IntakePrefill | null>(null);
  const appliedFor = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof NoticeFormValues>(k: K, val: NoticeFormValues[K]): void =>
    setV((cur) => ({ ...cur, [k]: val }));

  const types = useQuery(noticeTypesQuery);
  const employees = useQuery(employeesQuery);
  const engagements = useQuery({
    queryKey: ['engagements', 'for-entity', entity?.id],
    queryFn: () =>
      apiFetch<Paginated<EngagementRow>>(`/engagements?entityId=${entity!.id}&limit=100`),
    enabled: !!entity,
  });
  const type = types.data?.find((t) => t.code === v.noticeTypeCode);

  // Reply due follows the type's default days until the person sets it.
  useEffect(() => {
    if (replyTouched) return;
    const d = defaultReplyDue(v.issuedOn, type?.defaultReplyDays);
    setV((cur) => (cur.replyDueOn === d ? cur : { ...cur, replyDueOn: d }));
  }, [v.issuedOn, type?.defaultReplyDays, replyTouched]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const doc = await uploadNoticeDocument({
        engagementId: v.engagementId,
        file,
        documentType: 'notice',
      });
      return { file, documentId: doc.id, engagementId: v.engagementId };
    },
    onSuccess: (s) => {
      setIntake(s);
      setPrefill(null);
      appliedFor.current = null;
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not upload the PDF.'),
  });

  const read = useQuery({
    queryKey: ['notice-intake', intake?.documentId],
    queryFn: () => noticeIntake(intake!.documentId),
    enabled: !!intake,
    refetchInterval: (q) => (q.state.data?.ocrStatus === 'pending' ? pollMs : false),
    retry: false,
  });

  // Apply the suggestions once, when the read finishes.
  useEffect(() => {
    const r: NoticeIntakeResponse | undefined = read.data;
    if (!r || r.ocrStatus === 'pending' || appliedFor.current === r.documentId) return;
    appliedFor.current = r.documentId;
    const p = intakePrefill(r);
    setPrefill(p);
    setV((cur) => ({ ...cur, ...p.values }));
    if (p.values.replyDueOn) setReplyTouched(true);
  }, [read.data]);

  // The GSTIN read from the PDF → the client's registration, when it is the chosen client.
  const matches = read.data?.clients ?? [];
  const match = matches.find((m) => m.entityId === entity?.id);
  useEffect(() => {
    if (match?.registrationId) setV((cur) => ({ ...cur, registrationId: match.registrationId! }));
  }, [match?.registrationId]);

  const create = useMutation({
    mutationFn: async () => {
      let documentId = intake?.documentId ?? null;
      // The PDF went onto another engagement before the client was corrected:
      // file it again on the right one and withdraw the stray copy.
      if (intake && intake.engagementId !== v.engagementId) {
        const doc = await uploadNoticeDocument({
          engagementId: v.engagementId,
          file: intake.file,
          documentType: 'notice',
        });
        documentId = doc.id;
        await withdrawUpload(intake.engagementId, intake.documentId).catch(() => undefined);
      }
      return createNotice(toCreateNoticeRequest(v, documentId));
    },
    onSuccess: (n) => onCreated(n),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not record the notice.'),
  });

  const missing =
    !v.engagementId || !v.noticeTypeCode || !v.referenceNo.trim() || !v.issuedOn || !v.receivedOn;
  const reading = !!intake && (read.isLoading || read.data?.ocrStatus === 'pending');
  const note = (field: IntakeFormField): ReactNode => (
    <IntakeNoteLine
      field={field}
      prefill={prefill}
      onUse={(value) => {
        set(field, value);
        if (field === 'replyDueOn') setReplyTouched(true);
      }}
    />
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Add notice"
      description="Record a notice served on a client. Start from the PDF to have the dates and reference read for you — nothing is saved until you add it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={missing || create.isPending || upload.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Adding…' : 'Add notice'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger-500/30 bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-sm font-medium text-ink">
              Client<span className="ml-0.5 text-danger-600">*</span>
            </span>
            <EntityPicker
              value={entity}
              onChange={(e) => {
                setEntity(e);
                set('engagementId', '');
                set('registrationId', '');
              }}
              exclude={NO_EXCLUDE}
            />
          </div>
          <Field
            label="Engagement"
            required
            hint="The Compliance or Assignment engagement it is worked under."
          >
            <Select
              value={v.engagementId}
              disabled={!entity}
              onChange={(e) => set('engagementId', e.target.value)}
              aria-label="Engagement"
            >
              <option value="">{entity ? 'Choose…' : 'Pick the client first'}</option>
              {(engagements.data?.items ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.engagementCode} · {g.serviceName} · FY {g.financialYear}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* PS-104 — start from the PDF */}
        <div className="rounded-lg border border-dashed border-line-strong bg-surface-raised/50 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <FileUp className="h-4 w-4 text-ink-muted" aria-hidden />
            <span className="text-sm font-medium text-ink">Start from the PDF</span>
            <label
              className={`ml-auto inline-flex cursor-pointer items-center rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-raised ${
                !v.engagementId || upload.isPending ? 'pointer-events-none opacity-50' : ''
              }`}
            >
              {intake ? 'Choose another PDF' : 'Choose PDF'}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                aria-label="Notice PDF"
                disabled={!v.engagementId || upload.isPending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) {
                    setError(null);
                    upload.mutate(f);
                  }
                }}
              />
            </label>
          </div>
          {!v.engagementId && (
            <p className="mt-1 text-xs text-ink-faint">
              Pick the client and engagement first — the PDF is filed on it.
            </p>
          )}
          {upload.isPending && (
            <div className="mt-2">
              <Spinner label="Uploading the PDF…" />
            </div>
          )}
          {reading && (
            <div className="mt-2">
              <Spinner label="Reading the PDF…" />
            </div>
          )}
          {intake && read.data?.ocrStatus === 'failed' && (
            <p className="mt-2 text-xs text-warning-700">
              The PDF could not be read. It is attached — fill the form by hand.
            </p>
          )}
          {intake && read.isError && (
            <p className="mt-2 text-xs text-warning-700">
              Could not read the PDF just now. It is attached — fill the form by hand.
            </p>
          )}
          {prefill && (
            <div className="mt-2 space-y-1 text-xs text-ink-muted">
              <p>
                <span className="font-medium text-ink">{intake?.file.name}</span> is attached.{' '}
                {Object.keys(prefill.values).length > 0
                  ? `Filled ${Object.keys(prefill.values).length} field${Object.keys(prefill.values).length === 1 ? '' : 's'} — confirm each before adding.`
                  : 'Nothing could be read with confidence — fill the form by hand.'}
              </p>
              {(prefill.read.gstin || prefill.read.pan) && (
                <p>
                  The notice names {prefill.read.gstin ? `GSTIN ${prefill.read.gstin.value}` : ''}
                  {prefill.read.gstin && prefill.read.pan ? ' · ' : ''}
                  {prefill.read.pan ? `PAN ${prefill.read.pan.value}` : ''}
                  {(prefill.read.form || prefill.read.section) &&
                    ` · ${[prefill.read.form?.value, prefill.read.section?.value].filter(Boolean).join(' · ')}`}
                </p>
              )}
              {match && (
                <p className="flex items-center gap-1 text-success-700">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Matches {match.entityName} on
                  its {match.matchedOn === 'gstin' ? 'GSTIN' : 'PAN'}.
                </p>
              )}
              {!match && matches.length > 0 && (
                <div className="rounded-md border border-warning-500/30 bg-warning-50 px-2 py-1.5 text-warning-700">
                  <p className="font-medium">The PDF looks like it is for another client:</p>
                  <ul className="mt-1 space-y-1">
                    {matches.map((m) => (
                      <li key={m.entityId} className="flex flex-wrap items-center gap-1">
                        <span>
                          {m.entityName} ({m.matchedOn === 'gstin' ? 'GSTIN' : 'PAN'})
                        </span>
                        {m.engagements.map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            className="rounded border border-warning-500/40 bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink hover:bg-surface-raised"
                            onClick={() => {
                              setEntity({ id: m.entityId, label: m.entityName });
                              setV((cur) => ({
                                ...cur,
                                engagementId: g.id,
                                registrationId: m.registrationId ?? '',
                              }));
                            }}
                          >
                            Use {g.code} · {g.name}
                          </button>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!match && matches.length === 0 && (prefill.read.gstin || prefill.read.pan) && (
                <p className="text-warning-700">
                  No client on file has that GSTIN or PAN — check the client.
                </p>
              )}
            </div>
          )}
        </div>

        <Field label="Notice type" required>
          {types.isLoading ? (
            <Spinner />
          ) : (
            <NoticeTypeSelect
              value={v.noticeTypeCode}
              onChange={(code) => set('noticeTypeCode', code)}
              types={types.data ?? []}
            />
          )}
          {note('noticeTypeCode')}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reference (DIN or notice no.)" required>
            <Input value={v.referenceNo} onChange={(e) => set('referenceNo', e.target.value)} />
            {note('referenceNo')}
          </Field>
          <Field label="Served via">
            <Select
              value={v.servedVia}
              onChange={(e) => set('servedVia', e.target.value as NoticeServedVia)}
            >
              {NOTICE_SERVED_VIAS.map((s) => (
                <option key={s} value={s}>
                  {NOTICE_SERVED_VIA_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Issued on" required>
            <Input
              type="date"
              value={v.issuedOn}
              onChange={(e) => set('issuedOn', e.target.value)}
            />
            {note('issuedOn')}
          </Field>
          <Field label="Received on" required>
            <Input
              type="date"
              value={v.receivedOn}
              onChange={(e) => set('receivedOn', e.target.value)}
            />
          </Field>
          <Field
            label="Reply due"
            hint={
              type?.defaultReplyDays != null && !replyTouched
                ? `Issued on + ${type.defaultReplyDays} days (the type's default).`
                : undefined
            }
          >
            <Input
              type="date"
              value={v.replyDueOn}
              onChange={(e) => {
                setReplyTouched(true);
                set('replyDueOn', e.target.value);
              }}
            />
            {note('replyDueOn')}
          </Field>
          <Field label="Amount demanded (₹)">
            <Input
              inputMode="decimal"
              value={v.amountDemanded}
              onChange={(e) => set('amountDemanded', e.target.value)}
              placeholder="e.g. 125000"
            />
            {note('amountDemanded')}
          </Field>
          <Field label="Financial year">
            <Input
              value={v.financialYear}
              onChange={(e) => set('financialYear', e.target.value)}
              placeholder="2024-25"
            />
            {note('financialYear')}
          </Field>
          <Field label="Assessment year">
            <Input
              value={v.assessmentYear}
              onChange={(e) => set('assessmentYear', e.target.value)}
              placeholder="2025-26"
            />
            {note('assessmentYear')}
          </Field>
          <Field label="Period from">
            <Input
              type="date"
              value={v.periodFrom}
              onChange={(e) => set('periodFrom', e.target.value)}
            />
            {note('periodFrom')}
          </Field>
          <Field label="Period to">
            <Input
              type="date"
              value={v.periodTo}
              onChange={(e) => set('periodTo', e.target.value)}
            />
            {note('periodTo')}
          </Field>
          <Field label="Owner">
            <Select
              value={v.ownerId}
              onChange={(e) => set('ownerId', e.target.value)}
              aria-label="Owner"
            >
              <option value="">Me</option>
              {(employees.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName} · {p.gradeName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reviewer">
            <Select
              value={v.reviewerId}
              onChange={(e) => set('reviewerId', e.target.value)}
              aria-label="Reviewer"
            >
              <option value="">None</option>
              {(employees.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName} · {p.gradeName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Summary">
          <Textarea
            value={v.summary}
            onChange={(e) => set('summary', e.target.value)}
            placeholder="What the department is asking for, in a line or two."
          />
        </Field>
      </div>
    </Modal>
  );
}
