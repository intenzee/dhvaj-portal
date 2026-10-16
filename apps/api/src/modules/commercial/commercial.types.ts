import type { BillingFrequency, InvoiceStatus } from '@hsdg/contracts';

export interface UpsertCommercialInput {
  billingFrequency?: BillingFrequency;
  effectiveDate?: string | null;
  endDate?: string | null;
  retainerAmount?: string | null;
  scopeNotes?: string | null;
}

export interface InvoiceLineInput {
  description: string;
  quantity?: string;
  unitAmount?: string;
  engagementComponentId?: string | null;
  sortOrder?: number;
  sacCode?: string;
  gstRate?: number;
}

/** PS-201: the GST facts of a draft. */
interface InvoiceGstInput {
  clientGstin?: string | null;
  placeOfSupplyState?: string | null;
  isReverseCharge?: boolean;
}

export interface CreateInvoiceInput extends InvoiceGstInput {
  currency?: string;
  dueDate?: string | null;
  taxAmount?: string;
  notes?: string | null;
  lines?: InvoiceLineInput[];
}

export interface UpdateInvoiceInput extends InvoiceGstInput {
  currency?: string;
  issueDate?: string | null;
  dueDate?: string | null;
  taxAmount?: string;
  notes?: string | null;
  version?: number;
}

export interface SetInvoiceStatusInput {
  status: InvoiceStatus;
  issueDate?: string;
  /** Required to void an issued invoice. */
  reason?: string;
  version?: number;
}
