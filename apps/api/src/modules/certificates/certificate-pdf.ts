import { fillCertificateBody, formatInr } from '@hsdg/contracts';
import { A4, MARGIN, Page, assemble, dmy, wrap } from '../billing/invoice-pdf';

/**
 * PS-402 · a certificate as a PDF, with the tax invoice's small PDF writer.
 * The firm's letterhead (name, FRN, address), the certificate number and
 * date, the addressee, the template's wording with the figures filled in,
 * and the signature block: the partner, the membership number and the UDIN.
 * A draft prints as a draft and a revoked one with its revocation, so a copy
 * cannot pass for a live certificate.
 */
export interface CertificatePdfData {
  firm: { name: string; frn: string | null; address: string | null };
  title: string;
  formLabel: string | null;
  legalRef: string | null;
  certificateNo: string | null;
  issuedOn: string | null;
  addressee: string;
  purpose: string;
  clientName: string;
  body: string;
  figures: Record<string, string>;
  /** Figures with a date type print as DD-MM-YYYY. */
  dateKeys: string[];
  /** Figures with an amount type print in lakh grouping (1,25,00,000.00). */
  amountKeys: string[];
  partner: { name: string; membershipNo: string | null } | null;
  signedOn: string | null;
  udin: string | null;
  place: string | null;
  status: 'draft' | 'in_review' | 'signed' | 'issued' | 'revoked';
  revokedReason: string | null;
}

const LINE = 13;
const WIDTH = 92;

export function renderCertificatePdf(d: CertificatePdfData): Buffer {
  const pages: Page[] = [];
  let p = new Page();
  pages.push(p);
  let y = A4.h - MARGIN;
  const right = A4.w - MARGIN;
  const need = (lines: number) => {
    if (y - lines * LINE < MARGIN + 30) {
      p = new Page();
      pages.push(p);
      y = A4.h - MARGIN;
    }
  };
  const para = (text: string, size = 10, bold = false) => {
    for (const line of wrap(text, size > 10 ? 70 : WIDTH)) {
      need(1);
      p.text(MARGIN, y, line, size, bold);
      y -= size > 10 ? LINE + 3 : LINE;
    }
  };

  // Letterhead.
  p.text(MARGIN, y, d.firm.name || 'Chartered Accountants', 14, true);
  y -= 16;
  p.text(MARGIN, y, `Chartered Accountants${d.firm.frn ? `  -  FRN ${d.firm.frn}` : ''}`, 9);
  y -= LINE;
  if (d.firm.address) {
    for (const line of wrap(d.firm.address, 100)) {
      p.text(MARGIN, y, line, 8);
      y -= 11;
    }
  }
  y -= 4;
  p.rule(MARGIN, y, right, y, 0.8);
  y -= 20;

  if (d.status === 'draft' || d.status === 'in_review') {
    p.text(MARGIN, y, 'DRAFT - NOT SIGNED - NOT FOR ISSUE', 11, true);
    y -= 20;
  }
  if (d.status === 'revoked') {
    p.text(MARGIN, y, 'REVOKED - THIS CERTIFICATE IS WITHDRAWN', 11, true);
    y -= LINE;
    if (d.revokedReason) para(`Reason: ${d.revokedReason}`, 9);
    y -= 8;
  }

  p.text(MARGIN, y, `Certificate no.: ${d.certificateNo ?? '-'}`, 9);
  p.right(right, y, `Date: ${dmy(d.issuedOn ?? d.signedOn)}`, 9);
  y -= 22;
  p.text(MARGIN, y, 'To', 10);
  y -= LINE;
  para(d.addressee);
  y -= 10;

  para(d.title.toUpperCase(), 12, true);
  if (d.formLabel || d.legalRef) {
    para([d.formLabel, d.legalRef].filter(Boolean).join(' - '), 8);
  }
  y -= 8;

  const values: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(d.figures).map(([k, v]) => [
        k,
        d.dateKeys.includes(k) ? dmy(v) : d.amountKeys.includes(k) ? formatInr(v) : v,
      ]),
    ),
    client_name: d.clientName,
    purpose: d.purpose,
    form_label: d.formLabel ?? 'the prescribed form',
  };
  for (const block of fillCertificateBody(d.body, values).split(/\n{2,}/)) {
    const text = block.trim();
    if (!text) continue;
    para(text);
    y -= 8;
  }

  // Signature.
  need(7);
  y -= 16;
  p.text(MARGIN, y, `For ${d.firm.name || 'the firm'}`, 10, true);
  y -= LINE;
  p.text(MARGIN, y, `Chartered Accountants${d.firm.frn ? `, FRN ${d.firm.frn}` : ''}`, 9);
  y -= 34;
  p.text(MARGIN, y, d.partner?.name ?? '(Partner)', 10, true);
  y -= LINE;
  p.text(MARGIN, y, `Partner - Membership no. ${d.partner?.membershipNo ?? '-'}`, 9);
  y -= LINE;
  p.text(MARGIN, y, `UDIN: ${d.udin ?? '-'}`, 9, true);
  y -= LINE;
  p.text(MARGIN, y, `Place: ${d.place ?? '-'}    Date: ${dmy(d.signedOn)}`, 9);

  pages.forEach((pg, i) => {
    pg.right(right, MARGIN - 20, `Page ${i + 1} of ${pages.length}`, 7);
  });
  return assemble(pages);
}
