import { amountInWords, formatInr, type PayLine, type PayLineItem } from '@hsdg/contracts';
import { A4, MARGIN, Page, assemble, dmy } from '../billing/invoice-pdf';
import { monthLabel } from './payroll-errors';

export interface PayslipPdfData {
  firmName: string;
  firmAddress: string | null;
  month: string;
  kind: 'salary' | 'stipend';
  employeeCode: string;
  fullName: string;
  officeCode: string | null;
  uan: string | null;
  accountMasked: string | null;
  line: PayLine;
  paidAt: string | null;
  bankReference: string | null;
}

/** One A4 payslip: earnings and deductions side by side, net in figures and words. */
export function renderPayslipPdf(d: PayslipPdfData): Buffer {
  const p = new Page();
  const right = A4.w - MARGIN;
  const mid = A4.w / 2;
  let y = A4.h - MARGIN;

  p.text(MARGIN, y, d.firmName, 14, true);
  y -= 14;
  if (d.firmAddress) {
    for (const l of d.firmAddress.split(/\r?\n/).slice(0, 3)) {
      p.text(MARGIN, y, l, 8);
      y -= 10;
    }
  }
  y -= 6;
  p.text(
    MARGIN,
    y,
    `${d.kind === 'stipend' ? 'Stipend' : 'Pay'} slip for ${monthLabel(d.month)}`,
    11,
    true,
  );
  y -= 8;
  p.rule(MARGIN, y, right, y);
  y -= 14;

  const facts: [string, string][] = [
    ['Name', d.fullName],
    ['Employee code', d.employeeCode],
    ['Office', d.officeCode ?? '-'],
    ['UAN', d.uan ?? '-'],
    ['Days in month', String(d.line.daysInMonth)],
    ['Payable days', String(d.line.payableDays)],
    ['Loss-of-pay days', String(d.line.lossOfPayDays)],
    ['Paid into', d.accountMasked ?? '-'],
  ];
  facts.forEach(([k, v], i) => {
    const x = i % 2 === 0 ? MARGIN : mid + 6;
    if (i % 2 === 0 && i > 0) y -= 13;
    p.text(x, y, k, 8);
    p.text(x + 90, y, v, 9, true);
  });
  y -= 20;
  p.rule(MARGIN, y, right, y);
  y -= 14;

  const earnings = d.line.items.filter((i) => i.kind === 'earning' || i.kind === 'reimbursement');
  const deductions = d.line.items.filter((i) => i.kind === 'deduction');
  p.text(MARGIN, y, 'Earnings', 9, true);
  p.right(mid - 6, y, 'Amount', 9, true);
  p.text(mid + 6, y, 'Deductions', 9, true);
  p.right(right, y, 'Amount', 9, true);
  y -= 6;
  p.rule(MARGIN, y, right, y, 0.3);
  y -= 12;
  const column = (items: PayLineItem[], x0: number, x1: number, top: number): number => {
    let yy = top;
    for (const i of items) {
      p.text(x0, yy, i.label, 9);
      p.right(x1, yy, formatInr(i.amount), 9);
      yy -= 13;
    }
    return yy;
  };
  const yL = column(earnings, MARGIN, mid - 6, y);
  const yR = column(deductions, mid + 6, right, y);
  y = Math.min(yL, yR) - 2;
  p.rule(MARGIN, y, right, y, 0.3);
  y -= 13;
  p.text(MARGIN, y, 'Gross earnings', 9, true);
  p.right(mid - 6, y, formatInr(d.line.gross), 9, true);
  p.text(mid + 6, y, 'Total deductions', 9, true);
  p.right(right, y, formatInr(d.line.deductions), 9, true);
  if (d.line.reimbursements !== '0.00') {
    y -= 13;
    p.text(MARGIN, y, 'Reimbursements', 9);
    p.right(mid - 6, y, formatInr(d.line.reimbursements), 9);
  }
  y -= 8;
  p.rule(MARGIN, y, right, y);
  y -= 18;
  p.text(MARGIN, y, 'Net pay', 12, true);
  p.right(right, y, formatInr(d.line.net), 12, true);
  y -= 14;
  p.text(MARGIN, y, amountInWords(d.line.net), 8);
  y -= 22;

  const employer = d.line.items.filter((i) => i.kind === 'employer');
  if (employer.length > 0) {
    p.text(MARGIN, y, "The firm's contributions (not deducted from your pay)", 8, true);
    y -= 12;
    for (const i of employer) {
      p.text(MARGIN, y, i.label, 8);
      p.right(mid - 6, y, formatInr(i.amount), 8);
      y -= 11;
    }
    y -= 8;
  }
  if (d.paidAt) {
    p.text(
      MARGIN,
      y,
      `Paid on ${dmy(d.paidAt.slice(0, 10))}${d.bankReference ? `, bank reference ${d.bankReference}` : ''}.`,
      8,
    );
  }
  p.text(MARGIN, MARGIN - 20, 'This is a computer-generated payslip and needs no signature.', 7);
  return assemble([p]);
}
