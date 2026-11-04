'use client';

import {
  checkCertificateFigures,
  type CertificateFigures,
  type CertificateTemplate,
  type CertificateVariable,
} from '@hsdg/contracts';
import { Field, Input, Select, Textarea } from '@/components/form';

/**
 * The template's checks, as the person types — the same function the API
 * runs. A blank required field is not flagged until they try to send it.
 * Pure — tested.
 */
export function figureErrors(
  template: Pick<CertificateTemplate, 'variables' | 'checks'>,
  figures: CertificateFigures,
  showRequired: boolean,
): Record<string, string> {
  const filled = Object.fromEntries(Object.entries(figures).filter(([, v]) => v.trim() !== ''));
  const { errors } = checkCertificateFigures(template, filled);
  if (showRequired) return errors;
  return Object.fromEntries(
    Object.entries(errors).filter(
      ([k]) => (figures[k] ?? '').trim() !== '' || !isRequired(template, k),
    ),
  );
}

const isRequired = (t: Pick<CertificateTemplate, 'variables'>, key: string) =>
  t.variables.find((v) => v.key === key)?.required ?? false;

const PLACEHOLDER: Partial<Record<CertificateVariable['type'], string>> = {
  amount: '0.00',
  number: '0',
  percent: '0–100',
  pan: 'AAAAA9999A',
};

/** The template's fields, one per variable, typed by the variable. */
export function CertificateFigures({
  template,
  figures,
  onChange,
  errors,
  disabled,
}: {
  template: CertificateTemplate;
  figures: CertificateFigures;
  onChange: (next: CertificateFigures) => void;
  errors: Record<string, string>;
  disabled?: boolean;
}): JSX.Element {
  const set = (key: string, value: string) => onChange({ ...figures, [key]: value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {template.variables.map((v) => {
        const value = figures[v.key] ?? '';
        const error = errors[v.key];
        const common = {
          'aria-label': v.label,
          'aria-invalid': error ? true : undefined,
          disabled,
        };
        return (
          <Field
            key={v.key}
            label={v.label}
            required={v.required}
            hint={error ? undefined : v.help}
            className={v.type === 'longtext' ? 'sm:col-span-2' : undefined}
          >
            {v.type === 'longtext' ? (
              <Textarea value={value} onChange={(e) => set(v.key, e.target.value)} {...common} />
            ) : v.type === 'yesno' ? (
              <Select value={value} onChange={(e) => set(v.key, e.target.value)} {...common}>
                <option value="">Choose…</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </Select>
            ) : (
              <Input
                type={v.type === 'date' ? 'date' : 'text'}
                inputMode={
                  v.type === 'amount' || v.type === 'number' || v.type === 'percent'
                    ? 'decimal'
                    : undefined
                }
                value={value}
                placeholder={PLACEHOLDER[v.type]}
                onChange={(e) =>
                  set(v.key, v.type === 'pan' ? e.target.value.toUpperCase() : e.target.value)
                }
                className={
                  error ? 'border-danger-500' : v.type === 'pan' ? 'font-mono uppercase' : undefined
                }
                maxLength={v.type === 'pan' ? 10 : 300}
                {...common}
              />
            )}
            {error && <span className="mt-1 block text-xs text-danger-600">{error}</span>}
          </Field>
        );
      })}
    </div>
  );
}
