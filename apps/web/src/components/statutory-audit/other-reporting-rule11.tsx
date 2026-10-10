'use client';

import { useState } from 'react';
import {
  IEPF_STATUS_LABEL,
  RULE11E_CONCLUSION_LABEL,
  type DividendFacts,
  type ForeseeableLossFacts,
  type IepfFacts,
  type IepfStatus,
  type LitigationFacts,
  type OtherReportingCapturedFacts,
  type Rule11eAssessment,
  type Rule11eConclusion,
} from '@hsdg/contracts';
import { Button } from '@/components/ui';
import { Field, Input, Select, Textarea } from '@/components/form';
import { TriSelect, num, str, type FactsPatch } from './other-reporting-ui';

/**
 * Rule 11(a)–(f) facts (spec §6–§10): R11-01 pending litigations, R11-02
 * material foreseeable losses, R11-03 IEPF, the two mirrored Rule 11(e)
 * assessments (no monetary exemption) and R11-04 dividend / Section 123. Each
 * block saves on its own; the matrix cards update from the answers.
 */
export function OtherReportingRule11({
  facts,
  disabled,
  onSave,
}: {
  facts: OtherReportingCapturedFacts;
  disabled: boolean;
  onSave: (patch: FactsPatch) => void;
}): JSX.Element {
  return (
    <div className="space-y-4">
      <Litigation value={facts.litigation} disabled={disabled} onSave={(litigation) => onSave({ litigation })} />
      <Losses
        value={facts.foreseeableLosses}
        disabled={disabled}
        onSave={(foreseeableLosses) => onSave({ foreseeableLosses })}
      />
      <Iepf value={facts.iepf} disabled={disabled} onSave={(iepf) => onSave({ iepf })} />
      <Rule11e
        title="Rule 11(e)(i) — funds advanced / loaned / invested by the company"
        partiesLabel="Intermediaries"
        beneficiariesLabel="Ultimate beneficiaries"
        value={facts.rule11eAdvanced}
        disabled={disabled}
        onSave={(rule11eAdvanced) => onSave({ rule11eAdvanced })}
      />
      <Rule11e
        title="Rule 11(e)(ii) — funds received by the company"
        partiesLabel="Funding parties"
        beneficiariesLabel="Onward funding / guarantee / security understanding"
        value={facts.rule11eReceived}
        disabled={disabled}
        onSave={(rule11eReceived) => onSave({ rule11eReceived })}
      />
      <Dividend value={facts.dividend} disabled={disabled} onSave={(dividend) => onSave({ dividend })} />
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <fieldset className="space-y-2 rounded-md border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

function Litigation({
  value,
  disabled,
  onSave,
}: {
  value: LitigationFacts;
  disabled: boolean;
  onSave: (v: LitigationFacts) => void;
}): JSX.Element {
  const [v, setV] = useState(value);
  return (
    <Block title="Rule 11(a) — pending litigations (R11-01)">
      <TriSelect
        label="Pending litigations identified needing Rule 11 consideration?"
        value={v.identified}
        disabled={disabled}
        onChange={(identified) => setV({ ...v, identified })}
      />
      {v.identified === 'yes' && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Total matters">
            <Input
              type="number"
              value={str(v.totalMatters)}
              disabled={disabled}
              onChange={(e) => setV({ ...v, totalMatters: num(e.target.value) })}
            />
          </Field>
          <Field label="Material matters">
            <Input
              type="number"
              value={str(v.materialMatters)}
              disabled={disabled}
              onChange={(e) => setV({ ...v, materialMatters: num(e.target.value) })}
            />
          </Field>
          <Field label="Impact disclosed in the financial statements">
            <Select
              value={v.disclosure}
              disabled={disabled}
              onChange={(e) => setV({ ...v, disclosure: e.target.value as LitigationFacts['disclosure'] })}
            >
              <option value="pending">Pending</option>
              <option value="disclosed">Disclosed</option>
              <option value="partially_disclosed">Partially disclosed</option>
              <option value="not_disclosed">Not disclosed</option>
            </Select>
          </Field>
        </div>
      )}
      <Field label="Source workpaper (legal / litigation work)">
        <Input
          value={v.sourceWorkpaper ?? ''}
          disabled={disabled}
          onChange={(e) => setV({ ...v, sourceWorkpaper: e.target.value || null })}
        />
      </Field>
      <SaveButton disabled={disabled} onClick={() => onSave(v)} />
    </Block>
  );
}

function Losses({
  value,
  disabled,
  onSave,
}: {
  value: ForeseeableLossFacts;
  disabled: boolean;
  onSave: (v: ForeseeableLossFacts) => void;
}): JSX.Element {
  const [v, setV] = useState(value);
  const exists = v.hasLongTermContracts === 'yes' || v.hasDerivativeContracts === 'yes';
  return (
    <Block title="Rule 11(b) — material foreseeable losses (R11-02)">
      <TriSelect
        label="Long-term contracts exist?"
        value={v.hasLongTermContracts}
        disabled={disabled}
        onChange={(hasLongTermContracts) => setV({ ...v, hasLongTermContracts })}
      />
      <TriSelect
        label="Derivative contracts exist?"
        value={v.hasDerivativeContracts}
        disabled={disabled}
        onChange={(hasDerivativeContracts) => setV({ ...v, hasDerivativeContracts })}
      />
      {exists && (
        <TriSelect
          label="Provision for material foreseeable losses made as required?"
          value={v.provisionAdequate}
          disabled={disabled}
          onChange={(provisionAdequate) => setV({ ...v, provisionAdequate })}
        />
      )}
      <Field label="Linked workpapers (one per line)">
        <Textarea
          rows={2}
          value={v.linkedWorkpapers.join('\n')}
          disabled={disabled}
          onChange={(e) =>
            setV({
              ...v,
              linkedWorkpapers: e.target.value
                .split('\n')
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
      <SaveButton disabled={disabled} onClick={() => onSave(v)} />
    </Block>
  );
}

function Iepf({
  value,
  disabled,
  onSave,
}: {
  value: IepfFacts;
  disabled: boolean;
  onSave: (v: IepfFacts) => void;
}): JSX.Element {
  const [v, setV] = useState(value);
  return (
    <Block title="Rule 11(c) — transfers to the IEPF (R11-03)">
      <Field label="Status">
        <Select
          value={v.status}
          disabled={disabled}
          onChange={(e) => setV({ ...v, status: e.target.value as IepfStatus })}
        >
          {(Object.keys(IEPF_STATUS_LABEL) as IepfStatus[]).map((s) => (
            <option key={s} value={s}>
              {IEPF_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </Field>
      {v.status === 'delay' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Amount delayed (₹)">
            <Input
              inputMode="decimal"
              value={str(v.delayAmount)}
              disabled={disabled}
              onChange={(e) => setV({ ...v, delayAmount: num(e.target.value) })}
            />
          </Field>
          <Field label="Period of delay">
            <Input
              value={v.delayPeriod ?? ''}
              disabled={disabled}
              onChange={(e) => setV({ ...v, delayPeriod: e.target.value || null })}
            />
          </Field>
        </div>
      )}
      <SaveButton disabled={disabled} onClick={() => onSave(v)} />
    </Block>
  );
}

function Rule11e({
  title,
  partiesLabel,
  beneficiariesLabel,
  value,
  disabled,
  onSave,
}: {
  title: string;
  partiesLabel: string;
  beneficiariesLabel: string;
  value: Rule11eAssessment;
  disabled: boolean;
  onSave: (v: Rule11eAssessment) => void;
}): JSX.Element {
  const [v, setV] = useState(value);
  return (
    <Block title={title}>
      <p className="text-xs text-ink-muted">
        No monetary exemption — any such transaction needs the management representation (linked
        to the Section 07 representation letter).
      </p>
      <TriSelect
        label="Management representation obtained?"
        value={v.representationObtained}
        disabled={disabled}
        onChange={(representationObtained) => setV({ ...v, representationObtained })}
      />
      <TriSelect
        label="Such transactions identified?"
        value={v.transactionsIdentified}
        disabled={disabled}
        onChange={(transactionsIdentified) => setV({ ...v, transactionsIdentified })}
      />
      {v.transactionsIdentified === 'yes' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={partiesLabel}>
            <Input
              value={v.parties ?? ''}
              disabled={disabled}
              onChange={(e) => setV({ ...v, parties: e.target.value || null })}
            />
          </Field>
          <Field label={beneficiariesLabel}>
            <Input
              value={v.beneficiaries ?? ''}
              disabled={disabled}
              onChange={(e) => setV({ ...v, beneficiaries: e.target.value || null })}
            />
          </Field>
        </div>
      )}
      <Field label="Audit procedures performed">
        <Textarea
          rows={2}
          value={v.auditProcedures ?? ''}
          disabled={disabled}
          onChange={(e) => setV({ ...v, auditProcedures: e.target.value || null })}
        />
      </Field>
      <TriSelect
        label="Anything contrary noticed?"
        value={v.contraryMatter}
        disabled={disabled}
        onChange={(contraryMatter) => setV({ ...v, contraryMatter })}
      />
      {v.contraryMatter === 'yes' && (
        <Field label="Contrary matter">
          <Textarea
            rows={2}
            value={v.contraryNote ?? ''}
            disabled={disabled}
            onChange={(e) => setV({ ...v, contraryNote: e.target.value || null })}
          />
        </Field>
      )}
      <Field label="Conclusion">
        <Select
          value={v.conclusion}
          disabled={disabled}
          onChange={(e) => setV({ ...v, conclusion: e.target.value as Rule11eConclusion })}
        >
          {(Object.keys(RULE11E_CONCLUSION_LABEL) as Rule11eConclusion[]).map((c) => (
            <option key={c} value={c}>
              {RULE11E_CONCLUSION_LABEL[c]}
            </option>
          ))}
        </Select>
      </Field>
      <SaveButton disabled={disabled} onClick={() => onSave(v)} />
    </Block>
  );
}

function Dividend({
  value,
  disabled,
  onSave,
}: {
  value: DividendFacts;
  disabled: boolean;
  onSave: (v: DividendFacts) => void;
}): JSX.Element {
  const [v, setV] = useState(value);
  const declared = v.declaredOrPaid == null ? '' : v.declaredOrPaid ? 'yes' : 'no';
  return (
    <Block title="Rule 11(f) — dividend and Section 123 (R11-04)">
      <Field label="Dividend declared or paid during the year?">
        <Select
          value={declared}
          disabled={disabled}
          onChange={(e) =>
            setV({ ...v, declaredOrPaid: e.target.value === '' ? null : e.target.value === 'yes' })
          }
        >
          <option value="">Pending</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      </Field>
      {v.declaredOrPaid && (
        <>
          <Field label="Kind">
            <Select
              value={v.kind ?? ''}
              disabled={disabled}
              onChange={(e) => setV({ ...v, kind: (e.target.value || null) as DividendFacts['kind'] })}
            >
              <option value="">Select…</option>
              <option value="interim">Interim</option>
              <option value="final">Final</option>
              <option value="both">Interim and final</option>
            </Select>
          </Field>
          <TriSelect
            label="Complies with Section 123?"
            value={v.section123Compliant}
            disabled={disabled}
            onChange={(section123Compliant) => setV({ ...v, section123Compliant })}
          />
        </>
      )}
      <SaveButton disabled={disabled} onClick={() => onSave(v)} />
    </Block>
  );
}

function SaveButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }): JSX.Element {
  return (
    <Button size="sm" variant="secondary" disabled={disabled} onClick={onClick}>
      Save
    </Button>
  );
}
