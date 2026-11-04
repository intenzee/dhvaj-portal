import type { EngagementKind } from './engagement-restructure';
import { isoDaysBefore } from './tax-audit-milestones';
import type { WorkItemRef } from './work-links';

/**
 * Practice Services Phase 3 — the firm's registers (behind ff_registers).
 *
 * PS-304 · UDIN register: every UDIN the firm generated, the document it is
 * for and its signing partner, so peer review reads one list; and the reports
 * signed without one, against the firm's window (udin_window_days).
 */

/** UDIN (as the archive record): 2-digit year, 6-digit membership no., 10 letters or digits. */
export const REGISTER_UDIN_PATTERN = /^[0-9]{8}[A-Z0-9]{10}$/;

export const UDIN_DOCUMENT_KINDS = [
  'audit_report',
  'tax_audit',
  'gst_audit',
  'certificate',
  'other',
] as const;
export type UdinDocumentKind = (typeof UDIN_DOCUMENT_KINDS)[number];
export const UDIN_DOCUMENT_KIND_LABEL: Record<UdinDocumentKind, string> = {
  audit_report: 'Audit report',
  tax_audit: 'Tax audit report',
  gst_audit: 'GST audit',
  certificate: 'Certificate',
  other: 'Other',
};

export type UdinSource = 'manual' | 'archive' | 'tax_audit';
export type UdinStatus = 'active' | 'revoked';

/** The default UDIN window (days after signing), until the firm sets its own. */
export const DEFAULT_UDIN_WINDOW_DAYS = 60;
/** The window-closing nudge goes this many days before the window ends. */
export const UDIN_WINDOW_NUDGE_DAYS = 7;

/** The membership no. inside a UDIN (characters 3–8). */
export function udinMembershipNo(udin: string): string {
  return udin.slice(2, 8);
}

/** The last day a UDIN may be generated for a report signed on `signedOn`. */
export function udinWindowEnd(signedOn: string, windowDays: number): string {
  return isoDaysBefore(signedOn, -windowDays);
}

/** Whether a UDIN was generated after the window closed. */
export function udinGeneratedLate(
  signedOn: string,
  generatedOn: string,
  windowDays: number,
): boolean {
  return generatedOn > udinWindowEnd(signedOn, windowDays);
}

export interface UdinEntry {
  id: string;
  udin: string;
  documentKind: UdinDocumentKind;
  entityId: string;
  entityName: string;
  engagementId: string | null;
  engagementCode: string | null;
  documentId: string | null;
  signingPartnerId: string;
  signingPartnerName: string | null;
  membershipNo: string | null;
  signedOn: string;
  generatedOn: string;
  financialYear: string | null;
  description: string | null;
  source: UdinSource;
  status: UdinStatus;
  revokedReason: string | null;
  revokedAt: string | null;
  /** Generated after the firm's window closed (for peer review). */
  late: boolean;
  version: number;
  link: WorkItemRef;
}

export interface UdinListResponse {
  items: UdinEntry[];
  total: number;
  windowDays: number;
  /** register.manage: may add and revoke entries. */
  canManage: boolean;
}

/** A report signed without a UDIN in the register. */
export interface UdinPendingItem {
  sourceKind: 'archive' | 'tax_audit';
  sourceId: string;
  documentKind: UdinDocumentKind;
  entityId: string;
  entityName: string;
  engagementId: string;
  engagementCode: string;
  engagementKind: EngagementKind;
  financialYear: string | null;
  signingPartnerId: string | null;
  signingPartnerName: string | null;
  signedOn: string;
  windowEndsOn: string;
  /** Days until the window ends; negative once it has passed. */
  daysLeft: number;
  overdue: boolean;
  link: WorkItemRef;
}

export interface UdinPendingResponse {
  items: UdinPendingItem[];
  total: number;
  windowDays: number;
}

export interface CreateUdinInput {
  udin: string;
  documentKind: UdinDocumentKind;
  entityId: string;
  engagementId?: string | null;
  documentId?: string | null;
  signingPartnerId: string;
  signedOn: string;
  generatedOn: string;
  financialYear?: string | null;
  description?: string | null;
}

export interface RevokeUdinInput {
  reason: string;
  version: number;
}

/** One risk tile's worth of register items (PS-301 reads it). */
export interface RegisterRiskItem {
  ref: WorkItemRef;
  title: string;
  detail: string;
  dueOn: string | null;
}

export interface RegisterRiskTile {
  count: number;
  items: RegisterRiskItem[];
  /** The full list: '/registers/udin?view=overdue' | '/registers/dsc?view=at_risk'. */
  href: string;
}

/** A partner who can sign (has a partner profile), for the UDIN form. */
export interface UdinPartnerOption {
  employeeId: string;
  name: string;
  membershipNo: string | null;
}
