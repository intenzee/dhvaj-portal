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
}

export interface CreateInvoiceInput {
  currency?: string;
  dueDate?: string | null;
  taxAmount?: string;
  notes?: string | null;
  lines?: InvoiceLineInput[];
}

export interface UpdateInvoiceInput {
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
  version?: number;
}
