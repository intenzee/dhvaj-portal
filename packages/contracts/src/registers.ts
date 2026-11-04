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

/*
 * PS-305 · DSC register and custody: every token the office holds, its
 * expiry and where it is now. The PIN is an ADR-0035 credential, revealed
 * only through the vault's checks and log.
 */

export const DSC_CLASSES = ['class3', 'dgft', 'other'] as const;
export type DscClass = (typeof DSC_CLASSES)[number];
export const DSC_CLASS_LABEL: Record<DscClass, string> = {
  class3: 'Class 3',
  dgft: 'DGFT',
  other: 'Other',
};

export const DSC_USAGES = ['sign', 'encrypt', 'both'] as const;
export type DscUsage = (typeof DSC_USAGES)[number];
export const DSC_USAGE_LABEL: Record<DscUsage, string> = {
  sign: 'Signing',
  encrypt: 'Encryption',
  both: 'Signing and encryption',
};

export const DSC_STATUSES = ['active', 'expired', 'returned_to_holder', 'lost'] as const;
export type DscStatus = (typeof DSC_STATUSES)[number];
export const DSC_STATUS_LABEL: Record<DscStatus, string> = {
  active: 'Active',
  expired: 'Expired',
  returned_to_holder: 'Returned to holder',
  lost: 'Lost',
};

export type DscMovementKind = 'out' | 'in' | 'returned_to_holder';
export const DSC_MOVEMENT_LABEL: Record<DscMovementKind, string> = {
  out: 'Checked out',
  in: 'Checked in',
  returned_to_holder: 'Returned to holder',
};

/** dsc_expiring nudges this many days before valid_to (and again at the second). */
export const DSC_EXPIRY_NUDGE_DAYS = [30, 7] as const;
/** The register's "at risk" view: expiring within this many days. */
export const DSC_AT_RISK_DAYS = 30;

/** The expiry nudge band a token is in: 30 (8–30 days left), 7 (0–7), else null. Pure. */
export function dscExpiryBand(daysLeft: number): 30 | 7 | null {
  if (daysLeft < 0) return null;
  if (daysLeft <= 7) return 7;
  if (daysLeft <= 30) return 30;
  return null;
}

/** A token's status as shown: an active token past valid_to reads Expired. Pure. */
export function dscEffectiveStatus(status: DscStatus, validTo: string, today: string): DscStatus {
  return status === 'active' && validTo < today ? 'expired' : status;
}

export type DscView = 'all' | 'at_risk' | 'out' | 'expiring' | 'gone';

export interface DscToken {
  id: string;
  officeId: string;
  officeName: string | null;
  holderName: string;
  holderPan: string | null;
  din: string | null;
  entityId: string | null;
  entityName: string | null;
  class: DscClass;
  usage: DscUsage;
  issuer: string | null;
  validFrom: string | null;
  validTo: string;
  /** Days until valid_to (negative once expired). */
  daysToExpiry: number;
  tokenSerial: string | null;
  inOffice: boolean;
  location: string | null;
  outWithEmployeeId: string | null;
  /** Who has it: the employee's name, or the person named at check-out. */
  outWithName: string | null;
  outSince: string | null;
  expectedBackAt: string | null;
  /** Out past expected_back_at. */
  overdueReturn: boolean;
  status: DscStatus;
  statusReason: string | null;
  notes: string | null;
  /** A PIN is in the vault (revealed only on request). */
  hasPin: boolean;
  version: number;
  link: WorkItemRef;
}

export interface DscMovement {
  id: string;
  kind: DscMovementKind;
  at: string;
  byName: string | null;
  withName: string | null;
  purpose: string | null;
  expectedBackAt: string | null;
}

export interface DscTokenDetail extends DscToken {
  movements: DscMovement[];
  /** The caller may keep and reveal the PIN (the client's logins rule). */
  canPin: boolean;
}

export interface DscListResponse {
  items: DscToken[];
  total: number;
  /** register.manage: may add tokens and change their details. */
  canManage: boolean;
}

export interface CreateDscTokenInput {
  holderName: string;
  holderPan?: string | null;
  din?: string | null;
  entityId?: string | null;
  /** The office that keeps it; the caller's by default. */
  officeId?: string | null;
  class?: DscClass;
  usage?: DscUsage;
  issuer?: string | null;
  validFrom?: string | null;
  validTo: string;
  tokenSerial?: string | null;
  location?: string | null;
  notes?: string | null;
  /** Kept in the vault, never in the register. */
  pin?: string | null;
}

export interface UpdateDscTokenInput {
  version: number;
  holderName?: string;
  holderPan?: string | null;
  din?: string | null;
  entityId?: string | null;
  class?: DscClass;
  usage?: DscUsage;
  issuer?: string | null;
  validFrom?: string | null;
  validTo?: string;
  tokenSerial?: string | null;
  location?: string | null;
  notes?: string | null;
}

export interface CheckOutDscInput {
  version: number;
  /** A colleague who takes it… */
  withEmployeeId?: string | null;
  /** …or someone else (the director, the client's accountant). */
  withName?: string | null;
  purpose: string;
  /** The day it is due back (YYYY-MM-DD). */
  expectedBackOn: string;
}

export interface CheckInDscInput {
  version: number;
  location?: string | null;
}

export interface ReleaseDscInput {
  version: number;
  status: 'returned_to_holder' | 'lost';
  reason: string;
}

export interface SetDscPinInput {
  pin: string;
}

export interface RevealedDscPin {
  pin: string;
  /** How long the screen shows it (seconds). */
  showSeconds: number;
}
