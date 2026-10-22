'use client';

import { useState } from 'react';
import {
  PROOF_HEADS,
  type DecideTaxProofInput,
  type ProofHead,
  type SubmitTaxProofInput,
  type TaxProof,
} from '@hsdg/contracts';
import { downloadFile } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { errorText } from '@/lib/payroll';
import {
  PROOF_HEAD_LABEL,
  PROOF_STATUS_TONE,
  amountOrNull,
  readFileBase64,
} from '@/lib/payroll-tax';
import { useToast } from '@/lib/toast';
import { Badge, Button, EmptyState } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';

/**
 * The proofs handed in for a declaration. With `onDecide` (HR) each waiting
 * proof can be accepted, in full or part, or rejected with a reason; HR never
 * decides their own (the API refuses it).
 */
export function ProofList({
  proofs,
  onDecide,
  deciding,
}: {
  proofs: TaxProof[];
  onDecide?: (id: string, input: DecideTaxProofInput) => void;
  deciding?: boolean;
}): JSX.Element {
  const toast = useToast();
  if (proofs.length === 0) return <EmptyState>No proofs handed in yet.</EmptyState>;
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-line text-left text-xs text-ink-muted">
        <tr>
          <th className="py-2 font-medium">Head</th>
          <th className="px-3 py-2 text-right font-medium">Claimed</th>
          <th className="px-3 py-2 text-right font-medium">Accepted</th>
          <th className="px-3 py-2 font-medium">Status</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {proofs.map((p) => (
          <tr key={p.id}>
            <td className="py-2">
              {PROOF_HEAD_LABEL[p.head]}
              <div className="text-xs text-ink-faint">
                {onDecide ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      void downloadFile(`/payroll/tax/proofs/${p.id}/file`, p.filename).catch((e) =>
                        toast(errorText(e), 'error'),
                      )
                    }
                  >
                    {p.filename}
                  </button>
                ) : (
                  p.filename
                )}{' '}
                · {formatDate(p.submittedAt)}
              </div>
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(p.amount)}</td>
            <td className="px-3 py-2 text-right tabular-nums">
              {p.acceptedAmount ? formatMoney(p.acceptedAmount) : '—'}
            </td>
            <td className="px-3 py-2">
              <Badge tone={PROOF_STATUS_TONE[p.status]}>
                {p.status === 'submitted' ? 'To check' : p.status}
              </Badge>
              {p.reason && <div className="text-xs text-ink-muted">{p.reason}</div>}
            </td>
            <td className="py-2 text-right">
              {onDecide && p.status === 'submitted' && (
                <Decide proof={p} onDecide={onDecide} busy={deciding} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Decide({
  proof,
  onDecide,
  busy,
}: {
  proof: TaxProof;
  onDecide: (id: string, input: DecideTaxProofInput) => void;
  busy?: boolean;
}): JSX.Element {
  const [amount, setAmount] = useState(proof.amount);
  const [reason, setReason] = useState('');
  const accepted = amountOrNull(amount);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Input
        aria-label="Amount to accept"
        className="w-28"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Button
        size="sm"
        disabled={
          busy ||
          accepted === null ||
          Number(accepted) <= 0 ||
          Number(accepted) > Number(proof.amount)
        }
        onClick={() => onDecide(proof.id, { decision: 'accept', acceptedAmount: accepted! })}
      >
        Accept
      </Button>
      <Input
        aria-label="Reason to reject"
        className="w-40"
        placeholder="Reason to reject"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || !reason.trim()}
        onClick={() => onDecide(proof.id, { decision: 'reject', reason: reason.trim() })}
      >
        Reject
      </Button>
    </div>
  );
}

/** Hand in a proof: the head, the amount it proves and the file (filed in the HR vault). */
export function ProofUpload({
  onSubmit,
  busy,
}: {
  onSubmit: (input: SubmitTaxProofInput) => Promise<unknown>;
  busy?: boolean;
}): JSX.Element {
  const toast = useToast();
  const [head, setHead] = useState<ProofHead>('section80C');
  const [amount, setAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [picker, setPicker] = useState(0);
  const value = amountOrNull(amount);

  const submit = async () => {
    if (!file || !value) return;
    try {
      const { base64, contentType } = await readFileBase64(file);
      await onSubmit({
        head,
        amount: value,
        filename: file.name,
        contentType,
        contentBase64: base64,
      });
      setAmount('');
      setFile(null);
      setPicker((n) => n + 1);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  return (
    <div className="grid items-end gap-3 sm:grid-cols-[1.4fr_1fr_1.4fr_auto]">
      <Field label="Head">
        <Select value={head} onChange={(e) => setHead(e.target.value as ProofHead)}>
          {PROOF_HEADS.map((h) => (
            <option key={h} value={h}>
              {PROOF_HEAD_LABEL[h]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Amount it proves">
        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="File">
        <Input
          key={picker}
          type="file"
          accept="application/pdf,image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Button
        onClick={() => void submit()}
        disabled={busy || !file || !value || Number(value) <= 0}
      >
        Hand in
      </Button>
    </div>
  );
}
