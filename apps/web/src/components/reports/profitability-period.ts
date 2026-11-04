import { lastQuarter } from '@hsdg/contracts';

export interface PeriodPreset {
  label: string;
  from: string;
  to: string;
}

const mm = (n: number) => String(n).padStart(2, '0');

/** Quick periods for the profitability report, all to complete days. Pure — tested. */
export function periodPresets(today: string): PeriodPreset[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const fyStart = m >= 4 ? y : y - 1;
  const prevMonthYear = m === 1 ? y - 1 : y;
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevMonthEnd = new Date(Date.UTC(prevMonthYear, prevMonth, 0)).getUTCDate();
  return [
    { label: 'Last quarter', ...lastQuarter(today) },
    {
      label: 'Last month',
      from: `${prevMonthYear}-${mm(prevMonth)}-01`,
      to: `${prevMonthYear}-${mm(prevMonth)}-${mm(prevMonthEnd)}`,
    },
    { label: 'This month', from: `${y}-${mm(m)}-01`, to: today },
    { label: 'This FY to date', from: `${fyStart}-04-01`, to: today },
    { label: 'Last FY', from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31` },
  ];
}
