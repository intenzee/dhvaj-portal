import { Logger } from '@nestjs/common';
import type { InvoicePdfData } from './invoice-pdf';
import { pdfImage } from './pdf-image';

/** The firm_settings columns the invoice PDF prints. */
export interface FirmPdfRow {
  firm_name: string;
  address: string | null;
  gstin: string | null;
  state_code: string | null;
  frn: string | null;
  email: string | null;
  pan: string | null;
  phone: string | null;
  website: string | null;
  bank_account_name: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_branch: string | null;
  upi_id: string | null;
  logo: Buffer | null;
  logo_content_type: 'image/png' | 'image/jpeg' | null;
}

const logger = new Logger('FirmPdf');

/**
 * The firm block of an invoice PDF from its settings row. A logo that will not
 * decode is left off (it was checked on upload) rather than failing the issue.
 */
export function firmForPdf(f: FirmPdfRow | undefined): InvoicePdfData['firm'] {
  let logo: InvoicePdfData['firm']['logo'] = null;
  if (f?.logo && f.logo_content_type) {
    try {
      logo = pdfImage(f.logo, f.logo_content_type);
    } catch (err) {
      logger.warn(`The firm logo was left off an invoice: ${(err as Error).message}`);
    }
  }
  const bank = {
    accountName: f?.bank_account_name ?? null,
    bankName: f?.bank_name ?? null,
    accountNumber: f?.bank_account_number ?? null,
    ifsc: f?.bank_ifsc ?? null,
    branch: f?.bank_branch ?? null,
    upiId: f?.upi_id ?? null,
  };
  return {
    name: f?.firm_name ?? '',
    address: f?.address ?? null,
    gstin: f?.gstin ?? null,
    stateCode: f?.state_code ?? null,
    pan: f?.pan ?? null,
    frn: f?.frn ?? null,
    phone: f?.phone ?? null,
    email: f?.email ?? null,
    website: f?.website ?? null,
    bank: Object.values(bank).some(Boolean) ? bank : null,
    logo,
  };
}
