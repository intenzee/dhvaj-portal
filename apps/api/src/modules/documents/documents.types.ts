import type {
  DocumentClassification,
  DocumentSensitivity,
  DocumentStatus,
  DocumentType,
} from '@hsdg/contracts';

/** One immutable version in a document's chain. Storage reference is never exposed. */
export interface DocumentVersionRecord {
  id: string;
  documentId: string;
  versionNo: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  note: string | null;
  uploadedById: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
}

/** A logical document with a summary of its current version. */
export interface DocumentRecord {
  id: string;
  engagementId: string;
  /** Optional task this document is filed under (same engagement); null = engagement-level. */
  taskId: string | null;
  /** Optional component-work period (e.g. GST for a month) this document is filed under. */
  componentInstanceId: string | null;
  /** Optional checklist requirement this document satisfies (see doc requirements). */
  docRequirementId: string | null;
  title: string;
  documentType: DocumentType;
  classification: DocumentClassification;
  sensitivity: DocumentSensitivity;
  status: DocumentStatus;
  currentVersionNo: number;
  currentFilename: string | null;
  currentContentType: string | null;
  currentSizeBytes: number | null;
  retentionUntil: string | null;
  archivedAt: string | null;
  archivedById: string | null;
  /** When set, the document is soft-deleted (hidden everywhere; restorable by a managing partner). */
  deletedAt: string | null;
  createdById: string | null;
  createdByName: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetail extends DocumentRecord {
  versions: DocumentVersionRecord[];
}

/** A document plus its engagement/client context — for the cross-engagement view. */
export interface GlobalDocumentRecord extends DocumentRecord {
  engagementCode: string;
  entityName: string | null;
}

/** The bytes plus what a caller needs to save them — returned by download. */
export interface DocumentDownload {
  buffer: Buffer;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface CreateDocumentInput {
  title: string;
  /** File the document under a specific task (same engagement). */
  taskId?: string | null;
  /** File the document under a specific component-work period (same engagement). */
  componentInstanceId?: string | null;
  /** Tag the document as satisfying a checklist requirement of that component. */
  docRequirementId?: string | null;
  documentType?: DocumentType;
  classification?: DocumentClassification;
  sensitivity?: DocumentSensitivity;
  retentionUntil?: string;
  filename: string;
  contentType?: string;
  contentBase64: string;
}

export interface AddVersionInput {
  filename: string;
  contentType?: string;
  contentBase64: string;
  note?: string;
}

export interface UpdateDocumentInput {
  title?: string;
  documentType?: DocumentType;
  classification?: DocumentClassification;
  sensitivity?: DocumentSensitivity;
  retentionUntil?: string | null;
  version?: number;
}

export interface ArchiveDocumentInput {
  reason: string;
  version?: number;
}
