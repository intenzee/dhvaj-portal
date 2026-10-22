import type { Form130PartB, TaxComputation } from '@hsdg/contracts';
import { formatDate, formatMoney } from '@/lib/format';
import { Badge } from '@/components/ui';

function Row({
  label,
  amount,
  strong,
  minus,
}: {
  label: string;
  amount: string;
  strong?: boolean;
  minus?: boolean;
}): JSX.Element | null {
  if (!strong && Number(amount) === 0) return null;
  return (
    <tr className={strong ? 'font-medium text-ink' : 'text-ink-muted'}>
      <td className="py-1 pr-3">{label}</td>
      <td className="py-1 text-right tabular-nums">
        {minus ? '− ' : ''}
        {formatMoney(amount)}
      </td>
    </tr>
  );
}

/** The year's tax worked out line by line, as Form 130 Part B sets it out. */
export function TaxComputationView({ c }: { c: TaxComputation }): JSX.Element {
  return (
    <div className="space-y-2">
      <table className="w-full max-w-lg text-sm">
        <tbody>
          <Row label="Gross salary" amount={c.grossSalary} strong />
          {c.exemptions.map((e) => (
            <Row key={e.code} label={`Exempt: ${e.label}`} amount={e.amount} minus />
          ))}
          <Row label="Standard deduction" amount={c.standardDeduction} minus />
          <Row label="Professional tax" amount={c.professionalTax} minus />
          <Row label="Income from salary" amount={c.incomeFromSalary} strong />
          <Row label="Other income declared" amount={c.otherIncome} />
          {c.deductions.map((d) => (
            <Row key={d.code} label={d.label} amount={d.amount} minus />
          ))}
          <Row label="Total income" amount={c.totalIncome} strong />
          <Row label="Tax on it" amount={c.taxOnIncome} />
          <Row label="Rebate" amount={c.rebate} minus />
          <Row label="Surcharge" amount={c.surcharge} />
          <Row label="Health and education cess" amount={c.cess} />
          <Row label="Tax for the year" amount={c.taxPayable} strong />
        </tbody>
      </table>
      {c.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
          {c.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Form 130 Part B figures: the computation, what was deducted and what is left. */
export function Form130View({ f }: { f: Form130PartB }): JSX.Element {
  const balance = Number(f.balance);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <span>
          {formatDate(f.periodFrom)} – {formatDate(f.periodTo)} ·{' '}
          {f.computation.regime === 'new' ? 'New' : 'Old'} regime · PAN {f.panMasked ?? 'not given'}
        </span>
        <Badge tone={f.final ? 'success' : 'warn'}>{f.final ? 'Final' : 'Provisional'}</Badge>
      </div>
      <TaxComputationView c={f.computation} />
      <table className="w-full max-w-lg text-sm">
        <tbody>
          {f.previousEmployment && (
            <Row label="TDS by the previous employer" amount={f.previousEmployment.tds} />
          )}
          <Row label="TDS deducted here" amount={f.tdsDeducted} strong />
          <tr className="font-medium text-ink">
            <td className="py-1 pr-3">
              {balance < 0 ? 'Deducted in excess' : 'Still to be deducted'}
            </td>
            <td className="py-1 text-right tabular-nums">{formatMoney(Math.abs(balance))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
