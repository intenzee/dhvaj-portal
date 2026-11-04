import {
  RISK_MONEY_TILES,
  formatInr,
  partnerPackMonthLabel,
  type PartnerPackFigures,
} from '@hsdg/contracts';
import { A4, MARGIN, Page, assemble, dmy, wrap } from '../billing/invoice-pdf';

const STREAM_LABEL: Record<string, string> = {
  gst: 'GST',
  income_tax: 'Income tax',
  tds: 'TDS',
  roc: 'ROC',
  audit: 'Audit',
  payroll: 'Payroll',
  other: 'Other',
};
const rs = (amount: string): string => `Rs. ${formatInr(amount)}`;
const label = (s: string): string =>
  STREAM_LABEL[s] ?? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * PS-303 · the monthly partner pack as a PDF: the risk tiles with their first
 * items, then the month's work and money. Drawn from the stored figures, so
 * the PDF says exactly what the pack recorded when it was built.
 */
export function renderPartnerPackPdf(d: PartnerPackFigures, firmName: string | null): Buffer {
  const pages: Page[] = [];
  let p = new Page();
  pages.push(p);
  const right = A4.w - MARGIN;
  let y = A4.h - MARGIN;
  const room = (need: number): void => {
    if (y - need >= MARGIN) return;
    p = new Page();
    pages.push(p);
    y = A4.h - MARGIN;
  };
  const heading = (s: string): void => {
    room(40);
    y -= 10;
    p.text(MARGIN, y, s, 12, true);
    y -= 6;
    p.rule(MARGIN, y, right, y);
    y -= 14;
  };
  const row = (k: string, v: string, bold = false, indent = 0): void => {
    room(14);
    p.text(MARGIN + indent, y, k, 9, bold);
    p.right(right, y, v, 9, bold);
    y -= 13;
  };

  if (firmName) {
    p.text(MARGIN, y, firmName, 9);
    y -= 16;
  }
  p.text(MARGIN, y, `Partner pack - ${partnerPackMonthLabel(d.month)}`, 16, true);
  y -= 16;
  p.text(
    MARGIN,
    y,
    `${d.partner.name}${d.partner.officeCode ? ` (${d.partner.officeCode})` : ''} - ` +
      (d.scope === 'firm' ? 'the whole firm' : 'the clients and engagements you can see'),
    9,
  );
  y -= 12;
  p.text(MARGIN, y, `Month ${dmy(d.from)} to ${dmy(d.to)}; risk as on ${dmy(d.asOf)}.`, 8);
  y -= 8;

  heading('Risk');
  for (const t of d.risk) {
    const money = RISK_MONEY_TILES.includes(t.key) && t.amount && Number(t.amount) > 0;
    row(
      t.label,
      !t.available ? 'not in use yet' : money ? `${t.count} - ${rs(t.amount!)}` : String(t.count),
      t.available && t.count > 0,
    );
    for (const i of t.items) {
      for (const [n, line] of wrap(`${i.title} - ${i.detail}`, 92).entries()) {
        room(11);
        p.text(MARGIN + 12, y, line, 8);
        if (n === 0 && i.dueOn) p.right(right, y, dmy(i.dueOn), 8);
        y -= 10;
      }
    }
    if (t.items.length < t.count) {
      room(11);
      p.text(MARGIN + 12, y, `and ${t.count - t.items.length} more on the dashboard`, 8);
      y -= 10;
    }
    y -= 3;
  }

  heading('The month');
  row('Filings filed', String(d.filingsDone.total), true);
  for (const s of d.filingsDone.byStream) row(label(s.stream), String(s.count), false, 12);
  row('Notices closed', String(d.noticesClosed.total), true);
  for (const o of d.noticesClosed.byOutcome) row(label(o.outcome), String(o.count), false, 12);
  row(`Invoiced (${d.invoiced.count})`, rs(d.invoiced.amount), true);
  row(`Fees collected (${d.collected.count} receipts)`, rs(d.collected.amount), true);

  heading('Profitability');
  if (d.profitability) {
    row('Time cost', rs(d.profitability.timeCost));
    row('Standard value', rs(d.profitability.standardValue));
    row('Billed', rs(d.profitability.billed));
    row(
      'Realisation',
      d.profitability.realisationPct === null
        ? '-'
        : `${d.profitability.realisationPct.toFixed(1)}%`,
    );
    row('Margin', rs(d.profitability.margin), true);
  } else {
    room(14);
    p.text(MARGIN, y, 'Shown here once cost rates are set up (PS-302).', 9);
    y -= 13;
  }

  pages.forEach((pg, i) => pg.right(right, MARGIN / 2, `Page ${i + 1} of ${pages.length}`, 7));
  return assemble(pages);
}
