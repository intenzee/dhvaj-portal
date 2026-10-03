import type { WorkAreaKey } from '@hsdg/contracts';
import type { ActivityFlags } from './master-facts';

/**
 * The standard PBC request list (Audit Spec §16) — the client information a
 * statutory audit always needs, plus the requests the client master says this
 * client needs (inventory for a manufacturer, export proceeds for an exporter,
 * opening balances on a first-year audit, …). Pure: the service reads the facts
 * and inserts what this plans, so the team starts from a tailored list instead
 * of typing each request.
 */

/** Who at the client usually answers a request — matched to the contacts master. */
export type PbcOwnerRole = 'finance' | 'tax' | 'gst' | 'secretarial' | 'hr';

export interface StandardPbcFacts {
  isCompany: boolean;
  activityFlags: ActivityFlags;
  /** Borrowings on the master (null = unknown, asked anyway). */
  borrowings: number | null;
  hasGroupRelationships: boolean;
  hasSubsidiaries: boolean;
  initialAudit: boolean;
  /** Active work areas on the file — requests link to the one they support. */
  activeWorkAreas: ReadonlySet<string>;
}

export interface StandardPbcRequest {
  requirement: string;
  ownerRole: PbcOwnerRole;
  /** Linked when the file has this work area active. */
  workAreaKey: WorkAreaKey | null;
}

const req = (
  requirement: string,
  ownerRole: PbcOwnerRole,
  workAreaKey: WorkAreaKey | null = null,
): StandardPbcRequest => ({ requirement, ownerRole, workAreaKey });

/** Plan the standard list for one client. Order is the order the team asks in. */
export function planStandardPbcList(f: StandardPbcFacts): StandardPbcRequest[] {
  const a = f.activityFlags;
  const out: StandardPbcRequest[] = [
    req(
      'Trial balance and general ledger for the year, with prior-year comparatives',
      'finance',
      'schedule_iii_work',
    ),
    req(
      'Draft financial statements with notes and Schedule III groupings',
      'finance',
      'schedule_iii_work',
    ),
    req('Bank statements, year-end bank reconciliations and bank balance confirmations', 'finance'),
    req(
      'Fixed asset register with additions, disposals and invoices for major additions',
      'finance',
      'caro',
    ),
    req('Trade receivables ageing and party-wise balances, with confirmations', 'finance'),
    req('Trade payables ageing and party-wise balances, with MSME classification', 'finance'),
  ];

  if (a.manufacturing || a.trading || a.ecommerce) {
    out.push(
      req(
        'Inventory records, valuation working and physical verification reports',
        'finance',
        'caro',
      ),
    );
  }
  if (a.manufacturing) {
    out.push(req('Production, consumption and cost records for the year', 'finance'));
  }
  if (f.borrowings == null || f.borrowings > 0) {
    out.push(
      req(
        'Loan sanction letters, lender statements and stock/book-debt statements filed with banks',
        'finance',
        'caro',
      ),
    );
  }
  if (a.import) {
    out.push(req('Bills of entry and foreign-currency payment records for imports', 'finance'));
  }
  if (a.export) {
    out.push(req('Shipping bills, FIRC / e-BRC and export realisation status', 'finance'));
  }

  out.push(
    req('GST returns (GSTR-1, GSTR-3B, GSTR-9) and reconciliation with the books', 'gst'),
    req('TDS returns, challans and Form 26AS / AIS reconciliation', 'tax'),
    req('Income-tax return, computation and assessment orders for the prior year', 'tax'),
    req('Payroll registers, PF / ESI returns and challans', 'hr'),
    req('Board and general meeting minutes for the year', 'secretarial'),
  );
  if (f.isCompany) {
    out.push(
      req(
        'Statutory registers and MCA filings for the year (AOC-4, MGT-7, charge records)',
        'secretarial',
        'auditor_reporting',
      ),
    );
  }
  out.push(
    req('List of related parties and related-party transactions, with approvals', 'secretarial'),
    req(
      'Details of contingent liabilities, pending litigation and legal confirmations',
      'secretarial',
    ),
  );

  if (f.hasGroupRelationships) {
    out.push(req('Latest financial statements of group companies and investees', 'finance'));
  }
  if (f.hasSubsidiaries) {
    out.push(
      req(
        'Component financial statements, consolidation workings and component auditor reports',
        'finance',
        'cfs',
      ),
    );
  }
  if (f.initialAudit) {
    out.push(
      req(
        "Predecessor auditor's report, prior-year audited financial statements and opening-balance support",
        'finance',
      ),
    );
  }
  if (f.activeWorkAreas.has('ifc')) {
    out.push(
      req('Process notes and risk-control matrix for key processes (IFC)', 'finance', 'ifc'),
    );
  }
  if (f.activeWorkAreas.has('internal_audit_reliance')) {
    out.push(
      req(
        'Internal audit reports and management responses for the year',
        'finance',
        'internal_audit_reliance',
      ),
    );
  }

  return out.map((r) =>
    r.workAreaKey && !f.activeWorkAreas.has(r.workAreaKey) ? { ...r, workAreaKey: null } : r,
  );
}

/** Contact types on the contacts master that answer each kind of request. */
export const OWNER_CONTACT_TYPES: Record<PbcOwnerRole, readonly string[]> = {
  finance: ['cfo', 'finance_head', 'accounts'],
  tax: ['tax', 'cfo', 'finance_head', 'accounts'],
  gst: ['gst', 'tax', 'accounts', 'finance_head'],
  secretarial: ['cs', 'director', 'authorised_signatory'],
  hr: ['hr', 'accounts', 'finance_head'],
};

export interface ClientContact {
  fullName: string;
  designation: string | null;
  contactType: string | null;
  isPrimary: boolean;
}

/**
 * The client owner to show on a request: the first contact whose type answers
 * it (in preference order), else the primary contact, else none.
 */
export function pickClientOwner(
  role: PbcOwnerRole,
  contacts: readonly ClientContact[],
): string | null {
  for (const type of OWNER_CONTACT_TYPES[role]) {
    const c = contacts.find((x) => x.contactType === type);
    if (c) return label(c);
  }
  const primary = contacts.find((x) => x.isPrimary);
  return primary ? label(primary) : null;
}

function label(c: ClientContact): string {
  return c.designation?.trim() ? `${c.fullName} (${c.designation.trim()})` : c.fullName;
}

/** Same request, ignoring case and spacing — so a re-run never duplicates one. */
export function samePbcRequirement(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}
