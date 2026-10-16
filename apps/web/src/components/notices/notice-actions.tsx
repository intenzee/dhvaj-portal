'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  NOTICE_EVENT_KIND_LABEL,
  NOTICE_OUTCOMES,
  NOTICE_OUTCOME_LABEL,
  NOTICE_SERVED_VIAS,
  NOTICE_SERVED_VIA_LABEL,
  NOTICE_STATUS_LABEL,
  isNoticeOpen,
  type AppealNoticeResponse,
  type Notice,
  type NoticeEvent,
  type NoticeEventKind,
  type NoticeOutcome,
  type NoticeServedVia,
  type UpdateNoticeRequest,
} from '@hsdg/contracts';
import { ApiError } from '@/lib/api';
import {
  addNoticeEvent,
  appealNotice,
  closeNotice,
  noticeKey,
  noticesKey,
  updateNotice,
  uploadNoticeDocument,
  voidNoticeEvent,
  type NoticeDocumentType,
} from '@/lib/notices-api';
import { isStaleNotice, STALE_NOTICE_MESSAGE } from '@/lib/notices';
import { useToast } from '@/lib/toast';
import { todayIst } from '@/components/work/my-task-columns';
import { Modal } from '@/components/modal';
import { Field, Input, Select, Textarea } from '@/components/form';
import { Button } from '@/components/ui';
import { employeesQuery } from './new-notice-modal';

/** Store the notice a write returned and refresh the lists it sits on. */
export function useNoticeSaved(id: string): (n: Notice) => void {
  const qc = useQueryClient();
  return (n) => {
    qc.setQueryData(noticeKey(id), n);
    void qc.invalidateQueries({ queryKey: noticesKey });
  };
}

/** An error from a write, with "reload" when the copy on screen is stale (409). */
function WriteError({
  error,
  noticeId,
  onReload,
}: {
  error: unknown;
  noticeId: string;
  onReload: () => void;
}): JSX.Element | null {
  const qc = useQueryClient();
  if (!error) return null;
  const status = error instanceof ApiError ? error.status : undefined;
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  const stale = isStaleNotice(status, message);
  return (
    <div
      role="alert"
      className="mb-3 rounded-md border border-danger-500/30 bg-danger-50 px-3 py-2 text-sm text-danger-700"
    >
      {stale ? STALE_NOTICE_MESSAGE : message}
      {stale && (
        <button
          type="button"
          className="ml-2 font-semibold underline"
          onClick={() => {
            void qc.invalidateQueries({ queryKey: noticeKey(noticeId) });
            onReload();
          }}
        >
          Reload
        </button>
      )}
    </div>
  );
}

function FooterButtons({
  onClose,
  onSave,
  disabled,
  pending,
  label,
}: {
  onClose: () => void;
  onSave: () => void;
  disabled: boolean;
  pending: boolean;
  label: string;
}): JSX.Element {
  return (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button disabled={disabled || pending} onClick={onSave}>
        {pending ? 'Saving…' : label}
      </Button>
    </>
  );
}

function FileField({
  label,
  onChange,
}: {
  label: string;
  onChange: (f: File | null) => void;
}): JSX.Element {
  return (
    <Field label={label} hint="Optional — filed under the notice.">
      <input
        type="file"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="w-full text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-700"
      />
    </Field>
  );
}

/** What each event action asks for. */
interface EventSpec {
  title: string;
  description?: string;
  occurred: string;
  /** The next date: required, optional, or not asked. */
  next?: { label: string; required: boolean };
  ack?: boolean;
  body: { label: string; required: boolean };
  file?: { label: string; type: NoticeDocumentType };
}

export const EVENT_SPEC: Partial<Record<NoticeEventKind, EventSpec>> = {
  reply_filed: {
    title: 'Record reply',
    description: 'The reply filed with the department. Recording it clears the reply reminder.',
    occurred: 'Filed on',
    ack: true,
    body: { label: 'Notes', required: false },
    file: { label: 'Reply (PDF)', type: 'reply' },
  },
  hearing: {
    title: 'Add hearing',
    description: 'A personal hearing or video conference the officer has fixed.',
    occurred: 'Fixed on',
    next: { label: 'Hearing date', required: true },
    body: { label: 'Where / notes', required: false },
  },
  adjournment_sought: {
    title: 'Adjournment sought',
    occurred: 'Asked on',
    next: { label: 'Date asked for', required: false },
    body: { label: 'Reason', required: false },
  },
  adjournment_granted: {
    title: 'Adjournment granted',
    occurred: 'Granted on',
    next: { label: 'Next hearing', required: true },
    body: { label: 'Notes', required: false },
  },
  submission: {
    title: 'Submission',
    description: 'Further documents or written submissions given to the officer.',
    occurred: 'Submitted on',
    ack: true,
    body: { label: 'What was submitted', required: false },
    file: { label: 'Submission (PDF)', type: 'reply' },
  },
  order: {
    title: 'Record order',
    description:
      'The order passed. For an appealable notice it starts the appeal clock from the date it was communicated.',
    occurred: 'Order communicated on',
    body: { label: 'What the order says', required: false },
    file: { label: 'Order (PDF)', type: 'order' },
  },
  note: {
    title: 'Note',
    occurred: 'Date',
    body: { label: 'Note', required: true },
  },
};

export function EventModal({
  notice,
  kind,
  onClose,
}: {
  notice: Notice;
  kind: NoticeEventKind;
  onClose: () => void;
}): JSX.Element {
  const spec = EVENT_SPEC[kind] ?? {
    title: NOTICE_EVENT_KIND_LABEL[kind],
    occurred: 'Date',
    body: { label: 'Notes', required: false },
  };
  const saved = useNoticeSaved(notice.id);
  const toast = useToast();
  const [occurredOn, setOccurredOn] = useState(todayIst());
  const [nextDate, setNextDate] = useState('');
  const [ack, setAck] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const doc =
        file && spec.file
          ? await uploadNoticeDocument({
              engagementId: notice.engagementId,
              file,
              documentType: spec.file.type,
              noticeId: notice.id,
            })
          : null;
      return addNoticeEvent(notice.id, {
        version: notice.version,
        kind,
        occurredOn,
        ...(spec.next && nextDate ? { nextDate } : {}),
        ...(spec.ack && ack.trim() ? { ackReference: ack.trim() } : {}),
        ...(doc ? { documentId: doc.id } : {}),
        ...(body.trim() ? { body: body.trim() } : {}),
      });
    },
    onSuccess: (n) => {
      saved(n);
      toast(`${NOTICE_EVENT_KIND_LABEL[kind]} recorded.`);
      onClose();
    },
  });

  const missing =
    !occurredOn || (spec.next?.required && !nextDate) || (spec.body.required && !body.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title={spec.title}
      description={spec.description}
      footer={
        <FooterButtons
          onClose={onClose}
          onSave={() => save.mutate()}
          disabled={!!missing}
          pending={save.isPending}
          label="Save"
        />
      }
    >
      <WriteError error={save.error} noticeId={notice.id} onReload={onClose} />
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={spec.occurred} required>
            <Input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
          </Field>
          {spec.next && (
            <Field label={spec.next.label} required={spec.next.required}>
              <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
            </Field>
          )}
        </div>
        {spec.ack && (
          <Field label="Acknowledgement / ARN">
            <Input value={ack} onChange={(e) => setAck(e.target.value)} />
          </Field>
        )}
        <Field label={spec.body.label} required={spec.body.required}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {spec.file && <FileField label={spec.file.label} onChange={setFile} />}
      </div>
    </Modal>
  );
}

/** Close the notice with its outcome — also the partner's "Accept" after an order. */
export function CloseModal({
  notice,
  accept,
  onClose,
}: {
  notice: Notice;
  /** "Accept the order" wording. */
  accept?: boolean;
  onClose: () => void;
}): JSX.Element {
  const saved = useNoticeSaved(notice.id);
  const toast = useToast();
  const [outcome, setOutcome] = useState<NoticeOutcome | ''>(accept ? 'demand_confirmed' : '');
  const [amount, setAmount] = useState(notice.amountDemanded ?? '');
  const [closedOn, setClosedOn] = useState(todayIst());
  const save = useMutation({
    mutationFn: () =>
      closeNotice(notice.id, {
        version: notice.version,
        outcome: outcome as NoticeOutcome,
        outcomeAmount: amount.replace(/[,\s₹]/g, '') || null,
        closedOn,
      }),
    onSuccess: (n) => {
      saved(n);
      toast('Notice closed.');
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={accept ? 'Accept the order' : 'Close notice'}
      description={
        accept
          ? 'The client will not appeal. The notice closes with this outcome.'
          : 'Record how the notice ended. It leaves the open lists and Today.'
      }
      footer={
        <FooterButtons
          onClose={onClose}
          onSave={() => save.mutate()}
          disabled={!outcome || !closedOn}
          pending={save.isPending}
          label={accept ? 'Accept and close' : 'Close notice'}
        />
      }
    >
      <WriteError error={save.error} noticeId={notice.id} onReload={onClose} />
      <div className="space-y-3">
        <Field label="Outcome" required>
          <Select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as NoticeOutcome)}
            aria-label="Outcome"
          >
            <option value="">Choose…</option>
            {NOTICE_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {NOTICE_OUTCOME_LABEL[o]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Final amount (₹)" hint="The demand that stands; 0 if dropped.">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Closed on" required>
            <Input type="date" value={closedOn} onChange={(e) => setClosedOn(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/** PS-103 — the partner chooses to appeal: an Assignment engagement opens for it. */
export function AppealModal({
  notice,
  onClose,
  onAppealed,
}: {
  notice: Notice;
  onClose: () => void;
  onAppealed: (r: AppealNoticeResponse) => void;
}): JSX.Element {
  const saved = useNoticeSaved(notice.id);
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () =>
      appealNotice(notice.id, { version: notice.version, note: note.trim() || null }),
    onSuccess: (r) => {
      saved(r.notice);
      onAppealed(r);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Appeal the order"
      description="Opens an appeal engagement for the client, due by the appeal limitation date, and marks the notice appealed."
      footer={
        <FooterButtons
          onClose={onClose}
          onSave={() => save.mutate()}
          disabled={false}
          pending={save.isPending}
          label="Open the appeal"
        />
      }
    >
      <WriteError error={save.error} noticeId={notice.id} onReload={onClose} />
      <Field label="Note for the appeal team">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

export function VoidEventModal({
  notice,
  event,
  onClose,
}: {
  notice: Notice;
  event: NoticeEvent;
  onClose: () => void;
}): JSX.Element {
  const saved = useNoticeSaved(notice.id);
  const toast = useToast();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () =>
      voidNoticeEvent(notice.id, event.id, { version: notice.version, reason: reason.trim() }),
    onSuccess: (n) => {
      saved(n);
      toast('Entry voided.');
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Void "${NOTICE_EVENT_KIND_LABEL[event.kind]}"`}
      description={
        event.kind === 'order'
          ? 'Voiding the order also removes the appeal deadline it set. The entry stays on the timeline, struck through.'
          : 'The entry stays on the timeline, struck through, with your reason.'
      }
      footer={
        <FooterButtons
          onClose={onClose}
          onSave={() => save.mutate()}
          disabled={!reason.trim()}
          pending={save.isPending}
          label="Void"
        />
      }
    >
      <WriteError error={save.error} noticeId={notice.id} onReload={onClose} />
      <Field label="Reason" required>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this entry wrong? (audited)"
        />
      </Field>
    </Modal>
  );
}

/** The notice's own fields, edited with the version read (409 when someone else saved first). */
export function EditNoticeModal({
  notice,
  onClose,
}: {
  notice: Notice;
  onClose: () => void;
}): JSX.Element {
  const saved = useNoticeSaved(notice.id);
  const toast = useToast();
  const employees = useQuery(employeesQuery);
  const s = (x: string | null | undefined): string => x ?? '';
  const [v, setV] = useState({
    referenceNo: notice.referenceNo,
    issuedOn: notice.issuedOn,
    receivedOn: notice.receivedOn,
    servedVia: notice.servedVia,
    financialYear: s(notice.financialYear),
    assessmentYear: s(notice.assessmentYear),
    periodFrom: s(notice.periodFrom),
    periodTo: s(notice.periodTo),
    amountDemanded: s(notice.amountDemanded),
    replyDueOn: s(notice.replyDueOn),
    internalDueOverride: s(notice.internalDueOverride),
    ownerId: notice.ownerId,
    reviewerId: s(notice.reviewerId),
    summary: s(notice.summary),
    status: notice.status,
  });
  const set = (k: keyof typeof v, val: string): void => setV((cur) => ({ ...cur, [k]: val }));
  const early = notice.status === 'received' || notice.status === 'in_progress';
  const statusEditable = isNoticeOpen(notice.status) && notice.status !== 'appealed';

  const save = useMutation({
    mutationFn: () => {
      const req: UpdateNoticeRequest = { version: notice.version };
      const orNull = (x: string): string | null => (x.trim() ? x.trim() : null);
      if (v.referenceNo.trim() !== notice.referenceNo) req.referenceNo = v.referenceNo.trim();
      if (v.issuedOn !== notice.issuedOn) req.issuedOn = v.issuedOn;
      if (v.receivedOn !== notice.receivedOn) req.receivedOn = v.receivedOn;
      if (v.servedVia !== notice.servedVia) req.servedVia = v.servedVia;
      const nullable = [
        'financialYear',
        'assessmentYear',
        'periodFrom',
        'periodTo',
        'replyDueOn',
        'internalDueOverride',
        'reviewerId',
        'summary',
      ] as const;
      for (const k of nullable) {
        const next = orNull(v[k]);
        if (next !== (notice[k] ?? null)) req[k] = next;
      }
      const amount = orNull(v.amountDemanded.replace(/[,\s₹]/g, ''));
      if (amount !== (notice.amountDemanded ?? null)) req.amountDemanded = amount;
      if (v.ownerId !== notice.ownerId) req.ownerId = v.ownerId;
      if (v.status !== notice.status && ['received', 'in_progress', 'withdrawn'].includes(v.status))
        req.status = v.status as UpdateNoticeRequest['status'];
      return updateNotice(notice.id, req);
    },
    onSuccess: (n) => {
      saved(n);
      toast('Notice saved.');
      onClose();
    },
  });

  const people = employees.data?.items ?? [];
  const field = (label: string, k: keyof typeof v, type = 'text'): ReactNode => (
    <Field label={label}>
      <Input type={type} value={v[k]} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Edit notice"
      footer={
        <FooterButtons
          onClose={onClose}
          onSave={() => save.mutate()}
          disabled={!v.referenceNo.trim() || !v.issuedOn || !v.receivedOn}
          pending={save.isPending}
          label="Save"
        />
      }
    >
      <WriteError error={save.error} noticeId={notice.id} onReload={onClose} />
      <div className="grid gap-3 sm:grid-cols-2">
        {field('Reference', 'referenceNo')}
        <Field label="Served via">
          <Select
            value={v.servedVia}
            onChange={(e) => set('servedVia', e.target.value as NoticeServedVia)}
          >
            {NOTICE_SERVED_VIAS.map((x) => (
              <option key={x} value={x}>
                {NOTICE_SERVED_VIA_LABEL[x]}
              </option>
            ))}
          </Select>
        </Field>
        {field('Issued on', 'issuedOn', 'date')}
        {field('Received on', 'receivedOn', 'date')}
        {field('Reply due (department)', 'replyDueOn', 'date')}
        <Field
          label="Our internal date"
          hint="Blank: the reply date less the firm's buffer, on a working day."
        >
          <Input
            type="date"
            value={v.internalDueOverride}
            onChange={(e) => set('internalDueOverride', e.target.value)}
          />
        </Field>
        {field('Amount demanded (₹)', 'amountDemanded')}
        {field('Financial year', 'financialYear')}
        {field('Assessment year', 'assessmentYear')}
        <div />
        {field('Period from', 'periodFrom', 'date')}
        {field('Period to', 'periodTo', 'date')}
        <Field label="Owner">
          <Select
            value={v.ownerId}
            onChange={(e) => set('ownerId', e.target.value)}
            aria-label="Owner"
          >
            {!people.some((p) => p.id === notice.ownerId) && (
              <option value={notice.ownerId}>{notice.ownerName}</option>
            )}
            {people.map((p) => (
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
            {notice.reviewerId && !people.some((p) => p.id === notice.reviewerId) && (
              <option value={notice.reviewerId}>{notice.reviewerName}</option>
            )}
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} · {p.gradeName}
              </option>
            ))}
          </Select>
        </Field>
        {statusEditable && (
          <Field label="Status" hint="Later statuses follow the timeline and Close.">
            <Select
              value={v.status}
              onChange={(e) => set('status', e.target.value)}
              aria-label="Status"
            >
              {early ? (
                <>
                  <option value="received">{NOTICE_STATUS_LABEL.received}</option>
                  <option value="in_progress">{NOTICE_STATUS_LABEL.in_progress}</option>
                </>
              ) : (
                <option value={notice.status}>{NOTICE_STATUS_LABEL[notice.status]}</option>
              )}
              <option value="withdrawn">Withdrawn by the department</option>
            </Select>
          </Field>
        )}
        <Field label="Summary" className="sm:col-span-2">
          <Textarea value={v.summary} onChange={(e) => set('summary', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
