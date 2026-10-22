import type { PayLine } from '@hsdg/contracts';
import { formatMoney } from '@/lib/format';

/** One person's month, item by item: earnings, deductions and what the firm adds. */
export function LineDetail({ line }: { line: Pick<PayLine, 'items' | 'warnings'> }): JSX.Element {
  const col = (title: string, kinds: string[]) => (
    <div>
      <p className="mb-1 text-xs font-semibold text-ink-muted">{title}</p>
      {line.items
        .filter((i) => kinds.includes(i.kind))
        .map((i) => (
          <p key={`${i.kind}-${i.code}`} className="flex justify-between gap-4">
            <span>{i.label}</span>
            <span className="tabular-nums">{formatMoney(i.amount)}</span>
          </p>
        ))}
    </div>
  );
  return (
    <div className="space-y-2 text-sm">
      <div className="grid gap-4 sm:grid-cols-3">
        {col('Earnings', ['earning', 'reimbursement'])}
        {col('Deductions', ['deduction'])}
        {col('The firm’s contributions', ['employer'])}
      </div>
      {line.warnings.map((w) => (
        <p key={w} className="text-xs text-warning-700">
          {w}
        </p>
      ))}
    </div>
  );
}
