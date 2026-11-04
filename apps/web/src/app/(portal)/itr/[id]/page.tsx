'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Trash2, Upload } from 'lucide-react';
import {
  FEATURE_FLAG,
  ITR_FORMS,
  ITR_FORM_LABEL,
  ITR_INCOME_HEADS,
  ITR_INCOME_HEAD_LABEL,
  ITR_INCOME_SOURCES,
  ITR_INCOME_SOURCE_LABEL,
  ITR_INTIMATION_KINDS,
  ITR_INTIMATION_KIND_LABEL,
  ITR_INTIMATION_RESULTS,
  ITR_INTIMATION_RESULT_LABEL,
  ITR_MATCH_STATUS_LABEL,
  ITR_REFUND_STATUS_LABEL,
  ITR_REGIMES,
  ITR_REGIME_LABEL,
  ITR_RETURN_TYPES,
  ITR_RETURN_TYPE_LABEL,
  ITR_STAGE_LABEL,
  ITR_VERIFY_MODES,
  ITR_VERIFY_MODE_LABEL,
  type ItrForm,
  type ItrIncomeHead,
  type ItrIncomeSource,
  type ItrIntimationKind,
  type ItrIntimationResult,
  type ItrMatchStatus,
  type ItrRefundStatus,
  type ItrRegime,
  type ItrReturn,
  type ItrReturnType,
  type ItrVerifyMode,
} from '@hsdg/contracts';
import { ApiError } from '@/lib/api';
import { useFeatureFlags } from '@/lib/feature-flags';
import { useToast } from '@/lib/toast';
import { formatDate, formatMoney } from '@/lib/format';
import { istToday } from '@/lib/people';
import { cn } from '@/lib/cn';
import {
  ITR_REFUND_TONE,
  ITR_STAGE_TONE,
  classifyItrLine,
  deleteItrLine,
  eVerifyItr,
  fetchItrIncome,
  fetchItrReturn,
  importItrStatement,
  intimationOpensNotice,
  itrIncomeKey,
  itrKey,
  itrReturnKey,
  moveItrRefund,
  normaliseAmount,
  recordItrIntimation,
  refundMoveNeedsAmount,
  refundMoves,
  remindItrVerify,
  updateItrReturn,
} from '@/lib/itr-api';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { ReminderToSendPanel, type ReminderToSend } from '@/components/filing/client-chase';

const MATCH_TONE: Record<ItrMatchStatus, string> = {
  matched: 'success',
  mismatch: 'danger',
  not_in_client: 'warn',
  only_client: 'info',
};

const errorText = (err: unknown, fallback: string): string =>
  err instanceof ApiError ? err.message : fallback;

/** The file's bytes, base64, for POST /itr/returns/:id/statements. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {children}
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

/**
 * Practice Services PS-403 — one return: the form and regime, the
 * e-verification after filing, the refund, the 143(1) intimation, and the
 * 26AS / AIS / TIS / client figures matched by payer.
 */
export default function ItrReturnPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const flags = useFeatureFlags();
  const on = flags.isOn(FEATURE_FLAG.itrDesk);
  const q = useQuery({
    queryKey: itrReturnKey(id),
    queryFn: () => fetchItrReturn(id),
    enabled: on,
  });

  if (!flags.isLoading && !on) {
    return (
      <div className="space-y-4">
        <PageHeader title="ITR desk" />
        <EmptyState>The ITR desk isn&rsquo;t switched on for your office yet.</EmptyState>
      </div>
    );
  }
  if (q.isLoading || flags.isLoading) return <Spinner label="Loading the return…" />;
  if (q.isError || !q.data) {
    return (
      <EmptyState>
        {q.error instanceof ApiError && q.error.status === 404
          ? 'This return does not exist, or you cannot see its engagement.'
          : 'Could not load the return.'}
      </EmptyState>
    );
  }
  return <ReturnScreen r={q.data} />;
}

function ReturnScreen({ r }: { r: ItrReturn }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const saved = (next: ItrReturn): void => {
    qc.setQueryData(itrReturnKey(r.id), next);
    void qc.invalidateQueries({ queryKey: [...itrKey, 'season'] });
  };
  const onError = (fallback: string) => (err: unknown) => toast(errorText(err, fallback), 'error');
  const edit = r.can.edit;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${r.entityName} · ${r.yearLabel}`}
        subtitle={[r.pan, r.engagementCode, `FY ${r.financialYear}`].filter(Boolean).join(' · ')}
        back={{ href: '/itr', label: 'ITR desk' }}
        actions={<Badge tone={ITR_STAGE_TONE[r.stage]}>{ITR_STAGE_LABEL[r.stage]}</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailsCard r={r} edit={edit} onSaved={saved} onError={onError('Could not save.')} />
        <FilingCard r={r} edit={edit} onSaved={saved} onError={onError('Could not record it.')} />
        <RefundCard
          r={r}
          edit={edit}
          onSaved={saved}
          onError={onError('Could not move the refund.')}
        />
        <IntimationCard
          r={r}
          edit={edit}
          onSaved={saved}
          onError={onError('Could not record it.')}
        />
      </div>

      <IncomeCard r={r} edit={edit} />

      <p className="text-xs text-ink-muted">
        Filed on, acknowledgement and the filing itself live on the{' '}
        <Link href={`/engagements/${r.engagementId}`} className="text-primary-700 hover:underline">
          engagement
        </Link>
        &rsquo;s filing; lodge them there and this page follows.
      </p>
    </div>
  );
}

interface CardProps {
  r: ItrReturn;
  edit: boolean;
  onSaved: (r: ItrReturn) => void;
  onError: (err: unknown) => void;
}

function DetailsCard({ r, edit, onSaved, onError }: CardProps): JSX.Element {
  const toast = useToast();
  const [form, setForm] = useState({
    itrForm: r.itrForm ?? '',
    regime: r.regime ?? '',
    returnType: r.returnType,
    refundClaimed: r.refundClaimed ?? '',
    notes: r.notes ?? '',
  });
  const claimed = form.refundClaimed.trim() ? normaliseAmount(form.refundClaimed) : null;
  const badClaim = !!form.refundClaimed.trim() && claimed === null;
  const save = useMutation({
    mutationFn: () =>
      updateItrReturn(r, {
        itrForm: (form.itrForm || null) as ItrForm | null,
        regime: (form.regime || null) as ItrRegime | null,
        returnType: form.returnType,
        refundClaimed: claimed,
        notes: form.notes.trim() || null,
      }),
    onSuccess: (next) => {
      onSaved(next);
      toast('Return saved.', 'success');
    },
    onError,
  });
  const set = (patch: Partial<typeof form>): void => setForm((f) => ({ ...f, ...patch }));

  return (
    <Section title="The return">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Form">
          <Select
            disabled={!edit}
            value={form.itrForm}
            onChange={(e) => set({ itrForm: e.target.value })}
          >
            <option value="">Not chosen</option>
            {ITR_FORMS.map((f) => (
              <option key={f} value={f}>
                {ITR_FORM_LABEL[f]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Regime">
          <Select
            disabled={!edit}
            value={form.regime}
            onChange={(e) => set({ regime: e.target.value })}
          >
            <option value="">Not chosen</option>
            {ITR_REGIMES.map((g) => (
              <option key={g} value={g}>
                {ITR_REGIME_LABEL[g]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Return type">
          <Select
            disabled={!edit}
            value={form.returnType}
            onChange={(e) => set({ returnType: e.target.value as ItrReturnType })}
          >
            {ITR_RETURN_TYPES.map((t) => (
              <option key={t} value={t}>
                {ITR_RETURN_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Refund claimed (₹)"
          hint={badClaim ? 'An amount in rupees, e.g. 15,000 or 15000.50.' : undefined}
        >
          <Input
            disabled={!edit}
            inputMode="decimal"
            value={form.refundClaimed}
            onChange={(e) => set({ refundClaimed: e.target.value })}
            placeholder="0.00"
          />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea
          disabled={!edit}
          rows={2}
          value={form.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </Field>
      {edit && (
        <div className="flex justify-end">
          <Button size="sm" disabled={badClaim || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </Section>
  );
}

function FilingCard({ r, edit, onSaved, onError }: CardProps): JSX.Element {
  const toast = useToast();
  const [on, setOn] = useState(istToday());
  const [mode, setMode] = useState<ItrVerifyMode>('aadhaar_otp');
  // WhatsApp / copy: kept on screen to open or copy — a window opened after
  // the request returns is blocked as a pop-up.
  const [toSend, setToSend] = useState<ReminderToSend | null>(null);
  const verify = useMutation({
    mutationFn: () => eVerifyItr(r, { eVerifiedOn: on, mode }),
    onSuccess: (next) => {
      onSaved(next);
      toast(
        next.verifiedLate
          ? 'E-verified — after the window, so the return may count as belated.'
          : 'E-verified.',
        next.verifiedLate ? 'error' : 'success',
      );
    },
    onError,
  });
  const remind = useMutation({
    mutationFn: () => remindItrVerify(r.id),
    onSuccess: (m) => {
      if (m.channel === 'email') {
        setToSend(null);
        toast(`Reminder e-mailed${m.to ? ` to ${m.to}` : ''}.`, 'success');
        return;
      }
      const base = {
        instanceId: r.complianceInstanceId,
        client: r.entityName,
        text: m.text,
        waitingOn: [],
        raised: 0,
      };
      setToSend(
        m.channel === 'whatsapp' && m.waUrl
          ? { ...base, channel: 'whatsapp', waUrl: m.waUrl }
          : { ...base, channel: 'copy', fallback: m.fallback ?? null },
      );
    },
    onError,
  });

  return (
    <Section title="Filing and e-verification">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Fact label="Due">{formatDate(r.statutoryDate)}</Fact>
        <Fact label="Filed on">{r.filedOn ? formatDate(r.filedOn) : 'Not filed yet'}</Fact>
        <Fact label="Acknowledgement">{r.ackNo ?? '—'}</Fact>
        <Fact label="E-verify by">
          <span className={cn(r.eVerifyOverdue && 'font-medium text-danger-700')}>
            {r.eVerifyDueOn ? formatDate(r.eVerifyDueOn) : '—'}
            {r.eVerifyOverdue ? ' · overdue' : ''}
          </span>
        </Fact>
        <Fact label="E-verified">
          {r.eVerifiedOn
            ? `${formatDate(r.eVerifiedOn)} · ${r.eVerifyMode ? ITR_VERIFY_MODE_LABEL[r.eVerifyMode] : ''}${r.verifiedLate ? ' · late' : ''}`
            : 'Not yet'}
        </Fact>
      </dl>
      {edit && r.filedOn && !r.eVerifiedOn && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Verified on">
            <Input
              type="date"
              value={on}
              min={r.filedOn ?? undefined}
              max={istToday()}
              onChange={(e) => setOn(e.target.value)}
            />
          </Field>
          <Field label="How">
            <Select value={mode} onChange={(e) => setMode(e.target.value as ItrVerifyMode)}>
              {ITR_VERIFY_MODES.map((m) => (
                <option key={m} value={m}>
                  {ITR_VERIFY_MODE_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Button size="sm" disabled={!on || verify.isPending} onClick={() => verify.mutate()}>
            Record e-verification
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={remind.isPending}
            onClick={() => remind.mutate()}
          >
            <BellRing className="h-4 w-4" /> Remind the client
          </Button>
        </div>
      )}
      {toSend && !r.eVerifiedOn && <ReminderToSendPanel reminder={toSend} />}
    </Section>
  );
}

function RefundCard({ r, edit, onSaved, onError }: CardProps): JSX.Element {
  const toast = useToast();
  const moves = refundMoves(r.refundStatus);
  const [to, setTo] = useState<ItrRefundStatus | ''>('');
  const [amount, setAmount] = useState(r.refundClaimed ?? '');
  const [on, setOn] = useState(istToday());
  const [note, setNote] = useState('');
  const needs = to !== '' && refundMoveNeedsAmount(to);
  const settled = needs ? normaliseAmount(amount) : null;
  const move = useMutation({
    mutationFn: () =>
      moveItrRefund(r, {
        to: to as ItrRefundStatus,
        amount: settled,
        on: needs ? on : null,
        note: note.trim() || null,
      }),
    onSuccess: (next) => {
      onSaved(next);
      setTo('');
      setNote('');
      toast(`Refund: ${ITR_REFUND_STATUS_LABEL[next.refundStatus]}.`, 'success');
    },
    onError,
  });

  return (
    <Section title="Refund">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Fact label="Claimed">{r.refundClaimed ? formatMoney(r.refundClaimed) : '—'}</Fact>
        <Fact label="Status">
          <Badge tone={ITR_REFUND_TONE[r.refundStatus]}>
            {ITR_REFUND_STATUS_LABEL[r.refundStatus]}
          </Badge>
        </Fact>
        <Fact label="Credited / set off">
          {r.refundAmount ? `${formatMoney(r.refundAmount)} · ${formatDate(r.refundOn)}` : '—'}
        </Fact>
      </dl>
      {r.refundNote && <p className="text-xs text-ink-muted">{r.refundNote}</p>}
      {edit && moves.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Move to">
            <Select value={to} onChange={(e) => setTo(e.target.value as ItrRefundStatus | '')}>
              <option value="">Choose…</option>
              {moves.map((m) => (
                <option key={m} value={m}>
                  {ITR_REFUND_STATUS_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          {needs && (
            <>
              <Field label="Amount (₹)">
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="On">
                <Input
                  type="date"
                  value={on}
                  min={r.filedOn ?? undefined}
                  max={istToday()}
                  onChange={(e) => setOn(e.target.value)}
                />
              </Field>
            </>
          )}
          <Field label="Note" className="min-w-40 flex-1">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button
            size="sm"
            disabled={!to || (needs && (!settled || !on)) || move.isPending}
            onClick={() => move.mutate()}
          >
            Move
          </Button>
        </div>
      )}
    </Section>
  );
}

function IntimationCard({ r, edit, onSaved, onError }: CardProps): JSX.Element {
  const toast = useToast();
  const [f, setF] = useState({
    kind: '143_1' as ItrIntimationKind,
    referenceNo: '',
    issuedOn: '',
    receivedOn: istToday(),
    result: 'no_change' as ItrIntimationResult,
    amount: '',
    // null: the default for the kind and result (a demand or a 245 opens one).
    openNotice: null as boolean | null,
  });
  const set = (patch: Partial<typeof f>): void => setF((x) => ({ ...x, ...patch }));
  const hasAmount = f.kind === '245' || f.result !== 'no_change';
  const amount = hasAmount ? normaliseAmount(f.amount) : null;
  const openNotice = f.openNotice ?? intimationOpensNotice(f.kind, f.result);
  const today = istToday();
  const record = useMutation({
    mutationFn: () =>
      recordItrIntimation(r, {
        kind: f.kind,
        referenceNo: f.referenceNo.trim(),
        issuedOn: f.issuedOn,
        receivedOn: f.receivedOn,
        ...(f.kind === '143_1' ? { result: f.result } : {}),
        amount,
        openNotice,
      }),
    onSuccess: (res) => {
      onSaved(res.return);
      set({ referenceNo: '', amount: '', openNotice: null });
      toast(
        res.noticeId ? 'Recorded, and opened on the notice register.' : 'Intimation recorded.',
        'success',
      );
    },
    onError,
  });

  return (
    <Section title="Intimation and notices">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Fact label="143(1) received">{r.intimationOn ? formatDate(r.intimationOn) : '—'}</Fact>
        <Fact label="Result">
          {r.intimationResult ? ITR_INTIMATION_RESULT_LABEL[r.intimationResult] : '—'}
        </Fact>
        <Fact label="Amount">{r.intimationAmount ? formatMoney(r.intimationAmount) : '—'}</Fact>
      </dl>
      {r.notices.length > 0 && (
        <ul className="space-y-1 text-sm">
          {r.notices.map((n) => (
            <li key={n.id}>
              <Link href={`/notices/${n.id}`} className="text-primary-700 hover:underline">
                {n.referenceNo}
              </Link>{' '}
              <span className="text-ink-muted">
                · {n.typeCode} · {n.status}
              </span>
            </li>
          ))}
        </ul>
      )}
      {edit && r.filedOn && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Kind">
            <Select
              value={f.kind}
              onChange={(e) => set({ kind: e.target.value as ItrIntimationKind })}
            >
              {ITR_INTIMATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ITR_INTIMATION_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference no.">
            <Input value={f.referenceNo} onChange={(e) => set({ referenceNo: e.target.value })} />
          </Field>
          {f.kind === '143_1' && (
            <Field label="Result">
              <Select
                value={f.result}
                onChange={(e) => set({ result: e.target.value as ItrIntimationResult })}
              >
                {ITR_INTIMATION_RESULTS.map((x) => (
                  <option key={x} value={x}>
                    {ITR_INTIMATION_RESULT_LABEL[x]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Issued on">
            <Input
              type="date"
              value={f.issuedOn}
              min={r.filedOn ?? undefined}
              max={today}
              onChange={(e) => set({ issuedOn: e.target.value })}
            />
          </Field>
          <Field label="Received on">
            <Input
              type="date"
              value={f.receivedOn}
              min={f.issuedOn || undefined}
              max={today}
              onChange={(e) => set({ receivedOn: e.target.value })}
            />
          </Field>
          {hasAmount && (
            <Field
              label={f.kind === '245' ? 'Proposed set-off (₹)' : 'Amount determined (₹)'}
              required
            >
              <Input
                inputMode="decimal"
                value={f.amount}
                onChange={(e) => set({ amount: e.target.value })}
              />
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={openNotice}
              onChange={(e) => set({ openNotice: e.target.checked })}
            />
            Open it on the notice register (on for a demand or a set-off, which need a reply)
          </label>
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={
                !f.referenceNo.trim() ||
                !f.issuedOn ||
                !f.receivedOn ||
                f.receivedOn < f.issuedOn ||
                (hasAmount && !amount) ||
                record.isPending
              }
              onClick={() => record.mutate()}
            >
              Record
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

function IncomeCard({ r, edit }: { r: ItrReturn; edit: boolean }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const income = useQuery({ queryKey: itrIncomeKey(r.id), queryFn: () => fetchItrIncome(r.id) });
  const [source, setSource] = useState<ItrIncomeSource>('26as');
  const [file, setFile] = useState<File | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: itrIncomeKey(r.id) });
    void qc.invalidateQueries({ queryKey: itrReturnKey(r.id) });
  };
  const upload = useMutation({
    mutationFn: async () =>
      importItrStatement(r.id, {
        source,
        filename: file!.name,
        contentBase64: await readBase64(file!),
        replace: true,
      }),
    onSuccess: (res) => {
      setWarnings(res.warnings);
      setFile(null);
      toast(
        `${res.format}: ${res.imported} line${res.imported === 1 ? '' : 's'} imported${res.skipped ? `, ${res.skipped} skipped` : ''}.`,
        'success',
      );
      refresh();
    },
    onError: (err) => toast(errorText(err, 'Could not import the statement.'), 'error'),
  });
  const classify = useMutation({
    mutationFn: (v: { lineId: string; head: ItrIncomeHead }) =>
      classifyItrLine(r.id, v.lineId, v.head),
    onSuccess: (data) => qc.setQueryData(itrIncomeKey(r.id), data),
    onError: (err) => toast(errorText(err, 'Could not change the head.'), 'error'),
  });
  const remove = useMutation({
    mutationFn: (lineId: string) => deleteItrLine(r.id, lineId),
    onSuccess: (data) => qc.setQueryData(itrIncomeKey(r.id), data),
    onError: (err) => toast(errorText(err, 'Could not remove the line.'), 'error'),
  });

  const data = income.data;
  const present = ITR_INCOME_SOURCES.filter(
    (s) => (r.lineCounts[s] ?? 0) > 0 || data?.lines.some((l) => l.source === s),
  );

  return (
    <Section title="Income: 26AS, AIS, TIS and the client's figures">
      {edit && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Source">
            <Select value={source} onChange={(e) => setSource(e.target.value as ItrIncomeSource)}>
              {ITR_INCOME_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {ITR_INCOME_SOURCE_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="File (26AS text export, or a CSV / Excel sheet)">
            <Input
              type="file"
              accept=".txt,.csv,.xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Button size="sm" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
            <Upload className="h-4 w-4" /> {upload.isPending ? 'Importing…' : 'Import'}
          </Button>
          <p className="basis-full text-xs text-ink-muted">
            Importing replaces that source&rsquo;s lines. Password-protected PDFs and the encrypted
            AIS JSON are refused — download the text or Excel version.
          </p>
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="list-disc rounded-md bg-warning-50 py-2 pl-8 pr-3 text-xs text-warning-700">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {income.isLoading && <Spinner label="Loading the income…" />}
      {data && data.lines.length === 0 && (
        <EmptyState>
          No income lines yet. Import the 26AS or AIS, and the client&rsquo;s figures.
        </EmptyState>
      )}

      {data && data.matching.rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {(Object.keys(data.matching.counts) as ItrMatchStatus[]).map((s) => (
              <Badge key={s} tone={MATCH_TONE[s]}>
                {ITR_MATCH_STATUS_LABEL[s]} · {data.matching.counts[s]}
              </Badge>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line text-sm" aria-label="Matching">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-2 py-1">Payer</th>
                  <th className="px-2 py-1">Head</th>
                  {present.map((s) => (
                    <th key={s} className="px-2 py-1 text-right">
                      {ITR_INCOME_SOURCE_LABEL[s]}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-right">Gap</th>
                  <th className="px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.matching.rows.map((m) => (
                  <tr key={m.key}>
                    <td className="px-2 py-1">
                      <div>{m.payerName ?? '—'}</div>
                      {m.payerTan && <div className="text-xs text-ink-muted">{m.payerTan}</div>}
                    </td>
                    <td className="px-2 py-1">{ITR_INCOME_HEAD_LABEL[m.head]}</td>
                    {present.map((s) => (
                      <td key={s} className="px-2 py-1 text-right tabular-nums">
                        {m.amounts[s] !== undefined ? formatMoney(m.amounts[s]) : '—'}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatMoney(m.difference)}
                    </td>
                    <td className="px-2 py-1">
                      <Badge tone={MATCH_TONE[m.status]}>{ITR_MATCH_STATUS_LABEL[m.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data && data.lines.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-primary-700">
            Every line ({data.lines.length}) — fix a head or remove a line
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full divide-y divide-line text-sm">
              <tbody className="divide-y divide-line">
                {data.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-2 py-1 text-xs text-ink-muted">
                      {ITR_INCOME_SOURCE_LABEL[l.source]}
                    </td>
                    <td className="px-2 py-1">
                      {l.payerName ?? l.description ?? '—'}
                      {l.section && <span className="text-xs text-ink-muted"> · {l.section}</span>}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatMoney(l.amount)}</td>
                    <td className="px-2 py-1">
                      <Select
                        aria-label="Head"
                        disabled={!edit}
                        value={l.head}
                        onChange={(e) =>
                          classify.mutate({ lineId: l.id, head: e.target.value as ItrIncomeHead })
                        }
                      >
                        {ITR_INCOME_HEADS.map((h) => (
                          <option key={h} value={h}>
                            {ITR_INCOME_HEAD_LABEL[h]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1 text-right">
                      {edit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Remove the line"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(l.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Section>
  );
}
