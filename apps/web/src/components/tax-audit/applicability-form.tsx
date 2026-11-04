'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TAX_AUDIT_PRESUMPTIVE_SCHEMES,
  taxAuditApplicability,
  type SaveTaxAuditApplicabilityInput,
  type TaxAuditApplicability,
  type TaxAuditApplicabilityInput,
  type TaxAuditPresumptiveScheme,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Badge, Button } from '@/components/ui';
import { Field, Input, Select } from '@/components/form';
import { TAX_AUDITS_KEY } from './keys';

export const EMPTY_INPUTS: TaxAuditApplicabilityInput = {
  businessTurnover: null,
  professionReceipts: null,
  cashWithinFivePercent: false,
  presumptiveScheme: null,
  profitBelowPresumptive: false,
  incomeAboveExemption: true,
  optedOutOf44AD: false,
};

/** '' → null; '2,50,00,000' → 25000000. */
export function rupeesIn(text: string): number | null {
  const clean = text.replace(/[,\s₹]/g, '');
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const rupeesOut = (n: number | null): string => (n === null ? '' : String(n));

/**
 * Tax audit applicability for one year (Phase 3, F-2): the calculator's
 * questions, its answer as they are filled in, and an override with a reason.
 * The engagement's partner or manager saves it; the API works it out again.
 */
export function ApplicabilityForm({
  engagementId,
  financialYear,
  decision,
  onSaved,
}: {
  engagementId: string;
  financialYear: string;
  decision: TaxAuditApplicability | null;
  onSaved?: (d: TaxAuditApplicability) => void;
}): JSX.Element {
  const toast = useToast();
  const qc = useQueryClient();
  const [inputs, setInputs] = useState<TaxAuditApplicabilityInput>(
    decision?.inputs ?? EMPTY_INPUTS,
  );
  const [turnover, setTurnover] = useState(rupeesOut(inputs.businessTurnover));
  const [receipts, setReceipts] = useState(rupeesOut(inputs.professionReceipts));
  const [overriding, setOverriding] = useState(decision?.override !== null && !!decision);
  const [overrideApplicable, setOverrideApplicable] = useState(
    decision?.override?.applicable ?? false,
  );
  const [reason, setReason] = useState(decision?.override?.reason ?? '');

  const result = taxAuditApplicability(inputs);
  const set = <K extends keyof TaxAuditApplicabilityInput>(
    key: K,
    value: TaxAuditApplicabilityInput[K],
  ): void => setInputs((cur) => ({ ...cur, [key]: value }));

  const save = useMutation({
    mutationFn: (body: SaveTaxAuditApplicabilityInput) =>
      apiFetch<TaxAuditApplicability>(
        `/engagements/${engagementId}/tax-audit-applicability/${financialYear}`,
        { method: 'PUT', body },
      ),
    onSuccess: (d) => {
      toast(
        d.applicable
          ? `FY ${financialYear}: tax audit applies.`
          : `FY ${financialYear}: no tax audit.`,
        'success',
      );
      void qc.invalidateQueries({ queryKey: TAX_AUDITS_KEY });
      onSaved?.(d);
    },
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Could not save the decision.', 'error'),
  });

  const check = (
    key:
      | 'cashWithinFivePercent'
      | 'profitBelowPresumptive'
      | 'incomeAboveExemption'
      | 'optedOutOf44AD',
    label: string,
  ): JSX.Element => (
    <label className="flex items-start gap-2 text-sm text-ink">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={inputs[key]}
        onChange={(e) => set(key, e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Business turnover (₹)">
          <Input
            inputMode="numeric"
            value={turnover}
            placeholder="No business"
            onChange={(e) => {
              setTurnover(e.target.value);
              set('businessTurnover', rupeesIn(e.target.value));
            }}
          />
        </Field>
        <Field label="Professional receipts (₹)">
          <Input
            inputMode="numeric"
            value={receipts}
            placeholder="No profession"
            onChange={(e) => {
              setReceipts(e.target.value);
              set('professionReceipts', rupeesIn(e.target.value));
            }}
          />
        </Field>
        <Field label="Presumptive scheme">
          <Select
            value={inputs.presumptiveScheme ?? ''}
            onChange={(e) =>
              set('presumptiveScheme', (e.target.value || null) as TaxAuditPresumptiveScheme | null)
            }
          >
            <option value="">None</option>
            {TAX_AUDIT_PRESUMPTIVE_SCHEMES.map((s) => (
              <option key={s} value={s}>
                s.{s}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {check('cashWithinFivePercent', 'Cash receipts and cash payments each within 5%')}
        {check('incomeAboveExemption', 'Total income over the basic exemption limit')}
        {inputs.presumptiveScheme &&
          check(
            'profitBelowPresumptive',
            `Declares less than the deemed profit under s.${inputs.presumptiveScheme}`,
          )}
        {check('optedOutOf44AD', 'Left s.44AD within five years of opting in (s.44AD(4))')}
      </div>

      <div
        role="status"
        aria-label="Calculator answer"
        className="rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm"
      >
        <Badge tone={result.applicable ? 'warn' : 'success'}>
          {result.applicable ? `Tax audit applies · s.${result.clause}` : 'No tax audit'}
        </Badge>
        <p className="mt-1 text-ink-muted">{result.reason}</p>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={overriding}
          onChange={(e) => setOverriding(e.target.checked)}
        />
        Override the calculator
      </label>
      {overriding && (
        <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
          <Field label="Decision">
            <Select
              value={overrideApplicable ? 'yes' : 'no'}
              onChange={(e) => setOverrideApplicable(e.target.value === 'yes')}
            >
              <option value="yes">Tax audit applies</option>
              <option value="no">No tax audit</option>
            </Select>
          </Field>
          <Field label="Reason">
            <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-faint">
          {decision
            ? `Last decided by ${decision.decidedByName ?? 'someone'}.`
            : 'Not yet decided for this year.'}
        </p>
        <Button
          disabled={save.isPending || (overriding && !reason.trim())}
          onClick={() =>
            save.mutate({
              inputs,
              override: overriding
                ? { applicable: overrideApplicable, reason: reason.trim() }
                : null,
              ...(decision ? { version: decision.version } : {}),
            })
          }
        >
          Save decision
        </Button>
      </div>
    </div>
  );
}
