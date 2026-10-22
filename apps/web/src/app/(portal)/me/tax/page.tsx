'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ExitSettlement,
  Form130PartB,
  SaveTaxDeclarationInput,
  SubmitTaxProofInput,
  TaxDeclaration,
} from '@hsdg/contracts';
import { apiFetch } from '@/lib/api';
import { errorText } from '@/lib/payroll';
import { taxYearLabel, taxYearNow } from '@/lib/payroll-tax';
import { useToast } from '@/lib/toast';
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { Field, Select } from '@/components/form';
import { DeclarationForm } from '@/components/payroll-tax/declaration-form';
import { ProofList, ProofUpload } from '@/components/payroll-tax/proofs';
import { Form130View } from '@/components/payroll-tax/tax-computation';
import { SettlementStatement } from '@/components/payroll-tax/exit-editor';

/** My income tax: the declaration, proofs, Form 130 Part B; a leaver's settlement. */
export default function MyTaxPage(): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [year, setYear] = useState(taxYearNow());
  const key = ['me', 'tax', year];
  const decl = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<TaxDeclaration>(`/me/tax/${year}`),
    retry: false,
  });
  const f130 = useQuery({
    queryKey: [...key, 'form130'],
    queryFn: () => apiFetch<Form130PartB>(`/me/tax/${year}/form130`),
    retry: false,
  });
  const fnf = useQuery({
    queryKey: ['me', 'full-and-final'],
    queryFn: () => apiFetch<ExitSettlement | null>('/me/full-and-final'),
    retry: false,
  });
  const done = (message: string) => ({
    onSuccess: () => {
      toast(message, 'success');
      void qc.invalidateQueries({ queryKey: ['me', 'tax'] });
    },
    onError: (err: unknown) => toast(errorText(err), 'error'),
  });
  const save = useMutation({
    mutationFn: (input: SaveTaxDeclarationInput) =>
      apiFetch<TaxDeclaration>(`/me/tax/${year}`, { method: 'PUT', body: input }),
    ...done('Declaration saved.'),
  });
  const submit = useMutation({
    mutationFn: (input: SubmitTaxProofInput) =>
      apiFetch<TaxDeclaration>(`/me/tax/${year}/proofs`, { method: 'POST', body: input }),
    ...done('Proof handed in. HR will check it.'),
  });

  const settlement = fnf.data && 'status' in fnf.data ? fnf.data : null;
  // The regime is fixed once tax has been deducted on it this year.
  const regimeFixed = !!f130.data && Number(f130.data.tdsDeducted) > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="My income tax"
        subtitle="Declare what you will claim so the right tax is deducted each month. Hand in proofs before January: from then on only proved amounts count."
        back={{ href: '/me/pay', label: 'My pay' }}
      />
      <Field label="Tax year">
        <Select className="w-40" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[taxYearNow() + 1, taxYearNow(), taxYearNow() - 1].map((y) => (
            <option key={y} value={y}>
              {taxYearLabel(y)}
            </option>
          ))}
        </Select>
      </Field>

      {decl.isLoading ? (
        <Spinner />
      ) : decl.error || !decl.data ? (
        <EmptyState>{errorText(decl.error)}</EmptyState>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Declaration</CardTitle>
            </CardHeader>
            <CardBody>
              <DeclarationForm
                key={`${decl.data.id}-${decl.data.version}`}
                value={decl.data}
                regimeFixed={regimeFixed}
                saving={save.isPending}
                onSave={(input) => save.mutate(input)}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Proofs</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <ProofList proofs={decl.data.proofs} />
              {decl.data.id && !decl.data.lockedAt ? (
                <ProofUpload busy={submit.isPending} onSubmit={(i) => submit.mutateAsync(i)} />
              ) : !decl.data.id ? (
                <p className="text-sm text-ink-muted">
                  Save your declaration first, then hand in its proofs.
                </p>
              ) : null}
            </CardBody>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Form 130 Part B</CardTitle>
        </CardHeader>
        <CardBody>
          {f130.isLoading ? (
            <Spinner />
          ) : f130.error || !f130.data ? (
            <EmptyState>{errorText(f130.error)}</EmptyState>
          ) : (
            <Form130View f={f130.data} />
          )}
        </CardBody>
      </Card>

      {settlement && (
        <Card>
          <CardHeader>
            <CardTitle>Full and final</CardTitle>
          </CardHeader>
          <CardBody>
            <SettlementStatement s={settlement} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
