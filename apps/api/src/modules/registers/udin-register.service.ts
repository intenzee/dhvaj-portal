import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  DEFAULT_UDIN_WINDOW_DAYS,
  REGISTER_UDIN_PATTERN,
  udinGeneratedLate,
  udinMembershipNo,
  type CreateUdinInput,
  type EngagementKind,
  type RevokeUdinInput,
  type UdinDocumentKind,
  type UdinEntry,
  type UdinListResponse,
  type UdinPendingItem,
  type UdinPartnerOption,
  type UdinPendingResponse,
  type UdinSource,
  type UdinStatus,
} from '@hsdg/contracts';
import { DatabaseService } from '../../database/database.service';
import type { RlsContext } from '../../database/rls-context';
import { translatePgError } from '../../common/errors/pg-error.util';
import { AuditService } from '../audit/audit.service';
import { istToday } from '../engagements/time/auto-time';

const STALE = 'Someone changed this entry since you opened it. Reload and try again.';
const UDIN_FORMAT =
  'A UDIN is 18 characters: the 2-digit year, the 6-digit membership no. and 10 letters or digits.';

export interface UdinListQuery {
  search?: string;
  documentKind?: UdinDocumentKind;
  status?: UdinStatus;
  financialYear?: string;
  partnerId?: string;
  entityId?: string;
  id?: string;
  limit?: number;
  offset?: number;
}

interface UdinRow {
  id: string;
  udin: string;
  document_kind: UdinDocumentKind;
  entity_id: string;
  entity_name: string;
  engagement_id: string | null;
  engagement_code: string | null;
  engagement_kind: EngagementKind | null;
  document_id: string | null;
  signing_partner_employee_id: string;
  signing_partner_name: string | null;
  membership_no: string | null;
  signed_on: string;
  generated_on: string;
  financial_year: string | null;
  description: string | null;
  source: UdinSource;
  status: UdinStatus;
  revoked_reason: string | null;
  revoked_at: Date | null;
  version: number;
  total?: string;
}

interface PendingRow {
  source_kind: 'archive' | 'tax_audit';
  source_id: string;
  document_kind: UdinDocumentKind;
  entity_id: string;
  entity_name: string;
  engagement_id: string;
  engagement_code: string;
  engagement_kind: EngagementKind;
  financial_year: string | null;
  partner_id: string | null;
  partner_name: string | null;
  signed_on: string;
  window_ends_on: string;
  days_left: number;
  total?: string;
}

/** The firm's UDIN window (days after signing). */
export async function udinWindowDays(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ w: number | null }>(
    `SELECT udin_window_days AS w FROM hsdg.firm_settings LIMIT 1`,
  );
  return rows[0]?.w ?? DEFAULT_UDIN_WINDOW_DAYS;
}

/**
 * Reports signed without a UDIN in the register, with their window: an
 * archived audit file signed off without one, or a tax audit signed without
 * one. A register entry for the same engagement and kind (and year, for a tax
 * audit) counts. Read under the caller's RLS. `$1` is today, `$2` the window.
 */
export const UDIN_PENDING_SQL = `
  SELECT p.*, (p.signed_on + $2::int)::text AS window_ends_on,
         (p.signed_on + $2::int) - $1::date AS days_left
    FROM (
      SELECT 'archive' AS source_kind, w.id AS source_id, 'audit_report' AS document_kind,
             e.entity_id, ent.legal_name AS entity_name, e.id AS engagement_id,
             e.engagement_code, e.kind AS engagement_kind, e.financial_year,
             COALESCE(w.signed_off_by_employee_id, e.engagement_partner_id) AS partner_id,
             COALESCE(w.report_date, timezone('Asia/Kolkata', w.signed_off_at)::date) AS signed_on
        FROM hsdg.service_workflow_instances w
        JOIN hsdg.engagements e ON e.id = w.engagement_id
        JOIN hsdg.entities ent ON ent.id = e.entity_id
       WHERE w.signed_off_at IS NOT NULL AND w.udin IS NULL
         AND NOT EXISTS (
               SELECT 1 FROM hsdg.udin_register r
                WHERE r.status = 'active'
                  AND (r.source_id = w.id
                       OR (r.engagement_id = e.id AND r.document_kind = 'audit_report')))
      UNION ALL
      SELECT 'tax_audit', a.id, 'tax_audit', e.entity_id, ent.legal_name, e.id,
             e.engagement_code, e.kind, a.financial_year,
             COALESCE(a.signed_by_employee_id, a.signing_partner_id),
             timezone('Asia/Kolkata', a.signed_at)::date
        FROM hsdg.tax_audits a
        JOIN hsdg.engagements e ON e.id = a.engagement_id
        JOIN hsdg.entities ent ON ent.id = e.entity_id
       WHERE a.signed_at IS NOT NULL AND a.udin IS NULL
         AND NOT EXISTS (
               SELECT 1 FROM hsdg.udin_register r
                WHERE r.status = 'active'
                  AND (r.source_id = a.id
                       OR (r.engagement_id = e.id AND r.document_kind = 'tax_audit'
                           AND r.financial_year = a.financial_year)))
    ) p`;

export function pendingItem(r: PendingRow, partnerName: string | null = null): UdinPendingItem {
  return {
    sourceKind: r.source_kind,
    sourceId: r.source_id,
    documentKind: r.document_kind,
    entityId: r.entity_id,
    entityName: r.entity_name,
    engagementId: r.engagement_id,
    engagementCode: r.engagement_code,
    engagementKind: r.engagement_kind,
    financialYear: r.financial_year,
    signingPartnerId: r.partner_id,
    signingPartnerName: r.partner_name ?? partnerName,
    signedOn: r.signed_on,
    windowEndsOn: r.window_ends_on,
    daysLeft: Number(r.days_left),
    overdue: Number(r.days_left) < 0,
    link:
      r.source_kind === 'tax_audit'
        ? {
            engagementId: r.engagement_id,
            engagementKind: r.engagement_kind,
            stream: 'tax_audit',
            financialYear: r.financial_year,
          }
        : { engagementId: r.engagement_id, engagementKind: r.engagement_kind },
  };
}

export type { PendingRow };

/**
 * Practice Services PS-304 — the UDIN register. Reads follow the client's
 * visibility (RLS); adding and revoking need register.manage (the
 * controller). A UDIN is never edited or deleted: a wrong one is revoked with
 * its reason and stays in the register.
 */
@Injectable()
export class UdinRegisterService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RlsContext, query: UdinListQuery, canManage: boolean): Promise<UdinListResponse> {
    return this.db.withRlsContext(ctx, async (client) => {
      const windowDays = await udinWindowDays(client);
      const where: string[] = [];
      const args: unknown[] = [];
      const arg = (v: unknown) => {
        args.push(v);
        return `$${args.length}`;
      };
      if (query.id) where.push(`r.id = ${arg(query.id)}`);
      if (query.documentKind) where.push(`r.document_kind = ${arg(query.documentKind)}`);
      if (query.status) where.push(`r.status = ${arg(query.status)}`);
      if (query.financialYear) where.push(`r.financial_year = ${arg(query.financialYear)}`);
      if (query.partnerId) where.push(`r.signing_partner_employee_id = ${arg(query.partnerId)}`);
      if (query.entityId) where.push(`r.entity_id = ${arg(query.entityId)}`);
      const search = query.search?.trim();
      if (search) {
        const p = arg(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        where.push(
          `(r.udin ILIKE ${p} OR ent.legal_name ILIKE ${p} OR e.engagement_code ILIKE ${p}
            OR sp.full_name ILIKE ${p} OR r.description ILIKE ${p})`,
        );
      }
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
      const offset = Math.max(query.offset ?? 0, 0);
      const { rows } = await client.query<UdinRow>(
        `${UDIN_SELECT}
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY r.signed_on DESC, r.created_at DESC
          LIMIT ${arg(limit)} OFFSET ${arg(offset)}`,
        args,
      );
      return {
        items: rows.map((r) => entryOf(r, windowDays)),
        total: Number(rows[0]?.total ?? 0),
        windowDays,
        canManage,
      };
    });
  }

  async pending(
    ctx: RlsContext,
    query: { view?: 'overdue' | 'all'; limit?: number; offset?: number },
  ): Promise<UdinPendingResponse> {
    return this.db.withRlsContext(ctx, async (client) => {
      const windowDays = await udinWindowDays(client);
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
      const offset = Math.max(query.offset ?? 0, 0);
      const { rows } = await client.query<PendingRow>(
        `SELECT x.*, sp.full_name AS partner_name, count(*) OVER () AS total
           FROM (${UDIN_PENDING_SQL}) x
           LEFT JOIN hsdg.employees sp ON sp.id = x.partner_id
          WHERE ($3::boolean IS NOT TRUE OR x.days_left < 0)
          ORDER BY x.window_ends_on, x.entity_name
          LIMIT $4 OFFSET $5`,
        [istToday(), windowDays, query.view === 'overdue', limit, offset],
      );
      return {
        items: rows.map((r) => pendingItem(r)),
        total: Number(rows[0]?.total ?? 0),
        windowDays,
      };
    });
  }

  /** Partners the caller can see who have a partner profile (the signers). */
  async partners(ctx: RlsContext): Promise<UdinPartnerOption[]> {
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{
        id: string;
        name: string;
        membership_no: string | null;
      }>(
        `SELECT emp.id, emp.full_name AS name, pp.membership_no
           FROM hsdg.partner_profiles pp
           JOIN hsdg.employees emp ON emp.id = pp.employee_id
          WHERE emp.employment_status = 'active'
          ORDER BY emp.full_name`,
      );
      return rows.map((r) => ({ employeeId: r.id, name: r.name, membershipNo: r.membership_no }));
    });
  }

  async create(ctx: RlsContext, input: CreateUdinInput): Promise<UdinEntry> {
    const udin = input.udin.trim().toUpperCase();
    if (!REGISTER_UDIN_PATTERN.test(udin)) throw new BadRequestException(UDIN_FORMAT);
    if (input.generatedOn < input.signedOn) {
      throw new BadRequestException(
        'A UDIN is generated on or after the day the report is signed.',
      );
    }
    if (input.generatedOn > istToday()) {
      throw new BadRequestException("The UDIN's generation date can't be in the future.");
    }
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows: partner } = await client.query<{ membership_no: string | null }>(
        `SELECT pp.membership_no FROM hsdg.employees emp
           LEFT JOIN hsdg.partner_profiles pp ON pp.employee_id = emp.id
          WHERE emp.id = $1`,
        [input.signingPartnerId],
      );
      if (!partner[0]) throw new BadRequestException('Choose the partner who signed the document.');
      const membershipNo = partner[0].membership_no?.trim() || null;
      if (membershipNo && /^\d{6}$/.test(membershipNo) && udinMembershipNo(udin) !== membershipNo) {
        throw new BadRequestException(
          `This UDIN carries membership no. ${udinMembershipNo(udin)}, but the signing partner's is ${membershipNo}.`,
        );
      }
      let id: string;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO hsdg.udin_register
             (udin, document_kind, entity_id, engagement_id, document_id,
              signing_partner_employee_id, membership_no, signed_on, generated_on,
              financial_year, description, created_by_employee_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            udin,
            input.documentKind,
            input.entityId,
            input.engagementId ?? null,
            input.documentId ?? null,
            input.signingPartnerId,
            membershipNo,
            input.signedOn,
            input.generatedOn,
            input.financialYear ?? null,
            input.description?.trim() || null,
            ctx.employeeId ?? null,
          ],
        );
        id = rows[0]!.id;
      } catch (err) {
        throw translatePgError(err, {
          unique: [
            {
              match: 'udin_register_udin_key',
              message: `UDIN ${udin} is already in the register.`,
            },
          ],
          check: 'The entry is not valid. Check the UDIN and dates.',
          forbidden: 'You can add UDINs only for clients you can see, on one of their engagements.',
        });
      }
      await this.audit.recordWith(client, ctx, {
        action: 'udin.registered',
        objectType: 'udin_register',
        objectId: id,
        after: {
          udin,
          documentKind: input.documentKind,
          entityId: input.entityId,
          engagementId: input.engagementId ?? null,
          signedOn: input.signedOn,
          generatedOn: input.generatedOn,
        },
      });
      return this.readOne(client, id);
    });
  }

  async revoke(ctx: RlsContext, id: string, input: RevokeUdinInput): Promise<UdinEntry> {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException('Say why the UDIN is revoked.');
    return this.db.withRlsContext(ctx, async (client) => {
      const { rows } = await client.query<{ status: UdinStatus; version: number; udin: string }>(
        `SELECT status, version, udin FROM hsdg.udin_register WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const r = rows[0];
      if (!r) throw new NotFoundException('UDIN not found.');
      if (r.version !== input.version) throw new ConflictException(STALE);
      if (r.status === 'revoked') throw new ConflictException('This UDIN is already revoked.');
      await client.query(
        `UPDATE hsdg.udin_register
            SET status = 'revoked', revoked_reason = $2, revoked_at = now(),
                revoked_by_employee_id = $3, version = version + 1
          WHERE id = $1`,
        [id, reason, ctx.employeeId ?? null],
      );
      await this.audit.recordWith(client, ctx, {
        action: 'udin.revoked',
        objectType: 'udin_register',
        objectId: id,
        after: { udin: r.udin, reason },
      });
      return this.readOne(client, id);
    });
  }

  /** The register as CSV, for peer review (every row the caller can see, filtered). */
  async csv(ctx: RlsContext, query: UdinListQuery): Promise<string> {
    const all: UdinEntry[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await this.list(ctx, { ...query, limit: 500, offset }, false);
      all.push(...page.items);
      if (page.items.length < 500) break;
    }
    const head = [
      'UDIN',
      'Document',
      'Client',
      'Engagement',
      'Financial year',
      'Signing partner',
      'Membership no.',
      'Signed on',
      'Generated on',
      'Generated late',
      'Status',
      'Revoked reason',
      'Description',
    ];
    const lines = all.map((e) =>
      [
        e.udin,
        e.documentKind,
        e.entityName,
        e.engagementCode ?? '',
        e.financialYear ?? '',
        e.signingPartnerName ?? '',
        e.membershipNo ?? '',
        e.signedOn,
        e.generatedOn,
        e.late ? 'Yes' : 'No',
        e.status,
        e.revokedReason ?? '',
        e.description ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
    return [head.join(','), ...lines].join('\r\n') + '\r\n';
  }

  private async readOne(client: PoolClient, id: string): Promise<UdinEntry> {
    const windowDays = await udinWindowDays(client);
    const { rows } = await client.query<UdinRow>(`${UDIN_SELECT} WHERE r.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundException('UDIN not found.');
    return entryOf(rows[0], windowDays);
  }
}

const UDIN_SELECT = `
  SELECT r.id, r.udin, r.document_kind, r.entity_id, ent.legal_name AS entity_name,
         r.engagement_id, e.engagement_code, e.kind AS engagement_kind, r.document_id,
         r.signing_partner_employee_id, sp.full_name AS signing_partner_name, r.membership_no,
         r.signed_on::text, r.generated_on::text, r.financial_year, r.description, r.source,
         r.status, r.revoked_reason, r.revoked_at, r.version, count(*) OVER () AS total
    FROM hsdg.udin_register r
    JOIN hsdg.entities ent ON ent.id = r.entity_id
    LEFT JOIN hsdg.engagements e ON e.id = r.engagement_id
    LEFT JOIN hsdg.employees sp ON sp.id = r.signing_partner_employee_id`;

function entryOf(r: UdinRow, windowDays: number): UdinEntry {
  return {
    id: r.id,
    udin: r.udin,
    documentKind: r.document_kind,
    entityId: r.entity_id,
    entityName: r.entity_name,
    engagementId: r.engagement_id,
    engagementCode: r.engagement_code,
    documentId: r.document_id,
    signingPartnerId: r.signing_partner_employee_id,
    signingPartnerName: r.signing_partner_name,
    membershipNo: r.membership_no,
    signedOn: r.signed_on,
    generatedOn: r.generated_on,
    financialYear: r.financial_year,
    description: r.description,
    source: r.source,
    status: r.status,
    revokedReason: r.revoked_reason,
    revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
    late: udinGeneratedLate(r.signed_on, r.generated_on, windowDays),
    version: r.version,
    link: {
      engagementId: r.engagement_id ?? '',
      engagementKind: r.engagement_kind ?? 'compliance',
      udinId: r.id,
    },
  };
}

/** One CSV cell: quoted when it holds a comma, quote or line break; formulas defused. */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
