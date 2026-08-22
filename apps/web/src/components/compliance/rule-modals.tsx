'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CALCULATION_BASES,
  CALCULATION_BASIS,
  COMPLIANCE_CATEGORIES,
  WORKING_DAY_ADJUSTMENTS,
} from '@hsdg/contracts';
import { apiFetch, ApiError } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useToast } from '@/lib/toast';
import type { ComplianceRule } from '@/lib/types';
import { Button } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Field, Input, Select, Textarea } from '@/components/form';

function useRulesInvalidate(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['compliance', 'rules'] });
  };
}

export function CreateRuleModal({ onClose }: { onClose: () => void }): JSX.Element {
  const toast = useToast();
  const invalidate = useRulesInvalidate();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(COMPLIANCE_CATEGORIES[0] ?? 'income_tax');
  const [serviceCode, setServiceCode] = useState('');
  const [description, setDescription] = useState('');

  const codeValid = /^[A-Z0-9_]{2,50}$/.test(code);

  const create = useMutation({
    mutationFn: () =>
      apiFetch<ComplianceRule>('/compliance-rules', {
        method: 'POST',
        body: {
          code: code.trim().toUpperCase(),
          name: name.trim(),
          category,
          ...(serviceCode.trim() ? { serviceCode: serviceCode.trim().toUpperCase() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast('Compliance rule created. Add a version to make it effective.');
      invalidate();
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not create the rule.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="New compliance rule"
      description="A rule needs at least one effective-dated version before it applies."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!codeValid || name.trim().length === 0 || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create rule'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" required hint={code && !codeValid ? 'UPPER_SNAKE, 2–50 chars.' : 'e.g. ITR_FILING_IND'}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className={code && !codeValid ? 'border-danger-400' : undefined}
            />
          </Field>
          <Field label="Category" required>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {COMPLIANCE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Income Tax Return — Individuals" />
        </Field>
        <Field label="Linked service code" hint="Optional — link the obligation to a service.">
          <Input value={serviceCode} onChange={(e) => setServiceCode(e.target.value.toUpperCase())} placeholder="ITR_FILING" />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function AddVersionModal({
  rule,
  onClose,
}: {
  rule: ComplianceRule;
  onClose: () => void;
}): JSX.Element {
  const toast = useToast();
  const invalidate = useRulesInvalidate();

  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [calculationBasis, setCalculationBasis] = useState<string>(CALCULATION_BASES[0] ?? 'fy_end');
  const [offsetMonths, setOffsetMonths] = useState('0');
  const [offsetDays, setOffsetDays] = useState('0');
  const [fixedMonth, setFixedMonth] = useState('');
  const [fixedDay, setFixedDay] = useState('');
  const [workingDayAdjustment, setWorkingDayAdjustment] = useState<string>('next');
  const [internalSlaOffsetDays, setInternalSlaOffsetDays] = useState('0');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');

  const isFixed = calculationBasis === CALCULATION_BASIS.fixedDate;
  const conditionValid = condition.trim() === '' || safeParse(condition) !== undefined;
  const fixedValid = !isFixed || (fixedMonth !== '' && fixedDay !== '');

  const add = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        effectiveFrom,
        calculationBasis,
        offsetMonths: Number(offsetMonths) || 0,
        offsetDays: Number(offsetDays) || 0,
        workingDayAdjustment,
        internalSlaOffsetDays: Number(internalSlaOffsetDays) || 0,
      };
      if (effectiveTo) body.effectiveTo = effectiveTo;
      if (isFixed) {
        body.fixedMonth = Number(fixedMonth);
        body.fixedDay = Number(fixedDay);
      }
      if (condition.trim()) body.condition = safeParse(condition);
      if (notes.trim()) body.notes = notes.trim();
      return apiFetch(`/compliance-rules/${rule.id}/versions`, { method: 'POST', body });
    },
    onSuccess: () => {
      toast('Rule version added. Existing instances keep their snapshot.');
      invalidate();
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not add the version.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`New version — ${rule.code}`}
      description="Adding a version is how a rule changes. History is never rewritten."
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!effectiveFrom || !conditionValid || !fixedValid || add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending ? 'Adding…' : 'Add version'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Effective from" required>
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </Field>
          <Field label="Effective to" hint="Blank = open-ended.">
            <Input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
          </Field>
        </div>

        <Field label="Calculation basis" required hint="What the deadline is measured from.">
          <Select value={calculationBasis} onChange={(e) => setCalculationBasis(e.target.value)}>
            {CALCULATION_BASES.map((b) => (
              <option key={b} value={b}>
                {humanize(b)}
              </option>
            ))}
          </Select>
        </Field>

        {isFixed ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fixed month" required hint="1–12">
              <Input type="number" min={1} max={12} value={fixedMonth} onChange={(e) => setFixedMonth(e.target.value)} />
            </Field>
            <Field label="Fixed day" required hint="1–31">
              <Input type="number" min={1} max={31} value={fixedDay} onChange={(e) => setFixedDay(e.target.value)} />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Offset months" hint="From the basis date.">
              <Input type="number" min={-120} max={120} value={offsetMonths} onChange={(e) => setOffsetMonths(e.target.value)} />
            </Field>
            <Field label="Offset days">
              <Input type="number" min={-366} max={366} value={offsetDays} onChange={(e) => setOffsetDays(e.target.value)} />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Working-day adjustment" hint="If the deadline lands on a holiday/weekend.">
            <Select value={workingDayAdjustment} onChange={(e) => setWorkingDayAdjustment(e.target.value)}>
              {WORKING_DAY_ADJUSTMENTS.map((w) => (
                <option key={w} value={w}>
                  {humanize(w)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Internal SLA buffer (days)" hint="Days before statutory for our internal clock.">
            <Input type="number" min={0} max={366} value={internalSlaOffsetDays} onChange={(e) => setInternalSlaOffsetDays(e.target.value)} />
          </Field>
        </div>

        <Field
          label="Conditional applicability (JSON)"
          hint={
            condition.trim() && !conditionValid
              ? 'Invalid JSON.'
              : 'Optional, e.g. {"field":"turnover","op":">","value":10000000}'
          }
        >
          <Textarea
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            className={condition.trim() && !conditionValid ? 'border-danger-400 font-mono text-xs' : 'font-mono text-xs'}
            placeholder='{"field":"turnover","op":">","value":10000000}'
          />
        </Field>

        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function AddHolidayModal({ onClose }: { onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');

  const add = useMutation({
    mutationFn: () =>
      apiFetch('/compliance-holidays', { method: 'POST', body: { date, name: name.trim() } }),
    onSuccess: () => {
      toast('Holiday added.');
      void qc.invalidateQueries({ queryKey: ['compliance', 'holidays'] });
      onClose();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Could not add the holiday.', 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Add holiday"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!date || name.trim().length === 0 || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? 'Adding…' : 'Add holiday'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Date" required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Independence Day" />
        </Field>
      </div>
    </Modal>
  );
}

/** Parse JSON, returning undefined on failure (so callers can validate). */
function safeParse(text: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
