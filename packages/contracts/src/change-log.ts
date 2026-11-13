/**
 * Change log: every add, edit and removal on a client or an engagement, kept
 * by the database (who, when, each field's old → new). Managing Partner and
 * administrator only.
 */

/** The record kinds the log covers, by table, as the firm reads them. */
export const CHANGE_LOG_AREAS: Record<string, string> = {
  entities: 'Client',
  entity_registrations: 'Registration',
  entity_contacts: 'Contact',
  entity_addresses: 'Address',
  entity_branches: 'Office',
  entity_business_activities: 'Business activity',
  entity_financial_profiles: 'Financials',
  entity_listings: 'Listing',
  entity_relationships: 'Relationship',
  entity_regulatory_attributes: 'Regulatory attribute',
  registration_compliance_profiles: 'Compliance profile',
  client_credentials: 'Portal login',
  engagements: 'Engagement',
  compliance_engagement_years: 'Engagement year',
  engagement_services: 'Engagement service',
  engagement_team: 'Engagement team',
  engagement_commercial: 'Commercial terms',
  engagement_fee_milestones: 'Fee milestone',
  engagement_entities: 'Engagement client',
  engagement_offices: 'Engagement office',
  // A file uploaded (version 1); later uploads read "File version".
  document_versions: 'File',
  // A file renamed, reclassified, archived, deleted or restored.
  documents: 'File details',
};

/**
 * The area an entry reads as: by its table, except that a file's later
 * uploads are "File version" (its first upload is the file added). Pure — tested.
 */
export function changeLogArea(table: string, changes?: Record<string, unknown> | null): string {
  if (table === 'document_versions') {
    const v = Number(changes?.version_no);
    if (Number.isFinite(v) && v > 1) return 'File version';
  }
  return CHANGE_LOG_AREAS[table] ?? table;
}

/** Columns whose plain name does not read well. */
const FIELD_LABELS: Record<string, string> = {
  filename: 'File name',
  content_type: 'File type',
  size_bytes: 'Size (bytes)',
  version_no: 'Version',
  document_id: 'File',
  document_type: 'Kind of document',
  uploaded_by_employee_id: 'Uploaded by',
  deleted_by_employee_id: 'Deleted by',
  archived_by_employee_id: 'Archived by',
  retention_until: 'Keep until',
};

export type ChangeLogOp = 'insert' | 'update' | 'delete';

/** A field as it was and as it became (an insert has no before, a delete no after). */
export interface ChangeLogField {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
}

export interface ChangeLogEntry {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  table: string;
  area: string;
  op: ChangeLogOp;
  rowId: string | null;
  label: string | null;
  entityId: string | null;
  entityCode: string | null;
  entityName: string | null;
  engagementId: string | null;
  engagementCode: string | null;
  fields: ChangeLogField[];
}

/** GET /change-log query. */
export interface ChangeLogQuery {
  entityId?: string;
  engagementId?: string;
  actorUserId?: string;
  table?: string;
  op?: ChangeLogOp;
  /** Free text: client name / code, engagement code, record label. */
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** A column name as a label: engagement_partner_id → Engagement partner. */
export function changeLogFieldLabel(field: string): string {
  const known = FIELD_LABELS[field];
  if (known) return known;
  const base = field.replace(/_(id|ids)$/, '').replace(/_/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
}
