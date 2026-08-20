/**
 * Document vocabulary (Phase 10) shared by the API and web.
 *
 * A document is engagement-scoped professional evidence. The actual bytes live
 * in blob storage (Azure Blob in production, a local filesystem provider in
 * dev/test); PostgreSQL holds only metadata and an opaque storage reference.
 * Access inherits engagement permissions, and every version is retained —
 * completed/signed-off evidence is never silently replaced.
 */

/** What kind of professional document this is. */
export const DOCUMENT_TYPE = {
  engagementLetter: 'engagement_letter',
  workingPaper: 'working_paper',
  evidence: 'evidence',
  financialStatement: 'financial_statement',
  report: 'report',
  correspondence: 'correspondence',
  filing: 'filing',
  acknowledgement: 'acknowledgement',
  certificate: 'certificate',
  other: 'other',
} as const;
export type DocumentType = (typeof DOCUMENT_TYPE)[keyof typeof DOCUMENT_TYPE];
export const DOCUMENT_TYPES: DocumentType[] = Object.values(DOCUMENT_TYPE);

/** How widely the document may be shared (access nature). */
export const DOCUMENT_CLASSIFICATION = {
  internal: 'internal',
  clientShared: 'client_shared',
  confidential: 'confidential',
  restricted: 'restricted',
} as const;
export type DocumentClassification =
  (typeof DOCUMENT_CLASSIFICATION)[keyof typeof DOCUMENT_CLASSIFICATION];
export const DOCUMENT_CLASSIFICATIONS: DocumentClassification[] =
  Object.values(DOCUMENT_CLASSIFICATION);

/** Data-sensitivity tier (orthogonal to classification). */
export const DOCUMENT_SENSITIVITY = {
  normal: 'normal',
  sensitive: 'sensitive',
  highlySensitive: 'highly_sensitive',
} as const;
export type DocumentSensitivity =
  (typeof DOCUMENT_SENSITIVITY)[keyof typeof DOCUMENT_SENSITIVITY];
export const DOCUMENT_SENSITIVITIES: DocumentSensitivity[] = Object.values(DOCUMENT_SENSITIVITY);

/** Lifecycle of the logical document (its version chain is always retained). */
export const DOCUMENT_STATUS = {
  active: 'active',
  archived: 'archived',
} as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];
export const DOCUMENT_STATUSES: DocumentStatus[] = Object.values(DOCUMENT_STATUS);
